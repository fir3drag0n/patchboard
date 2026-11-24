// UniFi and Tailscale: the network around the server.
// UniFi: the official Network API on a UniFi OS console (UniFi Network 9.0
// and newer), with an API key from Control Plane, Integrations. Clients and
// every device, online or not, across every site.
// Tailscale: the tailnet's machines, which are online, and keys about to
// expire. An API access token from the admin console.

import type { TailnetData, TailnetDevice, UnifiData, UnifiDevice, UnifiHealth } from '../../shared/types.ts';
import { config } from '../config.ts';
import { fetchText, getJson } from '../http.ts';
import { type Adapter, MINUTE } from './adapter.ts';

type Page<T> = { data?: T[]; totalCount?: number };

export function toUnifiDevices(rows: { id?: string; name?: string; model?: string; state?: string; macAddress?: string }[], site: string): UnifiDevice[] {
  return rows.map((d) => ({ id: d.id ?? d.macAddress ?? d.name ?? '?', name: d.name || d.model || 'device', model: d.model, online: (d.state ?? 'ONLINE').toUpperCase() === 'ONLINE', site }));
}

type RawHealth = { subsystem?: string; status?: string; wan_ip?: string; isp_name?: string; latency?: number; uptime?: number; 'rx_bytes-r'?: number; 'tx_bytes-r'?: number; num_user?: number; xput_down?: number; xput_up?: number; speedtest_lastrun?: number };

/** Fork: the Network app's health rows (stat/health) as one summary; nothing usable, undefined. */
export function toUnifiHealth(rows: RawHealth[]): UnifiHealth | undefined {
  const by = (s: string) => rows.find((r) => r.subsystem === s);
  const wan = by('wan');
  const www = by('www');
  if (!wan && !www) return undefined;
  const num = (n: unknown) => (typeof n === 'number' && Number.isFinite(n) ? n : undefined);
  const down = num(www?.xput_down);
  const up = num(www?.xput_up);
  return {
    status: rows.filter((r) => r.subsystem && r.status).map((r) => ({ part: r.subsystem!, status: r.status! })),
    wanIp: wan?.wan_ip,
    isp: wan?.isp_name,
    latencyMs: num(www?.latency),
    uptimeSec: num(www?.uptime),
    // The Network app reports WAN traffic seen from the gateway: rx is what comes in.
    downBps: num(wan?.['rx_bytes-r']),
    upBps: num(wan?.['tx_bytes-r']),
    wlanClients: num(by('wlan')?.num_user),
    lanClients: num(by('lan')?.num_user),
    speedtest: down != null && up != null && (down > 0 || up > 0) ? { down, up, at: www?.speedtest_lastrun ? www.speedtest_lastrun * 1000 : undefined } : undefined,
  };
}

export function unifiAdapter(): Adapter<UnifiData> {
  const { url, key, verifyTls } = config.unifi!;
  const api = async <T>(path: string): Promise<T> => JSON.parse(await fetchText(`${url}/proxy/network/integration/v1${path}`, { verifyTls, headers: { 'X-API-KEY': key, Accept: 'application/json' } })) as T;
  return {
    id: 'unifi',
    label: 'UniFi',
    intervalMs: MINUTE,
    async fetch() {
      const sites = (await api<Page<{ id: string; name?: string }>>('/sites')).data ?? [];
      let clients = 0;
      const devices: UnifiDevice[] = [];
      for (const s of sites.slice(0, 20)) {
        const [d, c] = await Promise.all([api<Page<Parameters<typeof toUnifiDevices>[0][number]>>(`/sites/${s.id}/devices?limit=200`), api<Page<unknown>>(`/sites/${s.id}/clients?limit=1`)]);
        devices.push(...toUnifiDevices(d.data ?? [], s.name ?? 'Default'));
        clients += c.totalCount ?? 0;
      }
      // Fork: the default site's health; the classic endpoint takes the same API key. Missing, no health.
      const health = await fetchText(`${url}/proxy/network/api/s/default/stat/health`, { verifyTls, headers: { 'X-API-KEY': key, Accept: 'application/json' } })
        .then((t) => toUnifiHealth((JSON.parse(t) as { data?: RawHealth[] }).data ?? []))
        .catch(() => undefined);
      return { clients, devices, sites: sites.length, webUrl: url, ...(health ? { health } : {}) };
    },
  };
}

type RawTsDevice = { id?: string; name?: string; hostname?: string; os?: string; lastSeen?: string; connectedToControl?: boolean; expires?: string; keyExpiryDisabled?: boolean; updateAvailable?: boolean };

/** Online when connected to control, or seen in the last five minutes on older API answers. */
export function toTailnet(rows: RawTsDevice[], now = Date.now()): TailnetDevice[] {
  return rows
    .map((d) => {
      const expires = d.keyExpiryDisabled || !d.expires || d.expires.startsWith('0001') ? undefined : Date.parse(d.expires);
      return {
        id: d.id ?? d.name ?? '?',
        name: (d.name ?? d.hostname ?? '?').split('.')[0],
        os: d.os,
        online: d.connectedToControl ?? (d.lastSeen ? now - Date.parse(d.lastSeen) < 5 * MINUTE : false),
        lastSeen: d.lastSeen ? Date.parse(d.lastSeen) : undefined,
        keyExpires: expires,
        update: !!d.updateAvailable,
      };
    })
    .sort((a, b) => Number(b.online) - Number(a.online) || a.name.localeCompare(b.name));
}

export function tailscaleAdapter(): Adapter<TailnetData> {
  const { key, tailnet } = config.tailscale!;
  return {
    id: 'tailscale',
    label: 'Tailscale',
    intervalMs: 2 * MINUTE,
    async fetch() {
      const r = await getJson<{ devices?: RawTsDevice[] }>(`https://api.tailscale.com/api/v2/tailnet/${encodeURIComponent(tailnet)}/devices?fields=all`, { headers: { Authorization: `Bearer ${key}` } });
      return { devices: toTailnet(r.devices ?? []) };
    },
  };
}
