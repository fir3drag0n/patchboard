// The weather as an office display: what it's doing now, large, on the
// left; the next 24 hours as one chart of temperature over the chance of
// rain, night shaded, on the right; and the week below it, each day's low
// and high on the week's own scale. One 16:9 sheet: a card on a board, or
// the whole screen when the widget is shown alone on a TV or a wall tablet.

import type { WeatherData, WeatherHour } from '../../shared/types.ts';
import { useAppearance } from '../lib/appearance.ts';
import { deg, weatherText } from '../lib/format.ts';
import { t } from '../lib/i18n.ts';
import { locale } from '../lib/region.ts';
import { useNow, useSource } from '../lib/store.tsx';

type Sky = 'clear' | 'partly' | 'cloud' | 'fog' | 'drizzle' | 'rain' | 'snow' | 'storm';

/** WMO weather codes, as Open-Meteo sends them, grouped by what to draw. */
function skyOf(code: number): Sky {
  if (code <= 1) return 'clear';
  if (code === 2) return 'partly';
  if (code === 3) return 'cloud';
  if (code === 45 || code === 48) return 'fog';
  if (code >= 51 && code <= 57) return 'drizzle';
  if ((code >= 61 && code <= 67) || (code >= 80 && code <= 82)) return 'rain';
  if ((code >= 71 && code <= 77) || code === 85 || code === 86) return 'snow';
  if (code >= 95) return 'storm';
  return 'cloud';
}

const CLOUD = 'M15 35h19.5a7.5 7.5 0 0 0 .4-15 10.5 10.5 0 0 0-20.4 2.8A6.2 6.2 0 0 0 15 35z';

/** A condition in drafting lines, in the text's own color. */
export function SkyIcon({ code, night, className }: { code: number; night?: boolean; className?: string }) {
  const sky = skyOf(code);
  const sun = (cx: number, cy: number, r: number) => (
    <g className="wd-sun">
      <circle cx={cx} cy={cy} r={r} />
      {Array.from({ length: 8 }, (_, i) => {
        const a = (i * Math.PI) / 4;
        return <path key={i} d={`M${cx + Math.cos(a) * (r + 3)} ${cy + Math.sin(a) * (r + 3)} L${cx + Math.cos(a) * (r + 6)} ${cy + Math.sin(a) * (r + 6)}`} />;
      })}
    </g>
  );
  const moon = (cx: number, cy: number, r: number) => <path className="wd-moon" d={`M${cx + r * 0.3} ${cy - r} a${r} ${r} 0 1 0 ${r * 0.7} ${r * 1.55} a${r * 0.8} ${r * 0.8} 0 0 1 ${-r * 0.7} ${-r * 1.55}z`} />;
  return (
    <svg className={`wd-icon ${className ?? ''}`} viewBox="0 0 48 48" aria-hidden="true">
      {sky === 'clear' && (night ? moon(24, 24, 11) : sun(24, 24, 8))}
      {sky === 'partly' && (
        <>
          {night ? moon(17, 15, 7) : sun(17, 16, 5)}
          <path className="wd-cloud" d={CLOUD} transform="translate(4 4)" />
        </>
      )}
      {sky !== 'clear' && sky !== 'partly' && <path className="wd-cloud" d={CLOUD} />}
      {sky === 'fog' && <path d="M10 40h28M14 44h20" />}
      {sky === 'drizzle' && <path d="M18 40v2M26 40v2M22 44v2M30 44v2" />}
      {sky === 'rain' && <path d="M17 39l-2 5M24 39l-2 5M31 39l-2 5" />}
      {sky === 'snow' && <path d="M17 41h0M24 41h0M31 41h0M20.5 45h0M27.5 45h0" className="wd-flakes" />}
      {sky === 'storm' && <path d="M25 36l-4 6h5l-3 6" />}
    </svg>
  );
}

