// What the car widget can ask the car to do, through Tessie. The key is
// Patchboard's name; the value is Tessie's command (POST /{vin}/command/<it>).

export const CAR_COMMANDS = {
  lock: 'lock',
  unlock: 'unlock',
  frunk: 'activate_front_trunk',
  // Opens the trunk; on a powered trunk, closes an open one.
  trunk: 'activate_rear_trunk',
  'port-open': 'open_charge_port',
  'port-close': 'close_charge_port',
  'charge-start': 'start_charging',
  'charge-stop': 'stop_charging',
  'climate-on': 'start_climate',
  'climate-off': 'stop_climate',
  'sentry-on': 'enable_sentry',
  'sentry-off': 'disable_sentry',
  limit: 'set_charge_limit',
  flash: 'flash',
  honk: 'honk',
} as const;

export type CarCommand = keyof typeof CAR_COMMANDS;

/** Commands that let someone into the car: only with sign-in on, never from an open address. */
export const OPENS_CAR: readonly CarCommand[] = ['unlock', 'frunk', 'trunk'];

export function isCarCommand(x: string): x is CarCommand {
  return Object.hasOwn(CAR_COMMANDS, x);
}

/** A charge limit Tesla accepts: 50 to 100 percent. */
export function checkLimit(v: unknown): number | null {
  const n = Math.round(Number(v));
  return Number.isFinite(n) && n >= 50 && n <= 100 ? n : null;
}
