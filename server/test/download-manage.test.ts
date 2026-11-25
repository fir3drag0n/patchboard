import { strict as assert } from 'node:assert';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { fromDeluge, fromNzbget, fromNzbgetHistory, fromSabHistory, fromSabQueue, fromTransmission, trackerHost } from '../adapters/downloads.ts';
import { fromQbit } from '../adapters/qbit.ts';

const GB = 1024 ** 3;

test('every client says the same thing about a download in its own words', () => {
  const base = { hash: 'h', name: 'n', progress: 0.5, size: 2 * GB, completed: GB, dlspeed: 100, upspeed: 5, eta: 60, ratio: 0.1, category: 'tv', added_on: 1_700_000_000, tracker: 'https://tracker.example.org/announce' };
  assert.equal(fromQbit({ ...base, state: 'downloading' }).state, 'downloading');
  assert.equal(fromQbit({ ...base, state: 'stalledDL' }).state, 'stalled');
  assert.equal(fromQbit({ ...base, state: 'stoppedDL' }).state, 'paused');
  assert.equal(fromQbit({ ...base, state: 'stoppedUP', progress: 1 }).state, 'done');
  assert.equal(fromQbit({ ...base, state: 'stalledUP', progress: 1 }).state, 'seeding');
  assert.equal(fromQbit({ ...base, state: 'missingFiles' }).state, 'errored');
  const q = fromQbit({ ...base, state: 'downloading' });
  assert.equal(q.tracker, 'example.org');
  assert.equal(q.added, 1_700_000_000_000);
  // qBittorrent says 8640000 for "forever": that's no time left to show.
  assert.equal(fromQbit({ ...base, state: 'stalledDL', eta: 8_640_000 }).etaSec, -1);

  const tr = { hashString: 'h', name: 'n', percentDone: 0.5, sizeWhenDone: 2 * GB, haveValid: GB, rateDownload: 0, rateUpload: 0, eta: -1, uploadRatio: -1, addedDate: 0, error: 0, errorString: '' };
  assert.equal(fromTransmission({ ...tr, status: 4 }).state, 'stalled');
  assert.equal(fromTransmission({ ...tr, status: 0, percentDone: 1 }).state, 'done');
  assert.equal(fromTransmission({ ...tr, status: 6, percentDone: 1 }).state, 'seeding');
  assert.equal(fromTransmission({ ...tr, status: 4, error: 3, errorString: 'No data found' }).error, 'No data found');
  assert.equal(fromTransmission({ ...tr, status: 4 }).ratio, undefined);

  const de = { name: 'n', progress: 100, total_wanted: GB, total_done: GB, download_payload_rate: 0, upload_payload_rate: 0, eta: 0, ratio: 1.5, time_added: 0 };
  assert.equal(fromDeluge('x', { ...de, state: 'Paused' }).state, 'done');
  assert.equal(fromDeluge('x', { ...de, state: 'Paused', progress: 40 }).state, 'paused');
  assert.equal(fromDeluge('x', { ...de, state: 'Error', message: 'Disk full' }).error, 'Disk full');

  // What each torrent gave back, for the arrow up beside its ratio.
  assert.equal(fromQbit({ ...base, state: 'uploading', uploaded: 3 * GB }).uploaded, 3 * GB);
  assert.equal(fromTransmission({ ...tr, status: 6, uploadedEver: GB }).uploaded, GB);
  assert.equal(fromDeluge('x', { ...de, state: 'Seeding', total_uploaded: 2 * GB }).uploaded, 2 * GB);
  assert.equal(fromQbit({ ...base, state: 'uploading' }).uploaded, undefined);

  const sab = fromSabQueue({ nzo_id: 'a', filename: 'n', percentage: '25', mb: '1024', mbleft: '768', timeleft: '0:10:00', status: 'Downloading', cat: '*' }, 5e6, false);
  assert.deepEqual([sab.state, sab.etaSec, sab.done, sab.category], ['downloading', 600, 256 * 1024 * 1024, undefined]);
  assert.equal(fromSabQueue({ nzo_id: 'a', filename: 'n', percentage: '25', mb: '1', mbleft: '1', timeleft: '0:00:00', status: 'Queued' }, 0, true).state, 'paused');
  const failed = fromSabHistory({ nzo_id: 'b', name: 'n', status: 'Failed', bytes: 10, completed: 1, fail_message: 'Repair failed' });
  assert.deepEqual([failed.state, failed.error, failed.history], ['errored', 'Repair failed', true]);

  assert.equal(fromNzbget({ NZBID: 4, NZBName: 'n', FileSizeMB: 100, RemainingSizeMB: 25, Status: 'DOWNLOADING' }, 1e6, false).progress, 0.75);
  assert.equal(fromNzbget({ NZBID: 4, NZBName: 'n', FileSizeMB: 100, RemainingSizeMB: 25, Status: 'UNPACKING' }, 0, false).state, 'checking');
  assert.equal(fromNzbgetHistory({ NZBID: 5, Name: 'n', Status: 'FAILURE/PAR', FileSizeMB: 1, HistoryTime: 1 }).error, 'par');

  assert.equal(trackerHost('udp://tracker.opentrackr.org:1337/announce'), 'opentrackr.org');
  assert.equal(trackerHost('not a url'), undefined);
});

test('qBittorrent: remove keeps the files, delete takes them, and a link is added by form', async () => {
  const asked: { path: string; body: string }[] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => {
      asked.push({ path: req.url ?? '', body });
      if (req.url === '/api/v2/auth/login') return res.writeHead(200, { 'set-cookie': 'SID=abc; path=/' }).end('Ok.');
      if (req.url === '/api/v2/torrents/info') return res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify([{ hash: 'aa11', name: 'One', state: 'stalledUP', progress: 1, size: 5, completed: 5, dlspeed: 0, upspeed: 0, eta: 8640000, ratio: 2, category: '', added_on: 1, tracker: '' }]));
      res.writeHead(200).end('Ok.');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { withConfig } = await import('../config.ts');
  const { qbitClient } = await import('../adapters/qbit.ts');
  try {
    const { manage } = await withConfig({ QBIT_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, QBIT_USERNAME: 'u', QBIT_PASSWORD: 'p' }, async () => qbitClient());
    const list = await manage.list();
    assert.equal(list.entries[0].state, 'seeding');
    await manage.act(list.entries[0], 'remove');
    await manage.act(list.entries[0], 'delete');
    await manage.add({ url: 'magnet:?xt=urn:btih:abc&dn=Two' });
    const deletes = asked.filter((a) => a.path === '/api/v2/torrents/delete').map((a) => a.body);
    assert.deepEqual(deletes, ['hashes=aa11&deleteFiles=false', 'hashes=aa11&deleteFiles=true']);
    const add = asked.find((a) => a.path === '/api/v2/torrents/add');
    assert.ok(add?.body.includes('name="urls"') && add.body.includes('magnet:?xt=urn:btih:abc'));
  } finally {
    server.close();
  }
});

test("qBittorrent: a torrent being checked shows its own share done, not the shared running total", () => {
  const t = { hash: 'h', name: 'n', progress: 0.5, size: 1000, completed: 18_500_000_000, dlspeed: 0, upspeed: 0, eta: 8_640_000, ratio: 0, category: 'tv', added_on: 1_700_000_000, tracker: '' };
  const checking = fromQbit({ ...t, state: 'checkingDL' });
  assert.equal(checking.state, 'checking');
  assert.equal(checking.done, 500);
});
