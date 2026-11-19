// Beszel: every system its agents report, read into the same hosts Glances
// gives, so one Hosts widget covers both. Beszel's hub is PocketBase: sign in
// with a Beszel user (a read-only one is enough), then read the systems.
// https://beszel.dev

import type { GlancesData, GlancesHost } from '../../shared/types.ts';
import { config } from '../config.ts';
import { getJson } from '../http.ts';
import { type Adapter, SECOND } from './adapter.ts';

export interface BeszelSystem {
  id?: string;
  name?: string;
  host?: string;
  status?: string;
  info?: Record<string, unknown>;
}

const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);

function since(sec: number | undefined): string | undefined {
  if (!sec) return undefined;
  const d = Math.floor(sec / 86_400);
  const h = Math.floor((sec % 86_400) / 3600);
  return d ? `${d}d ${h}h` : `${h}h ${Math.floor((sec % 3600) / 60)}m`;
}

/** Beszel keeps a system's latest numbers in short keys under info. Paused systems are left out. */
export function toBeszelHosts(rows: BeszelSystem[], base: string): GlancesHost[] {
  return rows
    .filter((s) => s.status !== 'paused')
    .map((s) => {
      const i = s.info ?? {};
      const name = s.name ?? s.host ?? 'system';
      const ok = s.status === 'up';
      const disk = num(i.dp);
      return {
        url: `${base}/system/${encodeURIComponent(name)}`,
        ok,
        error: ok ? undefined : s.status === 'pending' ? 'Waiting for its agent' : 'Its agent is down',
        name,
        os: [i.os, i.k].filter((x) => typeof x === 'string').join(' '),
        cpuPct: num(i.cpu) ?? 0,
        cores: num(i.c),
        load: Array.isArray(i.la) ? num(i.la[1]) : num(i.l5),
        memPct: num(i.mp) ?? 0,
        memUsed: 0,
        memTotal: 0,
        disks: disk != null ? [{ mount: '/', used: 0, size: 0, pct: disk }] : [],
        // Beszel reports one bandwidth figure, in MB/s.
        rx: (num(i.b) ?? 0) * 1e6,
        tx: 0,
        tempC: num(i.dt) || undefined,
        uptime: since(num(i.u)),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function beszelAdapter(): Adapter<GlancesData> {
  const { url, username, password } = config.beszel!;
  return {
    id: 'beszel',
    label: 'Beszel',
    intervalMs: 30 * SECOND,
    async fetch() {
      const auth = await getJson<{ token?: string }>(`${url}/api/collections/users/auth-with-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identity: username, password }),
      });
      if (!auth.token) throw new Error('Beszel refused the sign-in');
      const list = await getJson<{ items?: BeszelSystem[] }>(`${url}/api/collections/systems/records?perPage=200&sort=name`, { headers: { Authorization: auth.token } });
      return { hosts: toBeszelHosts(list.items ?? [], url) };
    },
  };
}

// CPU by hour for one system, from Beszel's own history: 20-minute averages
// for the last day, 2-hour ones before that (Beszel keeps those a week).
// A record is stamped when its window ends; each point goes to the window's middle.

interface StatRow {
  created?: string;
  type?: string;
  stats?: { cpu?: number };
}

const WINDOW: Record<string, number> = { '20m': 20 * 60_000, '120m': 120 * 60_000 };

export function toCpuSeries(rows: StatRow[], dayAgo: number): [number, number][] {
  const out: [number, number][] = [];
  for (const r of rows) {
    const end = Date.parse((r.created ?? '').replace(' ', 'T'));
    const span = WINDOW[r.type ?? ''];
    const cpu = r.stats?.cpu;
    if (!span || !Number.isFinite(end) || typeof cpu !== 'number') continue;
    // The last day comes from the finer 20-minute rows; 2-hour rows fill the week before.
    if (r.type === '120m' && end > dayAgo) continue;
    if (r.type === '20m' && end <= dayAgo) continue;
    if (span > 60 * 60_000) for (let t = end - span + 30 * 60_000; t < end; t += 60 * 60_000) out.push([t, cpu]);
    else out.push([end - span / 2, cpu]);
  }
  return out.sort((a, b) => a[0] - b[0]);
}

/** A container as Beszel's agent sees it now: CPU in percent, memory in MB. */
interface BeszelContainer {
  name?: string;
  cpu?: number;
  memory?: number;
}

export interface HostDetail {
  series: [number, number][];
  containers: { name: string; cpu: number; memBytes: number }[];
  /** The root disk and any extra filesystems the agent watches, in bytes. */
  volumes: { name: string; used: number; total: number }[];
}

const GIB = 1024 ** 3;

/** Beszel's newest one-minute record: d/du in GB for the root disk, efs for the others. */
export function toVolumes(stats: { d?: number; du?: number; efs?: Record<string, { d?: number; du?: number }> } | undefined): HostDetail['volumes'] {
  if (!stats) return [];
  const out: HostDetail['volumes'] = [];
  if (typeof stats.d === 'number' && stats.d > 0) out.push({ name: 'System', used: (stats.du ?? 0) * GIB, total: stats.d * GIB });
  for (const [name, fs] of Object.entries(stats.efs ?? {})) {
    if (typeof fs?.d === 'number' && fs.d > 0) out.push({ name, used: (fs.du ?? 0) * GIB, total: fs.d * GIB });
  }
  return out;
}

const cpuCache = new Map<string, { at: number; detail: HostDetail }>();

export async function beszelHostDetail(host: string): Promise<HostDetail | null> {
  if (!config.beszel) return null;
  const hit = cpuCache.get(host);
  if (hit && Date.now() - hit.at < 60_000) return hit.detail;
  const { url, username, password } = config.beszel;
  const auth = await getJson<{ token?: string }>(`${url}/api/collections/users/auth-with-password`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity: username, password }),
  });
  if (!auth.token) throw new Error('Beszel refused the sign-in');
  const headers = { Authorization: auth.token };
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const list = await getJson<{ items?: BeszelSystem[] }>(`${url}/api/collections/systems/records?perPage=200`, { headers });
  const sys = (list.items ?? []).find((s) => norm(s.name ?? '') === norm(host));
  if (!sys?.id) return null;
  const since = new Date(Date.now() - 8 * 86_400_000).toISOString().replace('T', ' ');
  const filter = encodeURIComponent(`system='${sys.id}' && (type='20m' || type='120m') && created>='${since}'`);
  const [rows, ctrs, latest] = await Promise.all([
    getJson<{ items?: StatRow[] }>(`${url}/api/collections/system_stats/records?perPage=500&sort=created&fields=created,type,stats&filter=${filter}`, { headers }),
    getJson<{ items?: BeszelContainer[] }>(`${url}/api/collections/containers/records?perPage=500&fields=name,cpu,memory&filter=${encodeURIComponent(`system='${sys.id}'`)}`, { headers }),
    getJson<{ items?: { stats?: Parameters<typeof toVolumes>[0] }[] }>(`${url}/api/collections/system_stats/records?perPage=1&sort=-created&fields=stats&filter=${encodeURIComponent(`system='${sys.id}' && type='1m'`)}`, { headers }),
  ]);
  const detail: HostDetail = {
    series: toCpuSeries(rows.items ?? [], Date.now() - 86_400_000),
    containers: (ctrs.items ?? [])
      .filter((x) => x.name)
      .map((x) => ({ name: x.name!, cpu: x.cpu ?? 0, memBytes: (x.memory ?? 0) * 1024 * 1024 })),
    volumes: toVolumes(latest.items?.[0]?.stats),
  };
  cpuCache.set(host, { at: Date.now(), detail });
  return detail;
}
