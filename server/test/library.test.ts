import { strict as assert } from 'node:assert';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { fromLookup, fromMovie, fromSeries, refusal } from '../adapters/library.ts';

test('shows and films read the same way on the Library page', () => {
  const show = fromSeries({ id: 3, title: 'Silo', year: 2023, monitored: true, status: 'continuing', network: 'Apple TV+', titleSlug: 'silo', added: '2024-01-02T00:00:00Z', statistics: { episodeFileCount: 19, episodeCount: 20, sizeOnDisk: 5 } }, 'http://sonarr');
  assert.deepEqual([show.status, show.have, show.total, show.size, show.by, show.url, show.art], ['airing', 19, 20, 5, 'Apple TV+', 'http://sonarr/series/silo', '/api/art/sonarr/3']);
  assert.equal(fromSeries({ id: 1, title: 'x', monitored: false, status: 'ended', titleSlug: 'x' }, '').status, 'ended');
  assert.equal(fromSeries({ id: 1, title: 'x', monitored: false, titleSlug: 'x' }, '').total, 0);

  const film = fromMovie({ id: 7, title: 'Weapons', year: 2025, monitored: true, status: 'announced', isAvailable: false, hasFile: false, tmdbId: 99 }, 'http://radarr');
  assert.deepEqual([film.status, film.have, film.total, film.url], ['upcoming', 0, 1, 'http://radarr/movie/99']);
  assert.equal(fromMovie({ id: 7, title: 'x', monitored: true, isAvailable: true, hasFile: true, tmdbId: 1 }, '').status, 'out');
});

test('a lookup result says whether it is already in the library', () => {
  const found = fromLookup('sonarr', { id: 0, title: 'The Pitt', titleSlug: 'the-pitt', monitored: false, tvdbId: 42, year: 2025, seasons: [{ seasonNumber: 0 }, { seasonNumber: 1 }], images: [{ coverType: 'poster', remoteUrl: 'https://artworks.thetvdb.com/x.jpg' }] });
  assert.deepEqual([found?.key, found?.have, found?.seasons, found?.art], [42, false, 1, '/api/art/tvdb/42']);
  assert.equal(fromLookup('radarr', { id: 5, title: 'x', titleSlug: 'x', monitored: true, tmdbId: 8 })?.have, true);
  // Nothing to add it by: skip it.
  assert.equal(fromLookup('radarr', { id: 0, title: 'x', titleSlug: 'x', monitored: true, tmdbId: 0 }), null);
});

test('a refusal is said in the app’s own words', () => {
  assert.equal(refusal([{ propertyName: 'Path', errorMessage: 'This series has already been added' }]), 'This series has already been added');
  assert.equal(refusal({ message: 'NotFound' }), 'NotFound');
  assert.equal(refusal(null), undefined);
});

test('Sonarr: adding a show sends its quality, folder and search, and a refusal comes back as words', async () => {
  const asked: { method: string; path: string; body: string }[] = [];
  let refuse = false;
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      asked.push({ method: req.method ?? '', path: req.url ?? '', body });
      const json = (v: unknown, status = 200) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(v));
      if (req.url?.startsWith('/api/v3/series/lookup')) return json([{ title: 'The Pitt', tvdbId: 42, titleSlug: 'the-pitt', seasons: [] }]);
      if (req.url === '/api/v3/languageprofile') return json([], 404);
      if (req.url === '/api/v3/series' && req.method === 'POST') return refuse ? json([{ errorMessage: 'This series has already been added' }], 400) : json({ id: 9 }, 201);
      json({});
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { withConfig } = await import('../config.ts');
  const { arrLibrary } = await import('../adapters/library.ts');
  try {
    const lib = await withConfig({ SONARR_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, SONARR_KEY: 'k' }, async () => arrLibrary('sonarr'));
    assert.equal(await lib.add({ key: 42, profile: 4, folder: '/tv', search: true }), 'The Pitt');
    const sent = JSON.parse(asked.find((a) => a.method === 'POST' && a.path === '/api/v3/series')!.body);
    assert.deepEqual([sent.qualityProfileId, sent.rootFolderPath, sent.monitored, sent.addOptions.searchForMissingEpisodes, 'languageProfileId' in sent], [4, '/tv', true, true, false]);
    assert.ok(asked.some((a) => a.path === '/api/v3/series/lookup?term=tvdb:42'));

    await lib.monitor(3, false);
    const editor = asked.find((a) => a.path === '/api/v3/series/editor');
    assert.deepEqual([editor?.method, JSON.parse(editor!.body)], ['PUT', { seriesIds: [3], monitored: false }]);

    await lib.remove(12);
    assert.ok(asked.some((a) => a.method === 'DELETE' && a.path === '/api/v3/queue/12?removeFromClient=true&blocklist=false'));

    refuse = true;
    await assert.rejects(lib.add({ key: 42, profile: 4, folder: '/tv', search: false }), /already been added/);
  } finally {
    server.close();
  }
});
