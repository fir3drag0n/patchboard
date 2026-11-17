// The Library page's side of Sonarr and Radarr: every show or film, what's
// missing, the whole queue, and adding something new. Fetched only while the
// page is open; the 5-minute snapshot in arr.ts keeps the calendar and health.

import { rememberArt } from '../art.ts';
import type { ArrApp, ArrOptions, ArrQueueItem, EpisodeInfo, FoundItem, HistoryEvent, HistoryItem, LibraryItem, SeasonInfo, ShowDetail, WantedList } from '../../shared/types.ts';
import { config } from '../config.ts';
import { getJson, HttpError } from '../http.ts';
import { toQueue } from './arr.ts';
import { oneAtATime } from './adapter.ts';

export interface AddRequest {
  key: number;
  profile: number;
  folder: string;
  /** Search for it as soon as it's added. */
  search: boolean;
}

export interface ArrLibrary {
  items(): Promise<LibraryItem[]>;
  wanted(): Promise<WantedList>;
  queue(): Promise<ArrQueueItem[]>;
  find(term: string): Promise<FoundItem[]>;
  options(): Promise<ArrOptions>;
  monitor(id: number, on: boolean): Promise<void>;
  /** Search for every missing episode of a show, or for a film. */
  searchItem(id: number): Promise<void>;
  /** Search for one missing episode or film. */
  searchWanted(id: number): Promise<void>;
  searchAll(): Promise<void>;
  /** Take a download out of the queue and out of the client. */
  remove(queueId: number): Promise<void>;
  /** The same, blocklisting its release and searching for another. */
  retry(queueId: number): Promise<void>;
  add(what: AddRequest): Promise<string>;
  /** A show's seasons and episodes. Sonarr only. */
  show?(id: number): Promise<ShowDetail>;
  monitorSeason?(id: number, season: number, on: boolean): Promise<void>;
  searchSeason?(id: number, season: number): Promise<void>;
  /** The newest things it did, newest first. */
  history(): Promise<HistoryItem[]>;
}

/** How many history events the page lists. */
export const HISTORY_SIZE = 60;

interface ShowSeason {
  seasonNumber: number;
  monitored: boolean;
  statistics?: { episodeFileCount?: number; episodeCount?: number; totalEpisodeCount?: number; sizeOnDisk?: number };
}
interface ShowEpisode {
  id: number;
  seasonNumber: number;
  episodeNumber: number;
  title?: string;
  airDateUtc?: string;
  hasFile: boolean;
  monitored: boolean;
}

export function fromShow(seasons: ShowSeason[], episodes: ShowEpisode[], now = Date.now()): ShowDetail {
  const eps = episodes
    .map((e): EpisodeInfo => ({ id: e.id, season: e.seasonNumber, number: e.episodeNumber, title: e.title ?? '', ...(e.airDateUtc ? { airs: Date.parse(e.airDateUtc) } : {}), hasFile: e.hasFile, monitored: e.monitored }))
    .sort((a, b) => a.season - b.season || a.number - b.number);
  return {
    // Newest season first; specials (season 0) last.
    seasons: seasons
      .map((s): SeasonInfo => {
        const mine = eps.filter((e) => e.season === s.seasonNumber);
        return {
          number: s.seasonNumber,
          monitored: s.monitored,
          have: s.statistics?.episodeFileCount ?? mine.filter((e) => e.hasFile).length,
          aired: mine.filter((e) => e.airs !== undefined && e.airs <= now).length,
          total: s.statistics?.totalEpisodeCount ?? mine.length,
          size: s.statistics?.sizeOnDisk ?? 0,
        };
      })
      .sort((a, b) => (a.number === 0 ? 1 : b.number === 0 ? -1 : b.number - a.number)),
    episodes: eps,
  };
}

interface HistoryRecord {
  id: number;
  eventType: string;
  date: string;
  sourceTitle?: string;
  quality?: { quality?: { name?: string } };
  data?: Record<string, string | undefined>;
  series?: { title?: string };
  episode?: { seasonNumber: number; episodeNumber: number; title?: string };
  movie?: { title?: string; year?: number };
}

