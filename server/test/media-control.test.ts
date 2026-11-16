import { strict as assert } from 'node:assert';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { fromPlexSections, fromTautulliLibraries, fromVirtualFolders } from '../adapters/media-control.ts';
import { toStream } from '../adapters/mediaserver.ts';
import { toTautulliStream } from '../adapters/tautulli.ts';

test('a stream carries its session and device, so the Media page can stop it', () => {
  const jf = toStream('jellyfin', { Id: 'abc', DeviceName: 'Shield', UserName: 'Jo', NowPlayingItem: { Id: '1', Name: 'Silo', Type: 'Movie' } });
  assert.deepEqual([jf?.session, jf?.device], ['abc', 'Shield']);
  const px = toTautulliStream({ friendly_name: 'Sam', media_type: 'movie', title: 'Sinners', full_title: 'Sinners', state: 'playing', session_id: 'x9', player: 'Living room' });
  assert.deepEqual([px.session, px.device], ['x9', 'Living room']);
});

test('libraries read the same from Plex, Tautulli, Jellyfin and Emby', () => {
  const plex = fromPlexSections([{ key: '1', title: 'Films', type: 'movie', refreshing: true, scannedAt: 1_700_000_000 }, { key: '7', title: 'Odd', type: 'clip' }], new Map([['1', 1204]]));
  assert.deepEqual(plex.map((l) => [l.id, l.kind, l.count, l.scanning, l.canScan]), [['1', 'movies', 1204, true, true], ['7', 'other', undefined, false, true]]);
  assert.equal(plex[0].scannedAt, 1_700_000_000_000);
  const viaTautulli = fromTautulliLibraries([{ section_id: 2, section_name: 'TV', section_type: 'show', count: '212' }], false);
  assert.deepEqual([viaTautulli[0].kind, viaTautulli[0].count, viaTautulli[0].canScan], ['shows', 212, false]);
  const jf = fromVirtualFolders('jellyfin', [{ Name: 'Shows', ItemId: 'f1', CollectionType: 'tvshows', RefreshStatus: 'Active' }, { Name: 'No id' }]);
  assert.deepEqual(jf.map((l) => [l.id, l.kind, l.scanning]), [['f1', 'shows', true]]);
});

test('Jellyfin: stop says why, then stops; scan refreshes that library; counts come along', async () => {
  const asked: string[] = [];
  const server = http.createServer((req, res) => {
    asked.push(`${req.method} ${req.url}`);
    const json = (v: unknown) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(v));
    if (req.url === '/Library/VirtualFolders') return json([{ Name: 'Movies', ItemId: 'm1', CollectionType: 'movies' }]);
    if (req.url?.startsWith('/Items?ParentId=m1')) return json({ TotalRecordCount: 980, Items: [] });
    res.writeHead(204).end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { withConfig } = await import('../config.ts');
  const { mediaControl } = await import('../adapters/media-control.ts');
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await withConfig({ JELLYFIN_URL: url, JELLYFIN_KEY: 'k' }, async () => {
      const ctl = mediaControl('jellyfin')!;
      await ctl.stop('s1');
      const libs = await ctl.libraries();
      await ctl.scan!('m1');
      assert.deepEqual([libs[0].name, libs[0].count], ['Movies', 980]);
    });
    assert.deepEqual(asked.slice(0, 2), ['POST /Sessions/s1/Message', 'POST /Sessions/s1/Playing/Stop']);
    assert.ok(asked.some((a) => a.startsWith('POST /Items/m1/Refresh?Recursive=true')));
  } finally {
    server.close();
  }
});

test('Plex: scan asks Plex itself, and stopping without Plex Pass says so', async () => {
  const asked: string[] = [];
  const server = http.createServer((req, res) => {
    asked.push(`${req.url} ${req.headers['x-plex-token']}`);
    if (req.url?.startsWith('/status/sessions/terminate')) return res.writeHead(401).end();
    if (req.url === '/library/sections') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ MediaContainer: { Directory: [{ key: '3', title: 'Music', type: 'artist' }] } }));
    res.writeHead(200).end();
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { withConfig } = await import('../config.ts');
  const { mediaControl } = await import('../adapters/media-control.ts');
  try {
    const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await withConfig({ PLEX_URL: url, PLEX_TOKEN: 'tok' }, async () => {
      const ctl = mediaControl('plex')!;
      assert.deepEqual((await ctl.libraries()).map((l) => [l.name, l.kind]), [['Music', 'music']]);
      await ctl.scan!('3');
      await assert.rejects(ctl.stop('abc'), /Plex Pass/);
    });
    assert.ok(asked.includes('/library/sections/3/refresh tok'), 'the token goes in a header, never the address');
  } finally {
    server.close();
  }
});
