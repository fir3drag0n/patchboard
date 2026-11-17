// Fit, tap and hover checks against an isolated demo database: every page at
// desktop, laptop, tablet and phone sizes, in the default look and a wide one
// (mono font, large density). On each page, and inside everything a button
// opens, it looks for:
//   - the page scrolling sideways;
//   - a box that scrolls further than what's in it (an invisible tap area or
//     hint stretching it, as a stream's card once did);
//   - text cut off without an ellipsis;
//   - anything opened that leaves the screen;
//   - on touch, a control that answers less than 44px around its middle, or
//     one another control's tap area covers;
//   - on desktop, a hover that makes anything scroll.
// `--full` adds a small phone, an iPad on its side, a wall tablet, a 1080p
// kiosk and the light Paper theme. `--only=/path` checks one page.
// FIT_BASE=https://your.patchboard FIT_PASSWORD=... checks a running install
// instead, with its own look and data. The page may only read there: every
// request that would change something is blocked.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const args = process.argv.slice(2);
const full = args.includes('--full');
const only = args.find((a) => a.startsWith('--only='))?.slice(7);

const PAGES = [
  '/', '/server', '/stacks', '/reading', '/upcoming', '/apps', '/logs', '/weather', '/monitor',
  '/media', '/media?view=libraries', '/downloads', '/library', '/library?view=wanted', '/library?view=queue',
  '/library?view=history', '/library?view=subtitles', '/library?view=indexers', '/library?view=add',
  '/requests', '/requests?view=coming', '/requests?view=ask', '/blocking', '/blocking?view=lists',
  '/c/plex', '/c/sonarr', '/c/qbittorrent',
  '/settings?tab=look', '/settings?tab=home', '/settings?tab=devices', '/settings?tab=alerts',
  '/settings?tab=connections', '/settings?tab=connections&part=access', '/settings?tab=connections&part=apps',
  '/settings?tab=connections&part=backup', '/settings?tab=activity',
];
const touch = { isMobile: true, hasTouch: true };
const SIZES = [
  { name: 'desktop', viewport: { width: 1440, height: 900 } },
  { name: 'laptop', viewport: { width: 1280, height: 720 } },
  { name: 'tablet', viewport: { width: 820, height: 1180 }, ...touch },
  { name: 'iphone', viewport: { width: 402, height: 874 }, ...touch },
  ...(full
    ? [
        { name: 'small phone', viewport: { width: 360, height: 740 }, ...touch },
        { name: 'ipad landscape', viewport: { width: 1180, height: 820 }, ...touch },
        { name: 'wall tablet', viewport: { width: 960, height: 600 }, ...touch },
        { name: 'kiosk', viewport: { width: 1920, height: 1080 } },
      ]
    : []),
];
const live = process.env.FIT_BASE?.replace(/\/+$/, '');
const LOOKS = [
  { name: live ? 'yours' : 'default', look: null },
  { name: 'wide', look: { font: 'mono', density: 'large' } },
  ...(full && !live ? [{ name: 'paper', look: { theme: 'paper', scheme: 'light' } }] : []),
];
// Openers to leave alone: they leave the page or change saved settings.
const SKIP_OPEN = '[data-fit-skip], .lib-open-file, [aria-haspopup="dialog"][data-danger]';

const dir = mkdtempSync(join(tmpdir(), 'pb-fit-check-'));
const PORT = 3297;
const base = live ?? `http://localhost:${PORT}`;
const server = live ? null : spawn(process.execPath, ['server/index.ts'], { env: { ...process.env, DEMO: '1', DATA_DIR: dir, PORT: String(PORT) }, stdio: 'ignore' });

