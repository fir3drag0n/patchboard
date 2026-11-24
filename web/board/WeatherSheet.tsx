// The weather as a drawing sheet, the car's companion on a wall screen: the
// same zoned border and pen, a title block naming the place and its
// position, the conditions now, a station plot as a meteorologist draws one
// (cloud cover in the circle, a barb for the wind, figures at its corners,
// each called out), the next 24 hours plotted on the grid, and the week as
// dimension lines on one scale. One SVG, so it scales as a piece.

import { type CSSProperties, useEffect, useId, useRef, useState } from 'react';
import type { WeatherData, WeatherHour } from '../../shared/types.ts';
import { useAppearance } from '../lib/appearance.ts';
import { deg, weatherText } from '../lib/format.ts';
import { t } from '../lib/i18n.ts';
import { locale } from '../lib/region.ts';
import { useNow, useSource } from '../lib/store.tsx';
import { Frame, W } from './CarBlueprint.tsx';
import { SkyIcon, WeatherDisplay } from './WeatherDisplay.tsx';

const H = 180;
/** Narrower than this on screen, the sheet's smallest lettering drops under 7px, as the car's does: the Display style takes its place. */
const MIN_PX = 800;
const COMPASS = ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'];

/** A boxed panel with its name over a rule, as the car's panels are drawn. */
function Panel({ x, y, w, h, title }: { x: number; y: number; w: number; h: number; title: string }) {
  return (
    <g>
      <rect className="bp-box" x={x} y={y} width={w} height={h} />
      <text className="bp-cell-s" x={x + 3} y={y + 6.2}>
        {title}
      </text>
      <path className="bp-rule" d={`M${x} ${y + 9} H${x + w}`} />
    </g>
  );
}

/**
 * The station plot: the circle filled for the share of sky that's covered,
 * and the wind as a barb from the side it blows from, a full feather for
 * every ten knots, half for five, a pennant for fifty. Calm rings the circle.
 */
function Station({ cx, cy, r, cloud, dir, kmh, hatch }: { cx: number; cy: number; r: number; cloud?: number; dir?: number; kmh?: number; hatch: string }) {
  const oktas = cloud == null ? -1 : Math.round(cloud / 12.5);
  const share = oktas <= 0 ? 0 : oktas <= 2 ? 0.25 : oktas <= 5 ? 0.5 : oktas <= 7 ? 0.75 : 1;
  const wedge = (f: number) => {
    const a = f * 2 * Math.PI;
    const ex = cx + r * Math.sin(a);
    const ey = cy - r * Math.cos(a);
    return `M${cx} ${cy} L${cx} ${cy - r} A${r} ${r} 0 ${f > 0.5 ? 1 : 0} 1 ${ex.toFixed(2)} ${ey.toFixed(2)} Z`;
  };
  const kt = kmh == null ? 0 : Math.round((kmh * 0.54) / 5) * 5;
  const parts: string[] = [];
  if (dir != null && kt > 0) {
    const a = (dir * Math.PI) / 180;
    const dx = Math.sin(a);
    const dy = -Math.cos(a);
    // Feathers lean off the staff to one side, as the convention draws them.
    const fx = -dy * 6 + dx * 2.2;
    const fy = dx * 6 + dy * 2.2;
    // Short enough that a north or south wind's barb clears the panel's header and floor.
    const len = r + 18;
    const at = (d: number) => [cx + dx * d, cy + dy * d] as const;
    const [sx, sy] = at(r);
    const [tx, ty] = at(len);
    parts.push(`M${sx.toFixed(2)} ${sy.toFixed(2)} L${tx.toFixed(2)} ${ty.toFixed(2)}`);
    let left = kt;
    let d = len;
    while (left >= 50) {
      const [px, py] = at(d);
      const [qx, qy] = at(d - 3.2);
      parts.push(`M${px.toFixed(2)} ${py.toFixed(2)} L${(px + fx).toFixed(2)} ${(py + fy).toFixed(2)} L${qx.toFixed(2)} ${qy.toFixed(2)} Z`);
      left -= 50;
      d -= 4.4;
    }
    while (left >= 10) {
      const [px, py] = at(d);
      parts.push(`M${px.toFixed(2)} ${py.toFixed(2)} l${fx.toFixed(2)} ${fy.toFixed(2)}`);
      left -= 10;
      d -= 2.8;
    }
    if (left >= 5) {
      // A lone half feather stands back from the tip, so it can't read as a full one.
      if (d === len) d -= 2.8;
      const [px, py] = at(d);
      parts.push(`M${px.toFixed(2)} ${py.toFixed(2)} l${(fx / 2).toFixed(2)} ${(fy / 2).toFixed(2)}`);
    }
  }
  return (
    <g>
      {share > 0 && (share === 1 ? <circle cx={cx} cy={cy} r={r} fill={`url(#${hatch})`} /> : <path d={wedge(share)} fill={`url(#${hatch})`} />)}
      <circle className="wsh-pen" cx={cx} cy={cy} r={r} />
      {kt === 0 && kmh != null && <circle className="wsh-pen" cx={cx} cy={cy} r={r + 2.6} />}
      {parts.length > 0 && <path className="wsh-barb" d={parts.join(' ')} />}
    </g>
  );
}

