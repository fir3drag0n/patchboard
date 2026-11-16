import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { appIconFor, appIconVersion, clearAppIcon, saveAppIcon } from '../appicon.ts';

// Just a PNG's signature and header: enough for the size check.
const png = (size: number) => {
  const b = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b);
  b.writeUInt32BE(13, 8);
  b.write('IHDR', 12, 'latin1');
  b.writeUInt32BE(size, 16);
  b.writeUInt32BE(size, 20);
  return `data:image/png;base64,${b.toString('base64')}`;
};
const set = (bad?: number) => Object.fromEntries([64, 180, 192, 512].map((s) => [s, png(s === bad ? s + 1 : s)]));

test('your own app icon answers at the P addresses until you go back to the P', () => {
  clearAppIcon();
  assert.equal(appIconFor('/icon-192.png'), null);
  assert.match(String((saveAppIcon({ color: set(), mono: set(180) }) as { error: string }).error), /180px mono/);
  const r = saveAppIcon({ color: set(), mono: set() });
  assert.ok('icon' in r && r.icon === appIconVersion());
  for (const [path, size] of [['/favicon.png', 64], ['/icon-180.png', 180], ['/icon-light-512.png', 512], ['/icon-mono-dark-192.png', 192], ['/favicon-mono.png', 64]] as const) {
    assert.equal(appIconFor(path)?.readUInt32BE(16), size, path);
  }
  assert.equal(appIconFor('/icon-999.png'), null);
  assert.equal(appIconFor('/assets/icon-192.png'), null);
  clearAppIcon();
  assert.equal(appIconFor('/icon-192.png'), null);
});