const EVENT: [RegExp, HistoryEvent][] = [
  [/grab/i, 'grabbed'],
  [/import/i, 'imported'],
  [/fail/i, 'failed'],
  [/delet/i, 'deleted'],
  [/renam/i, 'renamed'],
  [/ignor/i, 'ignored'],
];

export function fromHistory(records: HistoryRecord[]): HistoryItem[] {
  return records.map((r) => {
    const d = r.data ?? {};
    const ep = r.episode;
    return {
      id: r.id,
      event: EVENT.find(([re]) => re.test(r.eventType))?.[1] ?? 'other',
      at: Date.parse(r.date),
      title: r.series?.title ?? r.movie?.title ?? r.sourceTitle ?? '',
      ...(ep ? { subtitle: `${epCode(ep.seasonNumber, ep.episodeNumber)} ${ep.title ?? ''}`.trim() } : r.movie?.year ? { subtitle: String(r.movie.year) } : {}),
      ...(r.sourceTitle ? { release: r.sourceTitle } : {}),
      ...(r.quality?.quality?.name ? { quality: r.quality.quality.name } : {}),
      ...((d.indexer || d.downloadClientName || d.downloadClient) ? { from: d.indexer || d.downloadClientName || d.downloadClient } : {}),
      ...((d.message || d.reason) ? { message: d.message || d.reason } : {}),
    };
  });
}

type Image = { coverType: string; remoteUrl?: string };
const posterOf = (images?: Image[]) => images?.find((x) => x.coverType === 'poster')?.remoteUrl;
const ms = (iso?: string) => (iso ? Date.parse(iso) || undefined : undefined);
const epCode = (s: number, e: number) => `S${String(s).padStart(2, '0')}E${String(e).padStart(2, '0')}`;

interface Series {
  id: number;
  title: string;
  year?: number;
  monitored: boolean;
  status?: string;
  network?: string;
  added?: string;
  titleSlug: string;
  tvdbId?: number;
  images?: Image[];
  statistics?: { episodeFileCount?: number; episodeCount?: number; sizeOnDisk?: number; seasonCount?: number };
}

export function fromSeries(s: Series, base: string): LibraryItem {
  rememberArt(`sonarr:${s.id}`, posterOf(s.images));
  const st = s.statistics ?? {};
  return {
    id: s.id,
    title: s.title,
    ...(s.year ? { year: s.year } : {}),
    monitored: s.monitored,
    status: s.status === 'ended' ? 'ended' : s.status === 'upcoming' ? 'upcoming' : 'airing',
    have: st.episodeFileCount ?? 0,
    total: st.episodeCount ?? 0,
    size: st.sizeOnDisk ?? 0,
    ...(s.network ? { by: s.network } : {}),
    ...(ms(s.added) ? { added: ms(s.added) } : {}),
    art: `/api/art/sonarr/${s.id}`,
    url: `${base}/series/${s.titleSlug}`,
  };
}

interface Movie {
  id: number;
  title: string;
  year?: number;
  monitored: boolean;
  status?: string;
  isAvailable?: boolean;
  hasFile?: boolean;
  sizeOnDisk?: number;
  studio?: string;
  added?: string;
  tmdbId: number;
  images?: Image[];
  inCinemas?: string;
  digitalRelease?: string;
  physicalRelease?: string;
}

export function fromMovie(m: Movie, base: string): LibraryItem {
  rememberArt(`radarr:${m.id}`, posterOf(m.images));
  return {
    id: m.id,
    title: m.title,
    ...(m.year ? { year: m.year } : {}),
    monitored: m.monitored,
    status: m.isAvailable || m.status === 'released' ? 'out' : 'upcoming',
    have: m.hasFile ? 1 : 0,
    total: 1,
    size: m.sizeOnDisk ?? 0,
    ...(m.studio ? { by: m.studio } : {}),
    ...(ms(m.added) ? { added: ms(m.added) } : {}),
    art: `/api/art/radarr/${m.id}`,
    url: `${base}/movie/${m.tmdbId}`,
  };
}

