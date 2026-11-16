// Rules about the car that the server, the widget and its one number share.

import { type Car, TIRES, type TirePos } from './types.ts';

export const PSI = 14.5038;

/** When a tire counts as low, from Settings, Alerts. 0 turns a check off. */
export interface TireLimits {
  tireLowPsi?: number;
  tireSpreadPsi?: number;
}

/**
 * A tire to look at: low outright (under 38 psi by default, where Tesla's own
 * warning sits near 36), or soft against the others (3 psi under the fullest).
 */
export function softTires(tires: Car['tires'], limits: TireLimits = {}): TirePos[] {
  if (!tires) return [];
  const low = limits.tireLowPsi ?? 38;
  const spread = limits.tireSpreadPsi ?? 3;
  const top = Math.max(...TIRES.map((t) => tires[t]));
  return TIRES.filter((t) => (low > 0 && tires[t] * PSI < low) || (spread > 0 && (top - tires[t]) * PSI >= spread));
}
