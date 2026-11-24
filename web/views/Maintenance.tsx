// Maintenance (fork fir3drag0n): OS and app updates on the Oracle servers,
// Mailcow and Unraid, with the same buttons as the Telegram update messages.
// The server asks n8n, which runs the restricted gates; nothing here holds a key.

import { useState } from 'react';
import { Led, Section } from '../components/ui.tsx';
import { useJson } from '../lib/api.ts';
import { agoLong } from '../lib/format.ts';
import { t } from '../lib/i18n.ts';

interface PluginUpdate { name: string; from: string; to: string; session?: boolean }
interface MaintStatus {
  updates: number;
  packages?: string[];
  plugins?: PluginUpdate[];
  os?: { current: string; latest: string; newer: boolean };
  reboot: boolean;
  containers?: number;
  kernel?: string;
  mailcow?: { behind: number; current: string; latest: string } | null;
}
interface MaintJob { action: string; startedAt: number; finishedAt?: number; ok?: boolean; output?: string }
interface MaintEntry { status?: MaintStatus; checkedAt?: number; error?: string; job?: MaintJob }
interface MaintData { enabled: boolean; targets: string[]; actions: Record<string, string[]>; state: Record<string, MaintEntry>; ctr?: Record<string, MaintJob> }

const NAMES: Record<string, string> = { oracle: 'oracle', oracle2: 'oracle2', oracle3: 'oracle3', unraid: 'Unraid' };
const BUTTONS: Record<string, { label: () => string; ask?: (name: string) => string }> = {
  status: { label: () => t('Check now') },
  upgrade: { label: () => t('Install updates'), ask: (name) => t('Install the updates on {name}?', { name }) },
  'upgrade-reboot': { label: () => t('Install + restart'), ask: (name) => t('Install the updates on {name} and restart it? Its containers are down for a few minutes.', { name }) },
  'mailcow-update': { label: () => t('Update Mailcow'), ask: () => t('Update Mailcow? A fresh backup runs first; mail pauses briefly.') },
  plugins: { label: () => t('Update plugins'), ask: () => t('Update the Unraid plugins (not the ones running the Claude session)?') },
  os: { label: () => t('Update Unraid OS'), ask: () => t('Download and install the new Unraid OS? It takes effect at the next restart.') },
  reboot: { label: () => t('Restart Unraid'), ask: () => t('Restart Unraid now? All containers, Home Assistant included, are down for several minutes.') },
};
const JOB_WORDS: Record<string, () => string> = {
  upgrade: () => t('Installing updates'),
  'upgrade-reboot': () => t('Installing updates and restarting'),
  'mailcow-update': () => t('Updating Mailcow'),
  plugins: () => t('Updating plugins'),
  os: () => t('Updating Unraid OS'),
  reboot: () => t('Restarting'),
};
const jobWords = (a: string) => (/^ctr:\*(@|$)/.test(a) ? t('Updating all containers') : a.startsWith('ctr:') ? t('Updating {name}', { name: a.slice(4).split('@')[0] }) : (JOB_WORDS[a]?.() ?? a));
/** Which machine a container job belongs to: "x" is Unraid's, "x@oracle" the Oracle's. */
const ctrTarget = (key: string) => key.split('@')[1] ?? 'unraid';
const ctrAllKey = (tg: string) => (tg === 'unraid' ? '*' : `*@${tg}`);

async function post(url: string): Promise<void> {
  const res = await fetch(url, { method: 'POST', headers: { 'X-Patchboard': 'action' } });
  const body = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
}

function needs(s?: MaintStatus): boolean {
  return !!s && (s.updates > 0 || s.reboot || (s.mailcow?.behind ?? 0) > 0);
}

