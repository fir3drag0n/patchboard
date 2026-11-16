// Media: Plex, Jellyfin and Emby. Who's watching, with Stop, and every
// library with Scan. Streams are the ones Home's Right now shows, so the two
// always agree; libraries are read from the servers while the page is open.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import type { MediaLibraries, MediaLibrary, Stream } from '../../shared/types.ts';
import { HoldButton } from '../components/Hold.tsx';
import { Empty, Meter, PosterRow as Row } from '../components/ui.tsx';
import { agoLong, duration } from '../lib/format.ts';
import { msg, t as tr } from '../lib/i18n.ts';
import { ACTION, call, useList } from '../lib/live-list.ts';
import { type MediaServer, useMediaServers } from '../lib/media.ts';
import { useStore } from '../lib/store.tsx';
import { useUrlChoice } from '../lib/url.ts';

type View = 'watching' | 'libraries';
const VIEWS: [View, string][] = [
  ['watching', msg('Watching')],
  ['libraries', msg('Libraries')],
];
// The Media page's server ids: Plex reports through Tautulli.
const SERVER_ID: Record<string, 'plex' | 'jellyfin' | 'emby'> = { tautulli: 'plex', jellyfin: 'jellyfin', emby: 'emby' };

export function Media() {
  const { snap } = useStore();
  const ro = !!snap?.readOnly;
  const { servers, configured } = useMediaServers();
  const [view, setView] = useUrlChoice<View>('view', VIEWS.map((v) => v[0]), 'watching');
  const [said, setSaid] = useState('');
  const [err, setErr] = useState('');

  useEffect(() => {
    setSaid('');
    setErr('');
  }, [view]);

  if (!snap) return <div className="page media-page" aria-busy="true" />;
  if (!configured)
    return (
      <div className="page media-page">
        <div className="page-head">
          <h1 className="page-title">{tr('Media')}</h1>
        </div>
        <Empty>
          {tr('Plex, Jellyfin and Emby are not set up.')} <Link to="/settings?tab=connections">{tr('Connect one')}</Link>
        </Empty>
      </div>
    );
  const streams = servers.flatMap((server) => server.data.streams.map((s) => ({ s, server })));

  return (
    <div className="page media-page">
      <div className="page-head">
        <h1 className="page-title">{tr('Media')}</h1>
      </div>
      <div className="page-toolbar">
        <div className="seg lib-views" role="group" aria-label={tr('Show')}>
          {VIEWS.map(([v, label]) => (
            <button key={v} type="button" aria-pressed={view === v} onClick={() => setView(v)}>
              {tr(label)}
              {v === 'watching' && streams.length > 0 && <span className="dlp-count">{streams.length}</span>}
            </button>
          ))}
        </div>
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
      {view === 'watching' && <Watching streams={streams} many={servers.length > 1} ro={ro} onSaid={setSaid} onErr={setErr} />}
      {view === 'libraries' && <Libraries ro={ro} onSaid={setSaid} onErr={setErr} />}
    </div>
  );
}

