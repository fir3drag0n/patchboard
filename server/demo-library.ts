// Demo mode's Sonarr and Radarr libraries, for the Library page. Taps change
// what the page shows until the server restarts.

import type { ArrApp, ArrQueueItem, FoundItem, LibraryItem, WantedItem } from '../shared/types.ts';
import type { ArrLibrary } from './adapters/library.ts';
import { poster } from './demo-media.ts';

const GB = 1024 ** 3;
const DAY = 86_400_000;
const ago = (days: number) => Date.now() - days * DAY;
const iso = (days: number) => new Date(ago(days)).toISOString();
const tmdb = (title: string, kind: 'movie' | 'tv') => `https://www.themoviedb.org/search/${kind}?query=${encodeURIComponent(title)}`;

const SHOWS: LibraryItem[] = [
  { id: 1, title: 'Severance', year: 2022, monitored: true, status: 'airing', have: 19, total: 19, size: 74 * GB, by: 'Apple TV+', added: ago(400) },
  { id: 2, title: 'The Bear', year: 2022, monitored: true, status: 'airing', have: 31, total: 38, size: 52 * GB, by: 'FX', added: ago(700) },
  { id: 3, title: 'Shōgun', year: 2024, monitored: true, status: 'airing', have: 9, total: 10, size: 61 * GB, by: 'FX', added: ago(300) },
  { id: 4, title: 'Slow Horses', year: 2022, monitored: true, status: 'airing', have: 29, total: 30, size: 48 * GB, by: 'Apple TV+', added: ago(650) },
  { id: 5, title: 'Andor', year: 2022, monitored: false, status: 'ended', have: 24, total: 24, size: 88 * GB, by: 'Disney+', added: ago(800) },
  { id: 6, title: 'The Last of Us', year: 2023, monitored: true, status: 'airing', have: 16, total: 16, size: 70 * GB, by: 'HBO', added: ago(600) },
  { id: 7, title: 'Silo', year: 2023, monitored: true, status: 'airing', have: 19, total: 20, size: 66 * GB, by: 'Apple TV+', added: ago(500) },
  { id: 8, title: 'Fallout', year: 2024, monitored: true, status: 'airing', have: 8, total: 8, size: 41 * GB, by: 'Prime Video', added: ago(250) },
].map((s) => ({ ...s, art: poster(s.title), url: tmdb(s.title, 'tv') }) as LibraryItem);

const FILMS: LibraryItem[] = [
  { id: 1, title: 'Dune: Part Two', year: 2024, monitored: true, status: 'out', have: 1, total: 1, size: 71 * GB, by: 'Legendary Pictures', added: ago(300) },
  { id: 2, title: 'Oppenheimer', year: 2023, monitored: true, status: 'out', have: 1, total: 1, size: 58 * GB, by: 'Universal Pictures', added: ago(500) },
  { id: 5, title: 'Poor Things', year: 2023, monitored: true, status: 'out', have: 0, total: 1, size: 0, by: 'Searchlight Pictures', added: ago(2) },
  { id: 6, title: 'Sinners', year: 2025, monitored: true, status: 'out', have: 0, total: 1, size: 0, by: 'Warner Bros.', added: ago(30) },
  { id: 7, title: 'One Battle After Another', year: 2025, monitored: true, status: 'out', have: 0, total: 1, size: 0, by: 'Warner Bros.', added: ago(14) },
  { id: 8, title: 'Weapons', year: 2025, monitored: true, status: 'upcoming', have: 0, total: 1, size: 0, by: 'New Line Cinema', added: ago(10) },
  { id: 9, title: 'Spider-Man: Across the Spider-Verse', year: 2023, monitored: false, status: 'out', have: 1, total: 1, size: 34 * GB, by: 'Sony Pictures Animation', added: ago(700) },
].map((m) => ({ ...m, art: poster(m.title), url: tmdb(m.title, 'movie') }) as LibraryItem);

const WANTED_SHOWS: WantedItem[] = [
  { id: 2301, title: 'The Bear', subtitle: 'S04E05', when: iso(1) },
  { id: 2302, title: 'The Bear', subtitle: 'S04E06', when: iso(1) },
  { id: 3101, title: 'Shōgun', subtitle: 'S01E05', when: iso(9) },
  { id: 4201, title: 'Slow Horses', subtitle: 'S05E02', when: iso(3) },
  { id: 7101, title: 'Silo', subtitle: 'S02E10', when: iso(2) },
].map((w) => ({ ...w, art: poster(w.title) }));

