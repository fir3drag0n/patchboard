import { strict as assert } from 'node:assert';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

// The Clipboard API is missing at a plain http address (http://server:3200),
// where many people open Patchboard. Every Copy goes through web/lib/copy.ts,
// which falls back there.
test('every Copy button goes through copyText, so it works over plain http', () => {
  const files = readdirSync('web', { recursive: true, encoding: 'utf8' }).filter((f) => /\.tsx?$/.test(f) && !f.endsWith(join('lib', 'copy.ts')));
  const direct = files.filter((f) => /navigator\.clipboard/.test(readFileSync(join('web', f), 'utf8')));
  assert.deepEqual(direct, []);
});
