// The four tire pressures on a picture of the car. With pictures of your own
// (Pictures, below) each pressure sits on a leader to where you tapped its
// tire, and you swipe between them to turn the car. Without, the car is drawn
// like a blueprint: from the side, the far tires in dashed hidden lines, or
// from above. A low tire is the only thing in color. Each device remembers
// which view it last showed.

import { type ChangeEvent, type MouseEvent, type PointerEvent, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CAR_VIEWS, type CarPicture, type CarView, labelSpots, MAX_PICTURES } from '../../shared/car-pictures.ts';
import { TIRES, type TirePos } from '../../shared/types.ts';
import { useJson } from '../lib/api.ts';
import { msg, t as tr } from '../lib/i18n.ts';
import { useModal } from '../lib/modal.ts';

export interface TireReading {
  pos: TirePos;
  value: string;
  name: string;
  soft: boolean;
}

type View = { kind: 'side' } | { kind: 'above' } | { kind: 'picture'; pic: CarPicture };

const viewKey = (vin: string) => `pb-car-view:${vin}`;
function savedIndex(vin: string): number {
  try {
    return Number(localStorage.getItem(viewKey(vin))) || 0;
  } catch {
    return 0;
  }
}

/** The pressures on the car, with arrows, dots and a swipe to turn it. */
export function CarTires({ vin, tires, unit, ro }: { vin: string; tires: TireReading[]; unit: string; ro: boolean }) {
  const [rev, setRev] = useState(0);
  const pics = useJson<Record<string, CarPicture[]>>(`/api/car-pictures?r=${rev}`).data?.[vin] ?? [];
  const views: View[] = pics.length ? pics.map((pic) => ({ kind: 'picture', pic })) : [{ kind: 'side' }, { kind: 'above' }];
  const [index, setIndex] = useState(() => savedIndex(vin));
  const [editing, setEditing] = useState(false);
  const at = ((index % views.length) + views.length) % views.length;
  const view = views[at];
  const start = useRef<number | null>(null);
  const turn = (by: number) => {
    const next = (((at + by) % views.length) + views.length) % views.length;
    setIndex(next);
    try {
      localStorage.setItem(viewKey(vin), String(next));
    } catch {
      // Private mode: it turns for this visit only.
    }
  };
  const down = (e: PointerEvent) => {
    start.current = e.clientX;
  };
  const up = (e: PointerEvent) => {
    if (start.current !== null && Math.abs(e.clientX - start.current) > 40) turn(e.clientX < start.current ? 1 : -1);
    start.current = null;
  };
  const label = `${tr('Tires')}, ${unit}: ${tires.map((t) => `${t.name} ${t.value}${t.soft ? `, ${tr('low')}` : ''}`).join(', ')}`;
  return (
    <div className="car-tires-wrap">
      <div className="car-tires-figure" role="img" aria-label={label} onPointerDown={down} onPointerUp={up} onPointerCancel={() => (start.current = null)}>
        {view.kind === 'side' ? <CarSide tires={tires} unit={unit} /> : view.kind === 'above' ? <CarAbove tires={tires} unit={unit} /> : <PictureView pic={view.pic} tires={tires} unit={unit} />}
      </div>
      <div className="car-views">
        {views.length > 1 && (
          <>
            <button type="button" className="text-button car-turn" aria-label={tr('Previous view')} onClick={() => turn(-1)}>
              ‹
            </button>
            <span className="car-dots" aria-hidden="true">
              {views.map((_, i) => (
                <i key={i} className={i === at ? 'is-on' : ''} />
              ))}
            </span>
            <button type="button" className="text-button car-turn" aria-label={tr('Next view')} onClick={() => turn(1)}>
              ›
            </button>
          </>
        )}
        {!ro && (
          <button type="button" className="text-button car-edit" onClick={() => setEditing(true)}>
            {tr('Pictures')}
          </button>
        )}
      </div>
      {editing &&
        createPortal(
          <PictureEditor
            vin={vin}
            pictures={pics}
            onClose={() => setEditing(false)}
            onSaved={() => {
              setRev((r) => r + 1);
              setIndex(0);
            }}
          />,
          document.body,
        )}
    </div>
  );
}

