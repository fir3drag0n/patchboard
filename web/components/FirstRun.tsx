// First run: one sheet, every field filled in already, so "Open Patchboard"
// works the moment it appears. The name and icon, the place and the apps are
// for everyone; language, clock, units and region are this browser's, taken
// from the browser itself and shown so they can be changed.

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { CatalogAudit } from '../../shared/types.ts';
import { setAppearance, useAppearance } from '../lib/appearance.ts';
import { adoptAll, saveLayout } from '../lib/adopt.ts';
import { LANGUAGES, lang, t as tr, tn } from '../lib/i18n.ts';
import { useModal } from '../lib/modal.ts';
import { locale, REGIONS } from '../lib/region.ts';
import { useStore } from '../lib/store.tsx';
import { uploadAppIcon } from './AppIcon.tsx';
import { Icon } from './ui.tsx';

const ACTION = { 'Content-Type': 'application/json', 'X-Patchboard': 'action' };

interface Place {
  name: string;
  area: string;
  lat: number;
  lon: number;
}

const post = async (url: string, method: string, body: unknown): Promise<string | null> => {
  const res = await fetch(url, { method, headers: ACTION, body: JSON.stringify(body) }).catch(() => null);
  if (!res) return tr("Can't reach Patchboard.");
  return res.ok ? null : (((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`);
};

/** The town search: type, pick one. */
function PlacePicker({ place, onPlace }: { place: Place | null; onPlace: (p: Place | null) => void }) {
  const [q, setQ] = useState('');
  const [found, setFound] = useState<Place[]>([]);
  const [err, setErr] = useState('');
  useEffect(() => {
    if (place || q.trim().length < 2) return setFound([]);
    const timer = setTimeout(async () => {
      const res = await fetch(`/api/places?q=${encodeURIComponent(q)}&lang=${lang()}`).catch(() => null);
      const body = (await res?.json().catch(() => null)) as { places?: Place[]; error?: string } | null;
      setErr(body?.error ?? '');
      setFound(body?.places ?? []);
    }, 300);
    return () => clearTimeout(timer);
  }, [q, place]);
  if (place)
    return (
      <div className="fr-place-picked">
        <span>
          {place.name}
          <small>{place.area}</small>
        </span>
        <button type="button" className="text-button" aria-label={tr('Change place')} onClick={() => (onPlace(null), setQ(''))}>
          {tr('Change')}
        </button>
      </div>
    );
  return (
    <div className="fr-place">
      <input className="field" type="search" value={q} placeholder={tr('Town or city')} aria-label={tr('Where is it?')} onChange={(e) => setQ(e.target.value)} autoComplete="off" />
      {found.length > 0 && (
        <ul className="fr-places" role="listbox" aria-label={tr('Places')}>
          {found.map((p) => (
            <li key={`${p.lat},${p.lon}`}>
              <button type="button" onClick={() => onPlace(p)}>
                {p.name}
                <small>{p.area}</small>
              </button>
            </li>
          ))}
        </ul>
      )}
      {err && <p className="crit-text">{err}</p>}
    </div>
  );
}

export function FirstRun({ onDone }: { onDone: () => void }) {
  const { snap } = useStore();
  const a = useAppearance();
  const startLang = useRef(a.lang);
  const close = () => onDone();
  const modal = useModal<HTMLDivElement>(close);
  // After the dialog's own focus: the title, so a phone doesn't open its keyboard and a screen reader starts here.
  const title = useRef<HTMLHeadingElement>(null);
  useLayoutEffect(() => title.current?.focus(), []);

  const [name, setName] = useState(snap?.brand?.name ?? '');
  const [iconBusy, setIconBusy] = useState(false);
  const [place, setPlace] = useState<Place | null>(null);
  const [changing, setChanging] = useState(false);
  const [password, setPassword] = useState('');
  const [auth, setAuth] = useState<{ mode: string; locked?: boolean } | null>(null);
  const [audit, setAudit] = useState<CatalogAudit | null>(null);
  const [skip, setSkip] = useState<Set<string>>(new Set());
  const [review, setReview] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<{ field: string; text: string } | null>(null);
  const restore = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void fetch('/api/auth/settings')
      .then((r) => (r.ok ? r.json() : null))
      .then(setAuth)
      .catch(() => {});
    void fetch('/api/catalog/audit')
      .then((r) => (r.ok ? r.json() : null))
      .then(setAudit)
      .catch(() => {});
  }, []);

  const found = audit?.discovered ?? [];
  const chosen = found.filter((d) => !skip.has(d.container));
  const dockerOk = !!snap?.sources.docker?.ok;
  const askPassword = auth?.mode === 'none' && !auth.locked && !snap?.demo;
  const own = snap?.brand?.icon;
  const langName = LANGUAGES.find(([c]) => c === (a.lang || lang()))?.[1] ?? 'English';
  // The country, in this page's language: the line already names the language.
  const regionName = (() => {
    try {
      const region = new Intl.Locale(locale()).maximize().region;
      return (region && new Intl.DisplayNames([lang()], { type: 'region' }).of(region)) || locale();
    } catch {
      return locale();
    }
  })();

  const finish = async () => {
    setErr(null);
    if (password && password.length < 8) return setErr({ field: 'password', text: tr('Use at least 8 characters.') });
    setBusy(true);
    const fail = (field: string, text: string) => (setErr({ field, text }), setBusy(false));
    if (name.trim() !== (snap?.brand?.name ?? '')) {
      const e = await post('/api/brand', 'PUT', { name: name.trim() });
      if (e) return fail('name', e);
    }
    if (place && !snap?.demo) {
      const e = await post('/api/setup/integrations/weather', 'PUT', { values: { WEATHER_LAT: String(place.lat), WEATHER_LON: String(place.lon), WEATHER_LABEL: place.name } });
      if (e) return fail('place', e);
    }
    if (chosen.length && !snap?.demo) {
      const existing = await fetch('/api/app-order')
        .then((r) => r.json())
        .catch(() => null);
      const e = await saveLayout(adoptAll(chosen, existing));
      if (e) return fail('apps', e);
    }
    if (password && askPassword) {
      const e = await post('/api/auth/settings', 'PUT', { mode: 'password', password });
      if (e) return fail('password', e);
    }
    await post('/api/first-run/done', 'POST', {});
    // A new language shows everywhere once the page draws again.
    if (a.lang !== startLang.current) location.reload();
    else onDone();
  };

  const pickIcon = async (input: HTMLInputElement) => {
    const file = input.files?.[0];
    if (!file) return;
    setIconBusy(true);
    const e = await uploadAppIcon(file).catch((x: Error) => x.message);
    setIconBusy(false);
    input.value = '';
    if (e) setErr({ field: 'name', text: e });
  };

  const restoreFile = async (input: HTMLInputElement) => {
    const file = input.files?.[0];
    if (!file) return;
    const res = await fetch('/api/setup', { method: 'PUT', headers: { 'X-Patchboard': 'action', 'Content-Type': 'text/plain' }, body: await file.text() });
    if (!res.ok) return setErr({ field: 'restore', text: (((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`) });
    await post('/api/first-run/done', 'POST', {});
    location.reload();
  };

  const note = (field: string) =>
    err?.field === field && (
      <p className="crit-text" role="alert">
        {err.text}
      </p>
    );

  return (
    <div className="fr-backdrop">
      <div className="fr-sheet" ref={modal} role="dialog" aria-modal="true" aria-labelledby="fr-title">
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) void finish();
          }}
        >
          <h2 id="fr-title" tabIndex={-1} ref={title}>
            {tr('Set up Patchboard')}
          </h2>

          <div className="fr-row fr-ident">
            <label className={`fr-icon ${iconBusy ? 'is-busy' : ''}`} title={tr('Upload your own icon')}>
              <img src={own ? `/icon-192.png?v=${own}` : '/icon-192.png'} alt="" width={52} height={52} />
              <span className="sr-only">{tr('Upload your own icon')}</span>
              <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif" className="sr-only" disabled={iconBusy || !!snap?.demo} onChange={(e) => void pickIcon(e.currentTarget)} />
            </label>
            <label className="fr-field">
              <span>{tr('Name')}</span>
              <input className="field" value={name} maxLength={40} placeholder="Patchboard" autoComplete="off" onChange={(e) => setName(e.target.value)} />
            </label>
          </div>
          {note('name')}

          <div className="fr-row">
            <span className="fr-label">{tr('Where is it?')}</span>
            <PlacePicker place={place} onPlace={setPlace} />
          </div>
          {note('place')}

          <div className="fr-row fr-local">
            <span>
              {[langName, a.clock24 ? tr('24-hour') : tr('12-hour'), a.temp === 'c' ? '°C' : a.temp === 'f' ? '°F' : '°C °F', regionName].join(' · ')}
            </span>
            <button type="button" className="text-button" aria-expanded={changing} aria-label={changing ? undefined : tr('Change language and units')} onClick={() => setChanging(!changing)}>
              {changing ? tr('Done') : tr('Change')}
            </button>
          </div>
          {changing && (
            <div className="fr-local-edit">
              <label>
                <span>{tr('Language')}</span>
                <select className="field" value={a.lang} onChange={(e) => setAppearance({ lang: e.target.value })}>
                  <option value="">{tr('Match this browser')}</option>
                  {LANGUAGES.map(([code, n]) => (
                    <option key={code} value={code}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>{tr('Dates and numbers')}</span>
                <select className="field" value={a.locale} onChange={(e) => setAppearance({ locale: e.target.value })}>
                  <option value="">{tr('Match this browser')}</option>
                  {REGIONS.map(([tag, n]) => (
                    <option key={tag} value={tag}>
                      {n}
                    </option>
                  ))}
                </select>
              </label>
              <div className="seg" role="group" aria-label={tr('Time format')}>
                {([[false, '12-hour'], [true, '24-hour']] as const).map(([v, l]) => (
                  <button key={l} type="button" aria-pressed={a.clock24 === v} onClick={() => setAppearance({ clock24: v })}>
                    {tr(l)}
                  </button>
                ))}
              </div>
              <div className="seg" role="group" aria-label={tr('Temperature units')}>
                {([['f', '°F'], ['c', '°C']] as const).map(([v, l]) => (
                  <button key={v} type="button" aria-pressed={a.temp === v} onClick={() => setAppearance({ temp: v })}>
                    {l}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="fr-row fr-apps">
            {!dockerOk ? (
              <span className="fr-muted">{tr("Patchboard can't see Docker, so it can't find your apps. Add them later in Apps.")}</span>
            ) : !audit ? (
              <span className="fr-muted">{tr('Looking for your apps...')}</span>
            ) : !found.length ? (
              <span className="fr-muted">{tr('No apps found yet. Add them later in Apps.')}</span>
            ) : (
              <>
                <label className="check">
                  <input
                    type="checkbox"
                    checked={chosen.length > 0}
                    ref={(el) => {
                      if (el) el.indeterminate = chosen.length > 0 && chosen.length < found.length;
                    }}
                    onChange={(e) => setSkip(e.target.checked ? new Set() : new Set(found.map((d) => d.container)))}
                  />
                  {chosen.length === found.length || !chosen.length
                    ? tn(found.length, 'Add the app it found', 'Add all {n} apps it found')
                    : tr('Add {n} of {all} apps it found', { n: chosen.length, all: found.length })}
                </label>
                <button type="button" className="text-button" aria-expanded={review} onClick={() => setReview(!review)}>
                  {review ? tr('Done') : tr('Review')}
                </button>
              </>
            )}
          </div>
          {review && found.length > 0 && (
            <ul className="fr-app-list">
              {found.map((d) => (
                <li key={d.container}>
                  <label className="check">
                    <input type="checkbox" checked={!skip.has(d.container)} onChange={() => setSkip((s) => { const n = new Set(s); if (n.has(d.container)) n.delete(d.container); else n.add(d.container); return n; })} />
                    <Icon name={d.name} icon={d.icon} size={20} />
                    {d.name}
                  </label>
                </li>
              ))}
            </ul>
          )}
          {note('apps')}

          {askPassword && (
            <label className="fr-row fr-field">
              <span>{tr('Password')}</span>
              <input className="field" type="password" value={password} placeholder={tr('Optional')} autoComplete="new-password" onChange={(e) => setPassword(e.target.value)} />
            </label>
          )}
          {note('password')}

          <div className="fr-actions">
            <button type="button" className="text-button" onClick={() => restore.current?.click()} disabled={!!snap?.demo}>
              {tr('Restore a setup file')}
            </button>
            <input ref={restore} type="file" accept="application/json,.json,.yaml,.yml" hidden onChange={(e) => void restoreFile(e.currentTarget)} />
            <button type="submit" className="button board-save" aria-disabled={busy || undefined}>
              {busy ? tr('Setting up...') : tr('Open Patchboard')}
            </button>
          </div>
          {note('restore')}
        </form>
      </div>
    </div>
  );
}
