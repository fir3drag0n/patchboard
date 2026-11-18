// Services with no tile of their own: Weather, a calendar, Trakt, Docker
// hosts, and any connected app nobody has put on Apps yet. They list under
// Also connected and open the same sheet a tile does: the connection, set up
// in place, and everything it shows up in. Nothing is saved for them; the
// list follows what's connected.

import { sourceOf } from '../../shared/feeds.ts';
import { CATEGORIES, INTEGRATIONS, type Integration } from '../../shared/integrations.ts';
import { UI_SETUP } from '../../shared/setup.ts';
import type { Snapshot } from '../../shared/types.ts';
import { iconFor, integrationOf, isConnected } from '../lib/connect.ts';
import { t } from '../lib/i18n.ts';
import { useModal } from '../lib/modal.ts';
import { AppConnection, PrinterHint, ShowsUpIn } from './AppSheet.tsx';
import { Icon, Section } from './ui.tsx';

/** Ways to be told about trouble, not apps: they belong with Alerts. */
const NOT_APPS = new Set(CATEGORIES.find(([name]) => name === 'Notifications')?.[1] ?? []);

/** An integration Apps can hold: set up from the UI, and not a notification channel. */
export const appLike = (i: Integration): boolean => UI_SETUP.has(i.id) && !NOT_APPS.has(i.id);

/** Connected integrations no tile stands for. */
export function untiled(snap: Snapshot): Integration[] {
  const covered = new Set(
    snap.catalog.groups
      .flatMap((g) => g.services)
      .map((s) => integrationOf(s)?.id)
      .filter((id): id is string => !!id)
      .map(sourceOf),
  );
  return INTEGRATIONS.filter((i) => appLike(i) && isConnected(snap, i) && !covered.has(sourceOf(i.id))).sort((a, b) => a.name.localeCompare(b.name));
}

export function AlsoConnected({ snap, onOpen }: { snap: Snapshot; onOpen: (id: string) => void }) {
  const list = untiled(snap);
  if (!list.length) return null;
  return (
    <Section title="Also connected" count={String(list.length)}>
      <ul className="tile-grid">
        {list.map((i) => {
          const src = snap.sources[sourceOf(i.id) as keyof Snapshot['sources']];
          const failing = !!src && !src.ok;
          return (
            <li className="tile" data-tone={failing ? 'warn' : 'none'} key={i.id}>
              <button type="button" className="tile-main" onClick={() => onOpen(i.id)}>
                <span className="tile-icon">
                  <Icon name={i.name} icon={iconFor(i)} size={24} />
                </span>
                <span className="tile-name">{i.name}</span>
                {/* Healthy stays quiet; only trouble says anything. */}
                {failing && <span className="tile-stat">{t('Not reachable')}</span>}
              </button>
            </li>
          );
        })}
      </ul>
    </Section>
  );
}

/** One service's sheet: what it adds, its connection, and where it shows up. */
export function ServiceSheet({ id, connect, feeds = true, onSaved, onClose }: { id: string; connect: boolean; /** Where it shows up; off over a board being arranged, whose own add does that. */ feeds?: boolean; onSaved?: () => void; onClose: () => void }) {
  const modal = useModal<HTMLDivElement>(onClose);
  const integration = INTEGRATIONS.find((i) => i.id === id);
  if (!integration) return null;
  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="palette drawer widget-settings" ref={modal} role="dialog" aria-label={integration.name} onClick={(e) => e.stopPropagation()}>
        <header className="drawer-head">
          <h2>{integration.name}</h2>
          <button type="button" className="text-button" onClick={onClose}>
            {t('Close')}
          </button>
        </header>
        <p className="settings-note">{t(integration.adds)}</p>
        <div className="ws-form">
          <AppConnection integration={integration} startOpen={connect} about={false} onChange={() => onSaved?.()} />
          {feeds ? <ShowsUpIn integration={integration} /> : integration.id === 'homeassistant' && <PrinterHint />}
        </div>
      </div>
    </div>
  );
}
