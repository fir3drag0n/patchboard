import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CTR_NAME, CTR_SELF } from '../maintenance.ts';

test('container names for the Unraid gate: plain names only', () => {
  for (const ok of ['binhex-prowlarr', 'Home-Assistant-Container', 'radarr_1', 'a.b']) assert.ok(CTR_NAME.test(ok), ok);
  for (const bad of ['', '../x', 'a b', 'a;rm', 'x@oracle', '*', 'a'.repeat(65)]) assert.ok(!CTR_NAME.test(bad), bad);
});

test('n8n never updates itself from a button', () => {
  assert.ok(CTR_SELF.includes('n8n'));
});
