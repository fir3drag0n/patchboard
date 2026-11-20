import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { maintenanceAlerts, parseOracle, parseUnraid } from '../maintenance.ts';

test('Maintenance: the Unraid gate lines become plugins, OS and restart', () => {
  const s = parseUnraid('PLUGIN dynamix.foo 2026.01.01 2026.02.01\nPLUGINX unraid-aicliagents 1.0 1.1\nOS 7.4.1 7.5.0 true\nREBOOT\nFERTIG');
  assert.equal(s.updates, 2);
  assert.equal(s.plugins?.length, 2);
  assert.equal(s.plugins?.[1].session, true);
  assert.deepEqual(s.os, { current: '7.4.1', latest: '7.5.0', newer: true });
  assert.equal(s.reboot, true);
  assert.throws(() => parseUnraid('OS 7.4.1 7.4.1 false'));
});

test('Maintenance: an Oracle status line, and the alerts it raises', () => {
  const s = parseOracle('{"server":"oracle2","updates":2,"packages":["fwupd","libfwupd3"],"reboot":true,"containers":28,"kernel":"7.0","mailcow":{"behind":3,"current":"a","latest":"b"}}');
  assert.equal(s.updates, 2);
  const alerts = maintenanceAlerts({ oracle2: { status: s }, oracle: { status: parseOracle('{"updates":0,"packages":[],"reboot":false,"mailcow":null}') } });
  assert.deepEqual(alerts.map((a) => a.id), ['maint-updates-oracle2', 'maint-mailcow-oracle2', 'maint-reboot-oracle2']);
  assert.equal(alerts[0].title, 'oracle2 has updates: 2 packages');
  assert.equal(alerts[1].say?.vars?.version, 'b');
});
