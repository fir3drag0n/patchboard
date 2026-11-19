import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toCpuSeries } from '../adapters/beszel.ts';

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
