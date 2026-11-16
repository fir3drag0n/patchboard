// Your own app icon, in place of the P. The browser that uploads it draws
// every size, in color and in black and white for e-ink, so the server only
// checks and stores PNGs. While one is set, the server answers the usual icon
// addresses with it, so manifests, the tab and the home screen need no change.

import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Brand } from '../shared/types.ts';
import { config } from './config.ts';
import { kvGet, kvSet } from './db.ts';

export const ICON_SIZES = [64, 180, 192, 512] as const;
type Ink = 'color' | 'mono';
const dir = () => join(config.dataDir, 'app-icon');
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** The icon's version while one is set: a hash of its files, so a preview can bust caches. */
export function appIconVersion(): string | undefined {
  const v = kvGet<unknown>('app-icon');
  return typeof v === 'string' && /^[a-f0-9]{12}$/.test(v) ? v : undefined;
}

/** The name in the header, with the icon's version when there is one. */
export function withIcon(brand: Brand): Brand {
  const icon = appIconVersion();
  return icon ? { ...brand, icon } : brand;
}

/** A PNG's width and height, from its header, or null for anything else. */
function pngSize(b: Buffer): [number, number] | null {
  if (b.length < 24 || !b.subarray(0, 8).equals(PNG) || b.toString('latin1', 12, 16) !== 'IHDR') return null;
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
}

/** Check and store a set: { color: { 64: dataUrl, ... }, mono: { ... } }. */
export function saveAppIcon(raw: unknown): { icon: string } | { error: string } {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const files: [string, Buffer][] = [];
  let total = 0;
  for (const ink of ['color', 'mono'] as Ink[]) {
    const set = (r[ink] && typeof r[ink] === 'object' ? r[ink] : {}) as Record<string, unknown>;
    for (const size of ICON_SIZES) {
      const url = set[size];
      const m = typeof url === 'string' ? /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(url) : null;
      if (!m) return { error: `Missing the ${size}px ${ink} icon` };
      const b = Buffer.from(m[1], 'base64');
      const wh = pngSize(b);
      if (!wh || wh[0] !== size || wh[1] !== size) return { error: `The ${size}px ${ink} icon isn't a ${size}px PNG` };
      total += b.length;
      files.push([`${ink}-${size}.png`, b]);
    }
  }
  if (total > 8 * 1024 * 1024) return { error: 'The icon came out over 8 MB. Try a simpler image.' };
  mkdirSync(dir(), { recursive: true });
  const hash = createHash('sha256');
  for (const [name, b] of files) {
    writeFileSync(join(dir(), name), b);
    hash.update(b);
  }
  const icon = hash.digest('hex').slice(0, 12);
  kvSet('app-icon', icon);
  return { icon };
}

/** Back to the P. */
export function clearAppIcon(): void {
  kvSet('app-icon', null);
  rmSync(dir(), { recursive: true, force: true });
}

// favicon.png, icon-180.png, icon-light-192.png, icon-mono-dark-512.png...
const ICON_PATH = /^\/(?:favicon(-mono(?:-dark)?)?\.png|icon(?:-light|(-mono(?:-dark)?))?-(180|192|512)\.png)$/;

/** The uploaded icon for one of the usual icon addresses, or null to serve the P. */
export function appIconFor(path: string): Buffer | null {
  const m = ICON_PATH.exec(path);
  if (!m || !appIconVersion()) return null;
  const ink: Ink = m[1] || m[2] ? 'mono' : 'color';
  try {
    return readFileSync(join(dir(), `${ink}-${m[3] ?? 64}.png`));
  } catch {
    return null;
  }
}
