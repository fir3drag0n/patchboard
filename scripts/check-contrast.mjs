// Contrast in every look: each theme in dark and light, e-ink and color e-ink.
// On every page, each visible text is measured against the background it is
// painted on: 4.5:1, or 3:1 for large text. Plain e-ink must show no color.
// Uses an isolated demo database. Run after building, with Chrome or Chromium.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium } from 'playwright-core';

const PAGES = ['/', '/server', '/stacks', '/reading', '/upcoming', '/logs', '/apps', '/media', '/downloads', '/library', '/requests', '/blocking', '/settings', '/settings?tab=connections', '/c/plex', '/monitor', '/weather'];
const THEMES = ['graphite', 'midnight', 'forest', 'dusk', 'paper', 'blueprint'];
const LOOKS = [
  ...THEMES.flatMap((theme) => ['dark', 'light'].map((scheme) => ({ name: `${theme} ${scheme}`, look: { theme, scheme } }))),
  { name: 'e-ink', look: { theme: 'graphite', scheme: 'light', eink: true } },
  { name: 'color e-ink', look: { theme: 'graphite', scheme: 'light', eink: true, einkColor: true } },
];

const dir = mkdtempSync(join(tmpdir(), 'pb-contrast-check-'));
const port = 3305;
const base = `http://localhost:${port}`;
const server = spawn(process.execPath, ['server/index.ts'], {
  env: { ...process.env, DEMO: '1', DATA_DIR: dir, PORT: String(port) }, stdio: 'ignore',
});

/** Runs in the page: every failing text, and in plain e-ink every colored text, fill or border. */
function measure(noColor) {
  const parse = (c) => {
    const m = /rgba?\(([^)]+)\)/.exec(c || '');
    if (!m) return null;
    const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 };
  };
  const lum = ({ r, g, b }) => {
    const f = (v) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const over = (top, under) => ({ r: top.r * top.a + under.r * (1 - top.a), g: top.g * top.a + under.g * (1 - top.a), b: top.b * top.a + under.b * (1 - top.a), a: 1 });
  const colored = (c) => Math.max(c.r, c.g, c.b) - Math.min(c.r, c.g, c.b) > 24;
  // The color actually under an element: its backgrounds stacked up to the first solid one.
  // Text over a picture (a poster, a camera) is left out.
  const backdrop = (el) => {
    const layers = [];
    for (let e = el; e; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (s.backgroundImage !== 'none' && !/gradient/.test(s.backgroundImage)) return null;
      const c = parse(s.backgroundColor);
      if (c && c.a > 0) {
        layers.push(c);
        if (c.a >= 1) break;
      }
    }
    return layers.reverse().reduce((under, layer) => over(layer, under), { r: 255, g: 255, b: 255, a: 1 });
  };
  const label = (el) => `${el.tagName.toLowerCase()}${typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''}`;
  const found = [];
  const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const el = node.parentElement;
    const text = node.textContent.trim();
    if (!text || !el || seen.has(el)) continue;
    seen.add(el);
    const s = getComputedStyle(el);
    const box = el.getBoundingClientRect();
    if (s.visibility === 'hidden' || !box.width || !box.height) continue;
    if (el.closest('[aria-hidden="true"], .sr-only, svg, :disabled, [aria-disabled="true"]')) continue;
    // A faded app or row (stopped, idle) is dimmed on purpose; its name is in its label.
    let opacity = 1;
    for (let e = el; e; e = e.parentElement) opacity *= Number(getComputedStyle(e).opacity);
    if (opacity < 0.99) continue;
    const fg = parse(s.color);
    const bg = backdrop(el);
    if (!fg || !bg) continue;
    const a = lum(over(fg, bg));
    const b = lum(bg);
    const ratio = (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
    const size = parseFloat(s.fontSize);
    const large = size >= 24 || (Number(s.fontWeight) >= 700 && size >= 18.66);
    if (ratio < (large ? 3 : 4.5)) found.push(`${label(el)} "${text.slice(0, 30)}" at ${ratio.toFixed(2)}:1`);
    if (noColor && colored(fg)) found.push(`${label(el)} "${text.slice(0, 30)}" is colored`);
  }
  if (noColor) {
    for (const el of document.querySelectorAll('body *')) {
      if (!el.getBoundingClientRect().width || el.closest('img, picture, video, [class*="poster"], [class*="cover"], [class*="icon"], .cam')) continue;
      const s = getComputedStyle(el);
      for (const prop of ['backgroundColor', 'borderTopColor', 'fill', 'stroke']) {
        if (prop === 'borderTopColor' && !parseFloat(s.borderTopWidth)) continue;
        const c = parse(s[prop]);
        if (c && c.a > 0 && colored(c)) found.push(`${label(el)} ${prop} is colored`);
      }
    }
  }
  return found;
}

let browser;
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try { if ((await fetch(`${base}/api/session`)).ok) { ready = true; break; } } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  assert(ready, 'demo server started');
  for (const options of [{ channel: 'chrome' }, { executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium' }, {}]) {
    try { browser = await chromium.launch(options); break; } catch {}
  }
  assert(browser, 'Install Chrome/Chromium or set CHROMIUM_PATH');
  const problems = [];
  for (const { name, look } of LOOKS) {
    const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, colorScheme: look.scheme });
    await context.addInitScript((saved) => localStorage.setItem('pb-appearance', JSON.stringify(saved)), look);
    const page = await context.newPage();
    for (const path of PAGES) {
      await page.goto(base + path, { waitUntil: 'networkidle' });
      await page.waitForTimeout(600);
      for (const p of await page.evaluate(measure, look.eink && !look.einkColor)) problems.push(`${name}, ${path}: ${p}`);
    }
    await context.close();
  }
  assert.deepEqual(problems, [], `Contrast problems:\n${problems.join('\n')}`);
  console.log(`Contrast passes on ${PAGES.length} pages in ${LOOKS.length} looks.`);
} finally {
  await browser?.close();
  server.kill();
  // Windows can hold the server's files a moment after it stops: retry, and never fail a check that passed over a temp folder.
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch {}
}
