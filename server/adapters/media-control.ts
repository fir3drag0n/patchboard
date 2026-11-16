// The Media page's controls: stop a stream, and each library with Scan.
// Plex itself (address and token) scans and stops; without it, Tautulli
// lists Plex's libraries and stops streams. Jellyfin and Emby do both with
// their API key. Every call goes from this server; the browser never talks
// to a media server.

import type { MediaLibrary, MediaServerId } from '../../shared/types.ts';
import { config } from '../config.ts';
import { getJson, HttpError, request } from '../http.ts';
import { authHeaders, type MediaKind } from './mediaserver.ts';

/** What a viewer reads when their stream stops. */
export const STOP_MESSAGE = 'The server’s owner stopped this stream.';

export interface MediaControl {
  stop: (session: string) => Promise<void>;
  libraries: () => Promise<MediaLibrary[]>;
  /** Missing when this server can list libraries but not scan them. */
  scan?: (id: string) => Promise<void>;
}

// ---------- Plex ----------

interface PlexSection {
  key: string;
  title: string;
  type?: string;
  refreshing?: boolean;
  scannedAt?: number;
}

const PLEX_KIND: Record<string, MediaLibrary['kind']> = { movie: 'movies', show: 'shows', artist: 'music', photo: 'photos' };

export function fromPlexSections(dirs: PlexSection[], counts: Map<string, number> = new Map()): MediaLibrary[] {
  return dirs.map((d) => ({
    server: 'plex',
    id: String(d.key),
    name: d.title,
    kind: PLEX_KIND[d.type ?? ''] ?? 'other',
    ...(counts.has(String(d.key)) ? { count: counts.get(String(d.key)) } : {}),
    scanning: !!d.refreshing,
    ...(d.scannedAt ? { scannedAt: d.scannedAt * 1000 } : {}),
    canScan: true,
  }));
}

function plex() {
  const { url, key } = config.plex!;
  const headers = { Accept: 'application/json', 'X-Plex-Token': key, 'X-Plex-Client-Identifier': 'patchboard', 'X-Plex-Product': 'Patchboard' };
  return { url, headers };
}

async function plexCall(path: string): Promise<Response> {
  const { url, headers } = plex();
  try {
    return await request(`${url}${path}`, { headers }, 15_000);
  } catch (err) {
    // Plex stops a stream for a Plex Pass server only, and answers 401 otherwise.
    if (err instanceof HttpError && (err.status === 401 || err.status === 403) && path.startsWith('/status/sessions/terminate')) throw new Error('Plex stops a stream only on a server with Plex Pass.');
    throw err;
  }
}

export async function plexSections(): Promise<PlexSection[]> {
  const { url, headers } = plex();
  return (await getJson<{ MediaContainer?: { Directory?: PlexSection[] } }>(`${url}/library/sections`, { headers }, 15_000)).MediaContainer?.Directory ?? [];
}

// ---------- Tautulli ----------

async function tautulli<T>(cmd: string, extra = ''): Promise<T> {
  const { url, key } = config.tautulli!;
  const r = await getJson<{ response: { result: string; message?: string; data: T } }>(`${url}/api/v2?apikey=${encodeURIComponent(key)}&cmd=${cmd}${extra}`, {}, 15_000);
  if (r.response.result !== 'success') throw new Error(r.response.message ?? 'Tautulli refused the request');
  return r.response.data;
}

interface TautulliLibrary {
  section_id: string | number;
  section_name: string;
  section_type?: string;
  count?: string | number;
}

export function fromTautulliLibraries(libs: TautulliLibrary[], canScan: boolean): MediaLibrary[] {
  return libs.map((l) => ({
    server: 'plex',
    id: String(l.section_id),
    name: l.section_name,
    kind: PLEX_KIND[l.section_type ?? ''] ?? 'other',
    ...(Number(l.count) ? { count: Number(l.count) } : {}),
    canScan,
  }));
}

// ---------- Jellyfin and Emby ----------

interface VirtualFolder {
  Name: string;
  ItemId?: string;
  Id?: string;
  CollectionType?: string;
  RefreshStatus?: string;
}

