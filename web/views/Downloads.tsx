// Downloads: everything in every download client, finished or not, with what
// you can do to each. Lists come straight from the clients while the page is
// open and visible, every few seconds; the snapshot keeps only its summary.
// Pause and resume are a tap. Removing is a hold: once for the entry, or
// again from the other button for the entry and its files.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import type { DownloadClientId, DownloadEntry, DownloadList, DownloadState, EntryAction } from '../../shared/types.ts';
import { HoldButton } from '../components/Hold.tsx';
import { Empty, Meter } from '../components/ui.tsx';
import { type DownloadClient, PauseButton, useDownloadClients } from '../lib/downloads.tsx';
import { agoLong, breakable, eta, size, speed } from '../lib/format.ts';
import { msg, t as tr } from '../lib/i18n.ts';
import { useStore } from '../lib/store.tsx';
import { useUrlChoice } from '../lib/url.ts';

const ACTION = { 'X-Patchboard': 'action' };
const EVERY_MS = 3000;

type Filter = 'all' | 'active' | 'seeding' | 'paused' | 'done' | 'errored';
const FILTERS: [Filter, string, DownloadState[]][] = [
  ['all', msg('All'), []],
  ['active', msg('Downloading'), ['downloading', 'stalled', 'queued', 'checking']],
  ['seeding', msg('Seeding'), ['seeding']],
  ['paused', msg('Paused'), ['paused']],
  ['done', msg('Finished'), ['done']],
  ['errored', msg('Failed'), ['errored']],
];
const ORDER: Record<DownloadState, number> = { errored: 0, downloading: 1, stalled: 2, checking: 3, queued: 4, paused: 5, seeding: 6, done: 7 };
const STATE: Record<DownloadState, string> = {
  downloading: msg('Downloading'),
  stalled: msg('Stalled'),
  queued: msg('Queued'),
  checking: msg('Checking'),
  paused: msg('Paused'),
  seeding: msg('Seeding'),
  done: msg('Finished'),
  errored: msg('Failed'),
};

type Row = DownloadEntry & { client: DownloadClient; kind: DownloadList['kind'] };

/** Each client's list, every few seconds while this tab is in view. */
function useLists(clients: DownloadClient[]): { lists: Map<DownloadClientId, DownloadList>; errors: Map<DownloadClientId, string>; reload: () => void } {
  const [lists, setLists] = useState(new Map<DownloadClientId, DownloadList>());
  const [errors, setErrors] = useState(new Map<DownloadClientId, string>());
  const ids = clients.map((c) => c.id).join(',');
  const tick = useRef<() => void>(() => {});
  useEffect(() => {
    if (!ids) return;
    let gone = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      clearTimeout(timer);
      const got = await Promise.all(
        ids.split(',').map(async (id) => {
          try {
            const res = await fetch(`/api/downloads/${id}/list`);
            const body = (await res.json()) as DownloadList & { error?: string };
            return [id, res.ok ? body : null, res.ok ? '' : (body.error ?? `HTTP ${res.status}`)] as const;
          } catch (err) {
            return [id, null, (err as Error).message] as const;
          }
        }),
      );
      if (gone) return;
      setLists((old) => {
        const next = new Map(old);
        for (const [id, list] of got) if (list) next.set(id as DownloadClientId, list);
        return next;
      });
      setErrors(new Map(got.filter(([, , e]) => e).map(([id, , e]) => [id as DownloadClientId, e])));
      if (document.visibilityState === 'visible') timer = setTimeout(() => void load(), EVERY_MS);
    };
    tick.current = () => void load();
    const onShow = () => document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', onShow);
    void load();
    return () => {
      gone = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onShow);
    };
  }, [ids]);
  return { lists, errors, reload: () => tick.current() };
}