// In the page: what doesn't fit right now, within `scope` (the page, or one opened panel).
function inspect({ scope, touch }) {
  const root = scope ? document.querySelector(scope) : document.body;
  if (!root) return [];
  const bad = [];
  const vw = document.documentElement.clientWidth;
  const vh = innerHeight;
  const name = (el) => {
    const text = (el.getAttribute('aria-label') || el.textContent || el.getAttribute('placeholder') || '').trim().replace(/\s+/g, ' ').slice(0, 32);
    const cls = String(el.className && el.className.baseVal === undefined ? el.className : '').split(' ').filter(Boolean)[0];
    return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}${text ? ` "${text}"` : ''}`;
  };
  const shown = (el) => el.checkVisibility({ visibilityProperty: true, opacityProperty: true }) && el.getClientRects().length > 0;

  if (!scope && document.documentElement.scrollWidth > vw + 1) bad.push(`page scrolls sideways (${document.documentElement.scrollWidth}px wide)`);

  // Boxes that scroll further than anything visible in them reaches.
  for (const el of [root, ...root.querySelectorAll('*')]) {
    if (el === document.body || !shown(el)) continue;
    const cs = getComputedStyle(el);
    const sx = /auto|scroll/.test(cs.overflowX);
    const sy = /auto|scroll/.test(cs.overflowY);
    if (!sx && !sy) continue;
    const dx = el.scrollWidth - el.clientWidth;
    const dy = el.scrollHeight - el.clientHeight;
    if ((!sx || dx <= 1) && (!sy || dy <= 1)) continue;
    if (el.matches('textarea, pre, code, .logs-lines, .log-lines')) continue;
    const r = el.getBoundingClientRect();
    let right = 0;
    let bottom = 0;
    for (const d of el.querySelectorAll('*')) {
      if (!shown(d)) continue;
      const b = d.getBoundingClientRect();
      if (!b.width || !b.height) continue;
      const m = getComputedStyle(d);
      right = Math.max(right, b.right + Math.max(0, parseFloat(m.marginRight)) - r.left - el.clientLeft + el.scrollLeft);
      bottom = Math.max(bottom, b.bottom + Math.max(0, parseFloat(m.marginBottom)) - r.top - el.clientTop + el.scrollTop);
    }
    const reachX = right + parseFloat(cs.paddingRight);
    const reachY = bottom + parseFloat(cs.paddingBottom);
    if (sx && dx > 1 && el.scrollWidth > reachX + 2) bad.push(`${name(el)} scrolls sideways past its content (${el.scrollWidth} > ${Math.round(reachX)})`);
    if (sy && dy > 1 && el.scrollHeight > reachY + 2) bad.push(`${name(el)} scrolls down past its content (${el.scrollHeight} > ${Math.round(reachY)})`);
  }

  // Text cut by overflow without an ellipsis.
  for (const el of root.querySelectorAll('*')) {
    if (!el.childNodes.length || ![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) continue;
    const cs = getComputedStyle(el);
    if (cs.overflowX !== 'hidden' && cs.overflowX !== 'clip') continue;
    if (cs.textOverflow === 'ellipsis' || cs.display === 'inline' || /\d/.test(cs.webkitLineClamp) || !shown(el)) continue;
    // Text for screen readers only is meant to be clipped to a pixel.
    if (el.clientWidth <= 1 || el.closest('.sr-only, .visually-hidden')) continue;
    if (el.scrollWidth > el.clientWidth + 2) bad.push(`${name(el)} cuts its text off`);
  }

  // An opened panel stays on screen.
  if (scope) {
    const r = root.getBoundingClientRect();
    if (r.left < -1 || r.right > vw + 1 || r.top < -1 || r.bottom > vh + 1) bad.push(`${name(root)} leaves the screen (${Math.round(r.left)},${Math.round(r.top)} to ${Math.round(r.right)},${Math.round(r.bottom)})`);
  }

  // Touch: each control answers 22px each side of its middle (or its whole
  // self when bigger), and nothing else's tap area lies on top of it.
  if (touch) {
    const controls = [...root.querySelectorAll('button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [role=tab]')].filter((el) => shown(el) && !el.disabled && !el.closest('[inert], [aria-hidden=true]'));
    // Bars pinned across the top or bottom of the screen cover what scrolls under them.
    const bars = [...document.querySelectorAll('body *')].filter((h) => /fixed|sticky/.test(getComputedStyle(h).position) && h.getBoundingClientRect().width > vw / 2 && !(scope && h.closest(scope)));
    const fixedTop = Math.max(0, ...bars.map((h) => h.getBoundingClientRect()).filter((b) => b.top < vh / 3 && b.bottom < vh / 3).map((b) => b.bottom));
    const fixedBottom = Math.min(vh, ...bars.map((h) => h.getBoundingClientRect()).filter((b) => b.top > (vh * 2) / 3).map((b) => b.top));
    const owns = (el, hit) => !!hit && (el === hit || el.contains(hit) || hit.contains(el) || [...(el.labels ?? [])].some((l) => l.contains(hit)));
    for (const el of controls) {
      const r = el.getBoundingClientRect();
      const cx = r.left + r.width / 2;
      const cy = r.top + r.height / 2;
      if (cy - 22 < (scope ? 0 : fixedTop) || cy + 22 > (scope ? vh : fixedBottom) || cx < 0 || cx > vw) continue;
      // Words linked inside a sentence are exempt (WCAG 2.5.8, inline).
      if (el.matches('a') && el.closest('p, .settings-note, .lib-total, li.alert-detail') && !el.matches('.text-button, .section-action, .button')) continue;
      const hit = document.elementFromPoint(cx, cy);
      if (!owns(el, hit)) {
        const other = hit?.closest('button, a[href], input, select, textarea, label, summary');
        if (other) bad.push(`tap on ${name(el)} lands on ${name(other)}`);
        continue;
      }
      // 44px when nothing else is there; a neighbor may come within 12px of
      // the middle (WCAG 2.5.8's 24px spacing), never closer.
      const control = 'button, a[href], input, select, textarea, label, summary';
      const at = (x, y) => document.elementFromPoint(cx + x, cy + y);
      const dirs = [[0, -1, r.height], [0, 1, r.height], [-1, 0, r.width], [1, 0, r.width]];
      for (const [ux, uy, span] of dirs) {
        const near = Math.max(0, 12 - span / 2);
        const far = Math.max(0, 21 - span / 2);
        const nearHit = at(ux * near, uy * near);
        if (near && !owns(el, nearHit)) {
          const by = nearHit?.closest(control);
          bad.push(by ? `${name(el)}'s tap area is covered by ${name(by)}` : `${name(el)} is a small tap target (${Math.round(r.width)}x${Math.round(r.height)})`);
          break;
        }
        const farHit = at(ux * far, uy * far);
        if (far && !owns(el, farHit) && !farHit?.closest(control)) {
          bad.push(`${name(el)} is a small tap target (${Math.round(r.width)}x${Math.round(r.height)})`);
          break;
        }
      }
    }
  }
  return bad;
}