const JELLY_KIND: Record<string, MediaLibrary['kind']> = { movies: 'movies', tvshows: 'shows', music: 'music', homevideos: 'photos', photos: 'photos' };

export function fromVirtualFolders(server: MediaKind, folders: VirtualFolder[]): MediaLibrary[] {
  return folders
    .filter((f) => f.ItemId ?? f.Id)
    .map((f) => ({
      server,
      id: String(f.ItemId ?? f.Id),
      name: f.Name,
      kind: JELLY_KIND[f.CollectionType ?? ''] ?? 'other',
      scanning: f.RefreshStatus === 'Active' || f.RefreshStatus === 'Running',
      canScan: true,
    }));
}

function jellyControl(kind: MediaKind): MediaControl {
  const { url, key } = config[kind]!;
  const headers = { Accept: 'application/json', 'Content-Type': 'application/json', ...authHeaders(kind, key) };
  return {
    async stop(session) {
      // Say why first; a client that can't show messages still stops.
      await request(`${url}/Sessions/${encodeURIComponent(session)}/Message`, { method: 'POST', headers, body: JSON.stringify({ Header: 'Patchboard', Text: STOP_MESSAGE, TimeoutMs: 10_000 }) }, 8000).catch(() => {});
      await request(`${url}/Sessions/${encodeURIComponent(session)}/Playing/Stop`, { method: 'POST', headers }, 15_000);
    },
    async libraries() {
      const libs = fromVirtualFolders(kind, await getJson<VirtualFolder[]>(`${url}/Library/VirtualFolders`, { headers }, 15_000));
      // How many films, shows or albums each holds; a server that won't say just shows none.
      await Promise.all(
        libs.map(async (l) => {
          const types = l.kind === 'movies' ? 'Movie' : l.kind === 'shows' ? 'Series' : l.kind === 'music' ? 'MusicAlbum' : '';
          if (!types) return;
          try {
            const r = await getJson<{ TotalRecordCount?: number }>(`${url}/Items?ParentId=${encodeURIComponent(l.id)}&Recursive=true&IncludeItemTypes=${types}&Limit=0`, { headers }, 10_000);
            if (typeof r.TotalRecordCount === 'number') l.count = r.TotalRecordCount;
          } catch {
            /* the count is a nicety */
          }
        }),
      );
      return libs;
    },
    async scan(id) {
      await request(`${url}/Items/${encodeURIComponent(id)}/Refresh?Recursive=true&ImageRefreshMode=Default&MetadataRefreshMode=Default&ReplaceAllImages=false&ReplaceAllMetadata=false`, { method: 'POST', headers }, 15_000);
    },
  };
}

// ---------- Which control each server has ----------

export function mediaControl(server: MediaServerId): MediaControl | undefined {
  if (server === 'jellyfin' || server === 'emby') return config[server] ? jellyControl(server) : undefined;
  if (config.plex) {
    return {
      async stop(session) {
        await plexCall(`/status/sessions/terminate?sessionId=${encodeURIComponent(session)}&reason=${encodeURIComponent(STOP_MESSAGE)}`);
      },
      async libraries() {
        // Tautulli knows how much each library holds; Plex's own list doesn't say.
        const counts = new Map<string, number>();
        if (config.tautulli) {
          try {
            for (const l of await tautulli<TautulliLibrary[]>('get_libraries')) if (Number(l.count)) counts.set(String(l.section_id), Number(l.count));
          } catch {
            /* counts are a nicety */
          }
        }
        return fromPlexSections(await plexSections(), counts);
      },
      async scan(id) {
        await plexCall(`/library/sections/${encodeURIComponent(id)}/refresh`);
      },
    };
  }
  if (config.tautulli) {
    return {
      async stop(session) {
        await tautulli('terminate_session', `&session_id=${encodeURIComponent(session)}&message=${encodeURIComponent(STOP_MESSAGE)}`);
      },
      async libraries() {
        return fromTautulliLibraries(await tautulli<TautulliLibrary[]>('get_libraries'), false);
      },
    };
  }
  return undefined;
}
