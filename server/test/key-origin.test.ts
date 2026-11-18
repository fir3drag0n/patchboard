import { strict as assert } from 'node:assert';
import { mkdtempSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'pb-keys-'));
const { setSecret } = await import('../secrets.ts');
const { fetchJsonWidget } = await import('../jsonwidget.ts');
const { validateJsonConfig } = await import('../../shared/jsonwidget.ts');

/** A server that answers with what it was sent: what an attacker would run. */
async function echo(): Promise<{ url: string; seen: string[]; close: () => void }> {
  const seen: string[] = [];
  const srv: Server = createServer((req, res) => {
    seen.push(`${req.url} ${req.headers['x-key'] ?? ''}`);
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ ok: 1 }));
  });
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r));
  const port = (srv.address() as { port: number }).port;
  return { url: `http://127.0.0.1:${port}`, seen, close: () => srv.close() };
}

const widget = (url: string) => {
  const v = validateJsonConfig({ url, headers: { 'X-Key': '${secret:HA_TOKEN}' }, fields: [{ label: 'ok', path: 'ok' }] });
  assert.ok('config' in v, JSON.stringify(v));
  return v.config;
};

test('a saved key goes only to the server it was first used with', async () => {
  const home = await echo();
  const other = await echo();
  try {
    setSecret('HA_TOKEN', 'long-lived-token');
    const first = await fetchJsonWidget(widget(`${home.url}/api/states?k=\${secret:HA_TOKEN}`), true);
    assert.equal(first.error, undefined);
    assert.match(home.seen[0], /long-lived-token/, 'the real server gets it');

    const stolen = await fetchJsonWidget(widget(`${other.url}/?k=\${secret:HA_TOKEN}`), true);
    assert.match(stolen.error ?? '', /only sent to/);
    assert.equal(other.seen.length, 0, 'another server is never even asked');

    // A key in the host can't steer the request either.
    const steered = await fetchJsonWidget(widget('http://${secret:HA_TOKEN}.example.com/'), true);
    assert.match(steered.error ?? '', /host/);

    // Saving the key again lets it bind to a new server.
    setSecret('HA_TOKEN', 'new-token');
    const moved = await fetchJsonWidget(widget(`${other.url}/?k=\${secret:HA_TOKEN}`), true);
    assert.equal(moved.error, undefined);
    assert.match(other.seen[0], /new-token/);
  } finally {
    home.close();
    other.close();
  }
});

test("an app's tile number can use its integration's saved address and key, and only there", async () => {
  const { setSavedSettings } = await import('../config.ts');
  const sonarr = await echo();
  const other = await echo();
  try {
    setSavedSettings({ SONARR_URL: sonarr.url, SONARR_KEY: 'sonarr-key' });
    const tile = (url: string) => {
      const v = validateJsonConfig({ url, headers: { 'X-Key': '${setup:SONARR_KEY}' }, fields: [{ label: 'ok', path: 'ok' }] });
      assert.ok('config' in v, JSON.stringify(v));
      return v.config;
    };
    const ok = await fetchJsonWidget(tile('${setup:SONARR_URL}/api/v3/queue'), true);
    assert.equal(ok.error, undefined);
    assert.equal(sonarr.seen[0], '/api/v3/queue sonarr-key', "Sonarr's own address gets Sonarr's key");

    const stolen = await fetchJsonWidget(tile(`${other.url}/`), true);
    assert.match(stolen.error ?? '', /only to its own integration/);
    assert.equal(other.seen.length, 0, 'another server is never asked');

    // The saved address may only start the URL, never sit inside another one.
    const inside = validateJsonConfig({ url: `${other.url}/?u=\${setup:SONARR_URL}`, headers: {}, fields: [{ label: 'ok', path: 'ok' }] });
    assert.ok('error' in inside);
    // A variable no integration owns resolves to nothing, and says so.
    const odd = validateJsonConfig({ url: `${sonarr.url}/`, headers: { 'X-Key': '${setup:PATCHBOARD_PASSWORD}' }, fields: [{ label: 'ok', path: 'ok' }] });
    assert.ok('config' in odd);
    const unknown = await fetchJsonWidget(odd.config, true);
    assert.match(unknown.error ?? '', /Nothing is saved/);
  } finally {
    setSavedSettings({});
    sonarr.close();
    other.close();
  }
});
