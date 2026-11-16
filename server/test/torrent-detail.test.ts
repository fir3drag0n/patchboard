import { strict as assert } from 'node:assert';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { test } from 'node:test';
import { fromDelugeDetail, fromTransmissionDetail } from '../adapters/downloads.ts';
import { fromQbitDetail } from '../adapters/qbit.ts';

test('a torrent opens the same from qBittorrent, Transmission and Deluge', () => {
  const qb = fromQbitDetail(
    [
      { index: 0, name: 'Show.S01/Show.S01E01.mkv', size: 1000, progress: 1, priority: 1 },
      { index: 1, name: 'Show.S01/sample.mkv', size: 10, progress: 0, priority: 0 },
      { index: 2, name: 'Show.S01/Show.S01E02.mkv', size: 1000, progress: 0.4, priority: 7 },
    ],
    { dl_limit: -1, up_limit: 500_000 },
    'tv',
    ['tv', 'movies'],
  );
  assert.deepEqual(qb.files.map((f) => [f.index, f.name, f.priority]), [[0, 'Show.S01E01.mkv', 'normal'], [1, 'sample.mkv', 'skip'], [2, 'Show.S01E02.mkv', 'high']]);
  assert.deepEqual([qb.limits, qb.category, qb.categories], [{ down: 0, up: 500_000 }, 'tv', ['movies', 'tv']]);

  const tr = fromTransmissionDetail({
    files: [{ name: 'Film/Film.mkv', length: 2000, bytesCompleted: 500 }, { name: 'Film/Film.srt', length: 10, bytesCompleted: 0 }],
    fileStats: [{ wanted: true, priority: 1 }, { wanted: false, priority: 0 }],
    downloadLimit: 2500,
    downloadLimited: true,
    uploadLimit: 100,
    uploadLimited: false,
  });
  assert.deepEqual(tr.files.map((f) => [f.name, f.progress, f.priority]), [['Film.mkv', 0.25, 'high'], ['Film.srt', 0, 'skip']]);
  assert.deepEqual([tr.limits, tr.categories], [{ down: 2_500_000, up: 0 }, undefined]);

  const de = fromDelugeDetail({
    files: [{ index: 0, path: 'Album/01.flac', size: 30 }, { index: 1, path: 'Album/cover.jpg', size: 2 }],
    file_progress: [0.5, 1],
    file_priorities: [4, 0],
    max_download_speed: -1,
    max_upload_speed: 100,
  });
  assert.deepEqual(de.files.map((f) => [f.name, f.priority]), [['01.flac', 'normal'], ['cover.jpg', 'skip']]);
  assert.deepEqual(de.limits, { down: 0, up: 102_400 });
});

test('qBittorrent: priority, category and limits go to the one torrent', async () => {
  const asked: string[] = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      if (req.url === '/api/v2/auth/login') return res.writeHead(200, { 'set-cookie': 'SID=x; path=/' }).end('Ok.');
      asked.push(`${req.url} ${decodeURIComponent(body)}`);
      res.writeHead(200).end('');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const { withConfig } = await import('../config.ts');
  const { qbitClient } = await import('../adapters/qbit.ts');
  try {
    await withConfig({ QBIT_URL: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, QBIT_USERNAME: 'u', QBIT_PASSWORD: 'p' }, async () => {
      const { manage } = qbitClient();
      const entry = { id: 'abc', name: 'x', state: 'downloading' as const, progress: 0, size: 0, done: 0, down: 0, up: 0, etaSec: -1 };
      const detail = { files: [], limits: { down: 0, up: 0 } };
      await manage.change!(entry, { files: [0, 2], priority: 'skip' }, detail);
      await manage.change!(entry, { category: 'tv shows' }, detail);
      await manage.change!(entry, { limits: { down: 2_500_000, up: 0 } }, detail);
    });
    assert.deepEqual(asked, [
      '/api/v2/torrents/filePrio hash=abc&id=0|2&priority=0',
      '/api/v2/torrents/setCategory hashes=abc&category=tv shows',
      '/api/v2/torrents/setDownloadLimit hashes=abc&limit=2500000',
      '/api/v2/torrents/setUploadLimit hashes=abc&limit=0',
    ]);
  } finally {
    server.close();
  }
});
