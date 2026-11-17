// Overseerr and Jellyseerr (same API): requests waiting for approval, with
// Approve and Decline, what's coming, and asking for something new.
// Requests carry only a TMDB id, so titles are looked up once and
// remembered; posters go through Patchboard's /api/art proxy, so the browser
// never calls TMDB itself.

import type { AskItem, RequestList, SeerrData, SeerrRequest } from '../../shared/types.ts';
import { rememberArt } from '../art.ts';
import { config } from '../config.ts';
import { getJson, HttpError } from '../http.ts';
import { type Adapter, MINUTE } from './adapter.ts';
import { refusal } from './library.ts';

export interface RawRequest {
  id: number;
  status: number; // 1 pending, 2 approved, 3 declined
  type?: 'movie' | 'tv';
  is4k?: boolean;
  createdAt: string;
  media?: { tmdbId?: number; mediaType?: 'movie' | 'tv' };
  seasons?: { seasonNumber: number }[];
  requestedBy?: { displayName?: string; username?: string; plexUsername?: string; email?: string };
}

export interface Details {
  title: string;
  year?: number;
  posterPath?: string;
}

export const requester = (r: RawRequest) =>
  r.requestedBy?.displayName || r.requestedBy?.username || r.requestedBy?.plexUsername || r.requestedBy?.email?.split('@')[0] || 'Someone';

export function toRequest(r: RawRequest, d: Details | undefined, web?: string): SeerrRequest {
  const kind = r.type ?? r.media?.mediaType ?? 'movie';
  return {
    ...(web && r.media?.tmdbId ? { href: `${web}/${kind}/${r.media.tmdbId}` } : {}),
    id: r.id,
    kind,
    title: d?.title ?? (kind === 'tv' ? 'A show' : 'A movie'),
    year: d?.year,
    by: requester(r),
    at: Date.parse(r.createdAt),
    seasons: kind === 'tv' && r.seasons?.length ? r.seasons.map((s) => s.seasonNumber) : undefined,
    is4k: !!r.is4k,
    art: d?.posterPath ? `/api/art/seerr/${r.id}` : undefined,
  };
}

export interface RawFound {
  id: number;
  mediaType: 'movie' | 'tv' | 'person';
  title?: string;
  name?: string;
  releaseDate?: string;
  firstAirDate?: string;
  overview?: string;
  posterPath?: string | null;
  mediaInfo?: { status?: number };
}

// Seerr's media status: 2 asked, 3 coming, 4 some seasons here, 5 here, 6 blocklisted (Jellyseerr).
const STATE: Record<number, AskItem['state']> = { 2: 'asked', 3: 'coming', 4: 'partial', 5: 'here', 6: 'blocked' };

/** A search result, or null for a person or a title without an id. */
export function fromFound(f: RawFound, web?: string): AskItem | null {
  if ((f.mediaType !== 'movie' && f.mediaType !== 'tv') || !f.id) return null;
  const date = f.releaseDate || f.firstAirDate;
  const src = f.mediaType === 'tv' ? 'tmdbtv' : 'tmdb';
  if (f.posterPath) rememberArt(`${src}:${f.id}`, `https://image.tmdb.org/t/p/w342${f.posterPath}`);
  return {
    key: f.id,
    kind: f.mediaType,
    title: f.title ?? f.name ?? '',
    year: date ? Number(date.slice(0, 4)) || undefined : undefined,
    overview: f.overview || undefined,
    art: f.posterPath ? `/api/art/${src}/${f.id}` : undefined,
    state: STATE[f.mediaInfo?.status ?? 0] ?? 'new',
    href: web ? `${web}/${f.mediaType}/${f.id}` : undefined,
  };
}

/** Request ids the Approve and Decline route may act on: the pending ones last read. */
export const pendingIds = new Set<number>();

export interface SeerrClient {
  adapter: Adapter<SeerrData>;
  act: (id: number, action: 'approve' | 'decline') => Promise<void>;
  /** Every request waiting for approval, or approved and not here yet, newest first. */
  list: (which: 'waiting' | 'coming') => Promise<RequestList>;
  find: (term: string) => Promise<AskItem[]>;
  /** Ask for a film, or every season of a show not already asked for. */
  ask: (kind: 'movie' | 'tv', tmdbId: number) => Promise<void>;
}

