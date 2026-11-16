import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { dimLabel, isNight } from '../../shared/wall.ts';

test('night hours run past midnight and read as times', () => {
  const at = (h: number) => new Date(2026, 10, 12, h, 30);
  assert.ok(isNight('22-7', at(23)) && isNight('22-7', at(3)));
  assert.ok(!isNight('22-7', at(7)) && !isNight('22-7', at(21)));
  assert.equal(dimLabel('22-7'), '10 PM to 7 AM');
  assert.equal(dimLabel('21-6'), '9 PM to 6 AM');
});
