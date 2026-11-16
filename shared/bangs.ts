// Search shortcuts: "!yt cats" searches YouTube, "!sonarr severance" your
// own Sonarr. Three kinds, first match wins: the ones you add to a Search
// widget, your apps that have a search page, then a short built-in list. A
// shortcut nobody here knows goes to DuckDuckGo, which knows thousands.

export interface Bang {
  /** What follows the "!": lowercase letters and digits. */
  key: string;
  name: string;
  /** An address with %s where the words go. */
  url: string;
}

export const BUILT_IN: Bang[] = [
  { key: 'g', name: 'Google', url: 'https://www.google.com/search?q=%s' },
  { key: 'd', name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=%s' },
  { key: 'b', name: 'Bing', url: 'https://www.bing.com/search?q=%s' },
  { key: 'k', name: 'Kagi', url: 'https://kagi.com/search?q=%s' },
  { key: 'w', name: 'Wikipedia', url: 'https://en.wikipedia.org/w/index.php?search=%s' },
  { key: 'yt', name: 'YouTube', url: 'https://www.youtube.com/results?search_query=%s' },
  { key: 'gh', name: 'GitHub', url: 'https://github.com/search?q=%s' },
  { key: 'r', name: 'Reddit', url: 'https://www.reddit.com/search/?q=%s' },
  { key: 'maps', name: 'Maps', url: 'https://www.google.com/maps/search/%s' },
  { key: 'a', name: 'Amazon', url: 'https://www.amazon.com/s?k=%s' },
  { key: 'imdb', name: 'IMDb', url: 'https://www.imdb.com/find/?q=%s' },
  { key: 'dh', name: 'Docker Hub', url: 'https://hub.docker.com/search?q=%s' },
];

/** Self-hosted apps' own search pages, after the app's address. */
const APP_SEARCH: Record<string, string> = {
  sonarr: '/add/new?term=%s',
  radarr: '/add/new?term=%s',
  lidarr: '/add/search?term=%s',
  readarr: '/add/search?term=%s',
  prowlarr: '/search?query=%s',
  jellyfin: '/web/#/search.html?query=%s',
  emby: '/web/index.html#!/search.html?query=%s',
  plex: '/web/index.html#!/search?query=%s',
  immich: '/search?query=%s',
  paperless: '/documents?query=%s',
  overseerr: '/search?query=%s',
  jellyseerr: '/search?query=%s',
  seerr: '/search?query=%s',
  gitea: '/explore/repos?q=%s',
  forgejo: '/explore/repos?q=%s',
  mealie: '/g/home?search=%s',
  linkding: '/bookmarks?q=%s',
  searxng: '/search?q=%s',
};

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Your apps with a search page: !sonarr, !jellyfin. */
export function appBangs(apps: { name: string; href?: string; container?: string; icon?: string }[]): Bang[] {
  const out: Bang[] = [];
  for (const a of apps) {
    if (!a.href || !/^https?:\/\//.test(a.href)) continue;
    const id = [a.container, a.icon?.replace(/\.(png|svg|webp)$/, ''), a.name].map((x) => norm(x ?? '')).find((x) => x && x in APP_SEARCH);
    if (!id) continue;
    const key = norm(a.name) || id;
    if (out.some((b) => b.key === key)) continue;
    out.push({ key, name: a.name, url: a.href.replace(/\/+$/, '') + APP_SEARCH[id] });
  }
  return out;
}

/** "yt=https://www.youtube.com/results?search_query=%s", one per line. */
export function parseBangs(raw: string): Bang[] {
  const out: Bang[] = [];
  for (const line of raw.split('\n')) {
    const m = /^\s*!?([a-z0-9]{1,20})\s*=\s*(https?:\/\/\S{3,300})\s*$/i.exec(line);
    if (m && m[2].includes('%s') && !out.some((b) => b.key === m[1].toLowerCase())) out.push({ key: m[1].toLowerCase(), name: m[1], url: m[2] });
  }
  return out.slice(0, 20);
}

/** Where a search goes: a shortcut at either end of the words, or the widget's engine. */
export function routeSearch(words: string, bangs: Bang[], fallback: (q: string) => string): { url: string; bang?: Bang } {
  const m = /^!([a-z0-9]+)\s*(.*)$/i.exec(words) ?? /^(.*?)\s*!([a-z0-9]+)$/i.exec(words);
  if (!m) return { url: fallback(words) };
  const [key, rest] = words.startsWith('!') ? [m[1], m[2]] : [m[2], m[1]];
  const bang = bangs.find((b) => b.key === key.toLowerCase());
  if (bang) return { url: bang.url.replace('%s', encodeURIComponent(rest.trim())), bang };
  // Not one of ours: DuckDuckGo runs its own.
  return { url: `https://duckduckgo.com/?q=${encodeURIComponent(words)}` };
}
