import { strict as assert } from 'node:assert';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

// Docker stops a container with SIGTERM and kills it 10 seconds later.
// Patchboard has to leave on its own, at once and cleanly.
test('SIGTERM stops Patchboard cleanly, well inside Docker’s 10 seconds', { skip: process.platform === 'win32' && 'Windows has no SIGTERM to send' }, async () => {
  const port = 3290 + Math.floor(Math.random() * 5);
  const child = spawn(process.execPath, ['server/index.ts'], { env: { ...process.env, DEMO: '1', DATA_DIR: mkdtempSync(join(tmpdir(), 'pb-stop-')), PORT: String(port) }, stdio: 'ignore' });
  for (let i = 0; i < 150; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${port}/api/session`)).ok) break;
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  const started = Date.now();
  const exited = new Promise<number | null>((r) => child.once('exit', (code) => r(code)));
  child.kill('SIGTERM');
  const code = await Promise.race([exited, new Promise<'hung'>((r) => setTimeout(() => r('hung'), 3000))]);
  if (code === 'hung') child.kill('SIGKILL');
  assert.equal(code, 0);
  assert.ok(Date.now() - started < 3000);
});
