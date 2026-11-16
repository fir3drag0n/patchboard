// API keys for the read-only API: one per script or AI tool, each named so
// you know what to revoke. Only a hash is kept; the key shows once, when made.

import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { ApiKeyInfo } from '../shared/types.ts';
import { kvGet, kvSet } from './db.ts';

interface Stored extends ApiKeyInfo {
  hash: string;
}

export const MAX_KEYS = 20;
const PREFIX = 'pb_';
const digest = (key: string) => createHash('sha256').update(key).digest('hex');

function all(): Stored[] {
  const raw = kvGet<unknown>('api-keys');
  return Array.isArray(raw) ? (raw as Stored[]).filter((k) => typeof k?.id === 'string' && typeof k.hash === 'string') : [];
}

/** Every key, without its hash. */
export function listKeys(): ApiKeyInfo[] {
  return all().map(({ hash: _, ...k }) => k);
}

/** A new key, shown this once. */
export function createKey(rawName: unknown): { key: string; info: ApiKeyInfo } | { error: string } {
  const name = typeof rawName === 'string' ? rawName.replace(/\s+/g, ' ').replace(/[\u0000-\u001f\u007f]/g, '').trim() : '';
  if (!name) return { error: 'Name the key after what will use it' };
  if (name.length > 40) return { error: 'Keep the name to 40 characters' };
  const keys = all();
  if (keys.length >= MAX_KEYS) return { error: `At most ${MAX_KEYS} keys` };
  const key = PREFIX + randomBytes(24).toString('base64url');
  const info: ApiKeyInfo = { id: randomBytes(6).toString('hex'), name, created: Date.now() };
  kvSet('api-keys', [...keys, { ...info, hash: digest(key) }]);
  return { key, info };
}

export function revokeKey(id: string): ApiKeyInfo | null {
  const keys = all();
  const gone = keys.find((k) => k.id === id);
  if (!gone) return null;
  kvSet('api-keys', keys.filter((k) => k.id !== id));
  const { hash: _, ...info } = gone;
  return info;
}

export const looksLikeKey = (s: string | undefined): s is string => !!s && s.startsWith(PREFIX);

/** The key's record when it's valid. Notes its use, at most once a minute. */
export function checkKey(key: string): ApiKeyInfo | null {
  const want = Buffer.from(digest(key), 'hex');
  const keys = all();
  const hit = keys.find((k) => {
    const have = Buffer.from(k.hash, 'hex');
    return have.length === want.length && timingSafeEqual(have, want);
  });
  if (!hit) return null;
  if (!hit.lastUsed || Date.now() - hit.lastUsed > 60_000) {
    hit.lastUsed = Date.now();
    kvSet('api-keys', keys);
  }
  const { hash: _, ...info } = hit;
  return info;
}
