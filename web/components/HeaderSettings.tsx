// What Home's header shows on this device: status, server details, time and
// weather, their sizes and the forecast view. The same controls in Settings,
// Home and in a panel over the board, so the header changes where you see it.

import { type Appearance, setAppearance, useAppearance } from '../lib/appearance.ts';
import { msg, t as tr } from '../lib/i18n.ts';
import { useModal } from '../lib/modal.ts';

const LABELS: Partial<Record<keyof Appearance, string>> = { homeStatusSize: msg('Status size'), homeClockSize: msg('Clock size'), homeWeather: msg('Weather view') };

export function HeaderSettings() {
  const a = useAppearance();
  const seg = <K extends keyof Appearance>(key: K, options: [Appearance[K], string][], disabled = false) => (
    <div className="seg" role="group" aria-label={tr(LABELS[key] ?? '')}>
      {options.map(([v, label]) => (
        <button key={String(v)} type="button" disabled={disabled} aria-pressed={a[key] === v} onClick={() => setAppearance({ [key]: v } as Partial<Appearance>)}>
          {tr(label)}
        </button>
      ))}
    </div>
  );
  return (
    <>
      <div className="header-switches">
        <label className="check"><input type="checkbox" checked={a.homeStatusSize !== 'hidden'} onChange={(e) => setAppearance({ homeStatusSize: e.target.checked ? 'medium' : 'hidden' })} />{tr('Show status')}</label>
        <label className="check"><input type="checkbox" checked={a.homeServer !== 'hidden'} onChange={(e) => setAppearance({ homeServer: e.target.checked ? 'card' : 'hidden' })} />{tr('Show server details')}</label>
        <label className="check"><input type="checkbox" checked={a.homeClockSize !== 'hidden'} onChange={(e) => setAppearance({ homeClockSize: e.target.checked ? 'small' : 'hidden' })} />{tr('Show time and date')}</label>
        <label className="check"><input type="checkbox" checked={a.homeWeather !== 'hidden'} onChange={(e) => setAppearance({ homeWeather: e.target.checked ? 'current' : 'hidden' })} />{tr('Show weather')}</label>
      </div>
      <p className="settings-note">{tr('With status off, Needs attention moves onto the board.')}</p>
      <details className="header-options-details">
        <summary>{tr('Sizes and forecast details')}</summary>
        <div className="header-options">
          <div><span>{tr('Status size')}</span>{seg('homeStatusSize', [['small', msg('Small')], ['medium', msg('Medium')], ['large', msg('Large')]], a.homeStatusSize === 'hidden')}</div>
          <div><span>{tr('Clock size')}</span>{seg('homeClockSize', [['small', msg('Small')], ['medium', msg('Medium')], ['large', msg('Large')]], a.homeClockSize === 'hidden')}</div>
          <div><span>{tr('Weather view')}</span>{seg('homeWeather', [['current', msg('Current')], ['summary', msg('Forecast')], ['hourly', msg('Hourly chart')]], a.homeWeather === 'hidden')}</div>
        </div>
      </details>
      <button type="button" className="button button-quiet" onClick={() => setAppearance({ homeStatusSize: 'medium', homeServer: 'card', homeWeather: 'current', homeClockSize: 'small' })}>{tr('Restore default header')}</button>
    </>
  );
}

/** The header's controls over the board: changes show behind the panel as you make them. */
export function HeaderPanel({ onClose }: { onClose: () => void }) {
  const modal = useModal<HTMLDivElement>(onClose);
  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="palette drawer header-panel" ref={modal} role="dialog" aria-label={tr('Edit header')} onClick={(e) => e.stopPropagation()}>
        <header className="drawer-head">
          <h2>{tr('Edit header')}</h2>
          <button type="button" className="text-button" onClick={onClose}>
            {tr('Done')}
          </button>
        </header>
        <p className="settings-note">{tr('This device only.')}</p>
        <HeaderSettings />
      </div>
    </div>
  );
}
