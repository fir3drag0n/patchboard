// The parts of an app's sheet that join the app to what it feeds: its
// connection, set up right here with the same form Settings uses, and where
// its data shows up, with a way to put a widget on Home. One place per app,
// so nobody has to remember that Sonarr's tile, its key and its widgets live
// in three different screens.

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { HOME_ID, type Board, WIDGET_INFO, type WidgetType } from '../../shared/board.ts';
import { feedsOf, sourceOf } from '../../shared/feeds.ts';
import { INTEGRATIONS, type Integration } from '../../shared/integrations.ts';
import type { SetupIntegration } from '../../shared/setup.ts';
import type { Service, Snapshot } from '../../shared/types.ts';
import { integrationOf, isConnected } from '../lib/connect.ts';
import { t } from '../lib/i18n.ts';
import { useStore } from '../lib/store.tsx';
import { IntegrationForm } from './IntegrationSetup.tsx';

const ACTION = { 'Content-Type': 'application/json', 'X-Patchboard': 'action' };

const PAGE_NAMES: Record<string, string> = {
  '/downloads': 'Downloads',
  '/library': 'Library',
  '/requests': 'Requests',
  '/media': 'Media',
  '/blocking': 'Ad blocking',
};

type Setup = { integrations: SetupIntegration[]; demo: boolean };

/** Integrations that stand in for one another: a Plex tile is Tautulli's, or Plex's own when that's the one set up. */
const STAND_INS: Record<string, string[]> = { tautulli: ['plex'] };

/** The integration to show: the app's own, unless only a stand-in has its fields filled in. */
function chosen(integration: Integration, setup: Setup | null): Integration {
  const filled = (id: string) => !!setup?.integrations.find((x) => x.id === id)?.fields.some((f) => f.required && f.set);
  if (filled(integration.id)) return integration;
  const alt = (STAND_INS[integration.id] ?? []).find(filled);
  return (alt && INTEGRATIONS.find((i) => i.id === alt)) || integration;
}

/** The integration behind this app, with its setup, once Settings can set it up. */
function useAppIntegration(app: Service): { integration?: Integration; setup: Setup | null; setSetup: (s: Setup) => void } {
  const own = integrationOf(app);
  const [setup, setSetup] = useState<Setup | null>(null);
  const integration = own && chosen(own, setup);
  useEffect(() => {
    if (!own) return;
    let gone = false;
    void fetch('/api/setup/integrations')
      .then((r) => r.json() as Promise<Setup>)
      .then((s) => !gone && setSetup(s))
      .catch(() => {});
    return () => {
      gone = true;
    };
  }, [own?.id]);
  return { integration, setup, setSetup };
}

/** Connected, can't be reached, or not set up, with the form one press away. */
export function AppConnection({ app, startOpen = false, onChange }: { app: Service; startOpen?: boolean; onChange: () => void }) {
  const { snap } = useStore();
  const { integration, setup, setSetup } = useAppIntegration(app);
  const [open, setOpen] = useState(startOpen);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const su = integration && setup?.integrations.find((x) => x.id === integration.id);
  if (!integration || !snap || !setup || !su) return null;
  const on = isConnected(snap, integration);
  const src = snap.sources[sourceOf(integration.id) as keyof Snapshot['sources']];
  const failing = on && src && !src.ok;
  return (
    <div className="ws-row app-conn">
      <span id="app-conn-label">{t('Connection')}</span>
      <p className="app-conn-state" aria-labelledby="app-conn-label">
        <span className={failing ? 'warn-text' : on ? '' : 'muted'}>{failing ? (src.error ?? t('Not reachable')) : on ? t('Connected') : t('Not connected')}</span>{' '}
        <button type="button" className="text-button" aria-expanded={open} onClick={() => setOpen(!open)}>
          {on ? t('Edit') : t('Connect')}
        </button>
      </p>
      {!on && !open && <p className="settings-note">{t(integration.adds)}</p>}
      {open && (
        <div className="integration-form">
          <IntegrationForm
            integration={integration}
            setup={su}
            demo={setup.demo}
            readOnly={!!snap.readOnly}
            onSaved={(all) => (setSetup({ ...setup, integrations: all }), onChange())}
            onClose={() => (setOpen(false), setResult(null))}
            result={result}
            setResult={setResult}
          />
        </div>
      )}
    </div>
  );
}

/** Where this app's data shows: widgets (on Home, or one press to add) and the pages it brings. */
export function ShowsUpIn({ app }: { app: Service }) {
  const { snap } = useStore();
  const integration = integrationOf(app);
  const [home, setHome] = useState<Board | null>(null);
  const [adding, setAdding] = useState<WidgetType | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (!integration) return;
    void fetch(`/api/boards/${HOME_ID}`)
      .then((r) => r.json() as Promise<{ board: Board }>)
      .then((b) => setHome(b.board))
      .catch(() => {});
  }, [integration?.id]);
  if (!integration || !snap) return null;
  const { widgets, pages } = feedsOf(integration.id);
  if (!widgets.length && !pages.length) return null;
  const on = isConnected(snap, integration);
  const onHome = (w: WidgetType) => !!home?.widgets.some((x) => x.type === w);

  const add = async (w: WidgetType) => {
    if (!home) return;
    setAdding(w);
    setErr('');
    const ids = new Set(home.widgets.map((x) => x.id));
    let id: string = w;
    for (let n = 2; ids.has(id); n++) id = `${w}-${n}`;
    const board = { ...home, widgets: [...home.widgets, { id, type: w, size: WIDGET_INFO[w].size }] };
    const res = await fetch(`/api/boards/${HOME_ID}`, { method: 'PUT', headers: ACTION, body: JSON.stringify(board) });
    const body = (await res.json().catch(() => ({}))) as { board?: Board; error?: string };
    setAdding(null);
    if (!res.ok) return setErr(body.error ?? `HTTP ${res.status}`);
    setHome(body.board ?? board);
  };

  return (
    <div className="ws-row app-feeds">
      <span id="app-feeds-label">{on ? t('Shows up in') : t('Once connected, it shows up in')}</span>
      <ul className="app-feeds-list" aria-labelledby="app-feeds-label">
        {widgets.map((w) => (
          <li key={w}>
            <span>{t(WIDGET_INFO[w].name)}</span>
            {onHome(w) ? (
              <span className="app-feeds-state">{t('On Home')}</span>
            ) : (
              on &&
              !snap.readOnly && (
                <button type="button" className="text-button" disabled={!home || adding !== null} onClick={() => void add(w)}>
                  {adding === w ? t('Adding...') : t('Add to Home')}
                </button>
              )
            )}
          </li>
        ))}
        {pages.map((p) => (
          <li key={p}>
            {on ? <Link to={p}>{t(PAGE_NAMES[p] ?? p)}</Link> : <span>{t(PAGE_NAMES[p] ?? p)}</span>}
            <span className="app-feeds-state">{t('Page')}</span>
          </li>
        ))}
      </ul>
      {err && (
        <span className="crit-text" role="alert">
          {err}
        </span>
      )}
    </div>
  );
}