export function WeatherDisplay() {
  const { data: w } = useSource<WeatherData>('weather');
  const { temp: unit, clock24 } = useAppearance();
  const now = useNow(60_000);
  if (!w) return null;
  const imperial = unit !== 'c';
  const speed = (kmh?: number) => (kmh == null ? '' : imperial ? `${Math.round(kmh * 0.621)} mph` : `${Math.round(kmh)} km/h`);
  const clock = (iso?: string) => (iso ? new Date(iso).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit', hour12: !clock24 }) : '');
  const hourOf = (iso: string) => new Date(iso).toLocaleTimeString(locale(), { hour: 'numeric', hour12: !clock24 });
  const today = w.days[0];
  const alert = w.alerts?.[0];

  // The next 24 hours from this one.
  const hours: WeatherHour[] = (w.hours ?? []).filter((h) => Date.parse(h.time) >= now - 3_600_000).slice(0, 25);
  const sunOn = (date: string) => w.days.find((d) => d.date === date);
  const isNight = (h: WeatherHour) => {
    const d = sunOn(h.time.slice(0, 10));
    if (!d?.sunrise || !d?.sunset) return w.isDay === false;
    const at = Date.parse(h.time);
    return at < Date.parse(d.sunrise) || at >= Date.parse(d.sunset);
  };
  const temps = hours.map((h) => h.temp);
  const tLo = Math.min(...temps) - 1.5;
  const tHi = Math.max(...temps) + 1.5;
  const n = Math.max(1, hours.length - 1);
  const x = (i: number) => (i / n) * 240;
  // The temperature takes the top two thirds; the chance of rain rises from the floor.
  const y = (c: number) => 8 + (1 - (c - tLo) / Math.max(1, tHi - tLo)) * 56;
  const line = hours.map((h, i) => `${i ? 'L' : 'M'}${x(i).toFixed(2)} ${y(h.temp).toFixed(2)}`).join(' ');
  const nights: [number, number][] = [];
  hours.forEach((h, i) => {
    if (!isNight(h)) return;
    const last = nights[nights.length - 1];
    if (last && last[1] === i - 1) last[1] = i;
    else nights.push([i, i]);
  });
  // Sunrise and sunset inside the window, placed between the hours they fall in.
  const t0 = hours.length ? Date.parse(hours[0].time) : now;
  const t1 = hours.length ? Date.parse(hours[hours.length - 1].time) : now;
  const marks = w.days
    .flatMap((d) => [
      ['rise', d.sunrise],
      ['set', d.sunset],
    ])
    .filter((m): m is [string, string] => !!m[1] && Date.parse(m[1]) > t0 && Date.parse(m[1]) < t1)
    .map(([kind, iso]) => ({ kind, iso, at: ((Date.parse(iso) - t0) / Math.max(1, t1 - t0)) * 100 }));

  // The week, each day's range on the week's own scale.
  const week = w.days.slice(0, 7);
  const wLo = Math.min(...week.map((d) => d.low));
  const wHi = Math.max(...week.map((d) => d.high));
  const pos = (c: number) => ((c - wLo) / Math.max(1, wHi - wLo)) * 100;
  const dayName = (date: string, i: number) => (i === 0 ? t('Today') : new Date(`${date}T12:00:00`).toLocaleDateString(locale(), { weekday: 'short' }));

  return (
    <div className="wd-stage">
      <div className="wd">
        <header className="wd-head">
          <span className="wd-place">{w.label}</span>
          <span className="wd-date">{new Date(now).toLocaleDateString(locale(), { weekday: 'long', month: 'long', day: 'numeric' })}</span>
          <span className="wd-clock">{new Date(now).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit', hour12: !clock24 })}</span>
        </header>

        <section className="wd-now" aria-label={t('Now')}>
          <div className="wd-hero">
            <SkyIcon code={w.codeNow} night={w.isDay === false} className="wd-icon-now" />
            <span className="wd-temp">{deg(w.tempNow, unit)}°</span>
          </div>
          <div className="wd-cond">{weatherText(w.codeNow)}</div>
          {today && <div className="wd-range">{t('High {high}°, low {low}°', { high: deg(today.high, unit), low: deg(today.low, unit) })}</div>}
          {alert && (
            <div className={`wd-alert ${/extreme|severe/i.test(alert.severity) ? 'is-severe' : ''}`}>
              {alert.event}
              {alert.until && <small> {t('until {time}', { time: clock(alert.until) })}</small>}
            </div>
          )}
          <dl className="wd-stats">
            {w.feelsNow != null && (
              <div>
                <dt>{t('Feels like')}</dt>
                <dd>{deg(w.feelsNow, unit)}°</dd>
              </div>
            )}
            {w.windNow != null && (
              <div>
                <dt>{t('Wind')}</dt>
                <dd>{speed(w.windNow)}</dd>
              </div>
            )}
            {w.humidityNow != null && (
              <div>
                <dt>{t('Humidity')}</dt>
                <dd>{w.humidityNow}%</dd>
              </div>
            )}
            {today?.uvMax != null && (
              <div>
                <dt>{t('UV')}</dt>
                <dd>{Math.round(today.uvMax)}</dd>
              </div>
            )}
            {today?.sunrise && (
              <div>
                <dt>{t('Sunrise')}</dt>
                <dd>{clock(today.sunrise)}</dd>
              </div>
            )}
            {today?.sunset && (
              <div>
                <dt>{t('Sunset')}</dt>
                <dd>{clock(today.sunset)}</dd>
              </div>
            )}
          </dl>
        </section>

        <section className="wd-day" aria-label={t('Next 24 hours')}>
          <h2 className="wd-h">{t('Next 24 hours')}</h2>
          {hours.length > 1 ? (
            <div className="wd-chart">
              <svg viewBox="0 0 240 100" preserveAspectRatio="none" aria-hidden="true">
                {nights.map(([a, b]) => (
                  <rect key={a} className="wd-night" x={x(Math.max(0, a - 0.5))} width={x(Math.min(n, b + 0.5)) - x(Math.max(0, a - 0.5))} y="0" height="100" />
                ))}
                {hours.map((h, i) =>
                  h.precipPct >= 5 ? <rect key={h.time} className="wd-rain" x={x(i) - 3} width="6" y={100 - h.precipPct * 0.3} height={h.precipPct * 0.3} /> : null,
                )}
                <path className="wd-line" d={line} />
              </svg>
              {/* Words and figures over the chart, so they keep their shape at any size. */}
              {hours.map((h, i) =>
                // Every third hour, unless sunrise or sunset is marked right there.
                i % 3 === 0 && !marks.some((m) => Math.abs(m.at - (i / n) * 100) < 4) ? (
                  <span key={h.time} className="wd-pt" style={{ left: `${(i / n) * 100}%`, top: `${y(h.temp)}%` }}>
                    <b>{deg(h.temp, unit)}°</b>
                    {h.precipPct >= 20 && <i>{h.precipPct}%</i>}
                  </span>
                ) : null,
              )}
              {marks.map((m) => (
                <span key={m.iso} className="wd-mark" style={{ left: `${m.at}%` }}>
                  {m.kind === 'rise' ? t('Sunrise') : t('Sunset')} {clock(m.iso)}
                </span>
              ))}
              <div className="wd-hours">
                {hours.map((h, i) =>
                  i % 3 === 0 ? (
                    <span key={h.time} style={{ left: `${(i / n) * 100}%` }}>
                      {i === 0 ? t('Now') : hourOf(h.time)}
                    </span>
                  ) : null,
                )}
              </div>
            </div>
          ) : (
            <p className="wd-empty">{t('No hourly forecast yet')}</p>
          )}
        </section>

        <section className="wd-week" aria-label={t('This week')}>
          <h2 className="wd-h">{t('This week')}</h2>
          <ol>
            {week.map((d, i) => (
              <li key={d.date}>
                <span className="wd-wday">{dayName(d.date, i)}</span>
                <SkyIcon code={d.code} className="wd-icon-day" />
                <span className="wd-wrain">{d.precipPct >= 20 ? `${d.precipPct}%` : ''}</span>
                <span className="wd-lo">{deg(d.low, unit)}°</span>
                <span className="wd-track" aria-hidden="true">
                  <b style={{ left: `${pos(d.low)}%`, width: `${Math.max(2, pos(d.high) - pos(d.low))}%` }} />
                </span>
                <span className="wd-hi">{deg(d.high, unit)}°</span>
              </li>
            ))}
          </ol>
        </section>
      </div>
    </div>
  );
}
