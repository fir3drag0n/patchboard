// A row that scrolls sideways fades at its right edge while there is more to
// see, so what sits past the edge isn't lost. Marks each matching element
// with data-more; styles.css draws the fade.

import { type RefObject, useEffect } from 'react';

export function useEdgeFade(root: RefObject<HTMLElement | null>, selector?: string): void {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const rows = selector ? [...el.querySelectorAll<HTMLElement>(selector)] : [el];
    const mark = (r: HTMLElement) => {
      // Only a row that scrolls: one that wraps can still measure wider, from
      // a hover label hanging past its last item, and has nothing hidden.
      const scrolls = /auto|scroll/.test(getComputedStyle(r).overflowX);
      if (scrolls && r.scrollWidth - r.clientWidth - r.scrollLeft > 4) r.dataset.more = '';
      else delete r.dataset.more;
    };
    const onScroll = (e: Event) => mark(e.currentTarget as HTMLElement);
    const ro = new ResizeObserver(() => rows.forEach(mark));
    for (const r of rows) {
      mark(r);
      r.addEventListener('scroll', onScroll, { passive: true });
      ro.observe(r);
    }
    return () => {
      ro.disconnect();
      for (const r of rows) r.removeEventListener('scroll', onScroll);
    };
  });
}
