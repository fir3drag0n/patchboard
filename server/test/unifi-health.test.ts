import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toUnifiHealth } from '../adapters/network.ts';

test('UniFi health: Internet, WAN, clients and the last speed test in one summary', () => {
  const h = toUnifiHealth([
    { subsystem: 'wlan', status: 'warning', num_user: 75 },
    { subsystem: 'wan', status: 'ok', wan_ip: '198.51.100.7', isp_name: 'Telekom', 'rx_bytes-r': 103234, 'tx_bytes-r': 23232 },
    { subsystem: 'www', status: 'ok', latency: 5, uptime: 1086103, xput_down: 1073, xput_up: 555, speedtest_lastrun: 1795497017 },
    { subsystem: 'lan', status: 'error', num_user: 15 },
    { subsystem: 'vpn', status: 'ok' },
  ]);
  assert.ok(h);
  assert.equal(h.isp, 'Telekom');
  assert.equal(h.wanIp, '198.51.100.7');
  assert.equal(h.latencyMs, 5);
  assert.equal(h.downBps, 103234);
  assert.equal(h.upBps, 23232);
  assert.equal(h.wlanClients, 75);
  assert.equal(h.lanClients, 15);
  assert.deepEqual(h.speedtest, { down: 1073, up: 555, at: 1795497017000 });
  assert.deepEqual(h.status.map((s) => s.part), ['wlan', 'wan', 'www', 'lan', 'vpn']);
});

test('UniFi health: no WAN and no Internet rows, no health; no speed test run, no speed test', () => {
  assert.equal(toUnifiHealth([{ subsystem: 'wlan', status: 'ok', num_user: 3 }]), undefined);
  assert.equal(toUnifiHealth([{ subsystem: 'www', status: 'ok', xput_down: 0, xput_up: 0 }])?.speedtest, undefined);
});
