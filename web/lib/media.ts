// Plex (straight, or through Tautulli), Jellyfin and Emby behind one hook, so the board's
// media widgets work with whichever servers you run, or all three.

import { dedupeRecent } from '../../shared/media.ts';
import type { MediaServerData, RecentItem, SourceId, Stream, TautulliData } from '../../shared/types.ts';
import type { MediaService } from './themes.ts';
import { findContainer } from './services.ts';
import { useSource, useStore } from './store.tsx';

export interface MediaServer {
  id: SourceId;
  label: string;
  /** The container its app page lives under, when one runs here. */
  container?: string;
  data: TautulliData | MediaServerData;
  /** The app's address from your catalog, when it has one. */
  href?: string;
}

const SERVERS: { id: SourceId; label: string; container: string }[] = [
  { id: 'tautulli', label: 'Plex', container: 'plex' },
  { id: 'jellyfin', label: 'Jellyfin', container: 'jellyfin' },
  { id: 'emby', label: 'Emby', container: 'emby' },
];

export function useMediaServers(): { servers: MediaServer[]; configured: boolean } {
  const plex = useSource<TautulliData>('tautulli');
  const jelly = useSource<MediaServerData>('jellyfin');
  const emby = useSource<MediaServerData>('emby');
  const snap = useStore().snap ?? null;
  const apps = snap?.catalog.groups.flatMap((g) => g.services) ?? [];
  const states = [plex, jelly, emby];
  const servers: MediaServer[] = [];
  SERVERS.forEach((s, i) => {
    const data = states[i].data;
    if (!data) return;
    const app = apps.find((a) => a.container === s.container || a.name.toLowerCase() === s.label.toLowerCase());
    const href = app?.href && app.href !== '#' ? app.href.replace(/\/+$/, '') : undefined;
    servers.push({ ...s, container: app?.container ?? findContainer(snap, s.container, s.label), data, href });
  });
  return { servers, configured: states.some((s) => s.state) };
}

/**
 * Where a poster opens: the title itself, in the server's web app. Plex's
 * app lives at /web on the server, or at app.plex.tv. Without an item path
 * yet, the app.
 */
export function itemHref(server: MediaServer, id: string): string | undefined {
  if (!server.href) return undefined;
  const path = server.data.itemPath;
  if (!path) return server.href;
  const base = server.id === 'tautulli' && !/plex\.tv|\/web(\/index\.html)?$/.test(server.href) ? `${server.href}/web/index.html` : server.href;
  return `${base}${path}${encodeURIComponent(id)}`;
}

/**
 * The title in the Plex app on a phone or tablet. Plex doesn't document its
 * links; this is the form its apps have answered to. Only for Plex, and only
 * once Plex's server id is known.
 */
export function plexAppHref(server: MediaServer, id: string): string | undefined {
  if (server.id !== 'tautulli') return undefined;
  const machine = /\/server\/([^/]+)\//.exec(server.data.itemPath ?? '')?.[1];
  return machine ? `plex://preplay/?metadataKey=${encodeURIComponent(`/library/metadata/${id}`)}&server=${machine}` : undefined;
}

const CONTROL: Record<string, 'plex' | 'jellyfin' | 'emby'> = { tautulli: 'plex', jellyfin: 'jellyfin', emby: 'emby' };

/** What a stream's row and its details need: its look, where it opens, and how to stop it. */
export function streamProps(server: MediaServer, s: Stream): { service: MediaService; label: string; href?: string; stop?: string; appHref?: string } {
  const control = CONTROL[server.id];
  return {
    service: control,
    label: server.label,
    href: s.itemId ? itemHref(server, s.itemId) : server.href,
    ...(control && s.session ? { stop: `/api/media/${control}/stop/${encodeURIComponent(s.session)}` } : {}),
    ...(s.itemId && plexAppHref(server, s.itemId) ? { appHref: plexAppHref(server, s.itemId) } : {}),
  };
}

export interface MergedItem extends RecentItem {
  server: MediaServer;
  /** Every server that has it, the one the poster opens first. */
  servers?: MediaServer[];
}

/**
 * Newest first across servers. A release two servers both added shows once,
 * opening on the first server with an address, and naming both.
 */
export function mergeRecent(servers: MediaServer[]): MergedItem[] {
  const all = servers.flatMap((server) => server.data.recent.map((r) => ({ ...r, server })));
  return dedupeRecent(all).map(({ item, also }) => {
    const copies = [item, ...also];
    const open = copies.find((c) => c.server.href) ?? item;
    const names = [...new Set(copies.map((c) => c.server))];
    return { ...open, title: item.title, subtitle: item.subtitle, addedAt: item.addedAt, thumb: open.thumb ?? item.thumb, servers: names };
  });
}
