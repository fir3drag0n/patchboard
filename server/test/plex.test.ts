import { strict as assert } from 'node:assert';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { fromPlexHistory, fromPlexRecent, fromPlexSessions } from '../adapters/plex.ts';

test('Plex on its own reads like Tautulli: who, what, how far, on what, and the session to stop', () => {
  const [ep, film] = fromPlexSessions([
    { ratingKey: '9', type: 'episode', title: 'Hello Goodbye', grandparentTitle: 'Slow Horses', parentIndex: 5, index: 2, grandparentThumb: '/library/metadata/1/thumb/1', viewOffset: 600_000, duration: 2_400_000, User: { title: 'Sam' }, Player: { title: 'Living room', state: 'paused' }, Session: { id: 'abc' }, TranscodeSession: { videoDecision: 'transcode' } },
    { ratingKey: '7', type: 'movie', title: 'Sinners', year: 2025, User: { title: 'Jo' }, Player: { product: 'Plex for iOS', state: 'playing' } },
  ]);
  assert.deepEqual([ep.title, ep.subtitle, ep.user, ep.state, ep.transcode, ep.session, ep.device, ep.progress], ['Slow Horses', 'S05E02 Hello Goodbye', 'Sam', 'paused', true, 'abc', 'Living room', 25]);
  assert.equal(ep.thumb, '/api/img/plex?path=%2Flibrary%2Fmetadata%2F1%2Fthumb%2F1');
  assert.deepEqual([film.subtitle, film.progress, film.device, film.transcode], [undefined, -1, 'Plex for iOS', false]);
});

test('Plex: recently added newest first, and plays named by account', () => {
  const recent = fromPlexRecent([
    { ratingKey: '1', type: 'movie', title: 'Old', addedAt: 100 },
    { ratingKey: '2', type: 'season', title: 'Season 2', parentTitle: 'Silo', addedAt: 200 },
    { type: 'movie', title: 'No key', addedAt: 300 },
  ]);
  assert.deepEqual(recent.map((r) => [r.id, r.title, r.subtitle, r.addedAt]), [['2', 'Silo', 'Season 2', 200_000], ['1', 'Old', undefined, 100_000]]);
  const plays = fromPlexHistory([{ ratingKey: '9', type: 'episode', title: 'Pilot', grandparentTitle: 'Fallout', parentIndex: 1, index: 1, viewedAt: 50, accountID: 1 }, { type: 'movie', title: 'X', viewedAt: 40, accountID: 99 }], new Map([[1, 'Nathan']]));
  assert.deepEqual(plays.map((p) => [p.user, p.title, p.subtitle, p.at]), [['Nathan', 'Fallout', 'S01E01 Pilot', 50_000], ['Someone', 'X', undefined, 40_000]]);
});

test('Plex: the token goes in a header, and posters only come from the library', async () => {
  const asked: string[] = [];
  const server = http.createServer((req, res) => {
    asked.push(`${req.url} ${req.headers['x-plex-token']}`);
    const mc = (v: unknown) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ MediaContainer: v }));
    if (req.url === '/identity') return mc({ machineIdentifier: 'm1' });
    if (req.url?.startsWith('/library/recentlyAdded')) return mc({ Metadata: [{ ratingKey: '3', type: 'movie', title: 'Dune', addedAt: 10 }] });
    if (req.url === '/status/sessions') return mc({ Metadata: [] });
    if (req.url?.startsWith('/photo/')) return res.writeHead(200, { 'content-type': 'image/jpeg' }).end('jpg');
    mc({});
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { withConfig } = await import('../config.ts');
  const { plexAdapter, plexImage } = await import('../adapters/plex.ts');
  try {
    await withConfig({ PLEX_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, PLEX_TOKEN: 'tok' }, async () => {
      const a = plexAdapter();
      assert.equal(a.id, 'tautulli');
      const data = await a.fetch();
      assert.deepEqual([data.streams, data.recent[0].title, data.itemPath?.includes('m1')], [[], 'Dune', true]);
      assert.equal(await (await plexImage('/library/metadata/3/thumb/9')).text(), 'jpg');
      await assert.rejects(plexImage('/:/prefs'), /Bad image path/);
      await assert.rejects(plexImage('/library/../accounts'), /Bad image path/);
    });
    assert.ok(asked.every((a) => a.endsWith(' tok') && !a.includes('X-Plex-Token=')), 'the token never rides in the address');
  } finally {
    server.close();
  }
});
