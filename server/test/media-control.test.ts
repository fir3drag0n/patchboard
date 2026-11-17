import { strict as assert } from 'node:assert';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { byShow, fromPlexSections, fromTautulliLibraries, fromVirtualFolders, jellyLibraryDetail, plexLibraryDetail } from '../adapters/media-control.ts';
import { toStream, webUrl } from '../adapters/mediaserver.ts';
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

test('an opened Plex library has its episodes, folders and newest arrivals', () => {
  const d = plexLibraryDetail(
    { key: '2', title: 'TV', type: 'show', Location: [{ path: '/data/tv' }] },
    [{ ratingKey: '9', type: 'episode', grandparentTitle: 'Silo', title: 'Descent', parentIndex: 2, index: 10, addedAt: 1_700_000_000 }],
    6120,
  );
  assert.equal(d.episodes, 6120);
  assert.equal(d.tracks, undefined);
  assert.deepEqual(d.folders, ['/data/tv']);
  assert.deepEqual([d.recent[0].title, d.recent[0].subtitle, d.recent[0].addedAt], ['Silo', 'S02E10 Descent', 1_700_000_000_000]);
  // A film library counts nothing more than its films.
  assert.equal(plexLibraryDetail({ key: '1', title: 'Films', type: 'movie' }, [], 40).episodes, undefined);
});

test('an opened Jellyfin library reads the same way', () => {
  const d = jellyLibraryDetail('jellyfin', { Name: 'Music', ItemId: 'm', CollectionType: 'music', Locations: ['/data/music'] }, [{ Id: 'a1', Name: 'Blue', Type: 'MusicAlbum', DateCreated: '2026-01-02T00:00:00Z' }], 900);
  assert.deepEqual([d.tracks, d.episodes, d.folders], [900, undefined, ['/data/music']]);
  assert.equal(d.recent[0].title, 'Blue');
  assert.equal(d.recent[0].thumb, '/api/img/jellyfin?id=a1');
});

test('a season drop shares one poster, so the shelf shows more than one show', () => {
  const ep = (id: string, title: string, subtitle: string, addedAt: number) => ({ id, type: 'episode', title, subtitle, addedAt });
  const shelf = byShow(
    [ep('e3', 'Big Brother', 'S28E40', 30), ep('e2', 'Big Brother', 'S28E39', 20), { id: 'm1', type: 'movie', title: 'Falling', subtitle: '2026', addedAt: 15 }, ep('e1', 'Big Brother', 'S28E38', 10), ep('s1', 'Silo', 'S02E10', 5)],
    (id) => (id === 'e3' ? 'show-bb' : undefined),
  );
  assert.deepEqual(
    shelf.map((r) => [r.id, r.title, r.episodes, r.subtitle]),
    [
      ['show-bb', 'Big Brother', 3, undefined],
      ['m1', 'Falling', undefined, '2026'],
      ['s1', 'Silo', undefined, 'S02E10'],
    ],
  );
  // Plex links the grouped poster to the show, not one episode.
  const d = plexLibraryDetail({ key: '2', title: 'TV', type: 'show' }, [
    { ratingKey: '9', grandparentRatingKey: '4', type: 'episode', grandparentTitle: 'Silo', title: 'Descent', parentIndex: 2, index: 10, addedAt: 2 },
    { ratingKey: '8', grandparentRatingKey: '4', type: 'episode', grandparentTitle: 'Silo', title: 'Into the Fire', parentIndex: 2, index: 9, addedAt: 1 },
  ]);
  assert.deepEqual([d.recent.length, d.recent[0].id, d.recent[0].episodes], [1, '4', 2]);
});

test('posters link through the https address from Connections, never a plain http one', () => {
  assert.deepEqual(webUrl('https://jellyfin.example.com/'), { webUrl: 'https://jellyfin.example.com' });
  assert.deepEqual(webUrl('http://jellyfin:8096'), {});
});
