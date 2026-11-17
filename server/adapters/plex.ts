// Plex itself, for when Tautulli isn't set up: who's watching, what was
// added, and the last plays, straight from the server with its token. It
// fills the same place Tautulli does, so Right now, Recently added, Watched
// and the Media page read the same either way. Posters come through
// Patchboard, and the token stays on the server.

import type { Play, RecentItem, Stream, TautulliData } from '../../shared/types.ts';
import { config } from '../config.ts';
import { getJson, request } from '../http.ts';
import { type Adapter, SECOND } from './adapter.ts';
import { plexItemPath } from './tautulli.ts';

interface PlexItem {
  ratingKey?: string;
  type?: string;
  title?: string;
  grandparentTitle?: string;
  parentTitle?: string;
  parentIndex?: number;
  index?: number;
  year?: number;
  thumb?: string;
  parentThumb?: string;
  grandparentThumb?: string;
  addedAt?: number;
  viewedAt?: number;
  accountID?: number;
  viewOffset?: number;
  duration?: number;
  User?: { title?: string };
  Player?: { title?: string; product?: string; state?: string };
  Session?: { id?: string };
  TranscodeSession?: { videoDecision?: string; audioDecision?: string };
}

const img = (path?: string) => (path ? `/api/img/plex?path=${encodeURIComponent(path)}` : undefined);
const code = (s?: number, e?: number) => (s != null && e != null ? `S${String(s).padStart(2, '0')}E${String(e).padStart(2, '0')}` : undefined);

/** A show's name for an episode, the item's own otherwise; and the episode's number and name under it. */
function names(it: PlexItem): { title: string; subtitle?: string; thumb?: string } {
  if (it.type === 'episode') return { title: it.grandparentTitle ?? it.title ?? '', subtitle: [code(it.parentIndex, it.index), it.title].filter(Boolean).join(' ') || undefined, thumb: img(it.grandparentThumb ?? it.thumb) };
  if (it.type === 'season') return { title: it.parentTitle ?? it.title ?? '', subtitle: it.title, thumb: img(it.parentThumb ?? it.thumb) };
  if (it.type === 'track') return { title: it.grandparentTitle ?? it.title ?? '', subtitle: it.title, thumb: img(it.parentThumb ?? it.thumb) };
  return { title: it.title ?? '', ...(it.year ? { subtitle: String(it.year) } : {}), thumb: img(it.thumb) };
}

export function fromPlexSessions(items: PlexItem[]): Stream[] {
  return items.map((s) => {
    const n = names(s);
    const pos = s.viewOffset;
    const dur = s.duration;
    const state = s.Player?.state;
    return {
      ...(s.ratingKey ? { itemId: s.ratingKey } : {}),
      user: s.User?.title ?? 'Someone',
      title: n.title,
      ...(s.type === 'episode' || s.type === 'track' ? { subtitle: n.subtitle } : {}),
      progress: pos != null && dur ? Math.min(100, (pos / dur) * 100) : -1,
      ...(pos != null ? { positionSec: pos / 1000 } : {}),
      ...(dur ? { durationSec: dur / 1000 } : {}),
      state: state === 'paused' || state === 'buffering' ? state : 'playing',
      transcode: s.TranscodeSession?.videoDecision === 'transcode' || s.TranscodeSession?.audioDecision === 'transcode',
      ...(n.thumb ? { thumb: n.thumb } : {}),
      ...(s.Session?.id ? { session: s.Session.id } : {}),
      ...(s.Player?.title || s.Player?.product ? { device: s.Player.title || s.Player.product } : {}),
    };
  });
}

export function fromPlexRecent(items: PlexItem[]): RecentItem[] {
  return items
    .filter((it) => it.ratingKey)
    .map((it) => {
      const n = names(it);
      return { id: it.ratingKey!, type: it.type ?? 'movie', title: n.title, ...(n.subtitle ? { subtitle: n.subtitle } : {}), addedAt: (it.addedAt ?? 0) * 1000, ...(n.thumb ? { thumb: n.thumb } : {}) };
    })
    .sort((a, b) => b.addedAt - a.addedAt);
}

export function fromPlexHistory(items: PlexItem[], accounts: Map<number, string>): Play[] {
  return items.map((it) => {
    const n = names(it);
    return {
      user: (it.accountID != null && accounts.get(it.accountID)) || 'Someone',
      title: n.title,
      ...(it.type === 'episode' && n.subtitle ? { subtitle: n.subtitle } : {}),
      at: (it.viewedAt ?? 0) * 1000,
      ...(it.ratingKey ? { itemId: it.ratingKey } : {}),
      ...(n.thumb ? { thumb: n.thumb } : {}),
    };
  });
}

export function plexAdapter(): Adapter<TautulliData> {
  const { url, key } = config.plex!;
  const headers = { Accept: 'application/json', 'X-Plex-Token': key };
  const get = <T>(path: string) => getJson<{ MediaContainer: T }>(`${url}${path}`, { headers }).then((r) => r.MediaContainer);
  let machine: string | null = null;
  let slow: { at: number; recent: RecentItem[]; watched?: Play[] } | null = null;
  let watching = false;
  return {
    // The place Tautulli fills: Plex's slot on Home and the Media page.
    id: 'tautulli',
    label: 'Plex',
    get intervalMs() {
      return watching ? 5 * SECOND : 15 * SECOND;
    },
    async fetch() {
      machine ??= (await get<{ machineIdentifier?: string }>('/identity').catch(() => null))?.machineIdentifier ?? null;
      // New arrivals and past plays change slowly: once a minute.
      if (!slow || Date.now() - slow.at > 60_000) {
        const [added, history, accounts] = await Promise.all([
          get<{ Metadata?: PlexItem[] }>('/library/recentlyAdded?X-Plex-Container-Start=0&X-Plex-Container-Size=30'),
          get<{ Metadata?: PlexItem[] }>('/status/sessions/history/all?sort=viewedAt:desc&X-Plex-Container-Start=0&X-Plex-Container-Size=15').catch(() => null),
          get<{ Account?: { id: number; name?: string }[] }>('/accounts').catch(() => null),
        ]);
        const who = new Map((accounts?.Account ?? []).map((a) => [a.id, a.name ?? '']));
        slow = { at: Date.now(), recent: fromPlexRecent(added.Metadata ?? []), ...(history ? { watched: fromPlexHistory(history.Metadata ?? [], who) } : {}) };
      }
      const sessions = await get<{ Metadata?: PlexItem[] }>('/status/sessions');
      const streams = fromPlexSessions(sessions.Metadata ?? []);
      watching = streams.length > 0;
      return { streams, recent: slow.recent, ...(slow.watched ? { watched: slow.watched } : {}), ...(machine ? { itemPath: plexItemPath(machine) } : {}) };
    },
  };
}

/** A Plex poster, sized down by Plex itself. Only library paths. */
export async function plexImage(path: string): Promise<Response> {
  if (!/^\/library\/[\w/.-]+$/.test(path) || path.split('/').includes('..')) throw new Error('Bad image path');
  const { url, key } = config.plex!;
  return request(`${url}/photo/:/transcode?width=300&height=450&minSize=1&upscale=1&url=${encodeURIComponent(path)}`, { headers: { 'X-Plex-Token': key } });
}
