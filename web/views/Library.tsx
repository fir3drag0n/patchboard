// Library: Sonarr's shows and Radarr's films in one place. Every title with
// what's on disk, what's missing, the whole queue, and adding something new.
// Lists come straight from the app while the page is open; the queue
// refreshes every few seconds while it's in view.

import { type ReactNode, useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { ArrApp, ArrOptions, ArrQueueItem, FoundItem, LibraryItem, WantedList } from '../../shared/types.ts';
import { HoldButton } from '../components/Hold.tsx';
import { Empty, Meter, Poster } from '../components/ui.tsx';
import { agoLong, breakable, size } from '../lib/format.ts';
import { msg, t as tr } from '../lib/i18n.ts';
import { useStore } from '../lib/store.tsx';
import { useUrlChoice } from '../lib/url.ts';

const ACTION = { 'X-Patchboard': 'action', 'Content-Type': 'application/json' };
const QUEUE_EVERY_MS = 5000;
const PAGE = 60;

type View = 'items' | 'wanted' | 'queue' | 'add';
const VIEWS: [View, string][] = [
  ['items', msg('Library')],
  ['wanted', msg('Missing')],
  ['queue', msg('Queue')],
  ['add', msg('Add')],
];
const APPS: [ArrApp, string][] = [
  ['sonarr', msg('Shows')],
  ['radarr', msg('Films')],
];
const QUEUE_STATE: Record<ArrQueueItem['state'], string> = {
  downloading: msg('Downloading'),
  queued: msg('Queued'),
  paused: msg('Paused'),
  importing: msg('Importing'),
  warning: msg('Needs a look'),
  failed: msg('Failed'),
};

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body;
}

/** One list from the app, loaded when asked for; the queue keeps itself fresh while in view. */
function useList<T>(url: string | null, every = 0): { data: T | null; err: string; reload: () => void } {
  const [data, setData] = useState<T | null>(null);
  const [err, setErr] = useState('');
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!url) return;
    let gone = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const load = async () => {
      clearTimeout(timer);
      try {
        const got = await call<T>(url);
        if (gone) return;
        setData(got);
        setErr('');
      } catch (e) {
        if (!gone) setErr((e as Error).message);
      }
      if (!gone && every && document.visibilityState === 'visible') timer = setTimeout(() => void load(), every);
    };
    const onShow = () => every && document.visibilityState === 'visible' && void load();
    document.addEventListener('visibilitychange', onShow);
    void load();
    return () => {
      gone = true;
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onShow);
    };
  }, [url, every, n]);
  useEffect(() => setData(null), [url]);
  return { data, err, reload: useCallback(() => setN((x) => x + 1), []) };
}

export function Library() {
  const { snap } = useStore();
  const ro = !!snap?.readOnly;
  const apps = APPS.filter(([a]) => snap?.sources[a]).map(([a]) => a);
  const [app, setApp] = useUrlChoice<ArrApp>('app', APPS.map((a) => a[0]), apps[0] ?? 'sonarr');
  const [view, setView] = useUrlChoice<View>('view', VIEWS.map((v) => v[0]), 'items');
  const [said, setSaid] = useState('');
  const [err, setErr] = useState('');
  const on = apps.includes(app) ? app : apps[0];

  useEffect(() => {
    setSaid('');
    setErr('');
  }, [on, view]);

  if (!snap) return <div className="page library-page" aria-busy="true" />;
  if (!on)
    return (
      <div className="page library-page">
        <div className="page-head">
          <h1 className="page-title">{tr('Library')}</h1>
        </div>
        <Empty>
          {tr('Sonarr and Radarr are not set up.')} <Link to="/settings?tab=connections">{tr('Connect one')}</Link>
        </Empty>
      </div>
    );

  const queueCount = (snap.sources[on]?.data as { queueTotal?: number } | null)?.queueTotal ?? 0;
  const shows = on === 'sonarr';

  /** POST an action, then say so or show why not. */
  async function act(path: string, done: string, body?: object, after?: () => void) {
    setErr('');
    setSaid('');
    try {
      await call(`/api/library/${on}/${path}`, { method: 'POST', headers: ACTION, body: JSON.stringify(body ?? {}) });
      setSaid(done);
      after?.();
    } catch (e) {
      setErr((e as Error).message);
    }
  }

  return (
    <div className="page library-page">
      <div className="page-head">
        <h1 className="page-title">{tr('Library')}</h1>
      </div>

      <div className="page-toolbar">
        <div className="seg lib-views" role="group" aria-label={tr('Show')}>
          {VIEWS.filter(([v]) => !(ro && v === 'add')).map(([v, label]) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}>
              {tr(label)}
              {v === 'queue' && queueCount > 0 && <span className="dlp-count">{queueCount}</span>}
            </button>
          ))}
        </div>
        {apps.length > 1 && (
          <div className="seg" role="group" aria-label={tr('Shows or films')}>
            {APPS.map(([a, label]) => (
              <button key={a} type="button" aria-pressed={on === a} onClick={() => setApp(a)}>
                {tr(label)}
              </button>
            ))}
          </div>
        )}
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

      {view === 'items' && <Items app={on} shows={shows} ro={ro} act={act} />}
      {view === 'wanted' && <Wanted app={on} shows={shows} ro={ro} act={act} />}
      {view === 'queue' && <Queue app={on} ro={ro} act={act} />}
      {view === 'add' && !ro && <Add app={on} shows={shows} onAdded={(title) => setSaid(tr('Added {title}.', { title }))} />}
    </div>
  );
}

