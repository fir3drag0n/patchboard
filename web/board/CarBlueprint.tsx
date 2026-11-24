// The car as a live engineering drawing: a general-arrangement sheet with a
// zoned border, the side view large with dimension lines from the model's
// published figures, front, rear and top views where you've added them, the
// live metrics, and a row of panels for status, charging, range and tires.
// Every panel and every tire opens its own detail sheet; Back returns to the
// whole car. Everything is drawn in one SVG, so it scales as a piece, on a
// wall tablet, in a dashboard card or on an e-ink reader. Too narrow to read,
// it gives way to `fallback`.

import { type KeyboardEvent, type ReactNode, useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { type CarPicture, type CarView } from '../../shared/car-pictures.ts';
import { dim, specFor } from '../../shared/car-specs.ts';
import { type Series, TIRES, type TirePos } from '../../shared/types.ts';
import { Lines, Spark } from '../components/Spark.tsx';
import { useJson } from '../lib/api.ts';
import { msg, t as tr } from '../lib/i18n.ts';
import { locale } from '../lib/region.ts';
import { PictureEditor, SIDE_PORT, SIDE_TIRES, SideDrawing, type TireReading } from './CarSketch.tsx';

/** An empty cell, as a drawing's table marks one. */
const BLANK = '–';

export interface CarSheet {
  vin: string;
  name: string;
  model?: string;
  ro: boolean;
  metric: boolean;
  /** "psi" or "bar". */
  unit: string;
  tires: TireReading[];
  /** 0 to 100. */
  battery: number;
  usable?: number;
  limit: number;
  low: boolean;
  range: string;
  rangeMi: number;
  /** "Charging", "Plugged in, not charging", "Unplugged". */
  state: string;
  plugged: boolean;
  charging: boolean;
  kw?: string;
  volts?: number;
  amps?: number;
  added?: string;
  toFull?: string;
  inside?: string;
  outside?: string;
  climate?: boolean;
  locked: boolean;
  /** Doors, frunk or trunk standing open, in words. */
  open: string[];
  sentry: boolean;
  odometer: string;
  /** "4 minutes ago". */
  read: string;
  asleep: boolean;
  /** A low tire, in words. */
  note?: string;
  week: { battery?: Series; tires: Partial<Record<TirePos, Series>> };
  day: { inside?: Series; outside?: Series };
  tireText: (bar: number) => string;
  tempText: (c: number) => string;
}

/** Below this width the sheet's lettering is too small to read. */
const MIN_WIDTH = 520;

type Detail = 'tires' | 'charge' | 'range' | 'climate' | 'status';
const DETAIL: Record<Detail, [string, string]> = {
  tires: ['A', msg('Tire pressure')],
  charge: ['B', msg('Charging')],
  range: ['C', msg('Range')],
  climate: ['D', msg('Climate')],
  status: ['E', msg('Status')],
};

export function CarBlueprint({ sheet, fallback }: { sheet: CarSheet; fallback: ReactNode }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1000);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const [rev, setRev] = useState(0);
  const pics = useJson<Record<string, CarPicture[]>>(`/api/car-pictures?r=${rev}`).data?.[sheet.vin] ?? [];
  const [editing, setEditing] = useState(false);
  const [detail, setDetail] = useState<Detail | null>(null);
  // Escape leaves a detail sheet, as Back does.
  useEffect(() => {
    if (!detail) return;
    const key = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && setDetail(null);
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [detail]);
  return (
    <div ref={wrap} className="bp-wrap">
      {width < MIN_WIDTH ? (
        fallback
      ) : detail ? (
        <DetailSheet sheet={sheet} detail={detail} onBack={() => setDetail(null)} />
      ) : (
        <>
          <Sheet sheet={sheet} pics={pics} open={setDetail} />
          {!sheet.ro && (
            <div className="car-views">
              <button type="button" className="text-button car-edit" onClick={() => setEditing(true)}>
                {tr('Pictures')}
              </button>
            </div>
          )}
        </>
      )}
      {editing &&
        createPortal(
          <PictureEditor
            vin={sheet.vin}
            pictures={pics}
            onClose={() => setEditing(false)}
            onSaved={() => setRev((r) => r + 1)}
          />,
          document.body,
        )}
    </div>
  );
}

/** A picture's size, the part of it to show, and where its drawing is, in its own pixels. */
interface Framed {
  w: number;
  h: number;
  crop: { x: number; y: number; w: number; h: number };
  /** The drawing's own extent inside the crop: where the car begins and ends. */
  ink: { x: number; y: number; w: number; h: number };
}

/**
 * Where the drawing is in a picture: everything darker than paper, inside
 * the part you boxed, with a little room around it.
 */
function useFramed(src: string | null, part?: [number, number, number, number]): Framed | null {
  const [framed, setFramed] = useState<Framed | null>(null);
  const partKey = part?.join(',') ?? '';
  useEffect(() => {
    setFramed(null);
    if (!src) return;
    const im = new Image();
    im.onload = () => {
      const w = im.naturalWidth;
      const h = im.naturalHeight;
      const [px, py, pw, ph] = part ?? [0, 0, 100, 100];
      const area = { x: (px / 100) * w, y: (py / 100) * h, w: (pw / 100) * w, h: (ph / 100) * h };
      const whole = { w, h, crop: area, ink: area };
      try {
        const scale = Math.min(1, 360 / w);
        const cw = Math.max(1, Math.round(w * scale));
        const ch = Math.max(1, Math.round(h * scale));
        const canvas = document.createElement('canvas');
        canvas.width = cw;
        canvas.height = ch;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (!ctx) return setFramed(whole);
        ctx.drawImage(im, 0, 0, cw, ch);
        const px4 = ctx.getImageData(0, 0, cw, ch).data;
        const luma = (i: number) => (px4[i] * 299 + px4[i + 1] * 587 + px4[i + 2] * 114) / 1000;
        let paper = 0;
        for (let i = 0; i < px4.length; i += 4 * 37) paper = Math.max(paper, luma(i));
        const ink = paper - 48;
        let [x0, y0, x1, y1] = [cw, ch, -1, -1];
        const ax0 = Math.floor(area.x * scale);
        const ay0 = Math.floor(area.y * scale);
        const ax1 = Math.min(cw, Math.ceil((area.x + area.w) * scale));
        const ay1 = Math.min(ch, Math.ceil((area.y + area.h) * scale));
        for (let y = ay0; y < ay1; y++)
          for (let x = ax0; x < ax1; x++) {
            const i = (y * cw + x) * 4;
            if (px4[i + 3] > 32 && luma(i) < ink) {
              if (x < x0) x0 = x;
              if (x > x1) x1 = x;
              if (y < y0) y0 = y;
              if (y > y1) y1 = y;
            }
          }
        if (x1 < x0) return setFramed(whole);
        const inkBox = { x: x0 / scale, y: y0 / scale, w: (x1 - x0) / scale, h: (y1 - y0) / scale };
        const pad = 0.03 * Math.max(inkBox.w, inkBox.h);
        const nx0 = Math.max(area.x, inkBox.x - pad);
        const ny0 = Math.max(area.y, inkBox.y - pad);
        const nx1 = Math.min(area.x + area.w, inkBox.x + inkBox.w + pad);
        const ny1 = Math.min(area.y + area.h, inkBox.y + inkBox.h + pad);
        setFramed({ w, h, crop: { x: nx0, y: ny0, w: nx1 - nx0, h: ny1 - ny0 }, ink: inkBox });
      } catch {
        setFramed(whole);
      }
    };
    im.src = src;
  }, [src, partKey]);
  return framed;
}

/** The side drawing's own box, as if it were a picture. */
const DRAWN: Framed = { w: 420, h: 190, crop: { x: 44, y: 44, w: 346, h: 128 }, ink: { x: 50, y: 48, w: 333, h: 104 } };

type Box = { x: number; y: number; w: number; h: number };

/** A view fitted into its place on the sheet, centered; and where a spot in the picture lands. */
function place(framed: Framed, slot: Box) {
  const { crop } = framed;
  const aspect = crop.w / crop.h;
  const w = Math.min(slot.w, slot.h * aspect);
  const h = w / aspect;
  const box = { x: slot.x + (slot.w - w) / 2, y: slot.y + (slot.h - h) / 2, w, h };
  const px = (nx: number, ny: number): [number, number] => [box.x + ((nx - crop.x) / crop.w) * box.w, box.y + ((ny - crop.y) / crop.h) * box.h];
  const at = (xy: [number, number]): [number, number] => px((xy[0] / 100) * framed.w, (xy[1] / 100) * framed.h);
  const ink = { x0: px(framed.ink.x, framed.ink.y)[0], y0: px(framed.ink.x, framed.ink.y)[1], x1: px(framed.ink.x + framed.ink.w, 0)[0], y1: px(0, framed.ink.y + framed.ink.h)[1] };
  return { box, at, ink };
}

/** One view of the car: your picture, cropped to its part, or the drawn side view. */
function ViewImage({ pic, framed, box, soft }: { pic: CarPicture | null; framed: Framed; box: Box; soft: Record<TirePos, boolean> }) {
  const { crop } = framed;
  return pic ? (
    <svg x={box.x} y={box.y} width={box.w} height={box.h} viewBox={`${crop.x} ${crop.y} ${crop.w} ${crop.h}`} preserveAspectRatio="none">
      <image href={pic.src} x="0" y="0" width={framed.w} height={framed.h} className={`bp-img ${pic.drawing === false ? '' : 'is-drawing'}`} />
    </svg>
  ) : (
    <svg x={box.x} y={box.y} width={box.w} height={box.h} viewBox={`${crop.x} ${crop.y} ${crop.w} ${crop.h}`} className="bp-drawn">
      <SideDrawing soft={soft} />
    </svg>
  );
}

/** A dimension line: arrowheads, extension ticks, and the figure centered on it. */
function Dimension({ x0, y0, x1, y1, text, vertical }: { x0: number; y0: number; x1: number; y1: number; text: string; vertical?: boolean }) {
  const a = 1.3;
  return (
    <g className="bp-dim">
      <line x1={x0} y1={y0} x2={x1} y2={y1} />
      {vertical ? (
        <>
          <path d={`M${x0 - a / 1.6} ${y0 + a} L${x0} ${y0} L${x0 + a / 1.6} ${y0 + a} M${x1 - a / 1.6} ${y1 - a} L${x1} ${y1} L${x1 + a / 1.6} ${y1 - a}`} />
          <path d={`M${x0 - 2} ${y0} H${x0 + 2} M${x1 - 2} ${y1} H${x1 + 2}`} />
          <text className="bp-dim-text" x={x0 + 2.2} y={(y0 + y1) / 2 + 1}>
            {text}
          </text>
        </>
      ) : (
        <>
          <path d={`M${x0 + a} ${y0 - a / 1.6} L${x0} ${y0} L${x0 + a} ${y0 + a / 1.6} M${x1 - a} ${y1 - a / 1.6} L${x1} ${y1} L${x1 - a} ${y1 + a / 1.6}`} />
          <path d={`M${x0} ${y0 - 2} V${y0 + 2} M${x1} ${y1 - 2} V${y1 + 2}`} />
          <text className="bp-dim-text" x={(x0 + x1) / 2} y={y0 - 1.2} textAnchor="middle">
            {text}
          </text>
        </>
      )}
    </g>
  );
}

/** A tappable part of the sheet: a button for a pointer, the keyboard and a screen reader. */
function Hit({ label, onOpen, children }: { label: string; onOpen: () => void; children: ReactNode }) {
  const key = (e: KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onOpen();
    }
  };
  return (
    <g className="bp-hit" role="button" tabIndex={0} aria-label={label} onClick={onOpen} onKeyDown={key}>
      {children}
    </g>
  );
}

