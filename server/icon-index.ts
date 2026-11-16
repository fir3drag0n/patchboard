// Which icon a name means. Two open icon sets publish an index: dashboard
// icons (with aliases) and selfh.st (about four thousand more). Patchboard
// reads both once a week and keeps a copy in the data folder, so "pms-docker",
// "portainer-ce" or a container called "jellyfin-server" all find their icon,
// and an app only selfh.st draws still gets one.

import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export type IconSet = 'dash' | 'selfhst';
export interface IconRef {
  set: IconSet;
  /** The file name in that set, without its extension. */
  ref: string;
}

const SOURCES: Record<IconSet, string> = {
  dash: 'https://cdn.jsdelivr.net/gh/homarr-labs/dashboard-icons/metadata.json',
  selfhst: 'https://cdn.jsdelivr.net/gh/selfhst/icons/index.json',
};
const WEEK = 7 * 24 * 3600_000;

/** "Portainer-CE", "portainer_ce" and "portainer ce" are the same word. */
export const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

// Words images and containers add that the icon's name doesn't have.
const PREFIX = /^(docker|linuxserver|lscr|ghcr|the)[-_.]/;
const SUFFIX = /[-_.](ce|ee|oss|server|web|webui|ui|app|frontend|backend|docker|community|official|ngx|core|io|hq)$/;

/** A name, then the same name with the extra words taken off, one at a time. */
export function variants(name: string): string[] {
  const out: string[] = [];
  let s = name.toLowerCase().trim();
  for (let i = 0; i < 4 && s; i++) {
    out.push(s);
    const next = s.replace(PREFIX, '').replace(SUFFIX, '');
    if (next === s) break;
    s = next;
  }
  const first = s.split(/[-_.\s]/)[0];
  if (first && first.length > 2) out.push(first);
  return [...new Set(out)];
}

/** Image names neither set lists, to the icon they mean. */
const IMAGE_ALIASES: Record<string, string> = { 'pms-docker': 'plex', 'immich-server': 'immich', adguardhome: 'adguard-home', 'static-file-server': 'docker', seerr: 'jellyseerr' };

/** Built from the two indexes: every name and alias, to its icon. */
export function buildIndex(dash: unknown, selfhst: unknown): Map<string, IconRef> {
  const map = new Map<string, IconRef>();
  const put = (key: string, r: IconRef) => {
    const k = norm(key);
    if (k && !map.has(k)) map.set(k, r);
  };
  // Dashboard icons first: the set Patchboard has always used.
  if (dash && typeof dash === 'object')
    for (const [ref, meta] of Object.entries(dash as Record<string, { aliases?: unknown }>)) {
      put(ref, { set: 'dash', ref });
      for (const a of Array.isArray(meta?.aliases) ? meta.aliases : []) if (typeof a === 'string') put(a, { set: 'dash', ref });
    }
  for (const [alias, ref] of Object.entries(IMAGE_ALIASES)) {
    const hit = map.get(norm(ref));
    if (hit) put(alias, hit);
  }
  if (Array.isArray(selfhst))
    for (const row of selfhst as { Reference?: unknown; Name?: unknown; PNG?: unknown }[]) {
      if (typeof row?.Reference !== 'string' || row.PNG === 'No') continue;
      put(row.Reference, { set: 'selfhst', ref: row.Reference });
      if (typeof row.Name === 'string') put(row.Name, { set: 'selfhst', ref: row.Reference });
    }
  return map;
}

/** The first of these names that either set draws. */
export function resolveIn(index: Map<string, IconRef>, names: string[]): IconRef | null {
  for (const n of names) for (const v of variants(n)) {
    const hit = index.get(norm(v));
    if (hit) return hit;
  }
  return null;
}

export function iconIndex(dir: string, offline = false) {
  let index: Map<string, IconRef> | null = null;
  let loading: Promise<void> | null = null;

  async function source(set: IconSet): Promise<unknown> {
    const path = join(dir, `index-${set}.json`);
    let saved: unknown = null;
    let fresh = false;
    try {
      saved = JSON.parse(readFileSync(path, 'utf8'));
      fresh = Date.now() - statSync(path).mtimeMs < WEEK;
    } catch {
      // Not saved yet.
    }
    if (fresh || offline) return saved;
    try {
      const res = await fetch(SOURCES[set], { signal: AbortSignal.timeout(15_000) });
      if (!res.ok) return saved;
      const text = await res.text();
      const body = JSON.parse(text);
      try {
        mkdirSync(dir, { recursive: true });
        writeFileSync(path, text);
      } catch {
        // A read-only data folder still gets the index for this run.
      }
      return body;
    } catch {
      return saved;
    }
  }

  function load(): Promise<void> {
    loading ??= Promise.all([source('dash'), source('selfhst')]).then(([d, s]) => {
      index = buildIndex(d, s);
      // Read again in a week, the next time someone asks.
      setTimeout(() => ((loading = null), (index = index)), WEEK).unref?.();
    });
    return loading;
  }

  return {
    /** The icon for the first of these names either set draws, or null. */
    async resolve(names: string[]): Promise<IconRef | null> {
      if (!index) await load().catch(() => {});
      return index ? resolveIn(index, names) : null;
    },
  };
}