export function Downloads() {
  const { snap } = useStore();
  const ro = !!snap?.readOnly;
  const { clients, configured } = useDownloadClients();
  const { lists, errors, reload } = useLists(clients);
  const [filter, setFilter] = useUrlChoice<Filter>('show', FILTERS.map((f) => f[0]), 'all');
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState('');
  const [said, setSaid] = useState('');
  const [err, setErr] = useState('');

  const rows: Row[] = useMemo(
    () =>
      clients
        .flatMap((c) => (lists.get(c.id)?.entries ?? []).map((e) => ({ ...e, client: c, kind: lists.get(c.id)!.kind })))
        .sort((a, b) => ORDER[a.state] - ORDER[b.state] || (b.added ?? 0) - (a.added ?? 0)),
    [clients, lists],
  );
  const counts = new Map(FILTERS.map(([f, , states]) => [f, f === 'all' ? rows.length : rows.filter((r) => states.includes(r.state)).length]));
  const needle = q.trim().toLowerCase();
  const states = FILTERS.find((f) => f[0] === filter)![2];
  const shown = rows.filter((r) => (!states.length || states.includes(r.state)) && (!needle || `${r.name} ${r.category ?? ''} ${r.tracker ?? ''}`.toLowerCase().includes(needle)));

  async function act(r: Row, action: EntryAction) {
    setBusy(`${r.client.id}:${r.id}`);
    setErr('');
    try {
      const res = await fetch(`/api/downloads/${r.client.id}/entries/${encodeURIComponent(r.id)}/${action}`, { method: 'POST', headers: ACTION });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`);
      if (action === 'remove') setSaid(tr('Removed {name}. Its files stay.', { name: r.name }));
      if (action === 'delete') setSaid(tr('Removed {name} and its files.', { name: r.name }));
      reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  if (!configured)
    return (
      <div className="page downloads-page">
        <div className="page-head">
          <h1 className="page-title">{tr('Downloads')}</h1>
        </div>
        <Empty>
          {tr('No download client is set up.')} <Link to="/settings?tab=connections">{tr('Connect one')}</Link>
        </Empty>
      </div>
    );

  const down = clients.reduce((n, c) => n + c.data.down, 0);
  const up = clients.reduce((n, c) => n + c.data.up, 0);
  return (
    <div className="page downloads-page">
      <div className="page-head">
        <h1 className="page-title">{tr('Downloads')}</h1>
        <p className="dlp-total">
          <span>{tr('{speed} down', { speed: speed(down) })}</span>
          {up > 0 && <span>{tr('{speed} up', { speed: speed(up) })}</span>}
        </p>
      </div>

      <ul className="dlp-clients" aria-label={tr('Download clients')}>
        {clients.map((c) => (
          <li key={c.id}>
            <strong>{c.container ? <Link to={`/c/${encodeURIComponent(c.container)}`}>{c.label}</Link> : c.label}</strong>
            <span className="dlp-client-state">
              {c.data.paused ? tr('Paused') : c.data.downloading ? tr('{n} downloading', { n: c.data.downloading }) : tr('Idle')}
              {c.data.altSpeed ? `, ${tr('speed limited')}` : ''}
            </span>
            {errors.get(c.id) && <span className="crit-text">{errors.get(c.id)}</span>}
            {!ro && (
              <span className="dlp-client-actions">
                {c.data.altSpeed !== undefined && <AltSpeed client={c} />}
                <PauseButton client={c} />
              </span>
            )}
          </li>
        ))}
      </ul>

      {!ro && <AddDownload clients={clients} onAdded={(name) => (setSaid(tr('Added {name}.', { name })), reload())} />}

      <div className="page-toolbar dlp-toolbar">
        <div className="seg" role="group" aria-label={tr('Show')}>
          {FILTERS.map(([f, label]) =>
            f === 'all' || counts.get(f) || filter === f ? (
              <button key={f} type="button" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                {tr(label)} <span className="dlp-count">{counts.get(f)}</span>
              </button>
            ) : null,
          )}
        </div>
        <input className="field" type="search" placeholder={tr('Filter by name, category or tracker')} aria-label={tr('Filter downloads')} value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {said && (
        <p className="req-done" role="status">
          {said}
        </p>
      )}
      {err && (
        <p className="crit-text" role="alert">
          {err}
        </p>
      )}

      {lists.size === 0 && errors.size === 0 ? (
        <div className="dlp-loading" aria-busy="true" />
      ) : shown.length === 0 ? (
        <Empty>{needle ? tr('Nothing matches.') : filter === 'all' ? tr('Nothing in any client.') : tr('Nothing here right now.')}</Empty>
      ) : (
        <ul className="dlp-list">
          {shown.map((r) => (
            <EntryRow key={`${r.client.id}:${r.id}`} r={r} many={clients.length > 1} ro={ro} busy={busy === `${r.client.id}:${r.id}`} onAct={(a) => void act(r, a)} />
          ))}
        </ul>
      )}
    </div>
  );
}

function EntryRow({ r, many, ro, busy, onAct }: { r: Row; many: boolean; ro: boolean; busy: boolean; onAct: (a: EntryAction) => void }) {
  const unfinished = r.progress < 1 && !r.history;
  const canPause = !r.history && ['downloading', 'stalled', 'queued', 'seeding', 'checking'].includes(r.state);
  const canResume = !r.history && (r.state === 'paused' || (r.state === 'errored' && r.kind === 'torrent'));
  const level = r.state === 'errored' ? 'crit' : r.state === 'stalled' ? 'warn' : 'ok';
  // The one line that says how it's doing: speed and time left while it runs, else its state.
  const how =
    r.state === 'downloading'
      ? [speed(r.down), eta(r.etaSec)].filter(Boolean).join(', ')
      : r.state === 'seeding'
        ? tr('Seeding at {speed}', { speed: speed(r.up) })
        : tr(STATE[r.state]);
  return (
    <li className={`dlp-row is-${r.state}`}>
      <div className="dlp-head">
        <span className="dlp-name" title={r.name}>
          {breakable(r.name)}
        </span>
        <span className={`dlp-how ${r.state === 'errored' ? 'crit-text' : r.state === 'stalled' ? 'warn-text' : ''}`}>{how}</span>
      </div>
      {unfinished && <Meter value={r.progress * 100} level={level} label={tr('{name}, {pct}%', { name: r.name, pct: Math.round(r.progress * 100) })} />}
      <div className="dlp-foot">
      <div className="dlp-info">
      <div className="dlp-meta">
        <span>{unfinished ? tr('{done} of {size}', { done: size(r.done), size: size(r.size) }) : size(r.size)}</span>
        {r.ratio !== undefined && r.kind === 'torrent' && <span>{tr('ratio {n}', { n: r.ratio.toFixed(2) })}</span>}
        {r.category && <span className="dlp-tag">{r.category}</span>}
        {r.tracker && <span>{r.tracker}</span>}
        {many && <span>{r.client.label}</span>}
        {r.added && <span>{r.history ? tr('finished {when}', { when: agoLong(r.added) }) : tr('added {when}', { when: agoLong(r.added) })}</span>}
      </div>
      {r.error && <p className="dlp-error crit-text">{r.error}</p>}
      </div>
      {!ro && (
        <div className="dlp-actions">
          {canResume && (
            <button type="button" className="button button-quiet" disabled={busy} onClick={() => onAct('resume')}>
              {tr('Resume')}
            </button>
          )}
          {canPause && !canResume && (
            <button type="button" className="button button-quiet" disabled={busy} onClick={() => onAct('pause')}>
              {tr('Pause')}
            </button>
          )}
          {r.history ? (
            <HoldButton className="text-button" label={tr('Remove {name} from the history', { name: r.name })} hint={tr('Hold to remove it from the history. The files stay.')} onConfirm={() => onAct('remove')}>
              {tr('Remove from history')}
            </HoldButton>
          ) : r.kind === 'usenet' ? (
            <HoldButton className="text-button" danger label={tr('Remove {name}', { name: r.name })} hint={tr('Hold to remove it, with what it has downloaded so far.')} onConfirm={() => onAct('remove')}>
              {tr('Remove')}
            </HoldButton>
          ) : (
            <>
              <HoldButton className="text-button" label={tr('Remove {name}', { name: r.name })} hint={tr('Hold to remove. The files stay.')} onConfirm={() => onAct('remove')}>
                {tr('Remove')}
              </HoldButton>
              <HoldButton className="text-button" danger label={tr('Remove {name} and delete its files', { name: r.name })} hint={tr('Hold to remove it and delete its files.')} onConfirm={() => onAct('delete')}>
                {tr('Remove and delete files')}
              </HoldButton>
            </>
          )}
        </div>
      )}
      </div>
    </li>
  );
}

function AltSpeed({ client }: { client: DownloadClient }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className="text-button"
      disabled={busy}
      onClick={() => {
        setBusy(true);
        void fetch(`/api/downloads/${client.id}/altspeed`, { method: 'POST', headers: ACTION }).finally(() => setBusy(false));
      }}
    >
      {client.data.altSpeed ? tr('Full speed') : tr('Limit speed')}
    </button>
  );
}

/** Which clients take this: torrents to a torrent client, NZBs to a usenet one. */
function fits(c: DownloadClient, what: string): boolean {
  const usenet = c.data.kind === 'usenet';
  if (/^magnet:|\.torrent$/i.test(what)) return !usenet;
  if (/\.nzb(\?|$)/i.test(what)) return usenet;
  return true;
}

function AddDownload({ clients, onAdded }: { clients: DownloadClient[]; onAdded: (name: string) => void }) {
  const [link, setLink] = useState('');
  const [to, setTo] = useState<DownloadClientId | ''>('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const file = useRef<HTMLInputElement>(null);
  const pick = (what: string) => clients.filter((c) => fits(c, what));
  const target = (what: string) => pick(what).find((c) => c.id === to) ?? pick(what)[0];
  const options = pick(link.trim());

  async function send(c: DownloadClient | undefined, body: object, name: string) {
    if (!c) return setErr(tr('No client here takes that.'));
    setBusy(true);
    setErr('');
    try {
      const res = await fetch(`/api/downloads/${c.id}/add`, { method: 'POST', headers: { ...ACTION, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`);
      setLink('');
      onAdded(name);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function upload(f: File) {
    if (f.size > 10 * 1024 * 1024) return setErr(tr('Files can be up to 10 MB'));
    const data = btoa(Array.from(new Uint8Array(await f.arrayBuffer()), (b) => String.fromCharCode(b)).join(''));
    await send(target(f.name), { name: f.name, data }, f.name);
  }

  const linkName = (u: string) => decodeURIComponent((/[?&]dn=([^&]+)/.exec(u)?.[1] ?? '').replace(/\+/g, ' ')) || u.split('/').pop() || u;
  return (
    <form
      className="dlp-add"
      onSubmit={(e) => {
        e.preventDefault();
        const u = link.trim();
        if (u) void send(target(u), { url: u }, linkName(u));
      }}
    >
      <input className="field" value={link} onChange={(e) => setLink(e.target.value)} placeholder={tr('Paste a magnet link or a web address')} aria-label={tr('Magnet link or web address')} autoComplete="off" spellCheck={false} />
      {options.length > 1 && (
        <select className="field" aria-label={tr('Send to')} value={target(link.trim())?.id ?? ''} onChange={(e) => setTo(e.target.value as DownloadClientId)}>
          {options.map((c) => (
            <option key={c.id} value={c.id}>
              {c.label}
            </option>
          ))}
        </select>
      )}
      <button type="submit" className="button" disabled={busy || !link.trim()}>
        {busy ? tr('Adding') : tr('Add')}
      </button>
      <button type="button" className="button button-quiet" disabled={busy} onClick={() => file.current?.click()}>
        {tr('Add a file')}
      </button>
      <input ref={file} type="file" hidden accept=".torrent,.nzb,application/x-bittorrent,application/x-nzb" onChange={(e) => {
        const f = e.target.files?.[0];
        e.target.value = '';
        if (f) void upload(f);
      }} />
      {err && (
        <span className="crit-text" role="alert">
          {err}
        </span>
      )}
    </form>
  );
}