/** Small line icons for the metrics, drawn in a 6 by 6 box. */
const ICONS: Record<string, string> = {
  charge: 'M0.5 1.5 H5 V4.5 H0.5 Z M5 2.5 H5.8 V3.5 H5 M1.4 2.3 V3.7 M2.4 2.3 V3.7 M3.4 2.3 V3.7',
  range: 'M3 5.6 C1.2 3.6 0.9 2.9 0.9 2.1 A2.1 2.1 0 0 1 5.1 2.1 C5.1 2.9 4.8 3.6 3 5.6 Z M3 1.4 A0.7 0.7 0 1 0 3 2.8 A0.7 0.7 0 1 0 3 1.4',
  power: 'M3.6 0.4 L1.2 3.4 H2.9 L2.3 5.6 L4.8 2.5 H3.1 Z',
  cabin: 'M3 3 C3 1.4 3.6 0.6 4.4 0.8 C5 1 4.8 2.4 3 3 C4.6 3 5.4 3.6 5.2 4.4 C5 5 3.6 4.8 3 3 C3 4.6 2.4 5.4 1.6 5.2 C1 5 1.2 3.6 3 3 C1.4 3 0.6 2.4 0.8 1.6 C1 1 2.4 1.2 3 3',
  outside: 'M2.4 0.6 H3.6 V3.6 A1.4 1.4 0 1 1 2.4 3.6 Z M3 2 V4.4',
};

