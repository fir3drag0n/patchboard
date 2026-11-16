// Pi-hole (v6 API) and AdGuard Home: today's queries and blocks, whether
// blocking is on, and a timed pause. A pause always carries a timer, so
// blocking comes back on its own even if nobody remembers to resume it.
// The Ad blocking page also reads the query log and keeps your own allow and
// block lists: exact domains only, so nothing here touches a regex or a
// hand-written AdGuard rule.

import { domainToASCII } from 'node:url';
import type { DnsBlockedBy, DnsData, DnsLists, DnsQuery } from '../../shared/types.ts';
import { config } from '../config.ts';
import { getJson, request } from '../http.ts';
import { type Adapter, SECOND } from './adapter.ts';

/** null resumes; a number pauses for that many minutes. */
export type DnsControl = (minutes: number | null) => Promise<void>;
export interface DnsDomains {
  log(o: { search?: string; blocked?: boolean }): Promise<DnsQuery[]>;
  lists(): Promise<DnsLists>;
  /** Puts a domain on one list and takes it off the other; null takes it off both. */
  put(domain: string, on: 'allow' | 'deny' | null): Promise<void>;
}
export interface DnsClient {
  adapter: Adapter<DnsData>;
  dns: DnsControl;
  domains: DnsDomains;
}

/** How many queries the page shows. */
export const LOG_SIZE = 100;

/** A plain domain name, lowercased and in ASCII, or null. */
export function cleanDomain(raw: string): string | null {
  const t = raw.trim().toLowerCase().replace(/\.$/, '');
  // domainToASCII would quietly drop a path or a port, so refuse those first.
  if (![...t].every((ch) => ch > '~' || /[a-z0-9._-]/.test(ch))) return null;
  const d = domainToASCII(t);
  return /^(?=.{1,253}$)([a-z0-9_](?:[a-z0-9_-]{0,61}[a-z0-9_])?\.)+[a-z0-9-]{2,63}$/.test(d) ? d : null;
}

/** The pauses the widget offers. The route accepts only these. */
export const PAUSE_MINUTES = [5, 30, 60];

const pct = (blocked: number, total: number) => (total ? Math.round((blocked / total) * 1000) / 10 : 0);

// ---------- Pi-hole 6 ----------

interface PiQuery {
  id: number;
  time: number;
  domain: string;
  status: string | null;
  client: { ip: string; name?: string | null };
}

const PI_BLOCKED: Record<string, DnsBlockedBy> = {
  GRAVITY: 'list',
  GRAVITY_CNAME: 'list',
  DENYLIST: 'yours',
  DENYLIST_CNAME: 'yours',
  REGEX: 'rule',
  REGEX_CNAME: 'rule',
  EXTERNAL_BLOCKED_IP: 'upstream',
  EXTERNAL_BLOCKED_NULL: 'upstream',
  EXTERNAL_BLOCKED_NXRA: 'upstream',
  EXTERNAL_BLOCKED_EDE15: 'upstream',
  SPECIAL_DOMAIN: 'rule',
};

export function fromPiQueries(qs: PiQuery[]): DnsQuery[] {
  return qs.map((q) => {
    const by = PI_BLOCKED[q.status ?? ''];
    return { id: String(q.id), at: Math.round(q.time * 1000), domain: q.domain, client: q.client.name || q.client.ip, blocked: !!by, by };
  });
}

interface PiSummary {
  queries: { total: number; blocked: number; percent_blocked?: number };
  gravity?: { domains_being_blocked?: number };
}

export function toPihole(sum: PiSummary, blocking: { blocking: string; timer?: number | null }, now = Date.now()): DnsData {
  const on = blocking.blocking === 'enabled';
  return {
    kind: 'pihole',
    queries: sum.queries.total,
    blocked: sum.queries.blocked,
    pct: sum.queries.percent_blocked != null ? Math.round(sum.queries.percent_blocked * 10) / 10 : pct(sum.queries.blocked, sum.queries.total),
    protecting: on,
    resumesAt: !on && blocking.timer ? now + blocking.timer * 1000 : undefined,
    listSize: sum.gravity?.domains_being_blocked,
  };
}