type Act = (path: string, done: string, body?: object, after?: () => void) => Promise<void>;

function Row({ art, title, children, actions }: { art?: string; title: string; children: ReactNode; actions?: ReactNode }) {
  return (
    <li className="lib-row">
      <Poster title={title} thumb={art} small />
      <div className="lib-body">{children}</div>
      {actions && <div className="lib-actions">{actions}</div>}
    </li>
  );
}

function Items({ app, shows, ro, act }: { app: ArrApp; shows: boolean; ro: boolean; act: Act }) {
  const { data, err, reload } = useList<LibraryItem[]>(`/api/library/${app}/items`);
  const [q, setQ] = useState('');
  const [more, setMore] = useState(PAGE);
  const needle = q.trim().toLowerCase();
  const all = [...(data ?? [])].sort((a, b) => a.title.replace(/^(the|a|an)\s+/i, '').localeCompare(b.title.replace(/^(the|a|an)\s+/i, '')));
  const shown = all.filter((i) => !needle || `${i.title} ${i.year ?? ''} ${i.by ?? ''}`.toLowerCase().includes(needle));
  const onDisk = (i: LibraryItem) =>
    shows
      ? tr('{have} of {total} episodes', { have: i.have, total: i.total })
      : i.have
        ? tr('On disk')
        : i.status === 'upcoming'
          ? tr('Not out yet')
          : tr('Missing');
  const status: Record<LibraryItem['status'], string> = { airing: tr('Airing'), ended: tr('Ended'), upcoming: tr('Not started'), out: '' };

  return (
    <>
      <div className="lib-filter">
        <input className="field" type="search" placeholder={shows ? tr('Filter shows') : tr('Filter films')} aria-label={shows ? tr('Filter shows') : tr('Filter films')} value={q} onChange={(e) => (setQ(e.target.value), setMore(PAGE))} />
        {data && <span className="lib-total">{shows ? tr('{n} shows', { n: all.length }) : tr('{n} films', { n: all.length })}</span>}
      </div>
      {err && <p className="crit-text">{err}</p>}
      {!data ? (
        !err && <div className="dlp-loading" aria-busy="true" />
      ) : shown.length === 0 ? (
        <Empty>{needle ? tr('Nothing matches.') : shows ? tr('No shows yet.') : tr('No films yet.')}</Empty>
      ) : (
        <>
          <ul className="lib-list">
            {shown.slice(0, more).map((i) => {
              const short = i.have < i.total && i.status !== 'upcoming';
              return (
                <Row
                  key={i.id}
                  art={i.art}
                  title={i.title}
                  actions={
                    !ro && (
                      <>
                        <button type="button" className="button button-quiet" aria-pressed={i.monitored} onClick={() => void act(`items/${i.id}/monitor`, i.monitored ? tr('Stopped watching for {title}.', { title: i.title }) : tr('Watching for {title}.', { title: i.title }), { on: !i.monitored }, reload)}>
                          {i.monitored ? tr('Monitored') : tr('Not monitored')}
                        </button>
                        <button type="button" className="button button-quiet" onClick={() => void act(`items/${i.id}/search`, tr('Searching for {title}.', { title: i.title }))}>
                          {tr('Search')}
                        </button>
                      </>
                    )
                  }
                >
                  <a className="lib-title" href={i.url} target="_blank" rel="noreferrer">
                    {i.title}
                    {i.year ? <span className="lib-year"> {i.year}</span> : null}
                  </a>
                  <div className="dlp-meta">
                    <span className={short && i.monitored ? 'warn-text' : undefined}>{onDisk(i)}</span>
                    {i.size > 0 && <span>{size(i.size)}</span>}
                    {status[i.status] && <span>{status[i.status]}</span>}
                    {i.by && <span>{i.by}</span>}
                  </div>
                </Row>
              );
            })}
          </ul>
          {shown.length > more && (
            <button type="button" className="button button-quiet lib-more" onClick={() => setMore((m) => m + PAGE)}>
              {tr('Show {n} more', { n: Math.min(PAGE, shown.length - more) })}
            </button>
          )}
        </>
      )}
    </>
  );
}

