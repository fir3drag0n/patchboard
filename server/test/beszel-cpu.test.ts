import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toCpuSeries, toVolumes } from '../adapters/beszel.ts';

test('beszel cpu: 20-minute rows for the last day, 2-hour rows spread over both hours before it', () => {
  const day = Date.parse('2026-11-19T00:00:00Z');
  const s = toCpuSeries(
    [
      { created: '2026-11-18 20:00:00.000Z', type: '120m', stats: { cpu: 40 } },
      { created: '2026-11-19 10:00:00.000Z', type: '120m', stats: { cpu: 99 } },
      { created: '2026-11-19 10:20:00.000Z', type: '20m', stats: { cpu: 12 } },
      { created: '2026-11-18 10:20:00.000Z', type: '20m', stats: { cpu: 77 } },
    ],
    day,
  );
  assert.deepEqual(s, [
    [Date.parse('2026-11-18T18:30:00Z'), 40],
    [Date.parse('2026-11-18T19:30:00Z'), 40],
    [Date.parse('2026-11-19T10:10:00Z'), 12],
  ]);
});

test('beszel volumes: the root disk as System, extra filesystems by name, in bytes', () => {
  const G = 1024 ** 3;
  assert.deepEqual(toVolumes({ d: 200, du: 85, efs: { nvme0n1p4: { d: 1847, du: 689 }, empty: { d: 0 } } }), [
    { name: 'System', used: 85 * G, total: 200 * G },
    { name: 'nvme0n1p4', used: 689 * G, total: 1847 * G },
  ]);
  assert.deepEqual(toVolumes(undefined), []);
});
