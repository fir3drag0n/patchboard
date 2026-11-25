// App icons by name ("plex.png", "sonarr") come from the dashboard-icons
// set. Patchboard fetches each one once, keeps it in the data folder and
// serves it itself, so the browser never calls a CDN and a known icon
// still shows when the internet is down.

import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const CDN = 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons';
const MIME = { png: 'image/png', svg: 'image/svg+xml', webp: 'image/webp' } as const;
export type IconKind = keyof typeof MIME;
/** A dashboard-icons file name: lowercase words joined by - . or _, never a path. */
const NAME = /^[a-z0-9]+([._-][a-z0-9]+)*$/;
const MAX_BYTES = 512 * 1024;
/** Re-fetched after a month, in case the set redrew it; the old copy serves meanwhile. */
const FRESH_MS = 30 * 24 * 3600_000;
/** A name the set doesn't have isn't asked for again for an hour. */
const MISS_MS = 3600_000;

export interface IconFile {
  body: Buffer<ArrayBuffer>;
  type: string;
}

export function iconCache(dir: string, cdn = CDN, timeoutMs = 10_000) {
  const misses = new Map<string, number>();
  const pending = new Map<string, Promise<Buffer<ArrayBuffer> | null>>();

  async function download(kind: IconKind, file: string): Promise<Buffer<ArrayBuffer> | null> {
    try {
      const res = await fetch(`${cdn}/${kind}/${file}`, { signal: AbortSignal.timeout(timeoutMs) });
      if (!res.ok || !(res.headers.get('content-type') ?? '').startsWith('image/')) return null;
      const body = Buffer.from(await res.arrayBuffer());
      if (!body.length || body.length > MAX_BYTES) return null;
      try {
        mkdirSync(join(dir, kind), { recursive: true });
        const tmp = join(dir, kind, `.${file}.${process.pid}.tmp`);
        writeFileSync(tmp, body);
        renameSync(tmp, join(dir, kind, file));
      } catch {
        // A read-only data folder still gets the icon, without a saved copy.
      }
      return body;
    } catch {
      return null;
    }
  }

  /** One download per icon at a time, however many tiles ask at once. */
  function fetchOnce(kind: IconKind, file: string): Promise<Buffer<ArrayBuffer> | null> {
    const key = `${kind}/${file}`;
    let p = pending.get(key);
    if (!p) {
      p = download(kind, file).finally(() => pending.delete(key));
      pending.set(key, p);
    }
    return p;
  }

  return {
    async get(kind: string, file: string, now = Date.now()): Promise<IconFile | null> {
      if (!Object.hasOwn(MIME, kind)) return null;
      const k = kind as IconKind;
      const base = file.endsWith(`.${k}`) ? file.slice(0, -(k.length + 1)) : '';
      if (!NAME.test(base) || base.length > 100) return null;
      const key = `${k}/${file}`;
      const type = MIME[k];
      try {
        const path = join(dir, k, file);
        const age = now - statSync(path).mtimeMs;
        const body = readFileSync(path);
        if (age > FRESH_MS) void fetchOnce(k, file);
        return { body, type };
      } catch {
        // Not saved yet.
      }
      if ((misses.get(key) ?? 0) > now) return null;
      const body = await fetchOnce(k, file);
      if (!body) {
        // Remembered misses stay bounded: past a thousand, start over.
        if (misses.size > 1000) misses.clear();
        misses.set(key, now + MISS_MS);
        return null;
      }
      return { body, type };
    },
  };
}

const URL_TYPES: Record<string, string> = { 'image/png': 'png', 'image/svg+xml': 'svg', 'image/webp': 'webp', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/x-icon': 'ico', 'image/vnd.microsoft.icon': 'ico' };
const URL_MIME: Record<string, string> = Object.fromEntries(Object.entries(URL_TYPES).map(([t, e]) => [e, t]));

/**
 * An icon given as a full address (an old Homepage's /images folder on the
 * LAN, say). The browser can't load a plain-HTTP LAN image into a page served
 * over HTTPS, so Patchboard fetches it once, keeps it, and serves it itself,
 * the same way it serves icons by name.
 */
export function urlIconCache(dir: string, timeoutMs = 10_000) {
  const misses = new Map<string, number>();
  const pending = new Map<string, Promise<IconFile | null>>();
  const fileFor = (url: string) => createHash('sha1').update(url).digest('hex').slice(0, 20);

  async function download(url: string, id: string): Promise<IconFile | null> {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), redirect: 'follow' });
      const type = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
      const ext = URL_TYPES[type];
      if (!res.ok || !ext) return null;
      const body = Buffer.from(await res.arrayBuffer());
      if (!body.length || body.length > MAX_BYTES) return null;
      try {
        mkdirSync(dir, { recursive: true });
        for (const old of readdirSync(dir).filter((f) => f.startsWith(`${id}.`))) rmSync(join(dir, old), { force: true });
        const tmp = join(dir, `.${id}.${process.pid}.tmp`);
        writeFileSync(tmp, body);
        renameSync(tmp, join(dir, `${id}.${ext}`));
      } catch {
        // A read-only data folder still gets the icon, without a saved copy.
      }
      return { body, type };
    } catch {
      return null;
    }
  }

  return {
    async get(url: string, now = Date.now()): Promise<IconFile | null> {
      const id = fileFor(url);
      let saved: IconFile | null = null;
      try {
        const name = readdirSync(dir).find((f) => f.startsWith(`${id}.`));
        if (name) {
          saved = { body: readFileSync(join(dir, name)), type: URL_MIME[name.split('.').pop()!] ?? 'application/octet-stream' };
          if (now - statSync(join(dir, name)).mtimeMs < FRESH_MS) return saved;
        }
      } catch {
        // No copy yet.
      }
      if (!saved && now - (misses.get(id) ?? 0) < MISS_MS) return null;
      let p = pending.get(id);
      if (!p) {
        p = download(url, id).finally(() => pending.delete(id));
        pending.set(id, p);
      }
      const got = await p;
      if (!got) misses.set(id, now);
      // Offline or moved: the copy already kept still serves.
      return got ?? saved;
    },
  };
}