/** One of your pictures, each pressure beside its tire on a short leader. */
function PictureView({ pic: whole, tires, unit }: { pic: CarPicture; tires: TireReading[]; unit: string }) {
  const [natural, setNatural] = useState(4 / 3);
  // Only the part you boxed, with its spots read in that part's percent.
  const [cx, cy, cw, ch] = whole.crop ?? WHOLE;
  const rel = (xy: [number, number] | null | undefined): [number, number] | null => (xy ? [((xy[0] - cx) / cw) * 100, ((xy[1] - cy) / ch) * 100] : null);
  const pic: CarPicture = { ...whole, at: { fl: rel(whole.at.fl), fr: rel(whole.at.fr), rl: rel(whole.at.rl), rr: rel(whole.at.rr) } };
  const aspect = (natural * cw) / ch;
  const h = 100 / aspect;
  const spots = labelSpots(pic.at, h);
  // The picture is 100 wide, with a gutter each side for the figures and a
  // strip under it for the unit, so no figure ever sits on the car.
  const outW = 100 + 2 * GUTTER;
  const outH = h + FOOT;
  return (
    <div className={`car-photo ${pic.drawing === false ? '' : 'is-drawing'}`} style={{ aspectRatio: `${outW} / ${outH}` }}>
      <div className="car-photo-frame" style={{ left: `${(GUTTER / outW) * 100}%`, width: `${(100 / outW) * 100}%`, height: `${(h / outH) * 100}%` }}>
        <img
          src={pic.src}
          alt=""
          draggable={false}
          className="car-photo-img"
          style={{ width: `${(100 / cw) * 100}%`, left: `${(-cx / cw) * 100}%`, top: `${(-cy / ch) * 100}%` }}
          onLoad={(e) => setNatural(e.currentTarget.naturalWidth / e.currentTarget.naturalHeight || 4 / 3)}
        />
      </div>
      <svg className="car-photo-marks" viewBox={`${-GUTTER} 0 ${outW} ${outH}`}>
        {tires.map((t) => {
          const { left, y } = spots[t.pos];
          const tx = left ? 1 - GUTTER : 99 + GUTTER;
          // The leader runs under the label to the picture's edge, then bends once to the tire.
          const ly = y + 2;
          const reach = left ? 0 : 100;
          const spot = pic.at[t.pos];
          return (
            <g key={t.pos} className={`car-callout ${t.soft ? 'is-soft' : ''}`}>
              {spot && (
                <>
                  <path className="car-lead" d={`M${tx} ${ly} L${reach} ${ly} L${spot[0]} ${(spot[1] * h) / 100}`} />
                  <circle className="car-dot" cx={spot[0]} cy={(spot[1] * h) / 100} r="0.6" />
                </>
              )}
              <text className="car-num" x={tx} y={y} textAnchor={left ? 'start' : 'end'}>
                {t.value}
                <tspan className="car-pos" dx="1.2">
                  {t.pos.toUpperCase()}
                </tspan>
              </text>
            </g>
          );
        })}
        <text className="car-unit" x="50" y={outH - 1.4} textAnchor="middle">
          {unit}
        </text>
      </svg>
    </div>
  );
}

/** Room beside a picture for the figures, and under it for the unit, in the picture's own units (it is 100 wide). */
const GUTTER = 15;
const FOOT = 5;

const TIRE_WORDS: Record<TirePos, string> = { fl: msg('front left'), fr: msg('front right'), rl: msg('rear left'), rr: msg('rear right') };
const VIEW_WORDS: Record<CarView, string> = { side: msg('Side'), top: msg('Top'), front: msg('Front'), rear: msg('Rear') };
const empty = (): CarPicture['at'] => ({ fl: null, fr: null, rl: null, rr: null });
type Crop = [number, number, number, number];
const WHOLE: Crop = [0, 0, 100, 100];

/** Setting up one picture: its view, the part to use, then four tires and the port. */
type Step = { pic: CarPicture; at: 'view' | 'crop' | number };

