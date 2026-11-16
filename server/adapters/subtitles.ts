// Bazarr's missing subtitles for the Library page: each episode or film
// with the languages it still lacks, Search for one, and Search all. Read
// from Bazarr while the page is open.

import type { SubtitleItem, SubtitleKind, SubtitleLang, SubtitleList } from '../../shared/types.ts';
import { config } from '../config.ts';
import { getJson, request } from '../http.ts';

export interface SubtitleControl {
  wanted(kind: SubtitleKind): Promise<SubtitleList>;
  /** Looks for every language the item lacks. */
  search(kind: SubtitleKind, item: SubtitleItem): Promise<void>;
  searchAll(kind: SubtitleKind): Promise<void>;
}

/** How many the page lists; the total says how many there are. */
export const WANTED_SIZE = 200;

interface Missing {
  name?: string;
  code2?: string;
  forced?: boolean;
  hi?: boolean;
}
interface WantedEpisode {
  seriesTitle: string;
  episode_number?: string;
  episodeTitle?: string;
  sonarrSeriesId: number;
  sonarrEpisodeId: number;
  missing_subtitles?: Missing[];
}
interface WantedMovie {
  title: string;
  radarrId: number;
  missing_subtitles?: Missing[];
}

const langs = (m: Missing[] = []): SubtitleLang[] =>
  m.filter((x) => x.code2).map((x) => ({ code: x.code2!, name: x.name ?? x.code2!, ...(x.forced ? { forced: true } : {}), ...(x.hi ? { hi: true } : {}) }));

export function fromWantedEpisodes(rows: WantedEpisode[]): SubtitleItem[] {
  return rows.map((r) => ({
    id: `${r.sonarrSeriesId}:${r.sonarrEpisodeId}`,
    title: r.seriesTitle,
    subtitle: [r.episode_number, r.episodeTitle].filter(Boolean).join(' '),
    missing: langs(r.missing_subtitles),
  }));
}

export function fromWantedMovies(rows: WantedMovie[]): SubtitleItem[] {
  return rows.map((r) => ({ id: String(r.radarrId), title: r.title, missing: langs(r.missing_subtitles) }));
}

/** Bazarr's address for one language of one item. */
export function searchPath(kind: SubtitleKind, id: string, l: SubtitleLang): string {
  const q = new URLSearchParams();
  if (kind === 'episodes') {
    const [series, episode] = id.split(':');
    q.set('seriesid', series);
    q.set('episodeid', episode);
  } else q.set('radarrid', id);
  q.set('language', l.code);
  q.set('forced', String(!!l.forced));
  q.set('hi', String(!!l.hi));
  return `/api/${kind}/subtitles?${q}`;
}

export function bazarrControl(): SubtitleControl | undefined {
  if (!config.bazarr) return undefined;
  const { url, key } = config.bazarr;
  const headers = { 'X-API-KEY': key };
  return {
    async wanted(kind) {
      const r = await getJson<{ data?: unknown[]; total?: number }>(`${url}/api/${kind}/wanted?start=0&length=${WANTED_SIZE}`, { headers }, 20_000);
      const items = kind === 'episodes' ? fromWantedEpisodes((r.data ?? []) as WantedEpisode[]) : fromWantedMovies((r.data ?? []) as WantedMovie[]);
      return { items, total: r.total ?? items.length };
    },
    async search(kind, item) {
      // Bazarr asks each provider in turn before it answers.
      for (const l of item.missing) await request(`${url}${searchPath(kind, item.id, l)}`, { method: 'PATCH', headers }, 120_000);
    },
    async searchAll(kind) {
      await request(`${url}/api/${kind === 'episodes' ? 'series' : 'movies'}?action=search-wanted`, { method: 'PATCH', headers });
    },
  };
}
