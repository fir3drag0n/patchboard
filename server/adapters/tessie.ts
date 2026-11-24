// Tessie: your Tesla's battery, range, charging, climate and locks, from
// Tessie's cached state. Reading it never wakes the car, so polling costs
// nothing in battery. https://developer.tessie.com

import { type Car, type CarData, TIRES } from '../../shared/types.ts';
import { config } from '../config.ts';
import { getJson } from '../http.ts';
import { type Adapter, MINUTE } from './adapter.ts';

interface Vehicle {
  vin: string;
  last_state?: {
    display_name?: string;
    state?: string; // online, asleep, offline
    charge_state?: {
      battery_level?: number;
      battery_range?: number; // miles
      charging_state?: string; // Charging, Complete, Disconnected, Stopped, Starting, NoPower
      minutes_to_full_charge?: number;
      charge_limit_soc?: number;
      charger_power?: number; // kW
      timestamp?: number;
      usable_battery_level?: number;
      charge_energy_added?: number; // kWh, this session
      charger_voltage?: number;
      charger_actual_current?: number;
      conn_charge_cable?: string; // "<invalid>" with no cable in
      charge_port_door_open?: boolean;
    };
    climate_state?: { inside_temp?: number; outside_temp?: number; is_climate_on?: boolean; driver_temp_setting?: number };
    vehicle_state?: {
      locked?: boolean;
      odometer?: number;
      sentry_mode?: boolean;
      car_version?: string;
      // In bar; null while the car hasn't measured since it woke.
      tpms_pressure_fl?: number | null;
      tpms_pressure_fr?: number | null;
      tpms_pressure_rl?: number | null;
      tpms_pressure_rr?: number | null;
      // 0 shut, anything else open: driver front, driver rear, passenger front, passenger rear, front and rear trunk.
      df?: number;
      dr?: number;
      pf?: number;
      pr?: number;
      ft?: number;
      rt?: number;
    };
    vehicle_config?: { car_type?: string; trim_badging?: string };
    drive_state?: { shift_state?: string | null };
  };
}

export function toCar(v: Vehicle): Car | null {
  const s = v.last_state;
  const c = s?.charge_state;
  if (!s || !c || c.battery_level == null) return null;
  return {
    vin: v.vin,
    name: s.display_name || 'Tesla',
    battery: c.battery_level,
    rangeMi: Math.round(c.battery_range ?? 0),
    charging: c.charging_state ?? 'Disconnected',
    minutesToFull: c.charging_state === 'Charging' ? c.minutes_to_full_charge : undefined,
    chargeKw: c.charging_state === 'Charging' ? c.charger_power : undefined,
    limit: c.charge_limit_soc ?? 80,
    insideC: s.climate_state?.inside_temp,
    outsideC: s.climate_state?.outside_temp,
    climateOn: !!s.climate_state?.is_climate_on,
    locked: s.vehicle_state?.locked ?? true,
    sentry: !!s.vehicle_state?.sentry_mode,
    odometerMi: Math.round(s.vehicle_state?.odometer ?? 0),
    driving: !!s.drive_state?.shift_state && s.drive_state.shift_state !== 'P',
    asleep: s.state === 'asleep',
    updatedAt: c.timestamp ?? Date.now(),
    setC: s.climate_state?.driver_temp_setting,
    tires: tiresOf(s.vehicle_state),
    model: modelName(s.vehicle_config?.car_type),
    trim: s.vehicle_config?.trim_badging || undefined,
    usable: c.usable_battery_level,
    addedKwh: c.charge_energy_added,
    volts: c.charging_state === 'Charging' ? c.charger_voltage : undefined,
    amps: c.charging_state === 'Charging' ? c.charger_actual_current : undefined,
    cable: c.conn_charge_cable == null ? undefined : c.conn_charge_cable !== '<invalid>' && c.conn_charge_cable !== '',
    portOpen: c.charge_port_door_open,
    open: openParts(s.vehicle_state),
  };
}

/** "model3" is "Model 3"; "cybertruck" is "Cybertruck". */
export function modelName(t?: string): string | undefined {
  if (!t) return undefined;
  const m = /^model([a-z0-9])$/i.exec(t);
  return m ? `Model ${m[1].toUpperCase()}` : t.charAt(0).toUpperCase() + t.slice(1);
}

/** Doors and trunks that stand open, when the car says. Tesla's driver side is left. */
function openParts(v: NonNullable<Vehicle['last_state']>['vehicle_state']): Car['open'] {
  if (!v || v.df == null) return undefined;
  return { fl: !!v.df, rl: !!v.dr, fr: !!v.pf, rr: !!v.pr, frunk: !!v.ft, trunk: !!v.rt };
}

/** All four pressures, or none: a car that has only some reports none yet. */
function tiresOf(v: NonNullable<Vehicle['last_state']>['vehicle_state']): Car['tires'] {
  const p = TIRES.map((t) => v?.[`tpms_pressure_${t}`]);
  if (p.some((x) => typeof x !== 'number' || !(x > 0))) return undefined;
  return { fl: p[0]!, fr: p[1]!, rl: p[2]!, rr: p[3]! };
}

export function tessieAdapter(): Adapter<CarData> {
  const { token, vin } = config.tessie!;
  return {
    id: 'tessie',
    label: 'Tesla',
    intervalMs: 2 * MINUTE,
    async fetch() {
      const r = await getJson<{ results: Vehicle[] }>('https://api.tessie.com/vehicles?only_active=false', {
        headers: { Authorization: `Bearer ${token}` },
      });
      const cars = r.results
        .filter((v) => !vin || v.vin === vin)
        .map(toCar)
        .filter((c): c is Car => c !== null);
      return { cars };
    },
  };
}
