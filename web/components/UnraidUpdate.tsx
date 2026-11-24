// Container updates (fork fir3drag0n): a button on each marked container, on
// Unraid and on the Oracles. The server asks n8n, which runs that machine's
// gate; the gate queues every request, so containers update one after another,
// never together. Names are Patchboard's: "x" on Unraid, "x@oracle" elsewhere.

import { useState } from 'react';
import { useJson } from '../lib/api.ts';
import { t } from '../lib/i18n.ts';

interface CtrJob { action: string; startedAt: number; finishedAt?: number; ok?: boolean; output?: string }
interface CtrData { enabled: boolean; ctr?: Record<string, CtrJob> }

export interface CtrUpdates {
  enabled: boolean;
  job: (name: string) => CtrJob | undefined;
  start: (name: string) => Promise<void>;
  fail: string | null;
}

/** One poll for the whole list; faster while something runs. */
export function useCtrUpdates(on = true): CtrUpdates {
  const [tick, setTick] = useState(0);
  const [fail, setFail] = useState<string | null>(null);
  const { data } = useJson<CtrData>(on ? `/api/maintenance?t=${tick}` : null, 8_000);
  const jobs = data?.ctr ?? {};
  return {
    enabled: !!data?.enabled,
    job: (name) => jobs[name],
    fail,
    start: async (name) => {
      setFail(null);
      try {
        const [base, host] = name.split('@');
        const res = await fetch(`/api/maintenance/${host ?? 'unraid'}/container/${encodeURIComponent(base)}`, { method: 'POST', headers: { 'X-Patchboard': 'action' } });
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      } catch (err) {
        setFail(`${name.startsWith('*') ? t('All') : name}: ${(err as Error).message}`);
      } finally {
        setTick((n) => n + 1);
      }
    },
  };
}

/** Button, or what the last update did. */
export function CtrUpdateButton({ name, u }: { name: string; u: CtrUpdates }) {
  if (!u.enabled) return null;
  const j = u.job(name);
  if (j && !j.finishedAt) return <span className="row-update-note">⏳ {t('Updating (queued one after another)')}</span>;
  const last = j?.finishedAt && (Date.now() - j.finishedAt < 600_000) ? j : undefined;
  return (
    <span className="ctr-update">
      {last && <span className={last.ok ? 'ok-text' : 'crit-text'} title={last.output}>{last.ok ? '✅' : '❌'}</span>}
      <button
        type="button"
        className="button button-quiet button-small"
        onClick={(e) => {
          e.preventDefault();
          if (window.confirm(t('Update {name} now? It stops for a few seconds.', { name }))) void u.start(name);
        }}
      >
        {last && !last.ok ? t('Try again') : t('Update')}
      </button>
    </span>
  );
}