/** Lookup results: shows by TVDB id, films by TMDB id, posters through Patchboard. */
export function fromLookup(app: ArrApp, r: Series & Partial<Movie> & { overview?: string; tvdbId?: number; seasons?: unknown[] }): FoundItem | null {
  const key = app === 'sonarr' ? r.tvdbId : r.tmdbId;
  if (!key) return null;
  const src = app === 'sonarr' ? 'tvdb' : 'tmdb';
  rememberArt(`${src}:${key}`, posterOf(r.images));
  return {
    key,
    title: r.title,
    ...(r.year ? { year: r.year } : {}),
    ...(r.overview ? { overview: r.overview } : {}),
    ...(r.network || r.studio ? { by: r.network || r.studio } : {}),
    ...(app === 'sonarr' && r.seasons ? { seasons: r.seasons.filter((s) => (s as { seasonNumber: number }).seasonNumber > 0).length } : {}),
    ...(posterOf(r.images) ? { art: `/api/art/${src}/${key}` } : {}),
    have: (r.id ?? 0) > 0,
  };
}

/** Sonarr and Radarr explain a 400: a list of { errorMessage } or { message }. */
export function refusal(body: unknown): string | undefined {
  const first = Array.isArray(body) ? body[0] : body;
  const said = (first as { errorMessage?: unknown; message?: unknown } | undefined)?.errorMessage ?? (first as { message?: unknown } | undefined)?.message;
  return typeof said === 'string' && said ? said.slice(0, 300) : undefined;
}