/** The part of a picture, shown large, with taps read back in the whole picture's percent. */
function CropPane({ src, crop, spots, onTap }: { src: string; crop: Crop; spots: [number, number][]; onTap?: (spot: [number, number]) => void }) {
  const [natural, setNatural] = useState<[number, number] | null>(null);
  const [cx, cy, cw, ch] = crop;
  const ratio = natural ? (cw * natural[0]) / (ch * natural[1]) : 4 / 3;
  const tap = (e: MouseEvent<HTMLDivElement>) => {
    if (!onTap) return;
    const r = e.currentTarget.getBoundingClientRect();
    const fx = (e.clientX - r.left) / r.width;
    const fy = (e.clientY - r.top) / r.height;
    onTap([Math.round((cx + fx * cw) * 10) / 10, Math.round((cy + fy * ch) * 10) / 10]);
  };
  return (
    <div className={`car-place-pic ${onTap ? 'is-tapping' : ''}`} style={{ aspectRatio: String(ratio) }} onClick={tap}>
      <img
        src={src}
        alt={tr('Your picture')}
        draggable={false}
        onLoad={(e) => setNatural([e.currentTarget.naturalWidth, e.currentTarget.naturalHeight])}
        style={{ width: `${(100 / cw) * 100}%`, left: `${(-cx / cw) * 100}%`, top: `${(-cy / ch) * 100}%` }}
      />
      {spots.map(([x, y], i) => (
        <i key={i} className="car-place-dot" style={{ left: `${((x - cx) / cw) * 100}%`, top: `${((y - cy) / ch) * 100}%` }} />
      ))}
    </div>
  );
}

/** Drag a box around the part of the picture to use, a whole sheet of views, say. */
function CropPicker({ src, onDone }: { src: string; onDone: (crop: Crop) => void }) {
  const [box, setBox] = useState<Crop | null>(null);
  const start = useRef<[number, number] | null>(null);
  const at = (e: PointerEvent<HTMLDivElement>): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    return [Math.max(0, Math.min(100, ((e.clientX - r.left) / r.width) * 100)), Math.max(0, Math.min(100, ((e.clientY - r.top) / r.height) * 100))];
  };
  return (
    <>
      <div
        className="car-place-pic car-crop"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          start.current = at(e);
          setBox(null);
        }}
        onPointerMove={(e) => {
          if (!start.current) return;
          const [x0, y0] = start.current;
          const [x1, y1] = at(e);
          setBox([Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0)]);
        }}
        onPointerUp={() => (start.current = null)}
      >
        <img src={src} alt={tr('Your picture')} draggable={false} className="car-crop-img" />
        {box && <i className="car-crop-box" style={{ left: `${box[0]}%`, top: `${box[1]}%`, width: `${box[2]}%`, height: `${box[3]}%` }} />}
      </div>
      <div className="car-place-actions">
        <button type="button" className="button" disabled={!box || box[2] < 2 || box[3] < 2} onClick={() => box && onDone(box.map((n) => Math.round(n * 10) / 10) as Crop)}>
          {tr('Use this part')}
        </button>
        <button type="button" className="button button-quiet" onClick={() => onDone(WHOLE)}>
          {tr('Use the whole picture')}
        </button>
      </div>
    </>
  );
}

