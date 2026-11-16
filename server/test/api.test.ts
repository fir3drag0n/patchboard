import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { apiRoutes, status } from '../api.ts';
import { checkKey, createKey, listKeys, revokeKey } from '../apikeys.ts';
import { kvSet } from '../db.ts';
import type { Snapshot } from '../../shared/types.ts';

const snap = {
  generatedAt: 1_700_000_000_000,
  sources: {
    docker: { data: { containers: [{ name: 'plex', image: 'plexinc/pms-docker', state: 'running', status: 'Up', health: 'healthy', project: 'media' }, { name: 'sonarr', image: 'linuxserver/sonarr', state: 'exited', status: 'Exited', health: null, project: 'media' }] } },
    stats: { data: { containers: { plex: { cpu: 12.34, memBytes: 500 } } } },
  },
  alerts: [{ id: 'a', level: 'critical', title: 'sonarr is not running', source: 'docker', since: 1_700_000_000_000 }],
  updates: { plex: {} },
  self: { version: '9.9.9' },
} as unknown as Snapshot;
const api = apiRoutes({ snapshot: () => snap, reading: async () => ({ value: '42' }) });
const mcp = (body: unknown) => api.request('/mcp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('API keys: shown once, checked by hash, named, revocable', () => {
  kvSet('api-keys', null);
  assert.match(String((createKey('  ') as { error: string }).error), /Name/);
  const made = createKey('Home Assistant');
  assert.ok('key' in made);
  assert.match(made.key, /^pb_[\w-]{32}$/);
  assert.equal(checkKey(made.key)?.name, 'Home Assistant');
  assert.equal(checkKey(made.key + 'x'), null);
  assert.ok(listKeys()[0].lastUsed);
  assert.ok(!('hash' in listKeys()[0]));
  assert.equal(revokeKey(made.info.id)?.name, 'Home Assistant');
  assert.equal(checkKey(made.key), null);
});

test('status leads with what needs you; containers carry their load and updates', async () => {
  const s = status(snap);
  assert.equal(s.status, 'critical');
  assert.equal(s.problems[0].title, 'sonarr is not running');
  assert.deepEqual(s.containers, { running: 1, total: 2 });
  const list = (await (await api.request('/containers?problems=1')).json()) as { name: string }[];
  assert.deepEqual(list.map((c) => c.name), ['sonarr']);
  const plex = (await (await api.request('/containers/plex')).json()) as Record<string, unknown>;
  assert.equal(plex.cpuPct, 12.3);
  assert.equal(plex.updateAvailable, true);
  assert.equal((await api.request('/containers/nope')).status, 404);
});

test('MCP: initialize, list tools, call one; notifications get no answer', async () => {
  const init = (await (await mcp({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26' } })).json()) as { result: { protocolVersion: string; serverInfo: { version: string } } };
  assert.equal(init.result.protocolVersion, '2025-03-26');
  assert.equal(init.result.serverInfo.version, '9.9.9');
  assert.equal((await mcp({ jsonrpc: '2.0', method: 'notifications/initialized' })).status, 202);
  const tools = (await (await mcp({ jsonrpc: '2.0', id: 2, method: 'tools/list' })).json()) as { result: { tools: { name: string; annotations: { readOnlyHint: boolean } }[] } };
  assert.ok(tools.result.tools.every((t) => t.annotations.readOnlyHint));
  const call = (await (await mcp({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'get_status', arguments: {} } })).json()) as { result: { structuredContent: { status: string }; isError: boolean } };
  assert.equal(call.result.structuredContent.status, 'critical');
  assert.equal(call.result.isError, false);
  const bad = (await (await mcp({ jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'restart_everything' } })).json()) as { error: { code: number } };
  assert.equal(bad.error.code, -32602);
  assert.equal((await api.request('/mcp')).status, 405);
});
