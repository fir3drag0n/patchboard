// Settings, Look: the app icon. Each device picks a look for the P; an
// uploaded icon replaces the P on every device. The browser draws every size
// here, in color and in black and white, so the server stores PNGs as they are.

import { useState } from 'react';
import { type AppIcon as Choice, setAppearance, useAppearance } from '../lib/appearance.ts';
import { useStore } from '../lib/store.tsx';
import { Section } from './ui.tsx';
import { msg, t as tr } from '../lib/i18n.ts';

const SIZES = [64, 180, 192, 512] as const;

async function load(file: File): Promise<HTMLImageElement> {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/**
 * The image on a square. A picture that fills its frame is cropped to the
 * middle; a logo with a clear background sits inside a margin, on black when
 * it's light and on white when it's dark, so it never disappears.
 */
function square(img: HTMLImageElement, size: number, mono: boolean): string {
  const w = img.naturalWidth || 512;
  const h = img.naturalHeight || 512;
  // Measure once, small: how much is see-through, and how light the rest is.
  const probe = document.createElement('canvas');
  probe.width = probe.height = 48;
  const pg = probe.getContext('2d', { willReadFrequently: true })!;
  pg.drawImage(img, 0, 0, 48, 48);
  const px = pg.getImageData(0, 0, 48, 48).data;
  let clear = 0;
  let lum = 0;
  let solid = 0;
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 200) clear++;
    if (px[i + 3] > 30) {
      lum += (0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]) / 255;
      solid++;
    }
  }
  const seeThrough = clear / (48 * 48) > 0.05;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d', { willReadFrequently: true })!;
  g.imageSmoothingQuality = 'high';
  if (seeThrough) {
    g.fillStyle = solid && lum / solid > 0.6 ? '#0b0c0e' : '#ffffff';
    g.fillRect(0, 0, size, size);
    const fit = (size * 0.76) / Math.max(w, h);
    g.drawImage(img, (size - w * fit) / 2, (size - h * fit) / 2, w * fit, h * fit);
  } else {
    const side = Math.min(w, h);
    g.drawImage(img, (w - side) / 2, (h - side) / 2, side, side, 0, 0, size, size);
  }
  if (mono) {
    // E-ink's ink, as icons on the page get it: gray, middle tones pushed toward black.
    const d = g.getImageData(0, 0, size, size);
    for (let i = 0; i < d.data.length; i += 4) {
      const y = 255 * Math.pow((0.2126 * d.data[i] + 0.7152 * d.data[i + 1] + 0.0722 * d.data[i + 2]) / 255, 2.4);
      d.data[i] = d.data[i + 1] = d.data[i + 2] = y;
    }
    g.putImageData(d, 0, 0);
  }
  return c.toDataURL('image/png');
}

/** Draws every size of the icon from one image and saves it for every device. An error message, or null. */
export async function uploadAppIcon(file: File): Promise<string | null> {
  const img = await load(file).catch(() => null);
  if (!img) return tr("This browser can't open that file as an image.");
  const body = { color: {} as Record<number, string>, mono: {} as Record<number, string> };
  for (const s of SIZES) {
    body.color[s] = square(img, s, false);
    body.mono[s] = square(img, s, true);
  }
  const res = await fetch('/api/app-icon', { method: 'PUT', headers: { 'Content-Type': 'application/json', 'X-Patchboard': 'action' }, body: JSON.stringify(body) });
  return res.ok ? null : (((await res.json().catch(() => ({}))) as { error?: string }).error ?? `HTTP ${res.status}`);
}

export function AppIconSection() {
  const a = useAppearance();
  const { snap } = useStore();
  const own = snap?.brand?.icon;
  const readOnly = !!snap?.readOnly;
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const darkNow = a.scheme === 'dark' || (a.scheme === 'auto' && !matchMedia('(prefers-color-scheme: light)').matches);
  const mono = a.appIcon === 'mono' || a.appIcon === 'mono-dark';
  // With your own icon, a device chooses only between color and black and white.
  const choices: [Choice, string, string, boolean][] = own
    ? [
        ['dark', msg('In color'), `/icon-192.png?v=${own}`, !mono],
        ['mono', msg('Black and white'), `/icon-mono-192.png?v=${own}`, mono],
      ]
    : (
        [
          ['dark', msg('Dark'), '/icon-192.png'],
          ['light', msg('Light'), '/icon-light-192.png'],
          ['auto', msg('Match the mode'), darkNow ? '/icon-192.png' : '/icon-light-192.png'],
          ['mono-dark', msg('White on black'), '/icon-mono-dark-192.png'],
          ['mono', msg('Black on white'), '/icon-mono-192.png'],
        ] as const
      ).map(([v, label, src]): [Choice, string, string, boolean] => [v, label, src, a.appIcon === v]);

  const pick = async (input: HTMLInputElement) => {
    const file = input.files?.[0];
    if (!file) return;
    setBusy(true);
    setErr((await uploadAppIcon(file).catch((e: Error) => e.message)) ?? '');
    setBusy(false);
    input.value = '';
  };
  const reset = async () => {
    setErr('');
    const res = await fetch('/api/app-icon', { method: 'DELETE', headers: { 'X-Patchboard': 'action' } });
    if (!res.ok) setErr(`HTTP ${res.status}`);
  };

  return (
    <Section title="App icon">
      <div className="icon-choices">
        {choices.map(([v, label, src, on]) => (
          <button key={v} type="button" className="icon-choice" aria-pressed={on} onClick={() => setAppearance({ appIcon: v })}>
            <img src={src} alt="" width={64} height={64} />
            <span>{tr(label)}</span>
          </button>
        ))}
        {/* Uploading is one of the choices, the same size as the rest. */}
        {!readOnly && (
          <label className="icon-choice icon-upload" aria-disabled={busy || undefined}>
            <span className="icon-upload-mark" aria-hidden>+</span>
            <span>{busy ? tr('Uploading') : own ? tr('Upload another') : tr('Upload your own')}</span>
            <input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml,image/gif" className="sr-only" disabled={busy} onChange={(e) => void pick(e.currentTarget)} />
          </label>
        )}
      </div>
      {!readOnly && (own || err) && (
        <div className="app-icon-own">
          {own && (
            <button type="button" className="text-button" onClick={() => void reset()}>
              {tr('Use the P')}
            </button>
          )}
          {err && <span className="crit-text">{err}</span>}
        </div>
      )}
      <p className="settings-note">
        {own ? `${tr('Your icon shows on every device.')} ` : ''}{tr('For Add to Home Screen or Install on this device. A phone keeps the icon it had when you added it: to change it, remove the app and add it again.')}{own ? '' : ' With dark home-screen icons on an iPhone, pick a dark one.'}
      </p>
    </Section>
  );
}