export function arrLibrary(app: ArrApp): ArrLibrary {
  const { url, key } = config[app]!;
  const headers = { 'X-Api-Key': key, 'Content-Type': 'application/json' };
  const get = <T>(path: string) => getJson<T>(`${url}/api/v3${path}`, { headers }, 20_000);
  // A refusal carries its reason ("This series has already been added"): say that, not "HTTP 400".
  const send = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${url}/api/v3${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(20_000) }).catch((err: Error) => {
      throw new Error(err.name === 'TimeoutError' ? 'Timed out after 20s' : 'Unreachable');
    });
    if (!res.ok) throw new Error(refusal(await res.json().catch(() => null)) ?? new HttpError(res.status, res.statusText).message);
    return res;
  };
  const command = (body: Record<string, unknown>) => send('POST', '/command', body).then(() => {});
  const seasons = oneAtATime();
  const sonarr = app === 'sonarr';

  return {
    async items() {
      return sonarr ? (await get<Series[]>('/series')).map((s) => fromSeries(s, url)) : (await get<Movie[]>('/movie')).map((m) => fromMovie(m, url));
    },
    async wanted() {
      if (!sonarr) {
        const missing = (await get<Movie[]>('/movie')).filter((m) => m.monitored && !m.hasFile && (m.isAvailable || m.status === 'released'));
        missing.sort((a, b) => (ms(b.digitalRelease ?? b.physicalRelease ?? b.inCinemas) ?? 0) - (ms(a.digitalRelease ?? a.physicalRelease ?? a.inCinemas) ?? 0));
        return {
          total: missing.length,
          items: missing.slice(0, 100).map((m) => ({ id: m.id, title: m.title, ...(m.year ? { subtitle: String(m.year) } : {}), when: m.digitalRelease ?? m.physicalRelease ?? m.inCinemas, art: `/api/art/radarr/${m.id}` })),
        };
      }
      type Ep = { id: number; seasonNumber: number; episodeNumber: number; title?: string; airDateUtc?: string; seriesId: number; series?: Series };
      const q = '/wanted/missing?page=1&pageSize=100&includeSeries=true&monitored=true&sortDirection=descending';
      // Sonarr 4 sorts by episodes.airDateUtc; 3 by airDateUtc.
      const page = await get<{ totalRecords: number; records: Ep[] }>(`${q}&sortKey=episodes.airDateUtc`).catch(() => get<{ totalRecords: number; records: Ep[] }>(`${q}&sortKey=airDateUtc`));
      return {
        total: page.totalRecords,
        items: page.records.map((e) => {
          if (e.series) rememberArt(`sonarr:${e.seriesId}`, posterOf(e.series.images));
          return { id: e.id, title: e.series?.title ?? '', subtitle: `${epCode(e.seasonNumber, e.episodeNumber)} ${e.title ?? ''}`.trim(), ...(e.airDateUtc ? { when: e.airDateUtc } : {}), art: `/api/art/sonarr/${e.seriesId}` };
        }),
      };
    },
    async queue() {
      const page = await get<{ records: Parameters<typeof toQueue>[0] }>('/queue?pageSize=200');
      return toQueue(page.records, 200);
    },
    async find(term) {
      const found = await get<Parameters<typeof fromLookup>[1][]>(`/${sonarr ? 'series' : 'movie'}/lookup?term=${encodeURIComponent(term)}`);
      return found
        .map((r) => fromLookup(app, r))
        .filter((r): r is FoundItem => !!r)
        .slice(0, 12);
    },
    async options() {
      const [profiles, folders] = await Promise.all([get<{ id: number; name: string }[]>('/qualityprofile'), get<{ path: string; freeSpace?: number }[]>('/rootfolder')]);
      return { profiles: profiles.map((p) => ({ id: p.id, name: p.name })), folders: folders.map((f) => ({ path: f.path, ...(f.freeSpace !== undefined ? { free: f.freeSpace } : {}) })) };
    },
    async monitor(id, on) {
      await send('PUT', sonarr ? '/series/editor' : '/movie/editor', sonarr ? { seriesIds: [id], monitored: on } : { movieIds: [id], monitored: on });
    },
    searchItem: (id) => command(sonarr ? { name: 'SeriesSearch', seriesId: id } : { name: 'MoviesSearch', movieIds: [id] }),
    searchWanted: (id) => command(sonarr ? { name: 'EpisodeSearch', episodeIds: [id] } : { name: 'MoviesSearch', movieIds: [id] }),
    searchAll: () => command({ name: sonarr ? 'MissingEpisodeSearch' : 'MissingMoviesSearch' }),
    async history() {
      const q = `/history?page=1&pageSize=${HISTORY_SIZE}&sortKey=date&sortDirection=descending&${sonarr ? 'includeSeries=true&includeEpisode=true' : 'includeMovie=true'}`;
      return fromHistory((await get<{ records: HistoryRecord[] }>(q)).records ?? []);
    },
    ...(sonarr
      ? {
          async show(id: number) {
            const [series, episodes] = await Promise.all([get<{ seasons: ShowSeason[] }>(`/series/${id}`), get<ShowEpisode[]>(`/episode?seriesId=${id}`)]);
            return fromShow(series.seasons ?? [], episodes);
          },
          // Sonarr takes the whole show back, so toggles run one at a time.
          monitorSeason: (id: number, season: number, on: boolean) =>
            seasons(async () => {
              const series = await get<{ seasons: ShowSeason[] } & Record<string, unknown>>(`/series/${id}`);
              if (!series.seasons.some((s) => s.seasonNumber === season)) throw new Error('Sonarr has no such season');
              await send('PUT', `/series/${id}`, { ...series, seasons: series.seasons.map((s) => (s.seasonNumber === season ? { ...s, monitored: on } : s)) });
            }),
          searchSeason: (id: number, season: number) => command({ name: 'SeasonSearch', seriesId: id, seasonNumber: season }),
        }
      : {}),
    remove: (id) => send('DELETE', `/queue/${id}?removeFromClient=true&blocklist=false`).then(() => {}),
    retry: (id) => send('DELETE', `/queue/${id}?removeFromClient=true&blocklist=true&skipRedownload=false`).then(() => {}),
    async add({ key: id, profile, folder, search }) {
      if (sonarr) {
        const [show] = await get<Record<string, unknown>[]>(`/series/lookup?term=tvdb:${id}`);
        if (!show) throw new Error('Sonarr could not find that show');
        // Sonarr 3 needs a language profile; 4 dropped them.
        const languages = await get<{ id: number }[]>('/languageprofile').catch(() => []);
        await send('POST', '/series', {
          ...show,
          qualityProfileId: profile,
          ...(languages[0] ? { languageProfileId: languages[0].id } : {}),
          rootFolderPath: folder,
          monitored: true,
          seasonFolder: true,
          addOptions: { monitor: 'all', searchForMissingEpisodes: search },
        });
        return String(show.title);
      }
      const movie = await get<Record<string, unknown>>(`/movie/lookup/tmdb?tmdbId=${id}`);
      await send('POST', '/movie', { ...movie, qualityProfileId: profile, rootFolderPath: folder, monitored: true, minimumAvailability: 'released', addOptions: { searchForMovie: search } });
      return String(movie.title);
    },
  };
}
