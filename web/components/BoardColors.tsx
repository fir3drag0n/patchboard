// A board's own colors: theme, mode and accent over each screen's. Set from
// Arrange board's More and from a device's pages in Settings, Devices. An
// e-ink screen has no colors to set, so there it shows nothing.

import type { BoardLook } from '../../shared/board.ts';
import { ACCENTS, THEMES } from '../lib/appearance.ts';
import { useEink } from '../lib/eink.ts';
import { t as tr } from '../lib/i18n.ts';

export function BoardColors({ look, onChange, label = true }: { look: BoardLook | undefined; onChange: (next: BoardLook | undefined) => void; label?: boolean }) {
  const eink = useEink();
  if (eink) return null;
  const l = look ?? {};
  const set = (patch: Partial<BoardLook>) => {
    const next = { ...l, ...patch };
    for (const k of Object.keys(next) as (keyof BoardLook)[]) if (!next[k]) delete next[k];
    onChange(Object.keys(next).length ? next : undefined);
  };
  // Swatches in the mode the board will show.
  const scheme = l.scheme ?? (document.documentElement.dataset.scheme === 'light' ? 'light' : 'dark');
  const preset = ACCENTS.find((a) => a.id === l.accent);
  const hex = l.accent?.startsWith('#') ? l.accent : '';
  return (
    <span className="board-colors" role="group" aria-label={tr('Board colors')}>
      {label && <span>{tr('Colors')}</span>}
      <select className="field" aria-label={tr('Theme')} value={l.theme ?? ''} onChange={(e) => set({ theme: e.target.value || undefined })}>
        <option value="">{tr("Each screen's theme")}</option>
        {THEMES.map((t) => (
          <option key={t.id} value={t.id}>
            {tr(t.name)}
          </option>
        ))}
      </select>
      <select className="field" aria-label={tr('Mode')} value={l.scheme ?? ''} onChange={(e) => set({ scheme: (e.target.value || undefined) as BoardLook['scheme'] })}>
        <option value="">{tr("Each screen's mode")}</option>
        <option value="dark">{tr('Dark')}</option>
        <option value="light">{tr('Light')}</option>
      </select>
      <span className="board-swatches">
        <button type="button" className="swatch swatch-theme" aria-pressed={!l.accent} aria-label={tr("The theme's own accent")} title={tr("The theme's own")} onClick={() => set({ accent: undefined })} />
        {ACCENTS.map((c) => (
          <button key={c.id} type="button" className="swatch" style={{ background: c[scheme] }} aria-pressed={preset?.id === c.id} aria-label={tr(c.name)} title={tr(c.name)} onClick={() => set({ accent: c.id })} />
        ))}
        <label className={`swatch swatch-pick ${hex ? 'is-on' : ''}`} title={tr('Any color')} style={hex ? { background: hex } : undefined}>
          <input type="color" value={hex || '#5fd0c5'} onChange={(e) => set({ accent: e.target.value })} aria-label={tr('Pick any accent color')} />
          <span aria-hidden>+</span>
        </label>
      </span>
    </span>
  );
}

/** Save only a board's colors, leaving the rest as it is saved now. */
export async function saveBoardLook(id: string, look: BoardLook | undefined): Promise<string | null> {
  const got = await fetch(`/api/boards/${encodeURIComponent(id)}`).catch(() => null);
  if (!got?.ok) return tr("Couldn't load that board.");
  const { board } = (await got.json()) as { board: Record<string, unknown> };
  const res = await fetch(`/api/boards/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Patchboard': 'action' },
    body: JSON.stringify({ ...board, look }),
  });
  if (res.ok) return null;
  return ((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`;
}
