import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { appBangs, BUILT_IN, parseBangs, routeSearch } from '../../shared/bangs.ts';

const ddg = (q: string) => `https://duckduckgo.com/?q=${encodeURIComponent(q)}`;

test('search shortcuts: built in, your apps, your own, and DuckDuckGo for the rest', () => {
  const apps = appBangs([
    { name: 'Sonarr', href: 'http://nas:8989/', container: 'sonarr' },
    { name: 'Jellyfin', href: 'http://nas:8096', icon: 'jellyfin.png' },
    { name: 'Cloudflared', href: 'http://nas:1' },
  ]);
  assert.deepEqual(apps.map((b) => b.key), ['sonarr', 'jellyfin']);
  const own = parseBangs('yt=https://example.com/v?q=%s\nbad line\nnope=https://no-placeholder.example');
  assert.deepEqual(own.map((b) => b.key), ['yt']);
  const all = [...own, ...apps, ...BUILT_IN];
  assert.equal(routeSearch('!sonarr the bear', all, ddg).url, 'http://nas:8989/add/new?term=the%20bear');
  assert.equal(routeSearch('the bear !sonarr', all, ddg).url, 'http://nas:8989/add/new?term=the%20bear', 'a shortcut at the end works too');
  assert.equal(routeSearch('!yt cats', all, ddg).url, 'https://example.com/v?q=cats', 'yours win over the built-in ones');
  assert.equal(routeSearch('!w Ada Lovelace', all, ddg).url, 'https://en.wikipedia.org/w/index.php?search=Ada%20Lovelace');
  assert.equal(routeSearch('!npm react', all, ddg).url, 'https://duckduckgo.com/?q=!npm%20react', "DuckDuckGo runs the ones we don't know");
  assert.equal(routeSearch('plain words', all, ddg).url, ddg('plain words'));
});