export function seerrClient(): SeerrClient {
  const { url, key } = config.overseerr!;
  // Links open the app the requests live in.
  const web = url;
  const headers = { 'X-Api-Key': key, Accept: 'application/json' };
  const titles = new Map<string, Details>();

  async function details(kind: 'movie' | 'tv', tmdbId: number): Promise<Details | undefined> {
    const k = `${kind}:${tmdbId}`;
    if (titles.has(k)) return titles.get(k);
    try {
      const d = await getJson<{ title?: string; name?: string; releaseDate?: string; firstAirDate?: string; posterPath?: string }>(`${url}/api/v1/${kind}/${tmdbId}`, { headers });
      const date = d.releaseDate || d.firstAirDate;
      const got: Details = { title: d.title ?? d.name ?? '', year: date ? Number(date.slice(0, 4)) || undefined : undefined, posterPath: d.posterPath ?? undefined };
      if (titles.size > 500) titles.delete(titles.keys().next().value!);
      titles.set(k, got);
      return got;
    } catch {
      return undefined;
    }
  }

  async function withTitles(rows: RawRequest[]): Promise<SeerrRequest[]> {
    // A few at a time: a first visit can name a hundred titles.
    const out: SeerrRequest[] = [];
    for (let i = 0; i < rows.length; i += 8) {
      out.push(
        ...(await Promise.all(
          rows.slice(i, i + 8).map(async (r) => {
            const kind = r.type ?? r.media?.mediaType ?? 'movie';
            const d = r.media?.tmdbId ? await details(kind, r.media.tmdbId) : undefined;
            if (d?.posterPath) rememberArt(`seerr:${r.id}`, `https://image.tmdb.org/t/p/w342${d.posterPath}`);
            return toRequest(r, d, web);
          }),
        )),
      );
    }
    return out;
  }

  // A refusal carries its reason ("Request for this media already exists"): say that, not "HTTP 409".
  async function send(path: string, body: unknown) {
    const res = await fetch(`${url}/api/v1${path}`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(20_000) }).catch((err: Error) => {
      throw new Error(err.name === 'TimeoutError' ? 'Timed out after 20s' : 'Unreachable');
    });
    if (!res.ok) throw new Error(refusal(await res.json().catch(() => null)) ?? new HttpError(res.status, res.statusText).message);
  }

  return {
    adapter: {
      id: 'overseerr',
      label: 'Requests',
      intervalMs: 2 * MINUTE,
      async fetch() {
        const [list, processing, count] = await Promise.all([
          getJson<{ results: RawRequest[] }>(`${url}/api/v1/request?take=20&skip=0&filter=pending&sort=added`, { headers }),
          getJson<{ results: RawRequest[] }>(`${url}/api/v1/request?take=10&skip=0&filter=processing&sort=added`, { headers }).catch(() => ({ results: [] })),
          getJson<{ pending?: number; total?: number; processing?: number; available?: number }>(`${url}/api/v1/request/count`, { headers }),
        ]);
        const out = await withTitles(list.results.filter((r) => r.status === 1));
        const coming = await withTitles(processing.results.filter((r) => r.status === 2));
        pendingIds.clear();
        for (const r of out) pendingIds.add(r.id);
        return { pending: count.pending ?? out.length, processing: count.processing ?? coming.length, requests: out, coming };
      },
    },
    async act(id, action) {
      await send(`/request/${id}/${action}`, {});
    },
    async list(which) {
      const filter = which === 'waiting' ? 'pending' : 'processing';
      const got = await getJson<{ pageInfo?: { results?: number }; results: RawRequest[] }>(`${url}/api/v1/request?take=100&skip=0&filter=${filter}&sort=added`, { headers }, 20_000);
      const rows = got.results.filter((r) => r.status === (which === 'waiting' ? 1 : 2));
      return { total: Math.max(got.pageInfo?.results ?? 0, rows.length), items: await withTitles(rows) };
    },
    async find(term) {
      // Seerr refuses some punctuation unless it is escaped.
      const q = encodeURIComponent(term).replace(/[!'()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`);
      const got = await getJson<{ results: RawFound[] }>(`${url}/api/v1/search?query=${q}&page=1`, { headers }, 20_000);
      return got.results.map((f) => fromFound(f, web)).filter((f): f is AskItem => !!f);
    },
    async ask(kind, tmdbId) {
      await send('/request', { mediaType: kind, mediaId: tmdbId, ...(kind === 'tv' ? { seasons: 'all' } : {}) });
    },
  };
}