function Wanted({ app, shows, ro, act }: { app: ArrApp; shows: boolean; ro: boolean; act: Act }) {
  const { data, err } = useList<WantedList>(`/api/library/${app}/wanted`);
  return (
    <>
      {data && data.total > 0 && (
        <div className="lib-filter">
          <span className="lib-total">
            {shows ? tr('{n} episodes missing', { n: data.total }) : tr('{n} films missing', { n: data.total })}
            {data.total > data.items.length ? `, ${tr('newest {n} here', { n: data.items.length })}` : ''}
          </span>
          {!ro && (
            <button type="button" className="button" onClick={() => void act('search-all', shows ? tr('Searching for every missing episode.') : tr('Searching for every missing film.'))}>
              {tr('Search for all')}
            </button>
          )}
        </div>
      )}
      {err && <p className="crit-text">{err}</p>}
      {!data ? (
        !err && <div className="dlp-loading" aria-busy="true" />
      ) : data.items.length === 0 ? (
        <Empty>{shows ? tr('Every monitored episode is on disk.') : tr('Every monitored film is on disk.')}</Empty>
      ) : (
        <ul className="lib-list">
          {data.items.map((w) => (
            <Row
              key={w.id}
              art={w.art}
              title={w.title}
              actions={
                !ro && (
                  <button type="button" className="button button-quiet" onClick={() => void act(`wanted/${w.id}/search`, tr('Searching for {title}.', { title: `${w.title} ${w.subtitle ?? ''}`.trim() }))}>
                    {tr('Search')}
                  </button>
                )
              }
            >
              <span className="lib-title">
                {w.title}
                {w.subtitle && <span className="lib-year"> {w.subtitle}</span>}
              </span>
              {w.when && <div className="dlp-meta">{shows ? tr('aired {when}', { when: agoLong(w.when) }) : tr('out {when}', { when: agoLong(w.when) })}</div>}
            </Row>
          ))}
        </ul>
      )}
    </>
  );
}