const W = 320;
const H = 180;

function Sheet({ sheet, pics, open }: { sheet: CarSheet; pics: CarPicture[]; open: (d: Detail) => void }) {
  const id = useId().replace(/:/g, '');
  const byView = (v: CarView) => pics.find((p) => p.view === v) ?? null;
  const sidePic = byView('side') ?? pics.find((p) => !p.view) ?? null;
  const topPic = byView('top');
  const frontPic = byView('front');
  const rearPic = byView('rear');
  const sideLoaded = useFramed(sidePic?.src ?? null, sidePic?.crop);
  const topFramed = useFramed(topPic?.src ?? null, topPic?.crop);
  const frontFramed = useFramed(frontPic?.src ?? null, frontPic?.crop);
  const rearFramed = useFramed(rearPic?.src ?? null, rearPic?.crop);
  const sideFramed = sidePic ? sideLoaded : DRAWN;
  const soft = Object.fromEntries(sheet.tires.map((t) => [t.pos, t.soft])) as Record<TirePos, boolean>;
  const tire = Object.fromEntries(sheet.tires.map((t) => [t.pos, t])) as Record<TirePos, TireReading>;
  const spec = specFor(sheet.model);
  const hasTopRow = !!(frontPic || rearPic || topPic);

  // The side view: large in the middle, higher up when there's no row of small views above it.
  const sideSlot = hasTopRow ? { x: 108, y: 64, w: 176, h: 52 } : { x: 104, y: 30, w: 184, h: 84 };
  const side = sideFramed ? place(sideFramed, sideSlot) : null;
  const sideAt = sidePic ? sidePic.at : SIDE_TIRES;
  const portXY = sidePic ? sidePic.port : SIDE_PORT;

  // Small views across the top.
  const smalls = [
    ['front', frontPic, frontFramed, msg('Front view')],
    ['rear', rearPic, rearFramed, msg('Rear view')],
    ['top', topPic, topFramed, msg('Top view')],
  ] as const;
  const shown = smalls.filter(([, p]) => p);
  const slotW = shown.length ? Math.min(66, 196 / shown.length) : 0;

  const cols = 8;
  const rows = 6;
  const zone = { x: 8, y: 8, w: W - 16, h: H - 16 };
  const cellW = zone.w / cols;
  const cellH = zone.h / rows;
  const metrics: [keyof typeof ICONS, string, string, string | undefined, Detail, boolean?][] = [
    ['charge', tr('Charge'), `${sheet.battery}%`, sheet.usable != null && sheet.usable !== sheet.battery ? tr('{n}% usable', { n: sheet.usable }) : undefined, 'charge', sheet.low],
    ['range', tr('Range'), sheet.range, undefined, 'range'],
    ['power', tr('Power'), sheet.charging && sheet.kw ? sheet.kw : BLANK, tr(sheet.state), 'charge'],
    ['cabin', tr('Cabin'), sheet.inside ?? BLANK, sheet.climate ? tr('Climate on') : undefined, 'climate'],
    ['outside', tr('Outside'), sheet.outside ?? BLANK, undefined, 'climate'],
  ];
  const full = sheet.battery > 0 ? Math.round((sheet.rangeMi / sheet.battery) * 100) : 0;
  const panels = { y: 132, h: 36, w: 72, gap: 4 };
  const px = (i: number) => 12 + i * (panels.w + panels.gap);

  return (
    <svg className="bp-sheet" viewBox={`0 0 ${W} ${H}`} role="group" aria-label={`${sheet.model ?? sheet.name}: ${tr('engineering drawing')}`}>
      <defs>
        <pattern id={`${id}-hatch`} width="1.4" height="1.4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="1.4" className="bp-hatch" />
        </pattern>
        <pattern id={`${id}-grid`} width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M5 0 V20 M10 0 V20 M15 0 V20 M0 5 H20 M0 10 H20 M0 15 H20" className="bp-grid-minor" />
          <path d="M0 0 H20 M0 0 V20" className="bp-grid-major" />
        </pattern>
      </defs>

      {/* The sheet: a faint grid, the outer border, and the zone border numbered 1 to 8 and lettered A to F. */}
      <rect x={zone.x} y={zone.y} width={zone.w} height={zone.h} fill={`url(#${id}-grid)`} />
      <rect className="bp-frame" x="2" y="2" width={W - 4} height={H - 4} />
      <rect className="bp-frame" x={zone.x} y={zone.y} width={zone.w} height={zone.h} />
      {Array.from({ length: cols }, (_, i) => (
        <g key={`c${i}`} className="bp-zone">
          {i > 0 && <path d={`M${zone.x + cellW * i} 2 V${zone.y} M${zone.x + cellW * i} ${H - 2} V${H - zone.y}`} />}
          <text x={zone.x + cellW * (i + 0.5)} y="6.6" textAnchor="middle">
            {i + 1}
          </text>
          <text x={zone.x + cellW * (i + 0.5)} y={H - 3.4} textAnchor="middle">
            {i + 1}
          </text>
        </g>
      ))}
      {Array.from({ length: rows }, (_, i) => (
        <g key={`r${i}`} className="bp-zone">
          {i > 0 && <path d={`M2 ${zone.y + cellH * i} H${zone.x} M${W - 2} ${zone.y + cellH * i} H${W - zone.x}`} />}
          <text x="5" y={zone.y + cellH * (i + 0.5) + 1} textAnchor="middle">
            {'ABCDEF'[i]}
          </text>
          <text x={W - 5} y={zone.y + cellH * (i + 0.5) + 1} textAnchor="middle">
            {'ABCDEF'[i]}
          </text>
        </g>
      ))}

      {/* Title, top left. */}
      <text className="bp-title" x="13" y="22">
        {sheet.model ?? sheet.name}
      </text>
      <text className="bp-small" x="13.4" y="28">
        {sheet.model ? `${sheet.name} · ` : ''}
        {tr('Vehicle status')}
      </text>
      <line className="bp-rule" x1="13" y1="31" x2="92" y2="31" />

      {/* Live metrics: a boxed list, each row opening its detail. */}
      <rect className="bp-box" x="12" y="36" width="82" height="88" />
      <text className="bp-row" x="16" y="42.5">
        {tr('Live metrics')}
      </text>
      <line className="bp-rule" x1="12" y1="45" x2="94" y2="45" />
      {metrics.map(([icon, label, value, sub, d, trouble], i) => {
        const y = 47 + i * 15.4;
        return (
          <Hit key={icon} label={`${label} ${value}${sub ? `, ${sub}` : ''}`} onOpen={() => open(d)}>
            <rect className="bp-hit-area" x="12.5" y={y} width="81" height="15" />
            <path className="bp-icon" d={ICONS[icon]} transform={`translate(15 ${y + 4.4})`} />
            <text className="bp-row" x="24" y={y + 8.8}>
              {label}
            </text>
            <text className={`bp-metric ${trouble ? 'is-soft' : ''}`} x="90" y={y + (sub ? 7.6 : 9.6)} textAnchor="end">
              {value}
            </text>
            {sub && (
              <text className="bp-tiny" x="90" y={y + 12.2} textAnchor="end">
                {sub}
              </text>
            )}
            {i < metrics.length - 1 && <line className="bp-rule-soft" x1="15" y1={y + 15.2} x2="91" y2={y + 15.2} />}
          </Hit>
        );
      })}

      {/* The small views across the top, each with its label; the top view carries the length. */}
      {shown.map(([v, pic, framed, label], i) => {
        if (!framed || !pic) return null;
        const slot = { x: 104 + i * (slotW + 4), y: 18, w: slotW, h: 30 };
        const p = place(framed, slot);
        return (
          <g key={v}>
            <ViewImage pic={pic} framed={framed} box={p.box} soft={soft} />
            {v === 'top' && spec && <Dimension x0={p.ink.x0} y0={14} x1={p.ink.x1} y1={14} text={dim(spec.length, locale())} />}
            <text className="bp-label-u" x={p.box.x + p.box.w / 2} y="55" textAnchor="middle">
              {tr(label)}
            </text>
            <line className="bp-rule" x1={p.box.x + p.box.w / 2 - 11} y1="56.4" x2={p.box.x + p.box.w / 2 + 11} y2="56.4" />
          </g>
        );
      })}

      {/* The side view, dimensioned underneath and on its right. */}
      {side && sideFramed && (
        <>
          <ViewImage pic={sidePic} framed={sideFramed} box={side.box} soft={soft} />
          {spec &&
            (() => {
              const x0 = side.ink.x0;
              const x1 = side.ink.x1;
              const y = side.ink.y1 + 4.5;
              const len = x1 - x0;
              const fl = sideAt.fl ? side.at(sideAt.fl)[0] : x0 + (len * (spec.front ?? spec.length * 0.18)) / spec.length;
              const rl = sideAt.rl ? side.at(sideAt.rl)[0] : x0 + (len * ((spec.front ?? spec.length * 0.18) + spec.wheelbase)) / spec.length;
              return (
                <>
                  {spec.front && <Dimension x0={x0} y0={y} x1={fl} y1={y} text={dim(spec.front, locale())} />}
                  <Dimension x0={fl} y0={y} x1={rl} y1={y} text={dim(spec.wheelbase, locale())} />
                  {spec.rear && <Dimension x0={rl} y0={y} x1={x1} y1={y} text={dim(spec.rear, locale())} />}
                  <Dimension x0={x0} y0={y + 6} x1={x1} y1={y + 6} text={dim(spec.length, locale())} />
                  <Dimension x0={x1 + 5} y0={side.ink.y0} x1={x1 + 5} y1={side.ink.y1} text={dim(spec.height, locale())} vertical />
                </>
              );
            })()}
          {/* Tires on the side view: a tap target over each tire that shows. */}
          {TIRES.map((t) => {
            const xy = sideAt[t];
            if (!xy) return null;
            const [cx, cy] = side.at(xy);
            return (
              <Hit key={t} label={`${tire[t].name} ${tire[t].value} ${sheet.unit}`} onOpen={() => open('tires')}>
                <circle className={`bp-tire-ring ${tire[t].soft ? 'is-soft' : ''}`} cx={cx} cy={cy} r={side.box.h * 0.2} />
              </Hit>
            );
          })}
          {/* The charge port, called out while it's plugged in. */}
          {sheet.plugged &&
            portXY &&
            (() => {
              const [cx, cy] = side.at(portXY);
              const lx = Math.min(W - 40, cx + 10);
              const ly = side.box.y - 1;
              return (
                <Hit label={`${tr('Charge port')}: ${tr(sheet.state)}${sheet.kw ? `, ${sheet.kw}` : ''}`} onOpen={() => open('charge')}>
                  <circle className="bp-dot" cx={cx} cy={cy} r="0.8" />
                  <path className="bp-lead" d={`M${cx} ${cy} L${lx} ${ly} H${lx + 26}`} />
                  {sheet.charging && <path className="bp-cable-flow" d={`M${lx + 26} ${ly} H${lx} L${cx} ${cy}`} />}
                  <path className="bp-icon" d={ICONS.power} transform={`translate(${lx} ${ly - 7.4})`} />
                  <text className="bp-small" x={lx + 6.5} y={ly - 2.6}>
                    {sheet.charging && sheet.kw ? `${tr('Charging')} ${sheet.kw}` : tr('Plugged in')}
                  </text>
                </Hit>
              );
            })()}
        </>
      )}

      {/* The row of panels along the bottom. */}
      <Hit label={`${tr('Status')}: ${sheet.locked ? tr('Locked') : tr('Unlocked')}`} onOpen={() => open('status')}>
        <rect className="bp-box bp-hit-area" x={px(0)} y={panels.y} width={panels.w} height={panels.h} />
        <text className="bp-row" x={px(0) + 3} y={panels.y + 6}>
          {tr('Status')}
        </text>
        <line className="bp-rule" x1={px(0)} y1={panels.y + 8} x2={px(0) + panels.w} y2={panels.y + 8} />
        {(
          [
            [tr('Doors'), sheet.open.length ? sheet.open.join(', ') : sheet.locked ? tr('Locked') : tr('Unlocked'), sheet.open.length > 0 || !sheet.locked],
            [tr('Sentry'), sheet.sentry ? tr('On') : tr('Off')],
            [tr('Odometer'), sheet.odometer],
            [sheet.asleep ? tr('Asleep, read') : tr('Read'), sheet.read],
          ] as [string, string, boolean?][]
        ).map(([k, v, trouble], i) => (
          <g key={k}>
            <text className="bp-tiny" x={px(0) + 3} y={panels.y + 14 + i * 6.2}>
              {k}
            </text>
            <text className={`bp-cell-s ${trouble ? 'is-soft' : ''}`} x={px(0) + panels.w - 3} y={panels.y + 14 + i * 6.2} textAnchor="end">
              {v}
            </text>
          </g>
        ))}
      </Hit>

      <Hit label={`${tr('Charging')}: ${tr(sheet.state)}`} onOpen={() => open('charge')}>
        <rect className="bp-box bp-hit-area" x={px(1)} y={panels.y} width={panels.w} height={panels.h} />
        <text className="bp-row" x={px(1) + 3} y={panels.y + 6}>
          {tr('Charging')}
        </text>
        <line className="bp-rule" x1={px(1)} y1={panels.y + 8} x2={px(1) + panels.w} y2={panels.y + 8} />
        {(
          [
            [tr('State'), tr(sheet.state)],
            [tr('Rate'), sheet.charging && sheet.kw ? `${sheet.kw}${sheet.volts && sheet.amps ? ` · ${sheet.volts} V ${sheet.amps} A` : ''}` : BLANK],
            [tr('Added'), sheet.added ?? BLANK],
            [sheet.toFull ? tr('Full in') : tr('Limit'), sheet.toFull ?? `${sheet.limit}%`],
          ] as [string, string][]
        ).map(([k, v], i) => (
          <g key={k}>
            <text className="bp-tiny" x={px(1) + 3} y={panels.y + 14 + i * 6.2}>
              {k}
            </text>
            <text className="bp-cell-s" x={px(1) + panels.w - 3} y={panels.y + 14 + i * 6.2} textAnchor="end">
              {v}
            </text>
          </g>
        ))}
      </Hit>

      {/* Range at each charge level, from this car's own range and charge; the limit and now marked. */}
      <Hit label={`${tr('Range')}: ${sheet.range}`} onOpen={() => open('range')}>
        <rect className="bp-box bp-hit-area" x={px(2)} y={panels.y} width={panels.w} height={panels.h} />
        <text className="bp-row" x={px(2) + 3} y={panels.y + 6}>
          {tr('Range by charge')}
        </text>
        <line className="bp-rule" x1={px(2)} y1={panels.y + 8} x2={px(2) + panels.w} y2={panels.y + 8} />
        {(() => {
          const g = { x: px(2) + 10, y: panels.y + 11, w: panels.w - 15, h: 18 };
          const at = (pct: number): [number, number] => [g.x + (g.w * pct) / 100, g.y + g.h - (g.h * pct) / 100];
          const now = at(sheet.battery);
          const lim = at(sheet.limit);
          return (
            <>
              <path className="bp-axis" d={`M${g.x} ${g.y} V${g.y + g.h} H${g.x + g.w}`} />
              <line className="bp-lead" x1={g.x} y1={g.y + g.h} x2={g.x + g.w} y2={g.y} />
              <line className="bp-limit" x1={lim[0]} y1={g.y} x2={lim[0]} y2={g.y + g.h} />
              <circle className="bp-dot" cx={now[0]} cy={now[1]} r="0.9" />
              <text className="bp-tiny" x={g.x - 1} y={g.y + 1.6} textAnchor="end">
                {full}
              </text>
              <text className="bp-tiny" x={g.x - 1} y={g.y + g.h} textAnchor="end">
                0
              </text>
              <text className="bp-tiny" x={g.x + g.w} y={g.y + g.h + 3.4} textAnchor="end">
                100%
              </text>
              <text className="bp-tiny" x={g.x} y={g.y + g.h + 3.4}>
                0%
              </text>
            </>
          );
        })()}
      </Hit>

      {/* Tire pressure: the car from above, a pressure at each corner. */}
      <Hit label={`${tr('Tire pressure')}: ${sheet.tires.map((t) => `${t.name} ${t.value}`).join(', ')} ${sheet.unit}`} onOpen={() => open('tires')}>
        <rect className="bp-box bp-hit-area" x={px(3)} y={panels.y} width={panels.w} height={panels.h} />
        <text className="bp-row" x={px(3) + 3} y={panels.y + 6}>
          {tr('Tire pressure')}
        </text>
        <line className="bp-rule" x1={px(3)} y1={panels.y + 8} x2={px(3) + panels.w} y2={panels.y + 8} />
        {(() => {
          const cx = px(3) + panels.w / 2;
          const car = { x: cx - 5, y: panels.y + 10.5, w: 10, h: 23 };
          const corner: Record<TirePos, [number, number, boolean]> = {
            fl: [car.x - 1, car.y + 5, true],
            fr: [car.x + car.w + 1, car.y + 5, false],
            rl: [car.x - 1, car.y + car.h - 5, true],
            rr: [car.x + car.w + 1, car.y + car.h - 5, false],
          };
          return (
            <>
              <path className="bp-plan" d={`M${car.x + 2} ${car.y} Q${cx} ${car.y - 1} ${car.x + car.w - 2} ${car.y} Q${car.x + car.w} ${car.y + 1} ${car.x + car.w} ${car.y + 4} V${car.y + car.h - 3} Q${car.x + car.w} ${car.y + car.h} ${car.x + car.w - 2.5} ${car.y + car.h} H${car.x + 2.5} Q${car.x} ${car.y + car.h} ${car.x} ${car.y + car.h - 3} V${car.y + 4} Q${car.x} ${car.y + 1} ${car.x + 2} ${car.y} Z`} />
              <path className="bp-plan" d={`M${car.x + 1.4} ${car.y + 7} Q${cx} ${car.y + 5.6} ${car.x + car.w - 1.4} ${car.y + 7} M${car.x + 1.4} ${car.y + car.h - 6} Q${cx} ${car.y + car.h - 4.8} ${car.x + car.w - 1.4} ${car.y + car.h - 6}`} />
              {TIRES.map((t) => {
                const [x, y, left] = corner[t];
                const r = tire[t];
                return (
                  <g key={t} className={`bp-tire ${r.soft ? 'is-soft' : ''}`}>
                    <rect className="bp-tread" x={left ? x - 1.2 : x} y={y - 2.6} width="1.2" height="5.2" rx="0.4" />
                    <line className="bp-lead" x1={left ? x - 1.6 : x + 1.6} y1={y} x2={left ? x - 8 : x + 8} y2={y} />
                    <text className="bp-tiny" x={left ? x - 9 : x + 9} y={y - 2.2} textAnchor={left ? 'end' : 'start'}>
                      {t.toUpperCase()}
                    </text>
                    <text className="bp-cell-s" x={left ? x - 9 : x + 9} y={y + 2.4} textAnchor={left ? 'end' : 'start'}>
                      {r.value}
                    </text>
                  </g>
                );
              })}
            </>
          );
        })()}
      </Hit>

      {sheet.note && (
        <text className="bp-small is-soft" x={W / 2} y={panels.y - 2.4} textAnchor="middle">
          {sheet.note}
        </text>
      )}
    </svg>
  );
}

