// The Media page's controls: stop a stream, and each library with Scan.
// Plex itself (address and token) scans and stops; without it, Tautulli
// lists Plex's libraries and stops streams. Jellyfin and Emby do both with
// their API key. Every call goes from this server; the browser never talks
// to a media server.

import type { LibraryDetail, MediaLibrary, MediaServerId, RecentItem } from '../../shared/types.ts';
import { config } from '../config.ts';
import { getJson, HttpError, request } from '../http.ts';
import { authHeaders, type Item, type MediaKind, toRecent } from './mediaserver.ts';
import { fromPlexRecent, type PlexItem } from './plex.ts';

/** What a viewer reads when their stream stops. */
export const STOP_MESSAGE = 'The server’s owner stopped this stream.';

export interface MediaControl {
  stop: (session: string) => Promise<void>;
  libraries: () => Promise<MediaLibrary[]>;
  /** Missing when this server can list libraries but not scan them. */
  scan?: (id: string) => Promise<void>;
  /** What one library holds and what came in last; missing without the server's own API. */
  library?: (id: string) => Promise<LibraryDetail>;
}

/** How many to show of what came in last. */
const RECENT = 12;
/** How many to read for them: a season drop takes many episodes, and they share one poster. */
const NEWEST = 60;

/**
 * Episodes of one show land together, so one poster stands for the show with
 * how many came in, and a season drop leaves room for the rest. `showId`
 * turns an episode's id into its show's, for the poster's link.
 */
export function byShow(items: RecentItem[], showId: (episode: string) => string | undefined = () => undefined): RecentItem[] {
  const out: RecentItem[] = [];
  const shows = new Map<string, RecentItem>();
  for (const r of items) {
    const seen = r.type === 'episode' ? shows.get(r.title) : undefined;
    if (seen) {
      seen.episodes = (seen.episodes ?? 1) + 1;
      continue;
    }
    const copy = { ...r };
    if (r.type === 'episode') shows.set(r.title, copy);
    out.push(copy);
  }
  return out.slice(0, RECENT).map(({ subtitle, ...r }) => (r.episodes ? { ...r, id: showId(r.id) ?? r.id } : { ...r, ...(subtitle ? { subtitle } : {}) }));
}

// ---------- Plex ----------

interface PlexSection {
  key: string;
  title: string;
  type?: string;
  refreshing?: boolean;
  scannedAt?: number;
  Location?: { path?: string }[];
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

/** A Plex library opened: its folders, its newest arrivals, and episodes or tracks when it has them. */
export function plexLibraryDetail(section: PlexSection | undefined, recent: PlexItem[], total?: number): LibraryDetail {
  const kind = PLEX_KIND[section?.type ?? ''];
  return {
    ...(total != null && kind === 'shows' ? { episodes: total } : {}),
    ...(total != null && kind === 'music' ? { tracks: total } : {}),
    folders: (section?.Location ?? []).map((l) => l.path ?? '').filter(Boolean),
    recent: byShow(fromPlexRecent(recent), (id) => recent.find((it) => it.ratingKey === id)?.grandparentRatingKey),
  };
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
  Locations?: string[];
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

/** A Jellyfin or Emby library opened, in the same shape as Plex's. */
export function jellyLibraryDetail(server: MediaKind, folder: VirtualFolder | undefined, recent: Item[], total?: number): LibraryDetail {
  const kind = JELLY_KIND[folder?.CollectionType ?? ''];
  return {
    ...(total != null && kind === 'shows' ? { episodes: total } : {}),
    ...(total != null && kind === 'music' ? { tracks: total } : {}),
    folders: folder?.Locations ?? [],
    // An episode's id is already its show's.
    recent: byShow(recent.map((it) => toRecent(server, it))),
  };
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
    async library(id) {
      const folder = (await getJson<VirtualFolder[]>(`${url}/Library/VirtualFolders`, { headers }, 15_000)).find((f) => String(f.ItemId ?? f.Id) === id);
      if (!folder) throw new Error(`${kind === 'jellyfin' ? 'Jellyfin' : 'Emby'} no longer has that library.`);
      const lib = JELLY_KIND[folder.CollectionType ?? ''] ?? 'other';
      const p = encodeURIComponent(id);
      const newest = lib === 'shows' ? 'Episode' : lib === 'music' ? 'MusicAlbum' : lib === 'movies' ? 'Movie' : 'Movie,Episode,MusicAlbum,Video,Photo';
      const counted = lib === 'shows' ? 'Episode' : lib === 'music' ? 'Audio' : '';
      const [recent, all] = await Promise.all([
        getJson<{ Items?: Item[] }>(`${url}/Items?ParentId=${p}&Recursive=true&SortBy=DateCreated&SortOrder=Descending&IncludeItemTypes=${newest}&Limit=${NEWEST}&Fields=DateCreated,ProductionYear`, { headers }, 15_000),
        counted ? getJson<{ TotalRecordCount?: number }>(`${url}/Items?ParentId=${p}&Recursive=true&IncludeItemTypes=${counted}&Limit=0`, { headers }, 15_000).catch(() => undefined) : undefined,
      ]);
      return jellyLibraryDetail(kind, folder, recent.Items ?? [], all?.TotalRecordCount);
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
      async library(id) {
        const { url, headers } = plex();
        const get = <T>(path: string) => getJson<{ MediaContainer?: T }>(`${url}${path}`, { headers }, 15_000).then((r) => r.MediaContainer);
        const section = (await plexSections()).find((s) => String(s.key) === id);
        if (!section) throw new Error('Plex no longer has that library.');
        const e = encodeURIComponent(id);
        // Plex's types: 4 is an episode, 10 a track. Size 0 asks for the count alone.
        const type = ({ show: 4, artist: 10 } as Record<string, number>)[section.type ?? ''];
        const [recent, all] = await Promise.all([
          get<{ Metadata?: PlexItem[] }>(`/library/sections/${e}/recentlyAdded?X-Plex-Container-Start=0&X-Plex-Container-Size=${NEWEST}`),
          type ? get<{ totalSize?: number }>(`/library/sections/${e}/all?type=${type}&X-Plex-Container-Start=0&X-Plex-Container-Size=0`).catch(() => undefined) : undefined,
        ]);
        return plexLibraryDetail(section, recent?.Metadata ?? [], all?.totalSize);
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
