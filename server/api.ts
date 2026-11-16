// The read-only API, for scripts and AI tools: what needs you, the
// containers, the server and any widget's number. JSON under /api/v1, and the
// same answers as MCP tools at /api/v1/mcp. Nothing here changes anything,
// and nothing here reveals an integration's address or key.

import { Hono } from 'hono';
import { NUMBERS, WIDGET_INFO, type Widget } from '../shared/board.ts';
import type { Reading } from '../shared/reading.ts';
import type { Alert, Container, NutData, Snapshot, StatsData, SystemData } from '../shared/types.ts';
import { boardList, getBoard } from './boards.ts';

export interface ApiDeps {
  snapshot: () => Snapshot;
  reading: (w: Widget, unit: 'f' | 'c') => Promise<Reading | null | undefined>;
}

const iso = (t?: number | null) => (t ? new Date(t).toISOString() : undefined);
const LEVEL = { critical: 'critical', warn: 'warning', info: 'note' } as const;

function alertOut(a: Alert) {
  return { level: LEVEL[a.level], title: a.title, detail: a.detail, since: iso(a.since), source: a.source, link: a.href };
}

function containersOf(snap: Snapshot): Container[] {
  return (snap.sources.docker?.data as { containers?: Container[] } | null)?.containers ?? [];
}

function containerOut(snap: Snapshot, c: Container) {
  const s = (snap.sources.stats?.data as StatsData | null)?.containers[c.name];
  return {
    name: c.name,
    stack: c.project ?? null,
    state: c.state,
    health: c.health,
    status: c.status,
    image: c.image,
    updateAvailable: !!snap.updates[c.name] || !!c.staleImage,
    ...(s ? { cpuPct: Math.round(s.cpu * 10) / 10, memoryBytes: s.memBytes } : {}),
  };
}

export function status(snap: Snapshot) {
  const alerts = snap.alerts.filter((a) => a.level !== 'info');
  const ctrs = containersOf(snap);
  const running = ctrs.filter((c) => c.state === 'running').length;
  const level = alerts.some((a) => a.level === 'critical') ? 'critical' : alerts.length ? 'warning' : 'ok';
  return {
    status: level,
    summary: alerts.length ? `${alerts.length} ${alerts.length === 1 ? 'thing needs' : 'things need'} you.` : `All quiet. ${running} containers running.`,
    problems: alerts.map(alertOut),
    containers: { running, total: ctrs.length },
    version: snap.self?.version,
    at: iso(snap.generatedAt),
  };
}

export function server(snap: Snapshot) {
  const sys = snap.sources.system?.data as SystemData | null;
  const ups = (snap.sources.nut?.data as NutData | null)?.ups ?? [];
  return {
    ...(sys
      ? {
          cpuPct: Math.round(sys.cpuPct * 10) / 10,
          load: sys.load.map((n) => Math.round(n * 100) / 100),
          cores: sys.cores,
          uptimeSec: sys.uptimeSec,
          memory: sys.mem ? { totalBytes: sys.mem.total, availableBytes: Math.round(sys.mem.available), zfsCacheBytes: Math.round(sys.mem.arc) } : null,
          storage: sys.pool ? { path: sys.pool.path, usedPct: sys.pool.usedPct, usedBytes: sys.pool.usedBytes, totalBytes: sys.pool.totalBytes } : null,
        }
      : { error: 'No system readings yet' }),
    ups: ups.map((u) => ({ name: u.name, model: u.model, onBattery: u.onBattery, lowBattery: u.lowBattery, replaceBattery: u.replaceBattery, chargePct: u.charge, runtimeSec: u.runtimeSec, loadPct: u.loadPct })),
  };
}

export function boards() {
  return boardList().map((b) => ({
    id: b.id,
    name: b.name,
    widgets: (getBoard(b.id)?.board.widgets ?? []).map((w) => ({ id: w.id, type: w.type, name: w.config?.title || WIDGET_INFO[w.type].name, hasNumber: !!NUMBERS[w.type] || w.type === 'markets' })),
  }));
}

async function widget(deps: ApiDeps, board: string, id: string, unit: 'f' | 'c') {
  const w = getBoard(board)?.board.widgets.find((x) => x.id === id);
  if (!w) return { error: `No widget ${id} on board ${board}` };
  if (!NUMBERS[w.type] && w.type !== 'markets') return { error: `${WIDGET_INFO[w.type].name} has no number to read` };
  const r = await deps.reading(w, unit);
  if (!r) return { error: r === null ? 'Nothing to show yet' : 'Still loading' };
  return { name: w.config?.title || WIDGET_INFO[w.type].name, value: r.value, detail: r.sub, tone: r.tone ?? null };
}

function findContainers(snap: Snapshot, q: { query?: string; stack?: string; problems?: boolean }) {
  const t = (q.query ?? '').trim().toLowerCase();
  return containersOf(snap)
    .filter((c) => !t || c.name.includes(t) || c.image.toLowerCase().includes(t))
    .filter((c) => !q.stack || c.project === q.stack)
    .filter((c) => !q.problems || c.state !== 'running' || c.health === 'unhealthy')
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((c) => containerOut(snap, c));
}

