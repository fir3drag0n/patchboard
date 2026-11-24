import assert from 'node:assert/strict';
import { test } from 'node:test';
import { CTR_NAME, ctrKey } from '../maintenance.ts';

test('container names for the gates: plain names only', () => {
  for (const ok of ['binhex-prowlarr', 'Home-Assistant-Container', 'radarr_1', 'a.b']) assert.ok(CTR_NAME.test(ok), ok);
  for (const bad of ['', '../x', 'a b', 'a;rm', 'x@oracle', '*', 'a'.repeat(65)]) assert.ok(!CTR_NAME.test(bad), bad);
});

test("Patchboard's name: Unraid's own bare, the Oracles' with @host", () => {
  assert.equal(ctrKey('unraid', 'n8n'), 'n8n');
  assert.equal(ctrKey('oracle', 'synapse'), 'synapse@oracle');
  assert.equal(ctrKey('oracle2', '*'), '*@oracle2');
});