/** A part of the car opened up: its figures now, and what Patchboard has recorded of it. */
function DetailSheet({ sheet, detail, onBack }: { sheet: CarSheet; detail: Detail; onBack: () => void }) {
  const [letter, title] = DETAIL[detail];
  const back = useRef<HTMLButtonElement>(null);
  useEffect(() => back.current?.focus(), []);
  const rows: [string, string, boolean?][] =
    detail === 'tires'
      ? sheet.tires.map((t) => [t.name, `${t.value} ${sheet.unit}`, t.soft])
      : detail === 'charge'
        ? [
            [tr('Charge'), `${sheet.battery}%${sheet.usable != null ? `, ${tr('{n}% usable', { n: sheet.usable })}` : ''}`, sheet.low],
            [tr('State'), tr(sheet.state)],
            [tr('Rate'), sheet.charging && sheet.kw ? sheet.kw : BLANK],
            [tr('Voltage and current'), sheet.volts && sheet.amps ? `${sheet.volts} V, ${sheet.amps} A` : BLANK],
            [tr('Added this session'), sheet.added ?? BLANK],
            [tr('Full in'), sheet.toFull ?? BLANK],
            [tr('Limit'), `${sheet.limit}%`],
          ]
        : detail === 'range'
          ? [
              [tr('Range now'), sheet.range],
              [tr('At the limit'), sheet.battery > 0 ? `${Math.round((sheet.rangeMi / sheet.battery) * sheet.limit)} mi` : BLANK],
              [tr('Full'), sheet.battery > 0 ? `${Math.round((sheet.rangeMi / sheet.battery) * 100)} mi` : BLANK],
            ]
          : detail === 'climate'
            ? [
                [tr('Cabin'), sheet.inside ?? BLANK],
                [tr('Outside'), sheet.outside ?? BLANK],
                [tr('Climate'), sheet.climate ? tr('On') : tr('Off')],
              ]
            : [
                [tr('Doors'), sheet.locked ? tr('Locked') : tr('Unlocked'), !sheet.locked],
                [tr('Open'), sheet.open.length ? sheet.open.join(', ') : tr('Nothing'), sheet.open.length > 0],
                [tr('Sentry'), sheet.sentry ? tr('On') : tr('Off')],
                [tr('Odometer'), sheet.odometer],
                [sheet.asleep ? tr('Asleep, read') : tr('Read'), sheet.read],
              ];
  return (
    <section className="bp-detail" aria-label={tr(title)}>
      <header className="bp-detail-head">
        <span className="bp-detail-title">
          {tr('Detail {letter}', { letter })} · {tr(title)}
        </span>
        <button ref={back} type="button" className="button button-quiet" onClick={onBack}>
          {tr('Back')}
        </button>
      </header>
      <dl className="bp-detail-rows">
        {rows.map(([k, v, trouble]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd className={trouble ? 'warn-text' : ''}>{v}</dd>
          </div>
        ))}
      </dl>
      <div className="bp-detail-chart">
        {detail === 'tires' && (
          <>
            <Lines
              height={90}
              format={(v) => `${sheet.tireText(v)} ${sheet.unit}`}
              label={tr('Tire pressures, last 7 days')}
              lines={sheet.tires.map((t) => ({ data: sheet.week.tires[t.pos], label: t.name, className: t.soft ? 'is-soft' : undefined }))}
            />
            <span className="bp-detail-note">{tr('Tire pressures, last 7 days')}</span>
          </>
        )}
        {(detail === 'charge' || detail === 'range') && (
          <>
            <Spark data={sheet.week.battery} min={0} max={100} height={90} format={(v) => `${Math.round(v)}%`} label={tr('Charge, last 7 days')} />
            <span className="bp-detail-note">{tr('Charge, last 7 days')}</span>
          </>
        )}
        {detail === 'climate' && (
          <>
            <Lines
              height={90}
              format={(v) => sheet.tempText(v)}
              label={tr('Cabin and outside, last 24 hours')}
              lines={[
                { data: sheet.day.inside, label: tr('Cabin') },
                { data: sheet.day.outside, label: tr('Outside') },
              ]}
            />
            <span className="bp-detail-note">{tr('Cabin and outside, last 24 hours')}</span>
          </>
        )}
      </div>
    </section>
  );
}