export function WeatherSheet() {
  const { data: w } = useSource<WeatherData>('weather');
  const id = useId().replace(/:/g, '');
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    // Measured as drawn, so a page zoom or enlarged text can't pass a phone off as a wall screen.
    const ro = new ResizeObserver(() => {
      const px = el.getBoundingClientRect().width;
      if (px) setWidth(px);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [!w]);
  if (!w) return null;
  return <div ref={box}>{width && width < MIN_PX ? <WeatherDisplay /> : <Sheet w={w} id={id} />}</div>;
}

function Sheet({ w, id }: { w: WeatherData; id: string }) {
  const { temp: unit, clock24 } = useAppearance();
  const now = useNow(60_000);
  const imperial = unit !== 'c';
  const clock = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit', hour12: !clock24 }) : '');
  const hourOf = (iso: string) => new Date(iso).toLocaleTimeString(locale(), { hour: 'numeric', hour12: !clock24 });
  const speed = (kmh: number) => (imperial ? `${Math.round(kmh * 0.621)} mph` : `${Math.round(kmh)} km/h`);
  const today = w.days[0];
  const alert = w.alerts?.[0];
  const severe = !!alert && /extreme|severe/i.test(alert.severity);

  // The title block's second line: where the forecast is for.
  const place = [
    w.lat != null ? `${Math.abs(w.lat).toFixed(2)}° ${w.lat >= 0 ? 'N' : 'S'}` : '',
    w.lon != null ? `${Math.abs(w.lon).toFixed(2)}° ${w.lon >= 0 ? 'E' : 'W'}` : '',
    w.elevation != null ? `${t('Elevation')} ${imperial ? `${Math.round(w.elevation * 3.281)} ft` : `${w.elevation} m`}` : '',
  ].filter(Boolean);

  // The next 24 hours, plotted inside their panel.
  const hours: WeatherHour[] = (w.hours ?? []).filter((h) => Date.parse(h.time) >= now - 3_600_000).slice(0, 25);
  const plot = { x0: 184, x1: 302, y0: 50, y1: 112 };
  const n = Math.max(1, hours.length - 1);
  const temps = hours.map((h) => deg(h.temp, unit));
  const tLo = Math.floor(Math.min(...temps) - 1);
  const tHi = Math.ceil(Math.max(...temps) + 1);
  const px = (i: number) => plot.x0 + (i / n) * (plot.x1 - plot.x0);
  // The temperature keeps above the band the rain rises in.
  const py = (v: number) => plot.y0 + 4 + (1 - (v - tLo) / Math.max(1, tHi - tLo)) * (plot.y1 - plot.y0 - 26);
  const line = temps.map((v, i) => `${i ? 'L' : 'M'}${px(i).toFixed(2)} ${py(v).toFixed(2)}`).join(' ');
  const sunOn = (date: string) => w.days.find((d) => d.date === date);
  const night = (h: WeatherHour) => {
    const d = sunOn(h.time.slice(0, 10));
    if (!d?.sunrise || !d?.sunset) return w.isDay === false;
    const at = Date.parse(h.time);
    return at < Date.parse(d.sunrise) || at >= Date.parse(d.sunset);
  };
  const nights: [number, number][] = [];
  hours.forEach((h, i) => {
    if (!night(h)) return;
    const last = nights[nights.length - 1];
    if (last && last[1] === i - 1) last[1] = i;
    else nights.push([i, i]);
  });
  const t0 = hours.length ? Date.parse(hours[0].time) : now;
  const t1 = hours.length ? Date.parse(hours[hours.length - 1].time) : now;
  const marks = w.days
    .flatMap((d) => [
      [t('Sunrise'), d.sunrise],
      [t('Sunset'), d.sunset],
    ])
    .filter((m): m is [string, string] => !!m[1] && Date.parse(m[1]) > t0 && Date.parse(m[1]) < t1)
    .map(([name, iso]) => ({ name, iso, x: plot.x0 + ((Date.parse(iso) - t0) / Math.max(1, t1 - t0)) * (plot.x1 - plot.x0) }));
  const ticks = [tLo, Math.round((tLo + tHi) / 2), tHi];

  // The week: each day a dimension line from its low to its high, on the week's scale.
  const week = w.days.slice(0, 7);
  const wLo = Math.min(...week.map((d) => deg(d.low, unit)));
  const wHi = Math.max(...week.map((d) => deg(d.high, unit)));
  const wy = (v: number) => 147 + (1 - (v - wLo) / Math.max(1, wHi - wLo)) * 17;
  const colW = (306 - 46) / 7;
  const dayName = (date: string, i: number) => (i === 0 ? t('Today') : new Date(`${date}T12:00:00`).toLocaleDateString(locale(), { weekday: 'short' }));

  // The station's callouts, at the corners of its panel, each led to the circle.
  const st = { cx: 125, cy: 79, r: 9 };
  // A callout's leader runs from its corner toward the circle, stopping short of it, and gives way
  // where the wind's barb already crosses that corner.
  const barbAt = w.windDirNow != null && (w.windNow ?? 0) >= 5 ? Math.atan2(-Math.cos((w.windDirNow * Math.PI) / 180), Math.sin((w.windDirNow * Math.PI) / 180)) : null;
  const lead = (x: number, y: number, a: number) => {
    if (barbAt != null && Math.abs(Math.atan2(Math.sin(a - barbAt), Math.cos(a - barbAt))) < (50 * Math.PI) / 180) return '';
    const ex = st.cx + Math.cos(a) * (st.r + 3);
    const ey = st.cy + Math.sin(a) * (st.r + 3);
    return `M${x} ${y} L${ex.toFixed(2)} ${ey.toFixed(2)}`;
  };
  const pressure = w.pressureNow == null ? null : imperial ? [(w.pressureNow * 0.02953).toFixed(2), 'inHg'] : [String(w.pressureNow), 'hPa'];
  const windText = w.windNow == null ? null : w.windNow < 5 ? t('Calm') : `${w.windDirNow != null ? `${COMPASS[Math.round(w.windDirNow / 22.5) % 16]} ` : ''}${speed(w.windNow)}`;

  return (
    <div className="bp-stage wsh" style={{ '--ratio': W / H } as CSSProperties}>
      <svg className="bp-sheet" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${w.label}: ${deg(w.tempNow, unit)}°, ${weatherText(w.codeNow)}`}>
        <Frame id={id} H={H} />

        {/* Title block: the place, and where it sits. */}
        <text className="bp-title" x="13" y="22">
          {w.label}
        </text>
        <text className="bp-small" x="13.4" y="28">
          {[t('Weather'), ...place].join(' · ')}
        </text>
        <text className="bp-small" x="307" y="19" textAnchor="end">
          {new Date(now).toLocaleDateString(locale(), { weekday: 'long', month: 'long', day: 'numeric' })}
        </text>
        <text className="bp-head" x="307" y="27.5" textAnchor="end">
          {new Date(now).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit', hour12: !clock24 })}
        </text>

        {/* Now. */}
        <Panel x={12} y={34} w={70} h={94} title={t('Now')} />
        <SkyIcon code={w.codeNow} night={w.isDay === false} className="wsh-icon" at={{ x: 15, y: 48, size: 17 }} />
        <text className="wsh-temp" x="34" y="63">
          {deg(w.tempNow, unit)}°
        </text>
        <text className="bp-cell" x="15" y="75">
          {weatherText(w.codeNow)}
        </text>
        {today && (
          <text className="bp-small" x="15.2" y="81">
            {t('High {high}°, low {low}°', { high: deg(today.high, unit), low: deg(today.low, unit) })}
          </text>
        )}
        {(
          [
            [t('Feels like'), w.feelsNow != null ? `${deg(w.feelsNow, unit)}°` : null],
            [t('Humidity'), w.humidityNow != null ? `${w.humidityNow}%` : null],
            [t('UV'), today?.uvMax != null ? String(Math.round(today.uvMax)) : null],
          ] as [string, string | null][]
        )
          .filter((r): r is [string, string] => r[1] != null)
          .map(([label, value], i) => (
            <g key={label}>
              <text className="bp-row" x="15" y={92 + i * 7}>
                {label}
              </text>
              <text className="bp-cell-s" x="79" y={92 + i * 7} textAnchor="end">
                {value}
              </text>
              <path className="bp-rule-soft" d={`M14 ${94.2 + i * 7} H80`} />
            </g>
          ))}
        {alert && (
          <g className={`wsh-alert${severe ? ' is-severe' : ''}`}>
            <path d="M15 113.2 l2.4 -4.2 l2.4 4.2 Z" />
            <text x="21.5" y="113">
              {alert.event}
            </text>
            {alert.until && (
              <text className="wsh-alert-until" x="21.5" y="119">
                {t('until {time}', { time: clock(alert.until) })}
              </text>
            )}
          </g>
        )}

        {/* The station plot, with its figures called out. */}
        <Panel x={86} y={34} w={78} h={94} title={t('Station')} />
        <Station cx={st.cx} cy={st.cy} r={st.r} cloud={w.cloudNow} dir={w.windDirNow} kmh={w.windNow} hatch={`${id}-hatch`} />
        <path className="wsh-lead" d={`${lead(102, 53, (-3 * Math.PI) / 4)} ${lead(148, 53, -Math.PI / 4)} ${lead(102, 104, (3 * Math.PI) / 4)} ${lead(148, 104, Math.PI / 4)}`} />
        <text className="bp-label-u" x="89" y="47">
          {t('Temperature')}
        </text>
        <text className="bp-cell" x="89" y="53">
          {deg(w.tempNow, unit)}°
        </text>
        {w.dewNow != null && (
          <>
            <text className="bp-label-u" x="89" y="110">
              {t('Dew point')}
            </text>
            <text className="bp-cell" x="89" y="116">
              {deg(w.dewNow, unit)}°
            </text>
          </>
        )}
        {pressure && (
          <>
            <text className="bp-label-u" x="161" y="47" textAnchor="end">
              {t('Pressure')}
            </text>
            <text className="bp-cell-s" x="161" y="53" textAnchor="end">
              {pressure[0]} <tspan className="wsh-unit">{pressure[1]}</tspan>
            </text>
          </>
        )}
        {w.cloudNow != null && (
          <>
            <text className="bp-label-u" x="161" y="110" textAnchor="end">
              {t('Cloud cover')}
            </text>
            <text className="bp-cell" x="161" y="116" textAnchor="end">
              {Math.round(w.cloudNow)}%
            </text>
          </>
        )}
        {windText && (
          <text className="bp-cell-s" x={st.cx} y="124" textAnchor="middle">
            {t('Wind')} {windText}
          </text>
        )}

        {/* The next 24 hours on the grid. */}
        <Panel x={168} y={34} w={140} h={94} title={t('Next 24 hours')} />
        {hours.length > 1 ? (
          <g>
            {nights.map(([a, b]) => {
              const xa = px(Math.max(0, a - 0.5));
              const xb = px(Math.min(n, b + 0.5));
              return <rect key={a} className="wsh-night" x={xa} y={plot.y0} width={xb - xa} height={plot.y1 - plot.y0} />;
            })}
            <path className="bp-rule" d={`M${plot.x0} ${plot.y0} V${plot.y1} H${plot.x1}`} />
            {ticks.map((v) => (
              <g key={v}>
                <path className="bp-rule-soft" d={`M${plot.x0} ${py(v).toFixed(2)} H${plot.x1}`} />
                <text className="bp-tiny" x={plot.x0 - 1.6} y={py(v) + 1} textAnchor="end">
                  {v}°
                </text>
              </g>
            ))}
            {hours.map((h, i) => {
              if (h.precipPct < 5) return null;
              const bw = ((plot.x1 - plot.x0) / n) * 0.62;
              const bh = (h.precipPct / 100) * 18;
              return <rect key={h.time} className="wsh-rain" x={px(i) - bw / 2} y={plot.y1 - bh} width={bw} height={bh} fill={`url(#${id}-hatch)`} />;
            })}
            {marks.map((m) => (
              <g key={m.iso}>
                <path className="wsh-dash" d={`M${m.x.toFixed(2)} ${plot.y0} V${plot.y1}`} />
                <text className="bp-tiny" x={m.x} y={plot.y0 - 1.4} textAnchor="middle">
                  {m.name} {clock(m.iso)}
                </text>
              </g>
            ))}
            <path className="wsh-line" d={line} />
            {hours.map((h, i) =>
              i % 3 === 0 ? (
                <g key={h.time}>
                  <circle className="bp-dot" cx={px(i)} cy={py(temps[i])} r="0.8" />
                  {/* Now's figure is the Now panel's; here it would sit on the scale. */}
                  {i > 0 && (
                    <text className="bp-label-u" x={px(i)} y={py(temps[i]) - 2.2} textAnchor="middle">
                      {temps[i]}°
                    </text>
                  )}
                  {h.precipPct >= 20 && (
                    <text className="wsh-pct" x={px(i)} y={plot.y1 - (h.precipPct / 100) * 18 - 1.2} textAnchor="middle">
                      {h.precipPct}%
                    </text>
                  )}
                  <path className="bp-rule" d={`M${px(i).toFixed(2)} ${plot.y1} v1.6`} />
                  <text className="bp-tiny" x={px(i)} y={plot.y1 + 5} textAnchor="middle">
                    {i === 0 ? t('Now') : hourOf(h.time)}
                  </text>
                </g>
              ) : null,
            )}
          </g>
        ) : (
          <text className="bp-small" x="172" y="54">
            {t('No hourly forecast yet')}
          </text>
        )}

        {/* The week, each day's low to high as a dimension line on one scale. */}
        <rect className="bp-box" x="12" y="132" width="296" height="36" />
        <text className="bp-cell-s" x="15" y="138.2">
          {t('This week')}
        </text>
        {week.map((d, i) => {
          const x = 46 + i * colW;
          const lo = deg(d.low, unit);
          const hi = deg(d.high, unit);
          const dx = x + 21;
          return (
            <g key={d.date}>
              <path className="bp-rule-soft" d={`M${x} 132 V168`} />
              <text className="bp-cell-s" x={x + 2.4} y="138.2">
                {dayName(d.date, i)}
              </text>
              <SkyIcon code={d.code} className="wsh-icon" at={{ x: x + 2, y: 142, size: 10 }} />
              {d.precipPct >= 20 && (
                <text className="wsh-pct" x={x + 2.6} y="162">
                  {d.precipPct}%
                </text>
              )}
              <path className="wsh-dim" d={`M${dx} ${wy(hi).toFixed(2)} V${wy(lo).toFixed(2)} M${dx - 1.6} ${wy(hi).toFixed(2)} h3.2 M${dx - 1.6} ${wy(lo).toFixed(2)} h3.2`} />
              <text className="bp-label-u" x={dx + 2.4} y={wy(hi) + 1.1}>
                {hi}°
              </text>
              <text className="bp-label-u" x={dx + 2.4} y={wy(lo) + 1.1}>
                {lo}°
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
