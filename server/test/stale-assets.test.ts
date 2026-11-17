import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { isStaleBuild } from '../../web/lib/stale.ts';

test('a page whose code is gone after an update reads as a stale build, in every browser', () => {
  for (const m of ['Importing a module script failed.', 'Failed to fetch dynamically imported module: https://x/assets/Settings-abc.js', 'error loading dynamically imported module', 'Unable to preload CSS for /assets/a.css'])
    assert.equal(isStaleBuild(new TypeError(m)), true, m);
  assert.equal(isStaleBuild(new Error("Cannot read properties of undefined (reading 'map')")), false);
});
