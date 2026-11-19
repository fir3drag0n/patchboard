// Pull down to refresh, for the installed app and for a browser tab on a
// touch screen (where the page turns the browser's own pull off).
// The page follows the finger down and a ring fills in the gap above it; let
// go past the line and the page reloads, which also picks up a new version.

import { useEffect, useState } from 'react';

/** Slide the page under the top bar; the ring sits in the gap. */
function drag(px: number, settle = false): void {
  const main = document.getElementById('main-content');
  if (!main) return;
  main.style.transition = settle ? 'transform 0.2s ease-out' : '';
  main.style.transform = px ? `translateY(${px}px)` : '';
}

const LINE = 64;

function installed(): boolean {
  return matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true;
}

/** True when the touch began inside something already scrolled, like a log. */
function insideScrolled(t: EventTarget | null): boolean {
  for (let el = t as HTMLElement | null; el && el !== document.body; el = el.parentElement) {
    if (el.scrollTop > 0) return true;
  }
  return false;
}

export function PullRefresh() {
  const [pull, setPull] = useState(0);
  const [going, setGoing] = useState(false);

  useEffect(() => {
    // CSS uses it too: a little more room under the status bar.
    if (installed()) document.documentElement.classList.add('is-installed');
    // A browser tab has no gesture of its own here either: the page turns the
    // browser's pull off (overscroll-behavior), so every touch screen gets this one.
    if (!installed() && !matchMedia('(pointer: coarse)').matches) return;
    let startY = 0;
    let active = false;
    let dist = 0;
    const start = (e: TouchEvent) => {
      if (window.scrollY > 0 || e.touches.length !== 1 || document.documentElement.classList.contains('is-locked') || insideScrolled(e.target)) return;
      startY = e.touches[0].clientY;
      active = true;
      dist = 0;
    };
    const move = (e: TouchEvent) => {
      if (!active) return;
      if (window.scrollY > 0) {
        active = false;
        setPull(0);
        drag(0);
        return;
      }
      // Resistance: the page moves half as far as the finger.
      dist = Math.max(0, (e.touches[0].clientY - startY) * 0.5);
      const shown = Math.min(LINE * 1.6, dist);
      setPull(shown);
      drag(shown);
    };
    const end = () => {
      if (!active) return;
      active = false;
      if (dist >= LINE) {
        setGoing(true);
        drag(LINE, true);
        location.reload();
      } else {
        setPull(0);
        drag(0, true);
      }
    };
    window.addEventListener('touchstart', start, { passive: true });
    window.addEventListener('touchmove', move, { passive: true });
    window.addEventListener('touchend', end, { passive: true });
    window.addEventListener('touchcancel', end, { passive: true });
    return () => {
      window.removeEventListener('touchstart', start);
      window.removeEventListener('touchmove', move);
      window.removeEventListener('touchend', end);
      window.removeEventListener('touchcancel', end);
    };
  }, []);

  if (!pull && !going) return null;
  const p = going ? 1 : Math.min(1, pull / LINE);
  return (
    <div className="ptr" style={{ transform: `translate(-50%, ${(going ? LINE : pull) / 2}px)` }} role="status" aria-label={going ? 'Refreshing' : p >= 1 ? 'Release to refresh' : 'Pull to refresh'}>
      <span className={`ptr-ring ${p >= 1 ? 'is-ready' : ''} ${going ? 'is-going' : ''}`} style={{ ['--p' as string]: p }} />
    </div>
  );
}
