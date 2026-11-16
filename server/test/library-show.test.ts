import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { fromHistory, fromShow } from '../adapters/library.ts';

test('a show opens to its seasons, newest first and specials last, with every episode in order', () => {
  const now = Date.parse('2026-11-16T12:00:00Z');
  const show = fromShow(
    [
      { seasonNumber: 0, monitored: false, statistics: { episodeFileCount: 0, totalEpisodeCount: 1, sizeOnDisk: 0 } },
      { seasonNumber: 1, monitored: true, statistics: { episodeFileCount: 2, totalEpisodeCount: 2, sizeOnDisk: 4e9 } },
      { seasonNumber: 2, monitored: true },
    ],
    [
      { id: 22, seasonNumber: 2, episodeNumber: 2, title: 'Ahead', airDateUtc: '2026-11-20T02:00:00Z', hasFile: false, monitored: true },
      { id: 21, seasonNumber: 2, episodeNumber: 1, title: 'Out', airDateUtc: '2026-11-10T02:00:00Z', hasFile: false, monitored: true },
      { id: 11, seasonNumber: 1, episodeNumber: 1, airDateUtc: '2025-01-01T02:00:00Z', hasFile: true, monitored: true },
      { id: 12, seasonNumber: 1, episodeNumber: 2, airDateUtc: '2025-01-08T02:00:00Z', hasFile: true, monitored: true },
      { id: 1, seasonNumber: 0, episodeNumber: 1, hasFile: false, monitored: false },
    ],
    now,
  );
  assert.deepEqual(show.seasons.map((s) => [s.number, s.have, s.aired, s.total]), [[2, 0, 1, 2], [1, 2, 2, 2], [0, 0, 0, 1]]);
  assert.deepEqual(show.episodes.map((e) => e.id), [1, 11, 12, 21, 22]);
  assert.equal(show.episodes[1].title, '');
});

test('history reads the same from Sonarr and Radarr, whatever each calls its events', () => {
  const h = fromHistory([
    { id: 1, eventType: 'grabbed', date: '2026-11-16T10:00:00Z', sourceTitle: 'Silo.S02E10.2160p', quality: { quality: { name: 'WEBDL-2160p' } }, data: { indexer: 'NZBgeek' }, series: { title: 'Silo' }, episode: { seasonNumber: 2, episodeNumber: 10, title: 'Into the Fire' } },
    { id: 2, eventType: 'downloadFolderImported', date: '2026-11-16T11:00:00Z', data: { downloadClientName: 'SABnzbd' }, movie: { title: 'Dune: Part Two', year: 2024 } },
    { id: 3, eventType: 'downloadFailed', date: '2026-11-16T11:30:00Z', data: { message: 'No files found' }, movie: { title: 'X' } },
    { id: 4, eventType: 'movieFileDeleted', date: '2026-11-16T11:40:00Z', data: { reason: 'Upgrade' }, movie: { title: 'Y' } },
    { id: 5, eventType: 'somethingNew', date: '2026-11-16T11:50:00Z', sourceTitle: 'Z' },
  ]);
  assert.deepEqual(h.map((x) => x.event), ['grabbed', 'imported', 'failed', 'deleted', 'other']);
  assert.deepEqual([h[0].subtitle, h[0].from, h[0].quality], ['S02E10 Into the Fire', 'NZBgeek', 'WEBDL-2160p']);
  assert.deepEqual([h[1].subtitle, h[1].from], ['2024', 'SABnzbd']);
  assert.deepEqual([h[2].message, h[3].message, h[4].title], ['No files found', 'Upgrade', 'Z']);
});