// The app has drawn: a main region, or a full-screen page such as Monitor.
const rendered = (page) => page.waitForSelector('main, [role=main], .monitor, .wall', { state: 'attached', timeout: 15000 }).then(() => true, () => false);

let browser;
const found = new Map();
const note = (where, problems) => {
  for (const p of problems) {
    if (!found.has(p)) found.set(p, new Set());
    found.get(p).add(where);
  }
};

try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${base}/api/session`)).ok) { ready = true; break; } } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  assert(ready, live ? `${base} answers` : 'demo server started');
  for (const options of [{ channel: 'chrome' }, { executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' }, {}]) {
    try { browser = await chromium.launch(options); break; } catch {}
  }
  assert(browser, 'Install Chrome/Chromium or set CHROMIUM_PATH');

  // A running install: sign in once, and share that session with every size.
  let session;
  if (live) {
    const ctx = await browser.newContext();
    const res = await ctx.request.post(`${base}/api/login`, { data: { password: process.env.FIT_PASSWORD ?? '' }, headers: { 'x-patchboard': 'action' } });
    assert(res.ok(), `sign-in at ${base} answered ${res.status()}`);
    session = await ctx.storageState();
    await ctx.close();
  }

  for (const look of LOOKS) {
    for (const size of SIZES) {
      const ctx = await browser.newContext({ viewport: size.viewport, isMobile: !!size.isMobile, hasTouch: !!size.hasTouch, reducedMotion: 'reduce', storageState: session });
      if (live) await ctx.route('**/*', (route) => (['GET', 'HEAD'].includes(route.request().method()) ? route.continue() : route.abort()));
      if (look.look) await ctx.addInitScript((l) => { try { localStorage.setItem('pb-appearance', JSON.stringify(l)); } catch {} }, look.look);
      const page = await ctx.newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message.split('\n')[0]));
      const isTouch = !!size.hasTouch;
      for (const path of PAGES) {
        if (only && !only.split(',').includes(path)) continue;
        if (process.env.FIT_PROGRESS) console.log(`${look.name} ${size.name} ${path}`);
        const where = `${path} ${size.name} ${look.name}`;
        await page.goto(base + path);
        if (!(await rendered(page))) {
          note(where, ['the page never rendered']);
          continue;
        }
        await page.waitForTimeout(900);
        note(where, await page.evaluate(inspect, { scope: null, touch: isTouch }));

        // Everything a button opens, one at a time, then closed again.
        const openers = await page.evaluate((skip) => {
          const seen = new Set();
          return [...document.querySelectorAll('button[aria-expanded="false"], button[aria-haspopup]:not([aria-expanded="true"])')]
            .filter((b) => b.checkVisibility() && !b.disabled && !b.matches(skip))
            .map((b, i) => {
              b.dataset.fitOpener = String(i);
              const kind = `${b.className}|${b.closest('[class]')?.className ?? ''}`;
              if (seen.has(kind)) return null;
              seen.add(kind);
              return String(i);
            })
            .filter(Boolean)
            .slice(0, 14);
        }, SKIP_OPEN);
        for (const id of openers) {
          const btn = page.locator(`[data-fit-opener="${id}"]`);
          if (!(await btn.count()) || !(await btn.isVisible())) continue;
          const label = ((await btn.getAttribute('aria-label')) || (await btn.textContent()) || '').trim().replace(/\s+/g, ' ').slice(0, 30);
          const before = page.url();
          await btn.scrollIntoViewIfNeeded().catch(() => {});
          await page.evaluate(() => { for (const el of document.querySelectorAll('body *')) el.dataset.fitBefore = ''; });
          try {
            if (isTouch) await btn.tap({ timeout: 2000 }); else await btn.click({ timeout: 2000 });
          } catch {
            await page.evaluate(() => document.querySelectorAll('[data-fit-before]').forEach((el) => delete el.dataset.fitBefore));
            continue;
          }
          await page.waitForTimeout(450);
          // What appeared floating over the page is the opened panel.
          const panel = await page.evaluate(() => {
            const fresh = [...document.querySelectorAll('body *:not([data-fit-before])')].filter((el) => {
              const p = getComputedStyle(el).position;
              return (p === 'fixed' || p === 'absolute') && el.checkVisibility() && el.getBoundingClientRect().width > 40 && el.getBoundingClientRect().height > 30 && !el.parentElement.closest('body *:not([data-fit-before])');
            });
            document.querySelectorAll('[data-fit-before]').forEach((el) => delete el.dataset.fitBefore);
            if (!fresh.length) return null;
            fresh[0].dataset.fitPanel = '';
            return '[data-fit-panel]';
          });
          const at = `${where}, opened "${label}"`;
          note(at, (await page.evaluate(inspect, { scope: null, touch: false })).filter((p) => p.startsWith('page')));
          if (panel) {
            note(at, await page.evaluate(inspect, { scope: panel, touch: isTouch }));
            await page.evaluate(() => document.querySelector('[data-fit-panel]')?.removeAttribute('data-fit-panel'));
          }
          if (page.url() !== before) {
            await page.goto(before);
            await rendered(page);
            await page.waitForTimeout(600);
            continue;
          }
          await page.keyboard.press('Escape');
          await page.waitForTimeout(150);
          if ((await btn.count()) && (await btn.getAttribute('aria-expanded')) === 'true') {
            if (isTouch) await btn.tap({ timeout: 2000 }).catch(() => {}); else await btn.click({ timeout: 2000 }).catch(() => {});
            await page.waitForTimeout(150);
          }
        }

        // Desktop hovers: a hold button's hint and a chart's reading.
        if (!isTouch) {
          const targets = await page.evaluate(() => {
            const pick = [...document.querySelectorAll('.hold:not(:disabled)')].filter((el) => el.checkVisibility()).slice(0, 6);
            pick.push(...[...document.querySelectorAll('.spark-wrap, .mon-chart-wrap')].filter((el) => el.checkVisibility()).slice(0, 2));
            return pick.map((el, i) => { el.dataset.fitHover = String(i); return String(i); });
          });
          for (const id of targets) {
            const el = page.locator(`[data-fit-hover="${id}"]`);
            await el.scrollIntoViewIfNeeded().catch(() => {});
            await el.hover({ timeout: 2000 }).catch(() => {});
            await page.waitForTimeout(500);
            const label = ((await el.textContent().catch(() => '')) || '').trim().slice(0, 24);
            note(`${where}, hovering "${label}"`, (await page.evaluate(inspect, { scope: null, touch: false })).filter((p) => !p.includes('cuts its text')));
          }
          await page.mouse.move(0, 0);
        }
      }
      if (errors.length) note(`${size.name} ${look.name}`, [...new Set(errors)].map((e) => `page error: ${e}`));
      await ctx.close();
    }
  }

  const report = [...found].map(([problem, where]) => `${problem}\n    ${[...where].slice(0, 4).join('\n    ')}${where.size > 4 ? `\n    and ${where.size - 4} more` : ''}`);
  assert.deepEqual(report, [], `Fit problems:\n${report.join('\n')}`);
  console.log(`Fit, taps and hovers pass on ${only ? only.split(',').length : PAGES.length} pages at ${SIZES.length} sizes in ${LOOKS.length} looks.`);
} finally {
  await browser?.close();
  server?.kill();
  await new Promise((r) => setTimeout(r, 300));
  try { rmSync(dir, { recursive: true, force: true }); } catch {}
}
