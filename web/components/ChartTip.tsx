// Point at a chart line to read it: a dot on the line and a small tag with
// the value and when. A mouse shows it while it moves over the chart; a tap
// shows it for a moment. Nothing is worked out until you point, so a board
// full of sparklines costs nothing extra.

import { type PointerEvent, type ReactNode, useEffect, useRef, useState } from 'react';
import { clock, dayLabel } from '../lib/format.ts';
import { locale } from '../lib/region.ts';

/** When a reading was taken, as briefly as its chart's span allows. */
export function readingTime(t: number, span: number): string {
  // Not a time: a chart drawn by position only.
  if (t < 1e11) return '';
  if (span <= 36 * 3_600_000) return clock(t);
  if (span <= 8 * 86_400_000) return `${new Date(t).toLocaleDateString(locale(), { weekday: 'short' })} ${clock(t)}`;
  return new Date(t).toLocaleDateString(locale(), { month: 'short', day: 'numeric' });
}

/** A whole number, or one decimal when the value is small. */
export const plainNumber = (v: number) => v.toLocaleString(locale(), { maximumFractionDigits: Math.abs(v) < 10 ? 1 : 0 });

export interface Tip {
  /** Across the chart, 0 to 1. */
  x: number;
  /** Down the chart, 0 to 1; leave it out for no dot. */
  y?: number;
  text: string;
  /** When, from readingTime. */
  when?: string;
}

/**
 * `xs` are each reading's place across the chart (0 to 1, in order);
 * `at(i)` says where reading i sits and what it reads.
 */
export function useChartTip(xs: number[], at: (i: number) => Tip | null) {
  const [i, setI] = useState<number | null>(null);
  const timer = useRef(0);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  // The chart redrew under the pointer with other readings: start over.
  useEffect(() => setI(null), [xs.length]);

  const pick = (e: PointerEvent<HTMLElement>) => {
    if (!xs.length) return;
    const r = e.currentTarget.getBoundingClientRect();
    const f = (e.clientX - r.left) / (r.width || 1);
    let lo = 0;
    let hi = xs.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] < f) lo = mid + 1;
      else hi = mid;
    }
    const n = lo > 0 && f - xs[lo - 1] < xs[lo] - f ? lo - 1 : lo;
    setI((was) => (was === n ? was : n));
  };

  const handlers = {
    onPointerMove: (e: PointerEvent<HTMLElement>) => e.pointerType === 'mouse' && pick(e),
    onPointerLeave: (e: PointerEvent<HTMLElement>) => e.pointerType === 'mouse' && setI(null),
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      if (e.pointerType === 'mouse') return;
      pick(e);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setI(null), 2500);
    },
  };

  const tip = i == null ? null : at(i);
  const overlay: ReactNode = tip ? (
    <>
      {tip.y != null && <i className="tip-dot" style={{ left: `${tip.x * 100}%`, top: `${tip.y * 100}%` }} aria-hidden />}
      <span className="tip-tag" data-side={tip.x > 0.75 ? 'end' : tip.x < 0.25 ? 'start' : 'mid'} style={{ left: `${tip.x * 100}%` }} aria-hidden>
        <b>{tip.text}</b>
        {tip.when && <span>{tip.when}</span>}
      </span>
    </>
  ) : null;
  return { handlers, overlay, on: tip != null };
}
