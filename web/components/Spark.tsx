// Hairline charts. One stroke in ink, no fill, no axes: a sparkline answers
// "is this climbing?". Point at it to read a value and when.

import type { Series } from '../../shared/types.ts';
import { plainNumber, readingTime, useChartTip } from './ChartTip.tsx';

export function Spark({
  data,
  height = 32,
  min = 0,
  max,
  label,
  format = plainNumber,
}: {
  data: Series | undefined;
  height?: number;
  min?: number;
  max?: number;
  label: string;
  /** How a reading reads when you point at it. */
  format?: (v: number) => string;
}) {
  const ok = !!data && data.length > 1;
  const t0 = ok ? data[0][0] : 0;
  const t1 = ok ? data[data.length - 1][0] : 1;
  const top = max ?? (ok ? Math.max(...data.map((d) => d[1])) * 1.15 : 1);
  const span = top - min || 1;
  const yOf = (v: number) => height - 1 - ((Math.min(top, Math.max(min, v)) - min) / span) * (height - 2);
  const xOf = (t: number) => (t - t0) / (t1 - t0 || 1);
  const xs = ok ? data.map((d) => xOf(d[0])) : [];
  const tip = useChartTip(xs, (i) => {
    const [t, v] = data![i];
    return { x: xs[i], y: yOf(v) / height, text: format(v), when: readingTime(t, t1 - t0) };
  });
  if (!ok) {
    return <div className="spark spark-empty" style={{ height }} role="img" aria-label={`${label}: not enough history yet`} />;
  }
  const pts = data.map(([t, v]) => `${(xOf(t) * 100).toFixed(2)},${yOf(v).toFixed(2)}`).join(' ');
  return (
    <span className={`spark-wrap ${tip.on ? 'is-pointed' : ''}`} style={{ height }} {...tip.handlers}>
      <svg className="spark" viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" style={{ height }} role="img" aria-label={label}>
        <line className="spark-base" x1="0" x2="100" y1={height - 0.5} y2={height - 0.5} vectorEffect="non-scaling-stroke" />
        <polyline points={pts} vectorEffect="non-scaling-stroke" />
      </svg>
      {/* The latest reading: where the line is now. */}
      <i className="spark-now" style={{ top: `${(yOf(data[data.length - 1][1]) / height) * 100}%` }} aria-hidden />
      {tip.overlay}
    </span>
  );
}

/** A hairline bar split into parts, e.g. memory: services, cache, free. */
export function Split({ parts, label }: { parts: { value: number; tone: 'ink' | 'mid' | 'faint' | 'warn' | 'crit'; title: string }[]; label: string }) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  return (
    <div className="split" role="img" aria-label={label}>
      {parts.map((p) => (
        <span key={p.title} className={`split-${p.tone}`} style={{ width: `${(p.value / total) * 100}%` }} title={p.title} />
      ))}
    </div>
  );
}

/**
 * Several lines on one scale and one stretch of time, for readings that
 * belong together (a car's four tires). Each line names itself for screen
 * readers; a class lets one stand out.
 */
export function Lines({ lines, height = 40, label, format = plainNumber }: { lines: { data: Series | undefined; label: string; className?: string }[]; height?: number; label: string; format?: (v: number) => string }) {
  const all = lines.flatMap((l) => l.data ?? []);
  const ok = all.length > 1;
  const t0 = ok ? Math.min(...all.map((p) => p[0])) : 0;
  const t1 = ok ? Math.max(...all.map((p) => p[0])) : 1;
  const lo = ok ? Math.min(...all.map((p) => p[1])) : 0;
  const hi = ok ? Math.max(...all.map((p) => p[1])) : 1;
  const pad = (hi - lo) * 0.15 || 0.05;
  const yOf = (v: number) => height - 1 - ((v - (lo - pad)) / (hi - lo + 2 * pad)) * (height - 2);
  const xOf = (t: number) => (t - t0) / (t1 - t0 || 1);
  // Pointing reads the lowest line at that moment: the one worth watching.
  const times = ok ? [...new Set(all.map((p) => p[0]))].sort((a, b) => a - b) : [];
  const xs = times.map(xOf);
  const tip = useChartTip(xs, (i) => {
    const at = times[i];
    let low: { label: string; v: number } | null = null;
    for (const l of lines) {
      const p = l.data?.reduce<[number, number] | null>((best, q) => (!best || Math.abs(q[0] - at) < Math.abs(best[0] - at) ? q : best), null);
      if (p && (!low || p[1] < low.v)) low = { label: l.label, v: p[1] };
    }
    return low ? { x: xs[i], y: yOf(low.v) / height, text: `${low.label} ${format(low.v)}`, when: readingTime(at, t1 - t0) } : null;
  });
  if (!ok) return <div className="spark spark-empty" style={{ height }} role="img" aria-label={`${label}: not enough history yet`} />;
  return (
    <span className={`spark-wrap ${tip.on ? 'is-pointed' : ''}`} style={{ height }} {...tip.handlers}>
      <svg className="spark spark-lines" viewBox={`0 0 100 ${height}`} preserveAspectRatio="none" style={{ height }} role="img" aria-label={label}>
        <line className="spark-base" x1="0" x2="100" y1={height - 0.5} y2={height - 0.5} vectorEffect="non-scaling-stroke" />
        {lines.map((l) =>
          (l.data?.length ?? 0) > 1 ? (
            <polyline key={l.label} className={l.className} points={l.data!.map(([t, v]) => `${(xOf(t) * 100).toFixed(2)},${yOf(v).toFixed(2)}`).join(' ')} vectorEffect="non-scaling-stroke">
              <title>{l.label}</title>
            </polyline>
          ) : null,
        )}
      </svg>
      {tip.overlay}
    </span>
  );
}