// MCP: the same answers as tools an assistant can call.
const TOOLS = [
  { name: 'get_status', description: 'What needs attention on the home server right now, worst first, and how many containers run. Start here.', inputSchema: { type: 'object', properties: {} } },
  {
    name: 'list_containers',
    description: 'Docker containers with state, health, stack, image, CPU, memory and whether an image update is waiting.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Part of a container or image name' },
        stack: { type: 'string', description: 'A compose project name' },
        problems_only: { type: 'boolean', description: 'Only containers that are stopped or unhealthy' },
      },
    },
  },
  { name: 'get_server', description: "The server's CPU, load, memory, storage, uptime and UPS.", inputSchema: { type: 'object', properties: {} } },
  { name: 'list_boards', description: "The dashboard's boards and their widgets, with which ones have a number read_widget can read.", inputSchema: { type: 'object', properties: {} } },
  {
    name: 'read_widget',
    description: "One widget's current number, as the dashboard shows it: Bitcoin's price, the internet speed, the car's charge.",
    inputSchema: {
      type: 'object',
      properties: { board: { type: 'string', description: 'Board id from list_boards, such as home' }, widget: { type: 'string', description: 'Widget id from list_boards' }, units: { type: 'string', enum: ['c', 'f'] } },
      required: ['board', 'widget'],
    },
  },
].map((t) => ({ ...t, annotations: { readOnlyHint: true, openWorldHint: false } }));

const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

async function callTool(deps: ApiDeps, name: string, args: Record<string, unknown>): Promise<unknown> {
  const snap = deps.snapshot();
  if (name === 'get_status') return status(snap);
  if (name === 'list_containers') return findContainers(snap, { query: args.query as string, stack: args.stack as string, problems: args.problems_only === true });
  if (name === 'get_server') return server(snap);
  if (name === 'list_boards') return boards();
  if (name === 'read_widget') return widget(deps, String(args.board ?? ''), String(args.widget ?? ''), args.units === 'c' ? 'c' : 'f');
  throw new Error(`Unknown tool ${name}`);
}

async function rpc(deps: ApiDeps, m: Rpc, version: string): Promise<object | null> {
  if (m.id === undefined || m.id === null) return null; // A notification: nothing to answer.
  const ok = (result: unknown) => ({ jsonrpc: '2.0', id: m.id, result });
  const fail = (code: number, message: string) => ({ jsonrpc: '2.0', id: m.id, error: { code, message } });
  switch (m.method) {
    case 'initialize': {
      const asked = String(m.params?.protocolVersion ?? '');
      return ok({
        protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'patchboard', title: 'Patchboard', version },
        instructions: 'Read-only view of a home server through its Patchboard dashboard. get_status first; it lists what needs attention.',
      });
    }
    case 'ping':
      return ok({});
    case 'tools/list':
      return ok({ tools: TOOLS });
    case 'tools/call': {
      const name = String(m.params?.name ?? '');
      if (!TOOLS.some((t) => t.name === name)) return fail(-32602, `Unknown tool ${name}`);
      let out: unknown;
      try {
        out = await callTool(deps, name, (m.params?.arguments as Record<string, unknown>) ?? {});
      } catch (e) {
        out = { error: (e as Error).message };
      }
      const isError = !!out && typeof out === 'object' && 'error' in out;
      return ok({ content: [{ type: 'text', text: JSON.stringify(out, null, 2) }], ...(Array.isArray(out) ? {} : { structuredContent: out }), isError });
    }
    default:
      return fail(-32601, `Method not found: ${m.method}`);
  }
}

export function apiRoutes(deps: ApiDeps): Hono {
  const api = new Hono();
  api.get('/', (c) =>
    c.json({
      endpoints: ['/api/v1/status', '/api/v1/alerts', '/api/v1/containers', '/api/v1/containers/:name', '/api/v1/server', '/api/v1/boards', '/api/v1/boards/:board/widgets/:widget'],
      mcp: '/api/v1/mcp',
    }),
  );
  api.get('/status', (c) => c.json(status(deps.snapshot())));
  api.get('/alerts', (c) => c.json(deps.snapshot().alerts.map(alertOut)));
  api.get('/containers', (c) => c.json(findContainers(deps.snapshot(), { query: c.req.query('q'), stack: c.req.query('stack'), problems: c.req.query('problems') === '1' })));
  api.get('/containers/:name', (c) => {
    const snap = deps.snapshot();
    const ctr = containersOf(snap).find((x) => x.name === c.req.param('name'));
    return ctr ? c.json(containerOut(snap, ctr)) : c.json({ error: 'No such container' }, 404);
  });
  api.get('/server', (c) => c.json(server(deps.snapshot())));
  api.get('/boards', (c) => c.json(boards()));
  api.get('/boards/:board/widgets/:widget', async (c) => {
    const r = await widget(deps, c.req.param('board'), c.req.param('widget'), c.req.query('units') === 'c' ? 'c' : 'f');
    return 'error' in r ? c.json(r, 404) : c.json(r);
  });

  // MCP over Streamable HTTP, stateless: every answer is plain JSON, no event stream.
  api.get('/mcp', (c) => c.json({ error: 'Send MCP requests with POST' }, 405, { Allow: 'POST' }));
  api.delete('/mcp', (c) => c.body(null, 405, { Allow: 'POST' }));
  api.post('/mcp', async (c) => {
    const body = (await c.req.json().catch(() => undefined)) as Rpc | Rpc[] | undefined;
    if (!body || typeof body !== 'object') return c.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, 400);
    const version = deps.snapshot().self?.version ?? 'dev';
    if (Array.isArray(body)) {
      const out = (await Promise.all(body.map((m) => rpc(deps, m, version)))).filter(Boolean);
      return out.length ? c.json(out) : c.body(null, 202);
    }
    const out = await rpc(deps, body, version);
    return out ? c.json(out) : c.body(null, 202);
  });
  return api;
}