function Watching({ streams, many, ro, onSaid, onErr }: { streams: { s: Stream; server: MediaServer }[]; many: boolean; ro: boolean; onSaid: (s: string) => void; onErr: (s: string) => void }) {
  const [busy, setBusy] = useState('');
  if (!streams.length) return <Empty>{tr('Nobody is watching.')}</Empty>;

  async function stop(s: Stream, server: MediaServer) {
    setBusy(s.session!);
    onSaid('');
    onErr('');
    try {
      await call(`/api/media/${SERVER_ID[server.id]}/stop/${encodeURIComponent(s.session!)}`, { method: 'POST', headers: ACTION });
      onSaid(tr('Stopped {title} for {user}.', { title: s.title, user: s.user }));
    } catch (e) {
      onErr((e as Error).message);
    } finally {
      setBusy('');
    }
  }

  return (
    <ul className="lib-list">
      {streams.map(({ s, server }) => (
        <Row
          key={`${server.id}:${s.session ?? s.user + s.title}`}
          art={s.thumb}
          title={s.title}
          actions={
            !ro &&
            s.session && (
              <HoldButton className="text-button" danger disabled={busy === s.session} label={tr('Stop {title} for {user}', { title: s.title, user: s.user })} hint={tr('Hold to stop it. They see a note that you did.')} onConfirm={() => void stop(s, server)}>
                {tr('Stop')}
              </HoldButton>
            )
          }
        >
          <span className="lib-title">
            {s.title}
            {s.subtitle && <span className="lib-year"> {s.subtitle}</span>}
          </span>
          <div className="dlp-meta">
            <span>{s.user}</span>
            {s.device && <span>{s.device}</span>}
            {many && <span>{server.label}</span>}
            <span>{s.transcode ? tr('Transcoding') : tr('Direct play')}</span>
            {s.state !== 'playing' && <span>{s.state === 'paused' ? tr('Paused') : tr('Buffering')}</span>}
          </div>
          {s.progress >= 0 && (
            <div className="media-progress">
              <Meter value={s.progress} level="ok" label={tr('{title}, {pct}% played', { title: s.title, pct: Math.round(s.progress) })} />
              {s.durationSec != null && s.positionSec != null && <span className="lib-total">{tr('{left} left', { left: duration((s.durationSec - s.positionSec) * 1000) })}</span>}
            </div>
          )}
        </Row>
      ))}
    </ul>
  );
}

const KIND_COUNT: Record<MediaLibrary['kind'], string> = {
  movies: msg('{n} films'),
  shows: msg('{n} shows'),
  music: msg('{n} albums'),
  photos: msg('{n} items'),
  other: msg('{n} items'),
};

function Libraries({ ro, onSaid, onErr }: { ro: boolean; onSaid: (s: string) => void; onErr: (s: string) => void }) {
  const { data, err, reload } = useList<MediaLibraries>('/api/media/libraries');
  const scanning = data?.servers.some((s) => s.libraries.some((l) => l.scanning));
  // While a scan runs, look again every few seconds to see it finish.
  useEffect(() => {
    if (!scanning) return;
    const t = setTimeout(reload, 4000);
    return () => clearTimeout(t);
  }, [scanning, data, reload]);

  async function scan(l: MediaLibrary) {
    onSaid('');
    onErr('');
    try {
      await call(`/api/media/${l.server}/scan/${encodeURIComponent(l.id)}`, { method: 'POST', headers: ACTION });
      onSaid(tr('Scanning {name}.', { name: l.name }));
      setTimeout(reload, 800);
    } catch (e) {
      onErr((e as Error).message);
    }
  }

  if (err) return <p className="crit-text">{err}</p>;
  if (!data) return <div className="dlp-loading" aria-busy="true" />;
  return (
    <>
      {data.servers.map((server) => (
        <section key={server.id} className="media-server">
          {data.servers.length > 1 && <h2 className="media-server-name">{server.name}</h2>}
          {server.error && <p className="crit-text">{server.error}</p>}
          {!server.canScan && !ro && (
            <p className="lib-total">
              {tr('To scan from here, add Plex’s address and token.')} <Link to="/settings?tab=connections">{tr('Connections')}</Link>
            </p>
          )}
          {!server.error && server.libraries.length === 0 ? (
            <Empty>{tr('No libraries.')}</Empty>
          ) : (
            <ul className="lib-list">
              {server.libraries.map((l) => (
                <li key={l.id} className="lib-row no-art">
                  <div className="lib-body">
                    <span className="lib-title">{l.name}</span>
                    <div className="dlp-meta">
                      {l.count != null && <span>{tr(KIND_COUNT[l.kind], { n: l.count.toLocaleString() })}</span>}
                      {l.scanning ? <span className="media-scanning">{tr('Scanning')}</span> : l.scannedAt ? <span>{tr('scanned {when}', { when: agoLong(l.scannedAt) })}</span> : null}
                    </div>
                  </div>
                  {!ro && l.canScan && (
                    <div className="lib-actions">
                      <button type="button" className="button button-quiet" disabled={l.scanning} onClick={() => void scan(l)}>
                        {tr('Scan')}
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </>
  );
}