const QUEUE: Record<ArrApp, ArrQueueItem[]> = {
  sonarr: [
    { id: 101, title: 'The.Bear.S04E04.1080p.WEB.h264', progress: 0.44, state: 'downloading' },
    { id: 102, title: 'Silo.S02E10.2160p.ATVP.WEB-DL', progress: 0.8, state: 'downloading' },
    { id: 103, title: 'Slow.Horses.S05E02.1080p.ATVP.WEB-DL', progress: 0.62, state: 'queued' },
  ],
  radarr: [
    { id: 201, title: 'One.Battle.After.Another.2025.2160p.WEB-DL', progress: 1, state: 'warning', message: 'No files found are eligible for import' },
    { id: 202, title: 'Sinners.2025.1080p.WEB-DL', progress: 0.12, state: 'downloading' },
  ],
};

const FIND: Record<ArrApp, FoundItem[]> = {
  sonarr: [
    { key: 371980, title: 'Severance', year: 2022, by: 'Apple TV+', seasons: 2, overview: 'Mark leads a team of office workers whose memories have been surgically divided between their work and personal lives.', have: true },
    { key: 393199, title: 'The Pitt', year: 2025, by: 'HBO Max', seasons: 1, overview: 'A shift-by-shift look at the staff of a Pittsburgh emergency room.', have: true },
    { key: 362392, title: 'The White Lotus', year: 2021, by: 'HBO', seasons: 3, overview: 'Guests and staff at an exclusive resort over one eventful week.', have: true },
  ],
  radarr: [
    { key: 666277, title: 'Past Lives', year: 2023, by: 'A24', overview: 'Two childhood friends meet again in New York, twenty years after one of them emigrated from Seoul.', have: true },
    { key: 872585, title: 'Oppenheimer', year: 2023, by: 'Universal Pictures', overview: 'The story of J. Robert Oppenheimer and the building of the atomic bomb.', have: true },
    { key: 840430, title: 'The Holdovers', year: 2023, by: 'Focus Features', overview: 'A teacher stays on campus over the holidays with a student who has nowhere to go.', have: true },
  ],
};

const monitored = new Map<string, boolean>();
const removed = new Set<string>();
const added: Record<ArrApp, LibraryItem[]> = { sonarr: [], radarr: [] };

export function demoLibrary(app: ArrApp): ArrLibrary {
  const base = app === 'sonarr' ? SHOWS : FILMS;
  const all = () => [...base, ...added[app]].map((i) => ({ ...i, monitored: monitored.get(`${app}:${i.id}`) ?? i.monitored }));
  return {
    items: async () => all(),
    async wanted() {
      const items =
        app === 'sonarr'
          ? WANTED_SHOWS
          : all()
              .filter((m) => m.monitored && !m.have && m.status === 'out')
              .map((m) => ({ id: m.id, title: m.title, subtitle: String(m.year), when: iso(m.id * 3), art: m.art }));
      return { total: items.length, items };
    },
    queue: async () => QUEUE[app].filter((q) => !removed.has(`${app}:${q.id}`)),
    async find(term) {
      const needle = term.toLowerCase();
      const have = new Set(all().map((i) => i.title.toLowerCase()));
      return FIND[app].filter((f) => f.title.toLowerCase().includes(needle)).map((f) => ({ ...f, art: poster(f.title), have: have.has(f.title.toLowerCase()) }));
    },
    options: async () => ({
      profiles: [
        { id: 1, name: 'HD-1080p' },
        { id: 2, name: 'Ultra-HD' },
      ],
      folders: [{ path: app === 'sonarr' ? '/data/media/tv' : '/data/media/movies', free: 3.2 * 1024 * GB }],
    }),
    async monitor(id, on) {
      monitored.set(`${app}:${id}`, on);
    },
    searchItem: async () => {},
    searchWanted: async () => {},
    searchAll: async () => {},
    remove: async (id) => void removed.add(`${app}:${id}`),
    retry: async (id) => void removed.add(`${app}:${id}`),
    async add({ key }) {
      const f = FIND[app].find((x) => x.key === key);
      if (!f) throw new Error('Not found');
      added[app].push({ id: 1000 + key, title: f.title, year: f.year, monitored: true, status: app === 'sonarr' ? 'airing' : 'out', have: 0, total: app === 'sonarr' ? 10 : 1, size: 0, by: f.by, added: Date.now(), art: poster(f.title), url: tmdb(f.title, app === 'sonarr' ? 'tv' : 'movie') });
      return f.title;
    },
  };
}