/** Add pictures of the car: pick each one's view, the part to use, then tap its tires and charge port. */
export function PictureEditor({ vin, pictures, onClose, onSaved }: { vin: string; pictures: CarPicture[]; onClose: () => void; onSaved: () => void }) {
  const modal = useModal<HTMLDivElement>(onClose);
  const [list, setList] = useState<CarPicture[]>(pictures);
  const [step, setStep] = useState<Step | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const upload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setError('');
    setBusy(true);
    try {
      const res = await fetch('/api/icons', { method: 'POST', headers: { 'content-type': file.type, 'x-patchboard': 'action' }, body: file });
      const body = (await res.json().catch(() => ({}))) as { icon?: string; error?: string };
      if (!res.ok || !body.icon) throw new Error(body.error ?? `HTTP ${res.status}`);
      setStep({ pic: { src: body.icon, at: empty(), drawing: true }, at: 'view' });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  // Four tires, then the charge port; then the picture joins the list.
  const place = (spot: [number, number] | null) => {
    if (!step || typeof step.at !== 'number') return;
    if (step.at === TIRES.length) {
      setList((l) => [...l, { ...step.pic, port: spot }]);
      setStep(null);
      return;
    }
    setStep({ pic: { ...step.pic, at: { ...step.pic.at, [TIRES[step.at]]: spot } }, at: step.at + 1 });
  };
  const save = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/car-pictures/${encodeURIComponent(vin)}`, { method: 'PUT', headers: { 'content-type': 'application/json', 'x-patchboard': 'action' }, body: JSON.stringify(list) });
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
      onSaved();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const crop = step?.pic.crop ?? WHOLE;
  const placed = step ? ([...TIRES.map((t) => step.pic.at[t]), step.pic.port].filter(Boolean) as [number, number][]) : [];

  return (
    <div className="palette-backdrop" onClick={onClose}>
      <div className="palette drawer car-pictures" ref={modal} role="dialog" aria-label={tr('Pictures of the car')} onClick={(e) => e.stopPropagation()}>
        <header className="drawer-head">
          <h2>{tr('Pictures of the car')}</h2>
          <button type="button" className="text-button" onClick={onClose}>
            {tr('Close')}
          </button>
        </header>
        {step?.at === 'view' ? (
          <div className="car-place">
            <p className="car-place-ask" role="status">
              {tr('Which view is this?')}
            </p>
            <CropPane src={step.pic.src} crop={WHOLE} spots={[]} />
            <div className="car-place-actions">
              {CAR_VIEWS.map((v) => (
                <button key={v} type="button" className="button button-quiet" onClick={() => setStep({ pic: { ...step.pic, view: v }, at: 'crop' })}>
                  {tr(VIEW_WORDS[v])}
                </button>
              ))}
            </div>
          </div>
        ) : step?.at === 'crop' ? (
          <div className="car-place">
            <p className="car-place-ask" role="status">
              {tr('Drag a box around the car, or use the whole picture.')}
            </p>
            <CropPicker src={step.pic.src} onDone={(c) => setStep({ pic: { ...step.pic, ...(c === WHOLE ? {} : { crop: c }) }, at: 0 })} />
          </div>
        ) : step ? (
          <div className="car-place">
            <p className="car-place-ask" role="status">
              {typeof step.at === 'number' && step.at < TIRES.length ? tr('Tap the {tire} tire.', { tire: tr(TIRE_WORDS[TIRES[step.at]]) }) : tr('Tap the charge port.')}
            </p>
            <CropPane src={step.pic.src} crop={crop} spots={placed} onTap={(s) => place(s)} />
            <div className="car-place-actions">
              <button type="button" className="button button-quiet" onClick={() => place(null)}>
                {typeof step.at === 'number' && step.at < TIRES.length ? tr('Can’t see it') : tr('No port in this picture')}
              </button>
              <button type="button" className="text-button" onClick={() => setStep({ pic: { ...step.pic, at: empty(), port: undefined }, at: 0 })}>
                {tr('Start over')}
              </button>
            </div>
          </div>
        ) : (
          <>
            <p className="settings-note">
              {tr('A drawing or picture of your car, from the side, top, front or rear. Pick its view, box the part to use (a sheet with several views works), then tap its tires and charge port. The drawing sheet puts each view in its place.')}
            </p>
            <ul className="car-pic-list">
              {list.map((p, i) => (
                <li key={`${p.src}-${i}`}>
                  <CropPane src={p.src} crop={p.crop ?? WHOLE} spots={[]} />
                  <div className="car-pic-about">
                    <strong>{p.view ? tr(VIEW_WORDS[p.view]) : tr('Any view')}</strong>
                    <label className="check">
                      <input type="checkbox" checked={p.drawing !== false} onChange={(e) => setList((l) => l.map((x, j) => (j === i ? { ...x, drawing: e.target.checked } : x)))} />
                      {tr('A drawing: light lines in dark mode')}
                    </label>
                  </div>
                  <button type="button" className="text-button req-quiet" onClick={() => setList((l) => l.filter((_, j) => j !== i))}>
                    {tr('Remove')}
                  </button>
                </li>
              ))}
            </ul>
            <div className="car-place-actions">
              {list.length < MAX_PICTURES && (
                <label className="button button-quiet">
                  {busy ? tr('Adding...') : tr('Add a picture')}
                  <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" disabled={busy} onChange={(e) => void upload(e)} />
                </label>
              )}
              <button type="button" className="button" disabled={busy} onClick={() => void save()}>
                {tr('Save')}
              </button>
            </div>
          </>
        )}
        {error && (
          <p className="crit-text" role="alert">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}

const by = (tires: TireReading[]) => Object.fromEntries(tires.map((t) => [t.pos, t])) as Record<TirePos, TireReading>;

/** A pressure and its tire's short name, at one end of a leader. */
function Callout({ t, x, y, end, line, dot }: { t: TireReading; x: number; y: number; end?: boolean; line: string; dot: [number, number] }) {
  return (
    <g className={`car-callout ${t.soft ? 'is-soft' : ''}`}>
      <path className="car-lead" d={line} />
      <circle className="car-dot" cx={dot[0]} cy={dot[1]} r="1.8" />
      <text className="car-num" x={x} y={y} textAnchor={end ? 'end' : 'start'}>
        {t.value}
        <tspan className="car-pos" dx="6">
          {t.pos.toUpperCase()}
        </tspan>
      </text>
    </g>
  );
}

/** A five-spoke wheel at a tire's center. */
const Wheel = ({ cx, cy, soft }: { cx: number; cy: number; soft: boolean }) => (
  <g className={`car-wheel ${soft ? 'is-soft' : ''}`}>
    <circle className="car-tire" cx={cx} cy={cy} r="24" />
    <circle className="car-rim" cx={cx} cy={cy} r="15" />
    <circle className="car-rim" cx={cx} cy={cy} r="3" />
    {[0, 72, 144, 216, 288].map((a) => {
      const r = (a * Math.PI) / 180;
      return <line key={a} className="car-rim" x1={cx + 4 * Math.sin(r)} y1={cy - 4 * Math.cos(r)} x2={cx + 14 * Math.sin(r)} y2={cy - 14 * Math.cos(r)} />;
    })}
  </g>
);

/** The side elevation: near tires drawn, far tires as hidden lines behind. */
/** The side drawing alone, in the 420 by 190 box from y 4: the far tires dashed, the near ones drawn. */
export function SideDrawing({ soft }: { soft: Record<TirePos, boolean> }) {
  return (
    <>
      <g className="car-guide">
        <line x1="10" y1="152" x2="410" y2="152" />
        <line x1="112" y1="54" x2="112" y2="168" />
        <line x1="313" y1="54" x2="313" y2="168" />
      </g>
      <circle className={`car-hidden ${soft.fr ? 'is-soft' : ''}`} cx="120" cy="124" r="25" />
      <circle className={`car-hidden ${soft.rr ? 'is-soft' : ''}`} cx="321" cy="124" r="25" />
      <path
        className="car-body"
        d="M58 136 C51 130 50 119 55 111 C61 104 88 100 118 96 C143 93 158 91 168 88 C186 72 203 58 226 52 C248 47 280 48 300 54 C323 62 348 76 366 86 C376 92 382 102 382 114 L381 128 C380 133 376 136 370 136 L341 136 A29 29 0 0 0 285 136 L140 136 A29 29 0 0 0 84 136 L64 136 C61 136 59 137 58 136 Z"
      />
      <g className="car-fine">
        <path d="M176 90 C192 75 208 63 229 57 C252 52 280 53 298 59 C318 66 336 77 350 87 Z" />
        <path d="M256 54 L254 89" />
        <path d="M62 112 C140 104 260 100 378 100" />
        <path d="M146 130 L280 130" />
        <path d="M178 92 L172 134 M254 90 L254 134 M318 84 L322 128" />
        <path d="M206 104 l14 0 M282 103 l14 0" />
        <path d="M56 108 C68 103 84 101 98 101 C88 106 72 109 58 111 Z" />
        <path d="M370 92 C376 94 380 98 381 103 L372 102 Z" />
        <path d="M70 100 C110 95 150 92 170 90" />
      </g>
      <path className="car-body" d="M178 92 l-11 -5 l-2 5 l11 3" />
      <Wheel cx={112} cy={128} soft={soft.fl} />
      <Wheel cx={313} cy={128} soft={soft.rl} />
    </>
  );
}

/** Where the side drawing's tires sit, in percent of its box, as a picture's tires do. */
export const SIDE_TIRES: CarPicture['at'] = { fl: [26.7, 65.3], fr: [28.6, 63.2], rl: [74.5, 65.3], rr: [76.4, 63.2] };
/** The drawn car's charge port: rear left, by the tail lamp. */
export const SIDE_PORT: [number, number] = [86.5, 47];

function CarSide({ tires, unit }: { tires: TireReading[]; unit: string }) {
  const t = by(tires);
  return (
    <svg className="car-sketch car-side" viewBox="0 4 420 190">
      <SideDrawing soft={{ fl: t.fl.soft, fr: t.fr.soft, rl: t.rl.soft, rr: t.rr.soft }} />
      {/* Front tires on the left, rear on the right: near ones above, far ones below. */}
      <Callout t={t.fl} x={6} y={28} line="M6 36 L64 36 L98 110" dot={[98, 110]} />
      <Callout t={t.fr} x={6} y={178} line="M6 186 L78 186 L104 146" dot={[104, 146]} />
      <Callout t={t.rl} x={414} y={28} end line="M414 36 L356 36 L326 110" dot={[326, 110]} />
      <Callout t={t.rr} x={414} y={178} end line="M414 186 L362 186 L338 144" dot={[338, 144]} />
      <text className="car-unit" x="210" y="184" textAnchor="middle">
        {unit}
      </text>
    </svg>
  );
}

/** Where each wheel sits on the view from above. */
const WHEEL: Record<TirePos, [number, number]> = { fl: [87, 46], fr: [128, 46], rl: [87, 112], rr: [128, 112] };

/** From above: the plan view, a pressure at each corner. */
function CarAbove({ tires, unit }: { tires: TireReading[]; unit: string }) {
  const t = by(tires);
  return (
    <svg className="car-sketch car-above" viewBox="0 0 220 172">
      <g className="car-guide">
        <line x1="110" y1="4" x2="110" y2="168" />
        <line x1="70" y1="53" x2="150" y2="53" />
        <line x1="70" y1="119" x2="150" y2="119" />
      </g>
      <g className="car-body">
        <path d="M99 24 Q110 20 121 24 Q127 27 127.5 36 L127.5 135 Q127 145 121 148 Q110 151 99 148 Q93 145 92.5 135 L92.5 36 Q93 27 99 24 Z" />
      </g>
      <g className="car-fine">
        <path d="M96.5 54 Q110 48.5 123.5 54 L121.5 64 Q110 60.5 98.5 64 Z" />
        <rect x="98.5" y="65" width="23" height="44" rx="3" />
        <path d="M98.5 110 Q110 113.5 121.5 110 L123.5 119 Q110 124 96.5 119 Z" />
        <path d="M92.5 59 L88.5 57.5 L88.5 61 L92.5 61 M127.5 59 L131.5 57.5 L131.5 61 L127.5 61" />
        <path d="M102 26.5 Q110 24.5 118 26.5" />
      </g>
      {TIRES.map((p) => (
        <rect key={p} className={`car-tread ${t[p].soft ? 'is-soft' : ''}`} x={WHEEL[p][0]} y={WHEEL[p][1]} width="5" height="14" rx="1.6" />
      ))}
      <Callout t={t.fl} x={6} y={34} line="M6 42 L56 42 L86 52" dot={[86, 52]} />
      <Callout t={t.fr} x={214} y={34} end line="M214 42 L164 42 L134 52" dot={[134, 52]} />
      <Callout t={t.rl} x={6} y={138} line="M6 146 L56 146 L86 120" dot={[86, 120]} />
      <Callout t={t.rr} x={214} y={138} end line="M214 146 L164 146 L134 120" dot={[134, 120]} />
      <text className="car-unit" x="110" y="168" textAnchor="middle">
        {unit}
      </text>
    </svg>
  );
}
