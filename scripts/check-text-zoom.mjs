// Firefox's text-only zoom (View, Zoom, Zoom Text Only) at 200%, against an
// isolated demo database. Unlike page zoom, it enlarges the words and leaves
// the layout's widths and breakpoints alone, so a desktop layout has to make
// room for text twice its size.
//
// Playwright can't reach Firefox's own text zoom, so this drives Playwright's
// Firefox build over Marionette, Firefox's built-in automation protocol, and
// sets the zoom from the browser side. Install it once with
// `npx playwright-core install firefox`.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { firefox } from 'playwright-core';

const ZOOM = 2;
const dir = mkdtempSync(join(tmpdir(), 'pb-text-zoom-'));
const port = process.env.CHECK_PORT ?? '3293';
const marionette = Number(process.env.MARIONETTE_PORT ?? 2831);
const base = `http://localhost:${port}`;
const server = spawn(process.execPath, ['server/index.ts'], { env: { ...process.env, DEMO: '1', DATA_DIR: dir, PORT: port }, stdio: 'ignore' });
const profile = join(dir, 'firefox');
mkdirSync(profile);
// Text-only zoom, the same for every site.
writeFileSync(join(profile, 'user.js'), [`user_pref("marionette.port", ${marionette});`, 'user_pref("browser.zoom.full", false);', 'user_pref("browser.zoom.siteSpecific", false);', 'user_pref("browser.shell.checkDefaultBrowser", false);', ''].join('\n'));
// Setting the zoom is a browser-side script, which Marionette allows only with this set.
const browser = spawn(firefox.executablePath(), ['--marionette', '--headless', '--no-remote', '--profile', profile], { env: { ...process.env, MOZ_REMOTE_ALLOW_SYSTEM_ACCESS: '1' }, stdio: 'ignore' });

// Marionette: length-prefixed JSON, [0, id, command, params] out and [1, id, error, result] back.
let socket;
let pending = '';
let nextId = 0;
const waiting = new Map();
const send = (name, params = {}) =>
  new Promise((resolve, reject) => {
    const id = ++nextId;
    waiting.set(id, { resolve, reject });
    const body = JSON.stringify([0, id, name, params]);
    socket.write(`${Buffer.byteLength(body)}:${body}`);
  });
const inPage = async (fn) => (await send('WebDriver:ExecuteAsyncScript', { script: `const done = arguments[0]; Promise.resolve((${fn})()).then(done, (e) => done({ failed: String(e) }));`, args: [] })).value;

// In the page: what doesn't fit at this text size.
function problems() {
  const out = [];
  const shown = (el) => el.checkVisibility({ visibilityProperty: true, opacityProperty: true }) && el.getClientRects().length > 0;
  const label = (el) => `${el.className && typeof el.className === 'string' ? '.' + el.className.split(' ')[0] : el.tagName.toLowerCase()} "${(el.getAttribute('aria-label') || el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 24)}"`;
  const overlap = (a, b) => a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
  if (document.documentElement.scrollWidth > innerWidth + 1) out.push(`page scrolls sideways (${document.documentElement.scrollWidth}px wide)`);
  const bar = document.querySelector('.topbar');
  if (bar.scrollWidth > bar.clientWidth + 1) out.push(`top bar runs ${bar.scrollWidth - bar.clientWidth}px past the window`);
  const items = [...bar.querySelectorAll('.wordmark, .nav > .nav-link:not(.nav-wrapped), .nav-over > .nav-link, .topbar-end > *')].filter(shown);
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (overlap(items[i].getBoundingClientRect(), items[j].getBoundingClientRect())) out.push(`${label(items[i])} and ${label(items[j])} overlap in the top bar`);
    }
  }
  for (const head of document.querySelectorAll('main .section-head')) {
    if (!shown(head)) continue;
    const edge = head.getBoundingClientRect().right;
    for (const child of head.children) {
      if (shown(child) && child.getBoundingClientRect().right > edge + 1) out.push(`${label(child)} runs out of its section heading`);
    }
  }
  return out;
}

try {
  let ready = false;
  for (let i = 0; i < 100 && !ready; i++) {
    try { ready = (await fetch(`${base}/api/session`)).ok; } catch {}
    if (!ready) await new Promise((r) => setTimeout(r, 100));
  }
  assert(ready, 'demo server started');
  for (let i = 0; i < 150 && !socket; i++) {
    await new Promise((r) => setTimeout(r, 200));
    socket = await new Promise((resolve) => {
      const s = net.connect(marionette, '127.0.0.1', () => resolve(s));
      s.on('error', () => resolve(null));
    });
  }
  assert(socket, 'Firefox started. Install it with: npx playwright-core install firefox');
  socket.on('data', (chunk) => {
    pending += chunk.toString();
    for (;;) {
      const colon = pending.indexOf(':');
      if (colon < 0) return;
      const size = Number(pending.slice(0, colon));
      const bytes = Buffer.from(pending.slice(colon + 1));
      if (bytes.length < size) return;
      const msg = JSON.parse(bytes.subarray(0, size).toString());
      pending = bytes.subarray(size).toString();
      if (!Array.isArray(msg)) continue;
      const w = waiting.get(msg[1]);
      waiting.delete(msg[1]);
      if (msg[2]) w.reject(new Error(msg[2].message ?? JSON.stringify(msg[2])));
      else w.resolve(msg[3]);
    }
  });
  await new Promise((r) => setTimeout(r, 300));
  await send('WebDriver:NewSession', { capabilities: { timeouts: { script: 20000 } } });
  await send('WebDriver:SetWindowRect', { width: 1280, height: 900 });

  const paths = ['/', '/server', '/stacks', '/reading', '/upcoming', '/apps', '/downloads', '/library', '/library?view=queue', '/requests', '/media', '/media?view=libraries', '/blocking', '/settings?tab=home', '/settings?tab=connections', '/settings?tab=look'];
  let plain;
  const failures = [];
  for (const path of paths) {
    await send('WebDriver:Navigate', { url: base + path });
    await send('Marionette:SetContext', { value: 'chrome' });
    await send('WebDriver:ExecuteScript', { script: `gBrowser.selectedBrowser.browsingContext.textZoom = ${ZOOM};`, args: [] });
    await send('Marionette:SetContext', { value: 'content' });
    await inPage(async () => {
      for (let i = 0; i < 150 && !document.querySelector('main h1, main h2'); i++) await new Promise((r) => setTimeout(r, 100));
      await document.fonts.ready;
      await new Promise((r) => setTimeout(r, 300));
    });
    const size = await inPage(() => ({ font: parseFloat(getComputedStyle(document.querySelector('main')).fontSize), dpr: devicePixelRatio }));
    plain ??= size;
    assert.equal(size.dpr, 1, `${path}: text-only zoom leaves the page scale alone`);
    for (const p of await inPage(problems)) failures.push(`${path}: ${p}`);
  }
  // The demo's main text is 15.5px; at 200% it must measure about twice that.
  assert(plain.font >= 28, `text zoom applied (main text measured ${plain.font}px)`);
  assert.deepEqual(failures, [], 'everything fits at 200% text-only zoom');
  await send('WebDriver:DeleteSession');
  console.log(`Firefox 200% text-only zoom passed on ${paths.length} views.`);
} finally {
  socket?.end();
  browser.kill();
  server.kill();
  await new Promise((r) => setTimeout(r, 800));
  // Windows can hold the server's files a moment after it stops: retry, and never fail a check that passed over a temp folder.
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {}
}
