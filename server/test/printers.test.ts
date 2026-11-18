import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { printersFromStates, type RawState, tidyTask, toMinutes } from '../adapters/printers.ts';

// A P1S as ha-bambulab 2.4 reports it to a Home Assistant set to °F.
const s = (id: string, state: string, attributes: Record<string, unknown> = {}): RawState => ({ entity_id: id, state, last_changed: '2026-11-17T17:39:26Z', attributes });
const p1s = (over: Record<string, string> = {}): RawState[] => {
  const base: Record<string, [string, Record<string, unknown>?]> = {
    'sensor.p1s_x_print_status': ['finish', { friendly_name: 'P1S_X Print status' }],
    'sensor.p1s_x_print_progress': ['100', { unit_of_measurement: '%' }],
    'sensor.p1s_x_current_stage': ['idle'],
    'sensor.p1s_x_remaining_time': ['0.0', { unit_of_measurement: 'h' }],
    'sensor.p1s_x_task_name': ['Furman_power_button_cover_v3.stl + Furman_power_button_cover_v3.stl + Furman_power_button_cover_v...'],
    'sensor.p1s_x_current_layer': ['57'],
    'sensor.p1s_x_total_layer_count': ['57'],
    'sensor.p1s_x_nozzle_temperature': ['78.8', { unit_of_measurement: '°F' }],
    'sensor.p1s_x_nozzle_target_temperature': ['32.0', { unit_of_measurement: '°F' }],
    'sensor.p1s_x_bed_temperature': ['75.2', { unit_of_measurement: '°F' }],
    'sensor.p1s_x_bed_target_temperature': ['32.0', { unit_of_measurement: '°F' }],
    'sensor.p1s_x_printer_name': ['Bambu Lab P1S'],
    'binary_sensor.p1s_x_online': ['on'],
    'binary_sensor.p1s_x_print_error': ['off'],
    'binary_sensor.p1s_x_hms_errors': ['off'],
    'image.p1s_x_cover_image': ['2026-11-17T17:39:26.598777'],
    'sensor.p1s_x_ams_1_tray_1': ['Bambu PLA Basic', { color: '#00AE42FF', active: true }],
    'sensor.p1s_x_ams_1_tray_2': ['Bambu PLA Basic', { color: '#161616FF' }],
    'sensor.p1s_x_externalspool_external_spool': ['Empty'],
    'sensor.living_room_temperature': ['71.2', { unit_of_measurement: '°F' }],
  };
  return Object.entries(base).map(([id, [state, attrs]]) => s(id, over[id] ?? state, attrs));
};

test('a Bambu Lab printer from Home Assistant: status, tidy name, units kept, trays', () => {
  const [p] = printersFromStates(p1s());
  assert.equal(p.id, 'p1s_x');
  assert.equal(p.name, 'Bambu Lab P1S');
  assert.equal(p.status, 'finish');
  assert.equal(p.online, true);
  assert.equal(p.task, 'Furman power button cover v3');
  assert.equal(p.progress, 100);
  assert.equal(p.minutesLeft, 0);
  assert.deepEqual([p.layer, p.layers], [57, 57]);
  // 32 °F is the 0 °C an idle heater reports: off.
  assert.deepEqual(p.nozzle, { now: 78.8, target: 0, unit: '°F' });
  const hot = printersFromStates(p1s({ 'sensor.p1s_x_nozzle_target_temperature': '428' }))[0];
  assert.equal(hot.nozzle?.target, 428);
  assert.equal(p.error, false);
  assert.match(p.cover!, /^\/api\/img\/ha-printer\?id=image\.p1s_x_cover_image&v=/);
  assert.deepEqual(p.trays, [
    { name: 'Bambu PLA Basic', color: '#00ae42', active: true },
    { name: 'Bambu PLA Basic', color: '#161616', active: false },
  ]);
});

test('printing, offline, errors and the time left in any unit', () => {
  const [p] = printersFromStates(p1s({ 'sensor.p1s_x_print_status': 'running', 'sensor.p1s_x_remaining_time': '1.25', 'sensor.p1s_x_print_progress': '61' }));
  assert.equal(p.status, 'running');
  assert.equal(p.minutesLeft, 75);
  assert.equal(p.progress, 61);
  assert.equal(printersFromStates(p1s({ 'binary_sensor.p1s_x_online': 'off', 'sensor.p1s_x_print_status': 'running' }))[0].status, 'offline');
  const broken = p1s({ 'binary_sensor.p1s_x_hms_errors': 'on' }).map((e) => (e.entity_id.endsWith('hms_errors') ? { ...e, attributes: { '1-Error': 'HMS_0300_0C00_0001_0004: The build plate is not placed properly.', '1-Wiki': 'https://wiki.bambulab.com' } } : e));
  const [b] = printersFromStates(broken);
  assert.equal(b.error, true);
  assert.deepEqual(b.errors, ['The build plate is not placed properly.']);
  assert.equal(toMinutes(90, 's'), 2);
  assert.equal(toMinutes(2, 'h'), 120);
  assert.equal(toMinutes(45, 'min'), 45);
});

test('no printer without a progress sensor; unknown values stay out', () => {
  assert.deepEqual(printersFromStates([s('sensor.washer_print_status', 'done')]), []);
  const [p] = printersFromStates(p1s({ 'sensor.p1s_x_task_name': 'unknown', 'sensor.p1s_x_nozzle_temperature': 'unavailable', 'image.p1s_x_cover_image': 'unknown' }));
  assert.equal(p.task, undefined);
  assert.equal(p.nozzle, undefined);
  assert.equal(p.cover, undefined);
});

test('task names: MakerWorld ids, extensions and repeats go', () => {
  assert.equal(tidyTask('209821-Furman_power_button_cover_v3.gcode.3mf'), 'Furman power button cover v3');
  assert.equal(tidyTask('Benchy.3mf + Clip.stl'), 'Benchy, Clip');
  assert.equal(tidyTask('Long_name_that_got_cut...'), 'Long name that got cut');
});
