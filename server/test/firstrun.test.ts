import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { kvSet } from '../db.ts';
import { findPlaces, firstRunPending, finishFirstRun, markExistingInstall } from '../firstrun.ts';

test('first run shows once per server, and never on an install that was already set up', () => {
  kvSet('first-run-done', null);
  for (const k of ['board', 'boards', 'app-order', 'brand', 'appearance', 'pages']) kvSet(k, null);
  markExistingInstall();
  assert.equal(firstRunPending(), true);
  finishFirstRun();
  assert.equal(firstRunPending(), false);
  // An upgrade: a saved name means someone set this server up before the sheet existed.
  kvSet('first-run-done', null);
  kvSet('brand', { name: 'Tank' });
  markExistingInstall();
  assert.equal(firstRunPending(), false);
  kvSet('brand', null);
});

test('the place search needs two letters, and demo mode answers without the network', async () => {
  assert.deepEqual(await findPlaces('R', 'en', true), []);
  const found = await findPlaces('Riverside', 'en', true);
  assert.equal(found[0].area, 'California, United States');
});