export function piholeClient(): DnsClient {
  const { url, password } = config.pihole!;
  // Pi-hole hands out a limited number of sessions, so keep one and only
  // sign in again when it expires.
  // Calls made together share one sign-in instead of each taking a session.
  let sid: string | null = null;
  let signingIn: Promise<void> | null = null;
  function signIn(): Promise<void> {
    signingIn ??= (async () => {
      try {
        const r = await getJson<{ session: { valid: boolean; sid: string | null } }>(`${url}/api/auth`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ password: password ?? '' }),
        });
        if (!r.session.valid) throw new Error('Pi-hole refused the password');
        sid = r.session.sid;
      } catch (err) {
        if ((err as { status?: number }).status === 401) throw new Error('Pi-hole refused the password');
        throw err;
      } finally {
        signingIn = null;
      }
    })();
    return signingIn;
  }
  async function call<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (sid === null && password) await signIn();
    const used = sid;
    const go = async () => {
      const res = await request(`${url}${path}`, { ...init, headers: { ...(init.headers as Record<string, string>), ...(sid ? { 'X-FTL-SID': sid } : {}) } });
      const text = await res.text();
      return (text ? JSON.parse(text) : undefined) as T;
    };
    try {
      return await go();
    } catch (err) {
      if ((err as { status?: number }).status !== 401 || !password) throw err;
      // Another call may have signed in again already.
      if (sid === used) await signIn();
      return go();
    }
  }
  return {
    adapter: {
      id: 'pihole',
      label: 'Pi-hole',
      intervalMs: 30 * SECOND,
      async fetch() {
        const [sum, blocking] = await Promise.all([call<PiSummary>('/api/stats/summary'), call<{ blocking: string; timer?: number | null }>('/api/dns/blocking')]);
        return toPihole(sum, blocking);
      },
    },
    async dns(minutes) {
      await call('/api/dns/blocking', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(minutes === null ? { blocking: true, timer: null } : { blocking: false, timer: minutes * 60 }),
      });
    },
    domains: {
      async log({ search, blocked }) {
        // Pi-hole filters by one status at a time, so blocked-only reads a
        // longer stretch and keeps the blocks.
        const q = new URLSearchParams({ length: String(blocked ? LOG_SIZE * 5 : LOG_SIZE) });
        if (search) q.set('domain', `*${search}*`);
        const r = await call<{ queries: PiQuery[] }>(`/api/queries?${q}`);
        const all = fromPiQueries(r.queries);
        return (blocked ? all.filter((x) => x.blocked) : all).slice(0, LOG_SIZE);
      },
      lists,
      async put(domain, on) {
        const now = await lists();
        for (const type of ['allow', 'deny'] as const) {
          const has = now[type].includes(domain);
          if (type === on && !has) {
            const r = await call<{ processed?: { errors?: { error?: string }[] } }>(`/api/domains/${type}/exact`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ domain, comment: 'Added from Patchboard', groups: [0], enabled: true }),
            });
            const failed = r?.processed?.errors?.[0];
            if (failed) throw new Error(failed.error ?? 'Pi-hole refused that domain');
          } else if (type !== on && has) {
            await call(`/api/domains/${type}/exact/${encodeURIComponent(domain)}`, { method: 'DELETE' });
          }
        }
      },
    },
  };
  async function lists(): Promise<DnsLists> {
    const [allow, deny] = await Promise.all(['allow', 'deny'].map((type) => call<{ domains: { domain: string }[] }>(`/api/domains/${type}/exact`)));
    return { allow: allow.domains.map((d) => d.domain).sort(), deny: deny.domains.map((d) => d.domain).sort() };
  }
}

// ---------- AdGuard Home ----------

interface AgStatus {
  protection_enabled: boolean;
  /** Milliseconds left on a timed pause. */
  protection_disabled_duration?: number;
}

interface AgStats {
  num_dns_queries: number;
  num_blocked_filtering: number;
  num_replaced_safebrowsing?: number;
  num_replaced_parental?: number;
}

