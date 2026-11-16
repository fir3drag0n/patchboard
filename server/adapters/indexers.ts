// Prowlarr's indexers for the Library page: each one with how it has done,
// whether Prowlarr has set it aside after failures, and Test, Turn on and
// Turn off. Read from Prowlarr while the page is open.

import type { Indexer, IndexerTest } from '../../shared/types.ts';
import { config } from '../config.ts';
import { HttpError } from '../http.ts';
import { refusal } from './library.ts';

export interface IndexerControl {
  list(): Promise<Indexer[]>;
  test(id: number): Promise<void>;
  testAll(): Promise<IndexerTest[]>;
  enable(id: number, on: boolean): Promise<void>;
}

interface Resource {
  id: number;
  name: string;
  enable: boolean;
  protocol: string;
}
interface Status {
  indexerId: number;
  disabledTill?: string;
  initialFailure?: string;
}
interface Stats {
  indexers?: { indexerId: number; numberOfQueries?: number; numberOfGrabs?: number; numberOfFailedQueries?: number; averageResponseTime?: number }[];
}
interface Tested {
  id: number;
  isValid: boolean;
  validationFailures?: { errorMessage?: string }[];
}

const ms = (t?: string) => (t ? Date.parse(t) : undefined);

export function fromProwlarr(list: Resource[], status: Status[], stats: Stats, now = Date.now()): Indexer[] {
  const st = new Map(status.map((s) => [s.indexerId, s]));
  const nums = new Map((stats.indexers ?? []).map((s) => [s.indexerId, s]));
  return list
    .map((r): Indexer => {
      const s = st.get(r.id);
      const until = ms(s?.disabledTill);
      const n = nums.get(r.id);
      return {
        id: r.id,
        name: r.name,
        protocol: r.protocol === 'usenet' ? 'usenet' : 'torrent',
        enabled: r.enable,
        failingUntil: until && until > now ? until : undefined,
        failingSince: until && until > now ? ms(s?.initialFailure) : undefined,
        queries: n?.numberOfQueries,
        grabs: n?.numberOfGrabs,
        failed: n?.numberOfFailedQueries,
        responseMs: n?.averageResponseTime,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function fromTestAll(results: Tested[], names: Map<number, string>): IndexerTest[] {
  return results.map((r) => ({ id: r.id, name: names.get(r.id) ?? `#${r.id}`, ok: r.isValid, error: r.isValid ? undefined : r.validationFailures?.map((f) => f.errorMessage).find(Boolean) }));
}

export function prowlarrControl(): IndexerControl | undefined {
  if (!config.prowlarr) return undefined;
  const { url, key } = config.prowlarr;
  const headers = { 'X-Api-Key': key, 'Content-Type': 'application/json' };
  // Testing asks each site in turn, so it gets longer than a read.
  const send = async (method: string, path: string, body?: unknown, timeout = 20_000): Promise<Response> => {
    const res = await fetch(`${url}/api/v1${path}`, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(timeout) }).catch((err: Error) => {
      throw new Error(err.name === 'TimeoutError' ? `Timed out after ${timeout / 1000}s` : 'Unreachable');
    });
    if (!res.ok) throw new Error(refusal(await res.json().catch(() => null)) ?? new HttpError(res.status, res.statusText).message);
    return res;
  };
  const get = async <T>(path: string) => (await (await send('GET', path)).json()) as T;
  const list = () => get<Resource[]>('/indexer');
  return {
    async list() {
      const [all, status, stats] = await Promise.all([list(), get<Status[]>('/indexerstatus'), get<Stats>('/indexerstats').catch(() => ({}))]);
      return fromProwlarr(all, status, stats);
    },
    async test(id) {
      await send('POST', '/indexer/test', await get<Resource>(`/indexer/${id}`), 60_000);
    },
    async testAll() {
      const names = new Map((await list()).map((r) => [r.id, r.name]));
      // Prowlarr answers 400 when any indexer fails, with every result in the body.
      const res = await fetch(`${url}/api/v1/indexer/testall`, { method: 'POST', headers, signal: AbortSignal.timeout(120_000) }).catch((err: Error) => {
        throw new Error(err.name === 'TimeoutError' ? 'Timed out after 120s' : 'Unreachable');
      });
      const body = await res.json().catch(() => null);
      if (!Array.isArray(body)) throw new Error(refusal(body) ?? new HttpError(res.status, res.statusText).message);
      return fromTestAll(body as Tested[], names);
    },
    async enable(id, on) {
      const r = await get<Resource>(`/indexer/${id}`);
      // forceSave: turning one off must work even while its site is down.
      await send('PUT', `/indexer/${id}?forceSave=true`, { ...r, enable: on });
    },
  };
}
