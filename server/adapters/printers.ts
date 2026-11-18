// 3D printers, read from Home Assistant's states: the Bambu Lab integration
// (ha-bambulab, from HACS) names each printer's entities with one shared
// start, such as sensor.p1s_<serial>_print_status. Home Assistant has already
// signed in to the printer, by cloud or LAN, so Patchboard needs no code of
// its own and works with any firmware the integration does.

import type { Printer, PrinterTemp, PrinterTray } from '../../shared/types.ts';

export interface RawState {
  entity_id: string;
  state: string;
  last_changed?: string;
  attributes?: Record<string, unknown>;
}

const GONE = new Set(['unknown', 'unavailable', 'none', '']);
const val = (s?: RawState) => (s && !GONE.has(s.state.trim().toLowerCase()) ? s.state.trim() : undefined);
const num = (s?: RawState) => {
  const v = val(s);
  const n = v == null ? NaN : Number(v);
  return Number.isFinite(n) ? n : undefined;
};
const unit = (s?: RawState) => (typeof s?.attributes?.unit_of_measurement === 'string' ? s.attributes.unit_of_measurement : undefined);

/** Minutes, from whatever unit Home Assistant shows the time left in. */
export function toMinutes(n: number, u = 'min'): number {
  const per: Record<string, number> = { s: 1 / 60, min: 1, h: 60, d: 1440 };
  return Math.round(n * (per[u] ?? 1));
}

/**
 * The print's name from the task, which Bambu builds from its files:
 * "Furman_power_button_cover_v3.stl + Furman_power_button_cover_v3.stl + Fur..."
 * reads "Furman power button cover v3".
 */
export function tidyTask(task: string): string {
  const parts = task
    .split(' + ')
    .map((p) => p.trim())
    // Bambu cuts the task short with "..." mid-name; that part repeats another, or is lost.
    .filter((p) => p && !/(\.\.\.|…)$/.test(p))
    .map((p) => p.replace(/^\d+-/, '').replace(/\.(gcode\.3mf|3mf|stl|step|stp|obj|gcode)$/i, '').replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim());
  const unique = [...new Set(parts)].filter(Boolean);
  return unique.length ? unique.join(', ') : task.replace(/(\.\.\.|…)$/, '').replace(/_/g, ' ').trim();
}

/** A heater that's off reports a target of 0 °C, which Home Assistant may show as 32 °F or 273 K. */
const OFF: Record<string, number> = { '°C': 0, '°F': 32, K: 273.15 };

const temp = (now?: RawState, target?: RawState): PrinterTemp | undefined => {
  const n = num(now);
  if (n == null) return undefined;
  const u = unit(now) ?? '°C';
  const t = num(target) ?? 0;
  return { now: n, target: t <= (OFF[u] ?? 0) + 0.5 ? 0 : t, unit: u };
};

/** #rrggbb from Bambu's #rrggbbaa or rrggbb. */
const color = (v: unknown): string | undefined => {
  const m = typeof v === 'string' ? /^#?([0-9a-f]{6})(?:[0-9a-f]{2})?$/i.exec(v.trim()) : null;
  return m ? `#${m[1].toLowerCase()}` : undefined;
};

/** Error words in an entity's attributes: ha-bambulab lists them as "1-Error", "2-Error"… or "error". */
const errorWords = (s?: RawState): string[] =>
  Object.entries(s?.attributes ?? {})
    .filter(([k, v]) => /^(\d+-)?error$/i.test(k) && typeof v === 'string' && v.trim())
    .map(([, v]) => String(v).replace(/^HMS_[0-9A-F_]+:\s*/i, '').trim());

/** Every printer in these states, by the print status sensor each has. */
export function printersFromStates(states: RawState[]): Printer[] {
  const by = new Map(states.map((s) => [s.entity_id, s]));
  const out: Printer[] = [];
  for (const s of states) {
    const m = /^sensor\.(.+)_print_status$/.exec(s.entity_id);
    if (!m) continue;
    const id = m[1];
    const get = (domain: string, suffix: string) => by.get(`${domain}.${id}_${suffix}`);
    // Only Bambu Lab's: it has a progress sensor beside the status.
    if (!get('sensor', 'print_progress')) continue;
    const online = get('binary_sensor', 'online');
    const raw = (val(s) ?? 'unknown').toLowerCase();
    const isOnline = online ? online.state === 'on' : raw !== 'offline';
    const status = isOnline ? raw : 'offline';
    const left = num(get('sensor', 'remaining_time'));
    const task = val(get('sensor', 'task_name'));
    const cover = get('image', 'cover_image');
    const errors = [...errorWords(get('binary_sensor', 'hms_errors')), ...errorWords(get('binary_sensor', 'print_error'))];
    const trays: PrinterTray[] = states
      .filter((t) => new RegExp(`^sensor\\.${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}_(ams_\\d+_tray_\\d+|externalspool_external_spool)$`).test(t.entity_id))
      .sort((a, b) => a.entity_id.localeCompare(b.entity_id, 'en', { numeric: true }))
      .map((t) => ({ name: val(t) ?? '', color: color(t.attributes?.color), active: t.attributes?.active === true || t.attributes?.in_use === true }))
      .filter((t) => t.name && t.name.toLowerCase() !== 'empty');
    const printer: Printer = {
      id,
      name: val(get('sensor', 'printer_name')) ?? (typeof s.attributes?.friendly_name === 'string' ? s.attributes.friendly_name.replace(/\s*print status$/i, '') : id),
      online: isOnline,
      status,
      error: get('binary_sensor', 'print_error')?.state === 'on' || get('binary_sensor', 'hms_errors')?.state === 'on',
      since: Date.parse(s.last_changed ?? '') || 0,
    };
    const stage = val(get('sensor', 'current_stage'));
    if (stage) printer.stage = stage.toLowerCase();
    if (task) printer.task = tidyTask(task);
    const progress = num(get('sensor', 'print_progress'));
    if (progress != null) printer.progress = Math.max(0, Math.min(100, progress));
    if (left != null) printer.minutesLeft = toMinutes(left, unit(get('sensor', 'remaining_time')));
    const layer = num(get('sensor', 'current_layer'));
    const layers = num(get('sensor', 'total_layer_count'));
    if (layer != null && layers) {
      printer.layer = layer;
      printer.layers = layers;
    }
    const nozzle = temp(get('sensor', 'nozzle_temperature'), get('sensor', 'nozzle_target_temperature'));
    const bed = temp(get('sensor', 'bed_temperature'), get('sensor', 'bed_target_temperature'));
    if (nozzle) printer.nozzle = nozzle;
    if (bed) printer.bed = bed;
    if (errors.length) printer.errors = [...new Set(errors)];
    // The picture's state is when it last changed, so a new print shows its own.
    if (cover && val(cover)) printer.cover = `/api/img/ha-printer?id=${encodeURIComponent(cover.entity_id)}&v=${encodeURIComponent(cover.state)}`;
    if (trays.length) printer.trays = trays;
    out.push(printer);
  }
  return out;
}

/** Cover pictures Patchboard may fetch: only the ones the last read named. */
const covers = new Set<string>();
export function rememberCovers(printers: Printer[]): void {
  covers.clear();
  for (const p of printers) if (p.cover) covers.add(`image.${p.id}_cover_image`);
}
export const knownCover = (id: string): boolean => covers.has(id);