export function Maintenance() {
  const [tick, setTick] = useState(0);
  const { data, error } = useJson<MaintData>(`/api/maintenance?t=${tick}`, 10_000);
  const [busy, setBusy] = useState<string | null>(null);
  const [fail, setFail] = useState<string | null>(null);

  async function run(target: string, action: string) {
    const b = BUTTONS[action];
    if (b?.ask && !window.confirm(b.ask(NAMES[target] ?? target))) return;
    setBusy(`${target}:${action}`);
    setFail(null);
    try {
      await post(`/api/maintenance/${target}/${action}`);
    } catch (err) {
      setFail(`${NAMES[target] ?? target}: ${(err as Error).message}`);
    } finally {
      setBusy(null);
      setTick((n) => n + 1);
    }
  }

  async function runCtrAll(tg: string) {
    if (!window.confirm(t('Update every container on {name} that has an update, one after another? Each stops for a few seconds.', { name: NAMES[tg] ?? tg }))) return;
    setBusy(`ctr:${tg}`);
    setFail(null);
    try {
      await post(`/api/maintenance/${tg}/container/*`);
    } catch (err) {
      setFail(`${NAMES[tg] ?? tg}: ${(err as Error).message}`);
    } finally {
      setBusy(null);
      setTick((n) => n + 1);
    }
  }

  if (error) return <div className="page"><h1 className="page-title">{t('Maintenance')}</h1><p>{error}</p></div>;
  if (!data) return null;
  if (!data.enabled) {
    return (
      <div className="page">
        <h1 className="page-title">{t('Maintenance')}</h1>
        <p>{t('Not set up: PB_WARTUNG_URL and PB_WARTUNG_TOKEN are missing.')}</p>
      </div>
    );
  }
  const open = data.targets.filter((tg) => needs(data.state[tg]?.status)).length;

  return (
    <div className="page maint-page">
      <div className="page-head">
        <h1 className="page-title">{t('Maintenance')}</h1>
        <span className="section-count">{open ? t('{n} need a look', { n: open }) : t('All up to date')}</span>
      </div>
      {fail && <p className="maint-fail" role="alert">{fail}</p>}
      {data.targets.map((tg) => {
        const e = data.state[tg] ?? {};
        const s = e.status;
        const running = !!e.job && !e.job.finishedAt;
        return (
          <Section key={tg} title={NAMES[tg] ?? tg} count={e.checkedAt ? t('checked {when}', { when: agoLong(e.checkedAt) }) : t('not checked yet')}>
            <div className="maint-body">
              <p className="maint-line">
                <Led state={e.error ? 'crit' : !s ? 'idle' : needs(s) ? 'warn' : 'ok'} />{' '}
                {e.error
                  ? t('Check failed: {error}', { error: e.error })
                  : !s
                    ? t('No state yet')
                    : tg === 'unraid'
                      ? [
                          s.os ? (s.os.newer ? t('Unraid {from} → {to} available', { from: s.os.current, to: s.os.latest }) : t('Unraid {v}, current', { v: s.os.current })) : '',
                          s.plugins?.length ? t('{n} plugin updates', { n: s.plugins.length }) : t('Plugins current'),
                        ].filter(Boolean).join(' · ')
                      : s.updates
                        ? t('{n} updates: {list}', { n: s.updates, list: (s.packages ?? []).slice(0, 10).join(', ') + ((s.packages?.length ?? 0) > 10 ? ' …' : '') })
                        : t('No updates')}
                {s?.reboot && <strong className="maint-reboot"> · {t('restart needed')}</strong>}
              </p>
              {s?.plugins && s.plugins.length > 0 && (
                <ul className="maint-list">
                  {s.plugins.map((p) => (
                    <li key={p.name}>
                      <code>{p.name}</code> {p.from} → {p.to}
                      {p.session && <em> ({t('runs the Claude session, update it yourself')})</em>}
                    </li>
                  ))}
                </ul>
              )}
              {s?.mailcow && (
                <p className="maint-line">
                  Mailcow {s.mailcow.current}
                  {s.mailcow.behind > 0 ? ` → ${s.mailcow.latest} (${t('{n} changes', { n: s.mailcow.behind })})` : ` · ${t('current')}`}
                </p>
              )}
              {s && tg !== 'unraid' && (
                <p className="maint-meta">
                  {s.containers != null && t('{n} containers', { n: s.containers })}
                  {s.kernel && ` · Kernel ${s.kernel}`}
                </p>
              )}
              {e.job && (
                <div className={`maint-job ${running ? 'is-running' : e.job.ok ? 'is-ok' : 'is-fail'}`}>
                  <strong>
                    {running ? `⏳ ${jobWords(e.job.action)} …` : `${e.job.ok ? '✅' : '❌'} ${jobWords(e.job.action)}`}
                  </strong>{' '}
                  <span className="maint-meta">{agoLong(e.job.finishedAt ?? e.job.startedAt)}</span>
                  {e.job.output && <pre className="maint-out">{e.job.output}</pre>}
                </div>
              )}
              {Object.entries(data.ctr ?? {}).filter(([name]) => ctrTarget(name) === tg).map(([name, j]) => (
                <div key={name} className={`maint-job ${!j.finishedAt ? 'is-running' : j.ok ? 'is-ok' : 'is-fail'}`}>
                  <strong>{!j.finishedAt ? `⏳ ${jobWords(j.action)} …` : `${j.ok ? '✅' : '❌'} ${jobWords(j.action)}`}</strong>{' '}
                  <span className="maint-meta">{agoLong(j.finishedAt ?? j.startedAt)}</span>
                  {j.output && <pre className="maint-out">{j.output}</pre>}
                </div>
              ))}
              <div className="maint-actions">
                {data.actions[tg].map((a) => {
                  const hide =
                    (a === 'upgrade' && !s?.updates) ||
                    (a === 'upgrade-reboot' && !s?.updates && !s?.reboot) ||
                    (a === 'mailcow-update' && !(s?.mailcow?.behind ?? 0)) ||
                    (a === 'plugins' && !s?.plugins?.some((p) => !p.session)) ||
                    (a === 'os' && !s?.os?.newer);
                  if (hide) return null;
                  const label = a === 'upgrade-reboot' && !s?.updates ? t('Restart now') : (BUTTONS[a]?.label() ?? a);
                  return (
                    <button
                      key={a}
                      type="button"
                      className={`button ${a === 'status' ? 'button-quiet' : ''}`}
                      disabled={!!busy || (running && a !== 'status')}
                      onClick={() => void run(tg, a)}
                    >
                      {busy === `${tg}:${a}` ? '…' : label}
                    </button>
                  );
                })}
                <button
                  type="button"
                  className="button"
                  disabled={!!busy || (!!data.ctr?.[ctrAllKey(tg)] && !data.ctr[ctrAllKey(tg)].finishedAt)}
                  onClick={() => void runCtrAll(tg)}
                >
                  {busy === `ctr:${tg}` ? '…' : t('Update all containers (one after another)')}
                </button>
              </div>
            </div>
          </Section>
        );
      })}
    </div>
  );
}
