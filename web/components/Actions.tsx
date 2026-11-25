// Start, stop and restart. Stop and restart take a press and hold, so a
// stray click or a pocket tap can't take an app down; start is one click.

import { useEffect, useState } from 'react';
import { HoldButton } from './Hold.tsx';
import { t } from '../lib/i18n.ts';

export type Action = 'start' | 'stop' | 'restart';

export const VERB: Record<Action, [string, string]> = {
  start: ['Start', 'Starting'],
  stop: ['Stop', 'Stopping'],
  restart: ['Restart', 'Restarting'],
};

export function ContainerActions({ name, running, self, onSent, locked }: { name: string; running: boolean; self?: boolean; onSent?: (action: Action) => void; locked?: boolean }) {
  const [busy, setBusy] = useState<Action | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!result) return;
    const t = setTimeout(() => setResult(null), 6000);
    return () => clearTimeout(t);
  }, [result]);

  const run = async (action: Action) => {
    setBusy(action);
    setResult(null);
    try {
      const res = await fetch(`/api/containers/${encodeURIComponent(name)}/action`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Patchboard': 'action' },
        body: JSON.stringify({ action }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      if (onSent) onSent(action);
      else setResult({ ok: true, text: `${VERB[action][0]} sent.` });
    } catch (err) {
      // Restarting Patchboard itself drops this request; the page reconnects.
      if (self && action !== 'start') setResult({ ok: true, text: 'Patchboard is restarting. This page reconnects on its own.' });
      else setResult({ ok: false, text: `${VERB[action][0]} failed: ${(err as Error).message}` });
    } finally {
      setBusy(null);
    }
  };

  const actions: Action[] = running ? ['restart', 'stop'] : ['start'];
  return (
    <div className="ctr-actions">
      {actions.map((a) =>
        a === 'start' ? (
          <button key={a} type="button" className="button button-quiet" disabled={locked} aria-disabled={!!busy || undefined} onClick={() => !busy && void run(a)} aria-live="polite">
            {busy === a ? `${VERB[a][1]}...` : VERB[a][0]}
          </button>
        ) : (
          <HoldButton key={a} danger={a === 'stop'} disabled={!!busy || locked} hint={`Hold to ${VERB[a][0].toLowerCase()}`} onConfirm={() => void run(a)}>
            {busy === a ? `${VERB[a][1]}...` : VERB[a][0]}
          </HoldButton>
        ),
      )}
      {result && <span className={`ctr-actions-result ${result.ok ? '' : 'crit-text'}`}>{result.text}</span>}
    </div>
  );
}

/** Fork: leave an offline UniFi device out of Needs attention until it is online again, or take it back. */
export function AlertIgnoreButton({ id, ignored, label }: { id: string; ignored: boolean; label?: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/alerts/${encodeURIComponent(id)}/ignore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Patchboard': 'action' },
        body: JSON.stringify({ ignore: !ignored }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button
        type="button"
        className="text-button alert-ignore"
        disabled={busy}
        title={ignored ? t('Report it again when it is offline') : t('No alert until it is online again')}
        onClick={() => void send()}
      >
        {label ?? (ignored ? t('Stop ignoring') : t('Ignore'))}
      </button>
      {error && <span className="ctr-actions-result crit-text">{error}</span>}
    </>
  );
}

/** Leave a stopped container out of Needs attention until it runs again, or take it back. */
export function IgnoreButton({ name, ignored, compact }: { name: string; ignored: boolean; compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/containers/${encodeURIComponent(name)}/ignore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Patchboard': 'action' },
        body: JSON.stringify({ ignore: !ignored }),
      });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button
        type="button"
        className={compact ? 'text-button alert-ignore' : 'button button-quiet'}
        disabled={busy}
        title={ignored ? 'Report it again when it is stopped' : 'Stopped on purpose: no alert until it runs again'}
        onClick={() => void send()}
      >
        {ignored ? 'Stop ignoring' : 'Ignore'}
      </button>
      {error && <span className="ctr-actions-result crit-text">{error}</span>}
    </>
  );
}
