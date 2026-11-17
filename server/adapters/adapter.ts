import type { SourceId } from '../../shared/types.ts';

/**
 * One integration. The hub polls `fetch` every `intervalMs` and caches the
 * result. Every adapter has a real implementation and a demo implementation
 * with the same shape, selected at startup by DEMO=1.
 */
export interface Adapter<T = unknown> {
  id: SourceId;
  label: string;
  intervalMs: number;
  fetch(): Promise<T>;
  /**
   * Optional push: keep one line open to the service. `update` hands over new
   * data the line already carried; `refresh` asks for a poll now. Returns a
   * function that closes the line. Polling carries on underneath, slower.
   */
  live?(on: { update(data: T): void; refresh(): void }): () => void;
}

export const SECOND = 1000;

/**
 * Runs what it's given one at a time, in order. For changes that read a
 * list, edit it and write it back: two at once would each read the old list,
 * and the second would undo the first.
 */
export function oneAtATime(): <T>(fn: () => Promise<T>) => Promise<T> {
  let last: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>) => {
    const run = last.then(fn, fn);
    last = run.catch(() => {});
    return run;
  };
}
export const MINUTE = 60 * SECOND;
