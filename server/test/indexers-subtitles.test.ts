import { strict as assert } from 'node:assert';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { fromProwlarr, fromTestAll } from '../adapters/indexers.ts';
import { fromWantedEpisodes, fromWantedMovies, searchPath } from '../adapters/subtitles.ts';

test('Prowlarr: each indexer with its numbers, and failing only while Prowlarr has it set aside', () => {
  const now = Date.parse('2026-11-16T12:00:00Z');
  const list = fromProwlarr(
    [
      { id: 2, name: 'Zed', enable: true, protocol: 'usenet' },
      { id: 1, name: 'Alpha', enable: true, protocol: 'torrent' },
      { id: 3, name: 'Mid', enable: false, protocol: 'torrent' },
    ],
    [
      { indexerId: 1, disabledTill: '2026-11-16T12:30:00Z', initialFailure: '2026-11-16T09:00:00Z' },
      { indexerId: 2, disabledTill: '2026-11-16T11:00:00Z' },
    ],
    { indexers: [{ indexerId: 1, numberOfQueries: 40, numberOfGrabs: 3, averageResponseTime: 812 }] },
    now,
  );
  assert.deepEqual(list.map((i) => [i.name, i.protocol, i.enabled, !!i.failingUntil]), [['Alpha', 'torrent', true, true], ['Mid', 'torrent', false, false], ['Zed', 'usenet', true, false]]);
  assert.deepEqual([list[0].queries, list[0].grabs, list[0].responseMs, list[0].failingSince], [40, 3, 812, Date.parse('2026-11-16T09:00:00Z')]);
  const tests = fromTestAll([{ id: 1, isValid: false, validationFailures: [{ errorMessage: 'Unable to connect' }] }, { id: 2, isValid: true }], new Map([[1, 'Alpha'], [2, 'Zed']]));
  assert.deepEqual(tests, [{ id: 1, name: 'Alpha', ok: false, error: 'Unable to connect' }, { id: 2, name: 'Zed', ok: true, error: undefined }]);
});

test('Prowlarr: a failed test says why, and Test all reads its answer even from a 400', async () => {
  const asked: string[] = [];
  const server = http.createServer((req, res) => {
    asked.push(`${req.method} ${req.url}`);
    const json = (code: number, v: unknown) => res.writeHead(code, { 'content-type': 'application/json' }).end(JSON.stringify(v));
    if (req.url === '/api/v1/indexer/7') return json(200, { id: 7, name: 'Down', enable: true, protocol: 'torrent' });
    if (req.url === '/api/v1/indexer') return json(200, [{ id: 7, name: 'Down', enable: true, protocol: 'torrent' }]);
    if (req.url === '/api/v1/indexer/test') return json(400, [{ propertyName: '', errorMessage: 'Unable to connect to indexer' }]);
    if (req.url === '/api/v1/indexer/testall') return json(400, [{ id: 7, isValid: false, validationFailures: [{ errorMessage: 'Unable to connect to indexer' }] }]);
    if (req.method === 'PUT') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => json(202, { ...JSON.parse(body) }));
      return;
    }
    json(404, {});
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { withConfig } = await import('../config.ts');
  const { prowlarrControl } = await import('../adapters/indexers.ts');
  try {
    await withConfig({ PROWLARR_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, PROWLARR_KEY: 'k' }, async () => {
      const ctl = prowlarrControl()!;
      await assert.rejects(ctl.test(7), /Unable to connect to indexer/);
      assert.deepEqual(await ctl.testAll(), [{ id: 7, name: 'Down', ok: false, error: 'Unable to connect to indexer' }]);
      await ctl.enable(7, false);
    });
    assert.ok(asked.includes('PUT /api/v1/indexer/7?forceSave=true'));
  } finally {
    server.close();
  }
});

test('Bazarr: wanted episodes and films read the same, and a search asks for each missing language', () => {
  const eps = fromWantedEpisodes([{ seriesTitle: 'Severance', episode_number: '2x03', episodeTitle: 'Who Is Alive?', sonarrSeriesId: 11, sonarrEpisodeId: 1103, missing_subtitles: [{ name: 'English', code2: 'en', hi: true }, { name: 'French', code2: 'fr', forced: false }] }]);
  assert.deepEqual(eps[0], { id: '11:1103', title: 'Severance', subtitle: '2x03 Who Is Alive?', missing: [{ code: 'en', name: 'English', hi: true }, { code: 'fr', name: 'French' }] });
  const films = fromWantedMovies([{ title: 'Past Lives', radarrId: 302, missing_subtitles: [{ name: 'English', code2: 'en' }] }]);
  assert.deepEqual(films[0], { id: '302', title: 'Past Lives', missing: [{ code: 'en', name: 'English' }] });
  assert.equal(searchPath('episodes', '11:1103', eps[0].missing[0]), '/api/episodes/subtitles?seriesid=11&episodeid=1103&language=en&forced=false&hi=true');
  assert.equal(searchPath('movies', '302', films[0].missing[0]), '/api/movies/subtitles?radarrid=302&language=en&forced=false&hi=false');
});