function Queue({ app, ro, act }: { app: ArrApp; ro: boolean; act: Act }) {
  const { data, err, reload } = useList<ArrQueueItem[]>(`/api/library/${app}/queue`, QUEUE_EVERY_MS);
  return (
    <>
      {err && <p className="crit-text">{err}</p>}
      {!data ? (
        !err && <div className="dlp-loading" aria-busy="true" />
      ) : data.length === 0 ? (
        <Empty>{tr('Nothing in the queue.')}</Empty>
      ) : (
        <ul className="dlp-list">
          {data.map((q) => {
            const stuck = q.state === 'failed' || q.state === 'warning';
            return (
              <li key={q.id} className={`dlp-row is-${q.state}`}>
                <div className="dlp-head">
                  <span className="dlp-name" title={q.title}>
                    {breakable(q.title)}
                  </span>
                  <span className={`dlp-how ${q.state === 'failed' ? 'crit-text' : q.state === 'warning' ? 'warn-text' : ''}`}>{tr(QUEUE_STATE[q.state])}</span>
                </div>
                {q.progress < 1 && <Meter value={q.progress * 100} level={q.state === 'failed' ? 'crit' : q.state === 'warning' ? 'warn' : 'ok'} label={tr('{name}, {pct}%', { name: q.title, pct: Math.round(q.progress * 100) })} />}
                <div className="dlp-foot">
                  <div className="dlp-info">{q.message && <p className={`dlp-error ${stuck ? 'warn-text' : ''}`}>{q.message}</p>}</div>
                  {!ro && (
                    <div className="dlp-actions">
                      <HoldButton className="text-button" label={tr('Try another release of {name}', { name: q.title })} hint={tr('Hold to blocklist this release and search for another.')} onConfirm={() => void act(`queue/${q.id}/retry`, tr('Looking for another release of {name}.', { name: q.title }), undefined, reload)}>
                        {tr('Try another')}
                      </HoldButton>
                      <HoldButton className="text-button" danger label={tr('Remove {name}', { name: q.title })} hint={tr('Hold to remove it from the queue and the download client.')} onConfirm={() => void act(`queue/${q.id}/remove`, tr('Removed {name}.', { name: q.title }), undefined, reload)}>
                        {tr('Remove')}
                      </HoldButton>
                    </div>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </>
  );
}

function Add({ app, shows, onAdded }: { app: ArrApp; shows: boolean; onAdded: (title: string) => void }) {
  const [term, setTerm] = useState('');
  const [found, setFound] = useState<FoundItem[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [open, setOpen] = useState<number | null>(null);
  const { data: options, err: optionsErr } = useList<ArrOptions>(`/api/library/${app}/options`);

  useEffect(() => {
    setFound(null);
    setOpen(null);
  }, [app]);

  async function find(e: React.FormEvent) {
    e.preventDefault();
    if (!term.trim()) return;
    setBusy(true);
    setErr('');
    setOpen(null);
    try {
      setFound(await call<FoundItem[]>(`/api/library/${app}/find?q=${encodeURIComponent(term.trim())}`));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <form className="dlp-add lib-find" onSubmit={(e) => void find(e)}>
        <input className="field" type="search" value={term} onChange={(e) => setTerm(e.target.value)} placeholder={shows ? tr('Find a show by name') : tr('Find a film by name')} aria-label={shows ? tr('Show name') : tr('Film name')} autoComplete="off" />
        <button type="submit" className="button" disabled={busy || !term.trim()}>
          {busy ? tr('Finding') : tr('Find')}
        </button>
      </form>
      {(err || optionsErr) && <p className="crit-text">{err || optionsErr}</p>}
      {found &&
        (found.length === 0 ? (
          <Empty>{tr('Nothing by that name.')}</Empty>
        ) : (
          <ul className="lib-list">
            {found.map((f) => (
              <Row
                key={f.key}
                art={f.art}
                title={f.title}
                actions={
                  f.have ? (
                    <span className="lib-have">{tr('In your library')}</span>
                  ) : open !== f.key ? (
                    <button type="button" className="button button-quiet" onClick={() => setOpen(f.key)}>
                      {tr('Add')}
                    </button>
                  ) : null
                }
              >
                <span className="lib-title">
                  {f.title}
                  {f.year ? <span className="lib-year"> {f.year}</span> : null}
                </span>
                <div className="dlp-meta">
                  {f.by && <span>{f.by}</span>}
                  {f.seasons ? <span>{f.seasons === 1 ? tr('1 season') : tr('{n} seasons', { n: f.seasons })}</span> : null}
                </div>
                {f.overview && <p className="lib-overview">{f.overview}</p>}
                {open === f.key && options && (
                  <AddForm
                    app={app}
                    item={f}
                    options={options}
                    onCancel={() => setOpen(null)}
                    onAdded={() => {
                      setFound((list) => list?.map((x) => (x.key === f.key ? { ...x, have: true } : x)) ?? null);
                      setOpen(null);
                      onAdded(f.title);
                    }}
                  />
                )}
              </Row>
            ))}
          </ul>
        ))}
    </>
  );
}

function AddForm({ app, item, options, onCancel, onAdded }: { app: ArrApp; item: FoundItem; options: ArrOptions; onCancel: () => void; onAdded: () => void }) {
  const [profile, setProfile] = useState(options.profiles[0]?.id ?? 0);
  const [folder, setFolder] = useState(options.folders[0]?.path ?? '');
  const [search, setSearch] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  if (!options.profiles.length || !options.folders.length)
    return <p className="crit-text">{app === 'sonarr' ? tr('Sonarr needs a quality profile and a root folder first.') : tr('Radarr needs a quality profile and a root folder first.')}</p>;

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await call(`/api/library/${app}/add`, { method: 'POST', headers: ACTION, body: JSON.stringify({ key: item.key, profile, folder, search }) });
      onAdded();
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  }

  return (
    <form className="lib-add" onSubmit={(e) => void add(e)}>
      <label>
        <span>{tr('Quality')}</span>
        <select className="field" value={profile} onChange={(e) => setProfile(Number(e.target.value))}>
          {options.profiles.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
      </label>
      <label>
        <span>{tr('Folder')}</span>
        <select className="field" value={folder} onChange={(e) => setFolder(e.target.value)}>
          {options.folders.map((f) => (
            <option key={f.path} value={f.path}>
              {f.free !== undefined ? tr('{path} ({free} free)', { path: f.path, free: size(f.free) }) : f.path}
            </option>
          ))}
        </select>
      </label>
      <label className="lib-check">
        <input type="checkbox" checked={search} onChange={(e) => setSearch(e.target.checked)} />
        <span>{tr('Search for it now')}</span>
      </label>
      <div className="lib-add-go">
        <button type="submit" className="button" disabled={busy}>
          {busy ? tr('Adding') : tr('Add {title}', { title: item.title })}
        </button>
        <button type="button" className="text-button" onClick={onCancel}>
          {tr('Cancel')}
        </button>
      </div>
      {err && (
        <p className="crit-text" role="alert">
          {err}
        </p>
      )}
    </form>
  );
}
