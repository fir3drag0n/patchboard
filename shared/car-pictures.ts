// Your own pictures of your car, for the tire pressures: each picture with
// where its four tires sit, in percent of its width and height. A tire you
// can't see in a picture has no spot, and its pressure shows without a leader.

import { TIRES, type TirePos } from './types.ts';

export interface CarPicture {
  /** An image you uploaded: /api/icons/<hash>.<ext>. */
  src: string;
  /** Where each tire sits, [x, y] in percent; null when this angle hides it. */
  at: Record<TirePos, [number, number] | null>;
  /** A drawing on light paper: shown inverted in dark mode, like chalk. Photos stay as they are. */
  drawing?: boolean;
  /** Where the charge port is, [x, y] in percent, for the cable while it's plugged in. */
  port?: [number, number] | null;
  /** Which view this is, so the drawing sheet puts it in its place. */
  view?: CarView;
  /** The part of the picture to show, [x, y, width, height] in percent; the whole picture when absent. Spots stay in the whole picture's percent. */
  crop?: [number, number, number, number];
}

/** Square-on views, and the two three-quarter views a turntable turns through between them. */
export type CarView = 'side' | 'top' | 'front' | 'rear' | 'front34' | 'rear34';
export const CAR_VIEWS: CarView[] = ['side', 'front34', 'front', 'rear34', 'rear', 'top'];

export const MAX_PICTURES = 6;
const SRC = /^\/api\/icons\/[a-f0-9]{16}\.(png|jpg|webp|gif)$/;

/** A list of pictures as sent, cleaned up, or an error to show. */
export function checkPictures(v: unknown): { ok: true; pictures: CarPicture[] } | { ok: false; error: string } {
  if (!Array.isArray(v)) return { ok: false, error: 'Send a list of pictures.' };
  if (v.length > MAX_PICTURES) return { ok: false, error: `Up to ${MAX_PICTURES} pictures a car.` };
  const out: CarPicture[] = [];
  for (const p of v as Partial<CarPicture>[]) {
    if (!p || typeof p.src !== 'string' || !SRC.test(p.src)) return { ok: false, error: 'A picture has to be one you uploaded here.' };
    const at = {} as CarPicture['at'];
    for (const t of TIRES) {
      const xy = p.at?.[t];
      if (xy == null) at[t] = null;
      else if (Array.isArray(xy) && xy.length === 2 && xy.every((n) => typeof n === 'number' && n >= 0 && n <= 100)) at[t] = [Math.round(xy[0] * 10) / 10, Math.round(xy[1] * 10) / 10];
      else return { ok: false, error: 'A tire spot has to be inside the picture.' };
    }
    const view = p.view;
    if (view != null && !CAR_VIEWS.includes(view)) return { ok: false, error: 'A picture is a side, front, rear, top or three-quarter view.' };
    const crop = p.crop;
    if (crop != null && !(Array.isArray(crop) && crop.length === 4 && crop.every((n) => typeof n === 'number' && n >= 0 && n <= 100) && crop[2] >= 2 && crop[3] >= 2 && crop[0] + crop[2] <= 100.01 && crop[1] + crop[3] <= 100.01)) return { ok: false, error: 'The part of the picture to show has to be inside it.' };
    const port = p.port;
    if (port != null && !(Array.isArray(port) && port.length === 2 && port.every((n) => typeof n === 'number' && n >= 0 && n <= 100))) return { ok: false, error: 'The charge port has to be inside the picture.' };
    const r1 = (n: number) => Math.round(n * 10) / 10;
    out.push({
      src: p.src,
      at,
      ...(p.drawing === false ? { drawing: false } : {}),
      ...(port ? { port: [r1(port[0]), r1(port[1])] as [number, number] } : {}),
      ...(view ? { view } : {}),
      ...(crop ? { crop: crop.map(r1) as [number, number, number, number] } : {}),
    });
  }
  return { ok: true, pictures: out };
}

/** Where a tire's pressure goes on a picture: its side, and how far down, in the picture's units. */
export interface LabelSpot {
  left: boolean;
  y: number;
}

/**
 * Each pressure beside its tire, on the side the tire is nearer, at the
 * tire's own height, so every leader is short. Two on one side are moved
 * apart until they clear; a tire this angle hides takes the emptier side.
 * `h` is the picture's height when its width is 100.
 */
export function labelSpots(at: CarPicture['at'], h: number, gap = 11): Record<TirePos, LabelSpot> {
  const top = 8;
  const bottom = h - 4;
  const sides: Record<'left' | 'right', { t: TirePos; y: number }[]> = { left: [], right: [] };
  for (const t of TIRES) {
    const xy = at[t];
    if (xy) sides[xy[0] < 50 ? 'left' : 'right'].push({ t, y: (xy[1] * h) / 100 });
  }
  for (const t of TIRES) {
    if (at[t]) continue;
    const side = sides.left.length <= sides.right.length ? 'left' : 'right';
    // A front tire reads first: a hidden one sits high, a rear one low.
    sides[side].push({ t, y: t.startsWith('f') ? top : bottom });
  }
  const out = {} as Record<TirePos, LabelSpot>;
  for (const side of ['left', 'right'] as const) {
    const list = sides[side].sort((a, b) => a.y - b.y);
    // Clamp, push each down to clear the one above, then back up from the bottom.
    let prev = -Infinity;
    for (const l of list) {
      l.y = Math.max(top, l.y, prev + gap);
      prev = l.y;
    }
    let next = Infinity;
    for (const l of [...list].reverse()) {
      l.y = Math.min(bottom, l.y, next - gap);
      next = l.y;
    }
    for (const l of list) out[l.t] = { left: side === 'left', y: l.y };
  }
  return out;
}
