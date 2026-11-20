// Maintenance: OS and app updates on the other machines (fork fir3drag0n).
// Patchboard holds no keys for them. It asks an n8n webhook, which runs the
// same restricted SSH gates the Telegram update buttons use: "status" only
// reads; the other actions install. The webhook takes a header token and a
// fixed list of target/action pairs, so nothing else can be run from here.

import type { Alert } from '../shared/types.ts';
import { kvGet, kvSet } from './db.ts';

export type MaintTarget = 'oracle' | 'oracle2' | 'oracle3' | 'unraid';
export const MAINT_TARGETS: MaintTarget[] = ['oracle', 'oracle2', 'oracle3', 'unraid'];
export const MAINT_ACTIONS: Record<MaintTarget, string[]> = {
  oracle: ['status', 'upgrade', 'upgrade-reboot'],
  oracle2: ['status', 'upgrade', 'upgrade-reboot', 'mailcow-update'],
  oracle3: ['status', 'upgrade', 'upgrade-reboot'],
  unraid: ['status', 'plugins', 'os', 'reboot'],
};

export interface PluginUpdate { name: string; from: string; to: string; session?: boolean }
export interface MaintStatus {
  updates: number;
  packages?: string[];
  plugins?: PluginUpdate[];
  os?: { current: string; latest: string; newer: boolean };
  reboot: boolean;
  containers?: number;
  kernel?: string;
  mailcow?: { behind: number; current: string; latest: string } | null;
}
export interface MaintJob { action: string; startedAt: number; finishedAt?: number; ok?: boolean; output?: string }
export interface MaintEntry { status?: MaintStatus; checkedAt?: number; error?: string; job?: MaintJob }
export type MaintState = Record<string, MaintEntry>;

const KEY = 'maintenance';
const url = () => process.env.PB_WARTUNG_URL ?? '';
const token = () => process.env.PB_WARTUNG_TOKEN ?? '';
export const maintenanceEnabled = () => !!url() && !!token();

export function maintenanceState(): MaintState {
  return kvGet<MaintState>(KEY) ?? {};
}
function update(target: string, change: (e: MaintEntry) => MaintEntry): void {
  const all = maintenanceState();
  all[target] = change(all[target] ?? {});
  kvSet(KEY, all);
}

/** The Unraid gate answers in lines: PLUGIN/PLUGINX name old new, OS cur new newer, REBOOT, FERTIG. */
export function parseUnraid(out: string): MaintStatus {
  const plugins: PluginUpdate[] = [];
  let os: MaintStatus['os'];
  let reboot = false;
  for (const line of out.split('\n')) {
    const a = line.trim().split(/\s+/);
    if (a[0] === 'PLUGIN' || a[0] === 'PLUGINX') plugins.push({ name: a[1], from: a[2], to: a[3], ...(a[0] === 'PLUGINX' ? { session: true } : {}) });
    else if (a[0] === 'OS') os = { current: a[1], latest: a[2], newer: a[3] === 'true' };
    else if (a[0] === 'REBOOT') reboot = true;
  }
  if (!out.includes('FERTIG')) throw new Error('Unraid check gave no complete answer');
  const own = plugins.filter((p) => !p.session).length;
  return { updates: own + (os?.newer ? 1 : 0), plugins, os, reboot };
}

export function parseOracle(out: string): MaintStatus {
  const j = JSON.parse(out.trim().split('\n').pop() ?? '{}') as MaintStatus;
  return { updates: j.updates ?? 0, packages: j.packages ?? [], reboot: !!j.reboot, containers: j.containers, kernel: j.kernel, mailcow: j.mailcow ?? null };
}

async function call(target: MaintTarget, action: string, timeoutMs: number): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  const res = await fetch(url(), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-pb-token': token() },
    body: JSON.stringify({ target, action }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = (await res.json().catch(() => ({}))) as { ok?: boolean; stdout?: string; stderr?: string; error?: string };
  if (!res.ok) throw new Error(body.error ?? `n8n answered HTTP ${res.status}`);
  return { ok: !!body.ok, stdout: body.stdout ?? '', stderr: body.stderr ?? '' };
}

const busy = new Set<string>();

/** Read the state of one machine. */
export async function checkTarget(target: MaintTarget): Promise<void> {
  if (busy.has(`check:${target}`)) return;
  busy.add(`check:${target}`);
  try {
    const r = await call(target, 'status', 5 * 60_000);
    if (!r.ok) throw new Error(r.stderr || r.stdout || 'check failed');
    const status = target === 'unraid' ? parseUnraid(r.stdout) : parseOracle(r.stdout);
    update(target, (e) => ({ ...e, status, checkedAt: Date.now(), error: undefined }));
  } catch (err) {
    update(target, (e) => ({ ...e, checkedAt: Date.now(), error: (err as Error).message }));
  } finally {
    busy.delete(`check:${target}`);
  }
}

export async function checkAll(): Promise<void> {
  await Promise.all(MAINT_TARGETS.map((t) => checkTarget(t)));
}

/** Start an install; it runs on after the request returns. False if one is running already. */
export function startAction(target: MaintTarget, action: string, done: () => void): boolean {
  if (busy.has(`run:${target}`)) return false;
  busy.add(`run:${target}`);
  update(target, (e) => ({ ...e, job: { action, startedAt: Date.now() } }));
  done();
  void (async () => {
    let ok = false;
    let output = '';
    try {
      // An Unraid OS update downloads and installs for up to 25 minutes.
      const r = await call(target, action, 40 * 60_000);
      ok = r.ok;
      output = (r.stdout || r.stderr).trim();
    } catch (err) {
      output = (err as Error).message;
    }
    update(target, (e) => ({ ...e, job: { ...e.job!, finishedAt: Date.now(), ok, output: output.slice(0, 4000) } }));
    busy.delete(`run:${target}`);
    done();
    // A restart takes the machine away for a while; look again once it's back.
    const later = /reboot/.test(action) ? 4 * 60_000 : 5_000;
    setTimeout(() => void checkTarget(target).then(done), later);
  })();
  return true;
}

export const LABELS: Record<MaintTarget, string> = { oracle: 'oracle', oracle2: 'oracle2', oracle3: 'oracle3', unraid: 'Unraid' };

/** Updates waiting or a restart due, for Needs attention. */
export function maintenanceAlerts(state: MaintState = maintenanceState()): Alert[] {
  const out: Alert[] = [];
  for (const t of MAINT_TARGETS) {
    const s = state[t]?.status;
    if (!s) continue;
    const name = LABELS[t];
    const base = { level: 'warn' as const, subject: name, href: '/maintenance', source: 'patchboard' as const };
    if (s.updates > 0) {
      const what = t === 'unraid' ? [s.plugins?.filter((p) => !p.session).length ? `${s.plugins.filter((p) => !p.session).length} plugins` : '', s.os?.newer ? `Unraid ${s.os.latest}` : ''].filter(Boolean).join(', ') : `${s.updates} packages`;
      out.push({ ...base, id: `maint-updates-${t}`, title: `${name} has updates: ${what}`, say: { key: '{name} has updates: {what}', vars: { name, what } } });
    }
    if (s.mailcow && s.mailcow.behind > 0) {
      out.push({ ...base, id: `maint-mailcow-${t}`, subject: 'Mailcow', title: `Mailcow update available: ${s.mailcow.latest}`, say: { key: 'Mailcow update available: {version}', vars: { version: s.mailcow.latest } } });
    }
    if (s.reboot) out.push({ ...base, id: `maint-reboot-${t}`, title: `${name} needs a restart`, say: { key: '{name} needs a restart', vars: { name } } });
  }
  return out;
}