export function toAdguard(stats: AgStats, status: AgStatus, now = Date.now()): DnsData {
  const blocked = stats.num_blocked_filtering + (stats.num_replaced_safebrowsing ?? 0) + (stats.num_replaced_parental ?? 0);
  return {
    kind: 'adguard',
    queries: stats.num_dns_queries,
    blocked,
    pct: pct(blocked, stats.num_dns_queries),
    protecting: status.protection_enabled,
    resumesAt: !status.protection_enabled && status.protection_disabled_duration ? now + status.protection_disabled_duration : undefined,
  };
}

interface AgQuery {
  time: string;
  question: { name: string };
  client: string;
  client_info?: { name?: string };
  reason: string;
  rules?: { filter_list_id?: number }[];
}

const AG_BLOCKED: Record<string, DnsBlockedBy> = {
  FilteredBlackList: 'list',
  FilteredBlockedService: 'service',
  FilteredSafeBrowsing: 'safety',
  FilteredParental: 'safety',
  FilteredInvalid: 'rule',
};

export function fromAgQueries(qs: AgQuery[]): DnsQuery[] {
  return qs.map((q) => {
    let by = AG_BLOCKED[q.reason];
    // List 0 is AdGuard's own custom rules: the ones you wrote.
    if (by === 'list' && q.rules?.some((r) => r.filter_list_id === 0)) by = 'yours';
    const at = Date.parse(q.time);
    return { id: `${q.time}|${q.client}|${q.question.name}`, at, domain: q.question.name.replace(/\.$/, ''), client: q.client_info?.name || q.client, blocked: !!by, by };
  });
}

// AdGuard keeps your lists as custom rules. Exact domains read the same way
// its own Block and Unblock buttons write them; any other rule stays as is.
const AG_RULE = /^(@@)?\|\|([a-z0-9._-]+)\^$/;

export function readRules(rules: string[]): DnsLists {
  const out: DnsLists = { allow: [], deny: [], other: 0 };
  for (const r of rules) {
    const m = AG_RULE.exec(r.trim());
    if (m) out[m[1] ? 'allow' : 'deny'].push(m[2]);
    else if (r.trim() && !/^[!#]/.test(r.trim())) out.other!++;
  }
  out.allow.sort();
  out.deny.sort();
  return out;
}

export function putRule(rules: string[], domain: string, on: 'allow' | 'deny' | null): string[] {
  const kept = rules.filter((r) => r.trim() !== `||${domain}^` && r.trim() !== `@@||${domain}^`);
  return on ? [...kept, on === 'allow' ? `@@||${domain}^` : `||${domain}^`] : kept;
}

export function adguardClient(): DnsClient {
  const { url, username, password } = config.adguard!;
  const auth: Record<string, string> = username ? { Authorization: `Basic ${Buffer.from(`${username}:${password ?? ''}`).toString('base64')}` } : {};
  return {
    adapter: {
      id: 'adguard',
      label: 'AdGuard Home',
      intervalMs: 30 * SECOND,
      async fetch() {
        const [stats, status] = await Promise.all([getJson<AgStats>(`${url}/control/stats`, { headers: auth }), getJson<AgStatus>(`${url}/control/status`, { headers: auth })]);
        return toAdguard(stats, status);
      },
    },
    async dns(minutes) {
      await request(`${url}/control/protection`, {
        method: 'POST',
        headers: { ...auth, 'Content-Type': 'application/json' },
        body: JSON.stringify(minutes === null ? { enabled: true } : { enabled: false, duration: minutes * 60_000 }),
      });
    },
    domains: {
      async log({ search, blocked }) {
        const q = new URLSearchParams({ limit: String(LOG_SIZE), response_status: blocked ? 'blocked' : 'all' });
        if (search) q.set('search', search);
        const r = await getJson<{ data: AgQuery[] }>(`${url}/control/querylog?${q}`, { headers: auth });
        return fromAgQueries(r.data ?? []);
      },
      async lists() {
        return readRules(await userRules());
      },
      async put(domain, on) {
        const rules = putRule(await userRules(), domain, on);
        await request(`${url}/control/filtering/set_rules`, {
          method: 'POST',
          headers: { ...auth, 'Content-Type': 'application/json' },
          body: JSON.stringify({ rules }),
        });
      },
    },
  };
  async function userRules(): Promise<string[]> {
    return (await getJson<{ user_rules?: string[] }>(`${url}/control/filtering/status`, { headers: auth })).user_rules ?? [];
  }
}
