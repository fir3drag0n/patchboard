// 3D printers, through Home Assistant's Bambu Lab integration: the print, how
// far along, when it's done, and the filament loaded. A failed print or a
// printer error says what's wrong and links to Home Assistant.

import type { HomeAssistantData, Printer, PrinterTemp } from '../../shared/types.ts';
import { useState } from 'react';
import { Meter, Section } from '../components/ui.tsx';
import { agoLong, clock } from '../lib/format.ts';
import { t } from '../lib/i18n.ts';
import { useSource, useStore } from '../lib/store.tsx';

/** The status in words, in the reader's language. */
const statusWords = (s: string): string =>
  ({
    running: t('Printing'),
    pause: t('Paused'),
    prepare: t('Getting ready'),
    slicing: t('Getting ready'),
    init: t('Getting ready'),
    finish: t('Print finished'),
    failed: t('Print failed'),
    offline: t('Offline'),
  })[s] ?? t('Idle');

/** Bambu's stage names read as words: heatbed_preheating, "Heatbed preheating". */
const stageWords = (s: string) => s.charAt(0).toUpperCase() + s.slice(1).replace(/_/g, ' ');

const left = (min: number) => {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h ? (m ? t('{h} h {m} min left', { h, m }) : t('{n} h left', { n: h })) : t('{n} min left', { n: m });
};

const heat = (label: string, v: PrinterTemp) => `${label} ${Math.round(v.now)}${v.target > 0 && Math.abs(v.target - v.now) > 2 ? ` → ${Math.round(v.target)}` : ''} ${v.unit}`;

/** The plate as the slicer drew it: square, and left out when there is none. */
function Cover({ src }: { src?: string }) {
  const [broken, setBroken] = useState(false);
  return src && !broken ? <img className="printer-cover" src={src} alt="" loading="lazy" onError={() => setBroken(true)} /> : null;
}

function OnePrinter({ p, many, haHref, now }: { p: Printer; many: boolean; haHref?: string; now: number }) {
  const working = ['running', 'pause', 'prepare', 'slicing', 'init'].includes(p.status);
  const word = statusWords(p.status);
  const trouble = p.error || p.status === 'failed';
  // A stage says more than "Printing" only while it isn't simply printing.
  const stage = working && p.stage && !['printing', 'idle'].includes(p.stage) ? stageWords(p.stage) : '';
  const heating = [p.nozzle, p.bed].some((v) => v && v.target > 0);
  // An idle printer keeps the last print's name and picture; they'd read as on the plate now.
  const last = p.status !== 'idle';
  return (
    <div className={`printer-one ${trouble ? 'is-trouble' : ''}`}>
      {last && <Cover src={p.cover} />}
      <div className="printer-body">
        {many && <h3 className="printer-name">{p.name}</h3>}
        {last && p.task && <p className="printer-task">{p.task}</p>}
        <p className="printer-state">
          {word}
          {stage && `, ${stage.toLowerCase()}`}
          {working && p.layer != null && p.layers ? ` · ${t('Layer {n} of {total}', { n: p.layer, total: p.layers })}` : ''}
          {!working && p.status !== 'idle' && p.since ? ` ${agoLong(p.since, now)}` : ''}
        </p>
        {working && p.progress != null && (
          <div className="printer-progress">
            <Meter label={t('{name} print progress', { name: p.name })} value={p.progress} level={p.status === 'pause' ? 'warn' : 'ok'} />
            <span className="printer-pct">{Math.round(p.progress)}%</span>
          </div>
        )}
        {working && p.minutesLeft != null && p.minutesLeft > 0 && (
          <p className="printer-time">
            {left(p.minutesLeft)} · {clock(now + p.minutesLeft * 60_000)}
          </p>
        )}
        {heating && (
          <p className="printer-heat">
            {[p.nozzle && heat(t('Nozzle'), p.nozzle), p.bed && heat(t('Bed'), p.bed)].filter(Boolean).join(' · ')}
          </p>
        )}
        {trouble && (
          <p className="printer-error">
            {p.errors?.[0] ?? t('The printer reports an error.')}
            {haHref && (
              <>
                {' '}
                <a href={haHref} target="_blank" rel="noreferrer">
                  {t('Open Home Assistant')}
                </a>
              </>
            )}
          </p>
        )}
        {p.trays && p.trays.length > 0 && (
          <ul className="printer-trays" aria-label={t('Filament')}>
            {p.trays.map((tray, i) => (
              <li key={i} className={tray.active ? 'is-active' : ''} title={tray.name} aria-current={tray.active || undefined}>
                <i style={tray.color ? { background: tray.color } : undefined} aria-hidden />
                <span className="sr-only">{tray.name}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

export function PrinterWidget({ now }: { now: number }) {
  const { state, data } = useSource<HomeAssistantData>('homeassistant');
  const snap = useStore().snap;
  const printers = data?.printers ?? [];
  if (!state || !printers.length) return null;
  const ha = snap?.catalog.groups.flatMap((g) => g.services).find((s) => s.name.toLowerCase() === 'home assistant')?.href;
  const haHref = ha && ha !== '#' ? ha : undefined;
  return (
    <Section title="3D printer" source={state} className="printer">
      {printers.map((p) => (
        <OnePrinter key={p.id} p={p} many={printers.length > 1} haHref={haHref} now={now} />
      ))}
    </Section>
  );
}
