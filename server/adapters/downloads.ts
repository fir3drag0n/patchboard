// Transmission, Deluge, SABnzbd and NZBGet, reported in qBittorrent's shape so
// the board shows every download client the same way. Each one can also pause
// and resume everything, through POST /api/downloads/:id/:action.

import type { ActiveTorrent, DownloadClientId, DownloadEntry, DownloadList, DownloadState, EntryAction, QbitData } from '../../shared/types.ts';
import { config } from '../config.ts';
import { HttpError, request } from '../http.ts';
import { type Adapter, SECOND } from './adapter.ts';

export type DownloadAction = 'pause' | 'resume';
export type DownloadControl = (action: DownloadAction) => Promise<void>;
/** What can be done to one download. */
export type ItemAction = 'pause' | 'resume' | 'remove';

/** Something to download: a magnet or web link, or a .torrent or .nzb file. */
export type NewDownload = { url: string } | { file: { name: string; data: Buffer } };

/** The Downloads page's view of one client: everything in it, and what can be done. */
export interface DownloadManager {
  list(): Promise<DownloadList>;
  act(entry: DownloadEntry, action: EntryAction): Promise<void>;
  add(what: NewDownload): Promise<void>;
}

/** A tracker announce URL's host, without the "tracker." noise. */
export function trackerHost(url: string | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname.replace(/^(tracker|announce|t)\./, '') || undefined;
  } catch {
    return undefined;
  }
}

/** Seconds since 1970 as ms, or nothing for 0 and missing. */
const ms = (s: number | undefined) => (s && s > 0 ? s * 1000 : undefined);
const eta = (s: number | undefined) => (s != null && s >= 0 && s < 8_640_000 ? Math.round(s) : -1);

const basic = (user?: string, pass?: string): Record<string, string> =>
  user || pass ? { Authorization: `Basic ${Buffer.from(`${user ?? ''}:${pass ?? ''}`).toString('base64')}` } : {};

const top = (list: ActiveTorrent[]) => list.sort((a, b) => b.speed - a.speed).slice(0, 4);

// ---------- Transmission: JSON RPC with a session id it hands out on a 409 ----------

interface TrTorrent {
  name: string;
  status: number; // 0 stopped, 1-2 checking, 3 queued, 4 downloading, 5 queued to seed, 6 seeding
  percentDone: number;
  rateDownload: number;
  eta: number;
  error: number;
}

export function transmissionClient() {
  const { url, username, password } = config.transmission!;
  let session = '';
  async function rpc<T>(method: string, args: Record<string, unknown> = {}): Promise<T> {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await request(`${url}/transmission/rpc`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Transmission-Session-Id': session, ...basic(username, password) },
          body: JSON.stringify({ method, arguments: args }),
        });
        const body = (await res.json()) as { result: string; arguments: T };
        if (body.result !== 'success') throw new Error(`Transmission: ${body.result}`);
        return body.arguments;
      } catch (err) {
        // The first call, and any call after a restart, gets 409 with a fresh id.
        if (err instanceof HttpError && err.status === 409 && attempt === 0) {
          const res = await fetch(`${url}/transmission/rpc`, { method: 'POST', headers: basic(username, password), signal: AbortSignal.timeout(8000) }).catch(() => null);
          session = res?.headers.get('x-transmission-session-id') ?? '';
          continue;
        }
        throw err;
      }
    }
    throw new Error('Transmission refused the session');
  }

  const adapter: Adapter<QbitData> = {
    id: 'transmission',
    label: 'Transmission',
    intervalMs: 5 * SECOND,
    async fetch() {
      const [stats, list] = await Promise.all([
        rpc<{ downloadSpeed: number; uploadSpeed: number }>('session-stats'),
        rpc<{ torrents: TrTorrent[] }>('torrent-get', { fields: ['name', 'status', 'percentDone', 'rateDownload', 'eta', 'error'] }),
      ]);
      const t = list.torrents;
      const downloading = t.filter((x) => x.status === 4 || x.status === 3);
      return {
        kind: 'torrent',
        down: stats.downloadSpeed,
        up: stats.uploadSpeed,
        downloading: downloading.length,
        seeding: t.filter((x) => x.status === 6 || x.status === 5).length,
        stalled: downloading.filter((x) => x.status === 4 && x.rateDownload === 0).length,
        errored: t.filter((x) => x.error > 0).map((x) => x.name),
        paused: t.length > 0 && t.every((x) => x.status === 0),
        active: top(downloading.map((x) => ({ name: x.name, progress: x.percentDone, speed: x.rateDownload, etaSec: x.eta }))),
      };
    },
  };
  const control: DownloadControl = async (action) => {
    await rpc(action === 'pause' ? 'torrent-stop' : 'torrent-start');
  };

  const manage: DownloadManager = {
    async list() {
      const { torrents } = await rpc<{ torrents: TrFull[] }>('torrent-get', {
        fields: ['hashString', 'name', 'status', 'percentDone', 'sizeWhenDone', 'haveValid', 'rateDownload', 'rateUpload', 'eta', 'uploadRatio', 'labels', 'addedDate', 'trackers', 'error', 'errorString'],
      });
      return { kind: 'torrent', entries: torrents.map(fromTransmission) };
    },
    async act(entry, action) {
      const ids = [entry.id];
      if (action === 'pause') await rpc('torrent-stop', { ids });
      else if (action === 'resume') await rpc('torrent-start', { ids });
      else await rpc('torrent-remove', { ids, 'delete-local-data': action === 'delete' });
    },
    async add(what) {
      const added = await rpc<{ 'torrent-added'?: unknown; 'torrent-duplicate'?: unknown }>('torrent-add', 'url' in what ? { filename: what.url } : { metainfo: what.file.data.toString('base64') });
      if (!added['torrent-added'] && !added['torrent-duplicate']) throw new Error("Transmission didn't take it");
    },
  };
  return { adapter, control, manage };
}

interface TrFull {
  hashString: string;
  name: string;
  status: number;
  percentDone: number;
  sizeWhenDone: number;
  haveValid: number;
  rateDownload: number;
  rateUpload: number;
  eta: number;
  uploadRatio: number;
  labels?: string[];
  addedDate: number;
  trackers?: { announce: string }[];
  error: number;
  errorString: string;
}

export function fromTransmission(t: TrFull): DownloadEntry {
  const finished = t.percentDone >= 1;
  // 0 stopped, 1-2 checking, 3 queued, 4 downloading, 5 queued to seed, 6 seeding.
  const state: DownloadState =
    t.error > 0 ? 'errored' : t.status === 0 ? (finished ? 'done' : 'paused') : t.status <= 2 ? 'checking' : t.status === 3 ? 'queued' : t.status === 4 ? (t.rateDownload ? 'downloading' : 'stalled') : 'seeding';
  return {
    id: t.hashString,
    name: t.name,
    state,
    progress: t.percentDone,
    size: t.sizeWhenDone,
    done: t.haveValid,
    down: t.rateDownload,
    up: t.rateUpload,
    etaSec: eta(t.eta),
    ratio: t.uploadRatio >= 0 ? t.uploadRatio : undefined,
    category: t.labels?.[0],
    added: ms(t.addedDate),
    tracker: trackerHost(t.trackers?.[0]?.announce),
    error: t.error > 0 ? t.errorString : undefined,
  };
}

// ---------- Deluge: the Web UI's JSON RPC, signed in with its password ----------

interface DeTorrent {
  name: string;
  state: string;
  progress: number; // 0-100
  download_payload_rate: number;
  eta: number;
}

export function delugeClient() {
  const { url, password } = config.deluge!;
  let cookie = '';
  let id = 0;
  async function call<T>(method: string, params: unknown[] = []): Promise<T> {
    const res = await request(`${url}/json`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookie },
      body: JSON.stringify({ method, params, id: ++id }),
    });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const body = (await res.json()) as { result: T; error: { message: string; code: number } | null };
    if (body.error) {
      const e = new Error(`Deluge: ${body.error.message}`);
      (e as Error & { code?: number }).code = body.error.code;
      throw e;
    }
    return body.result;
  }
  async function ready(): Promise<void> {
    if (!cookie && !(await call<boolean>('auth.login', [password]))) throw new Error('Deluge rejected the password');
    // The Web UI talks to a daemon; connect to the first one when it isn't.
    if (!(await call<boolean>('web.connected'))) {
      const hosts = await call<[string, ...unknown[]][]>('web.get_hosts');
      if (!hosts.length) throw new Error('Deluge has no daemon to connect to');
      await call('web.connect', [hosts[0][0]]);
    }
  }
  async function withLogin<T>(fn: () => Promise<T>): Promise<T> {
    try {
      await ready();
      return await fn();
    } catch (err) {
      // An expired session answers with error code 1, "Not authenticated".
      if ((err as { code?: number }).code !== 1) throw err;
      cookie = '';
      await ready();
      return fn();
    }
  }

  const adapter: Adapter<QbitData> = {
    id: 'deluge',
    label: 'Deluge',
    intervalMs: 5 * SECOND,
    fetch: () =>
      withLogin(async () => {
        const ui = await call<{ torrents: Record<string, DeTorrent>; stats: { download_rate: number; upload_rate: number } }>('web.update_ui', [
          ['name', 'state', 'progress', 'download_payload_rate', 'eta'],
          {},
        ]);
        const paused = await call<boolean>('core.is_session_paused').catch(() => false);
        const t = Object.values(ui.torrents ?? {});
        const downloading = t.filter((x) => x.state === 'Downloading' || x.state === 'Queued');
        return {
          kind: 'torrent',
          down: ui.stats.download_rate,
          up: ui.stats.upload_rate,
          downloading: downloading.length,
          seeding: t.filter((x) => x.state === 'Seeding').length,
          stalled: downloading.filter((x) => x.state === 'Downloading' && x.download_payload_rate === 0).length,
          errored: t.filter((x) => x.state === 'Error').map((x) => x.name),
          paused,
          active: top(downloading.map((x) => ({ name: x.name, progress: x.progress / 100, speed: x.download_payload_rate, etaSec: x.eta }))),
        };
      }),
  };
  const control: DownloadControl = (action) =>
    withLogin(async () => {
      await call(action === 'pause' ? 'core.pause_session' : 'core.resume_session');
    });

  /** Deluge 2 takes a list in pause_torrents; 1.3 took it in pause_torrent. */
  const each = async (verb: 'pause' | 'resume', id: string) => {
    try {
      await call(`core.${verb}_torrents`, [[id]]);
    } catch {
      await call(`core.${verb}_torrent`, [[id]]);
    }
  };
  const manage: DownloadManager = {
    list: () =>
      withLogin(async () => {
        const ui = await call<{ torrents: Record<string, DeFull> }>('web.update_ui', [
          ['name', 'state', 'progress', 'total_wanted', 'total_done', 'download_payload_rate', 'upload_payload_rate', 'eta', 'ratio', 'label', 'time_added', 'tracker_host', 'message'],
          {},
        ]);
        return { kind: 'torrent', entries: Object.entries(ui.torrents ?? {}).map(([id, t]) => fromDeluge(id, t)) };
      }),
    act: (entry, action) =>
      withLogin(async () => {
        if (action === 'pause' || action === 'resume') await each(action, entry.id);
        else await call('core.remove_torrent', [entry.id, action === 'delete']);
      }),
    add: (what) =>
      withLogin(async () => {
        if ('file' in what) await call('core.add_torrent_file', [what.file.name, what.file.data.toString('base64'), {}]);
        else if (what.url.startsWith('magnet:')) await call('core.add_torrent_magnet', [what.url, {}]);
        else await call('core.add_torrent_url', [what.url, {}]);
      }),
  };
  return { adapter, control, manage };
}

interface DeFull {
  name: string;
  state: string;
  progress: number;
  total_wanted: number;
  total_done: number;
  download_payload_rate: number;
  upload_payload_rate: number;
  eta: number;
  ratio: number;
  label?: string;
  time_added: number;
  tracker_host?: string;
  message?: string;
}

export function fromDeluge(id: string, t: DeFull): DownloadEntry {
  const finished = t.progress >= 100;
  const s = t.state;
  const state: DownloadState =
    s === 'Error' ? 'errored' : s === 'Paused' ? (finished ? 'done' : 'paused') : s === 'Seeding' ? 'seeding' : s === 'Queued' ? (finished ? 'done' : 'queued') : s === 'Checking' || s === 'Allocating' || s === 'Moving' ? 'checking' : t.download_payload_rate ? 'downloading' : 'stalled';
  return {
    id,
    name: t.name,
    state,
    progress: t.progress / 100,
    size: t.total_wanted,
    done: t.total_done,
    down: t.download_payload_rate,
    up: t.upload_payload_rate,
    etaSec: finished ? -1 : eta(t.eta || -1),
    ratio: t.ratio >= 0 ? t.ratio : undefined,
    category: t.label || undefined,
    added: ms(t.time_added),
    tracker: t.tracker_host || undefined,
    error: s === 'Error' ? t.message : undefined,
  };
}

// ---------- SABnzbd: one API key in the query string ----------

interface SabSlot {
  filename: string;
  percentage: string;
  timeleft: string; // H:MM:SS
  status: string;
}

const hms = (s: string) => s.split(':').reduce((n, p) => n * 60 + (Number(p) || 0), 0);

export function sabnzbdClient() {
  const { url, key } = config.sabnzbd!;
  const api = <T>(mode: string, extra = '') =>
    request(`${url}/api?mode=${mode}&output=json&apikey=${encodeURIComponent(key)}${extra}`).then((r) => r.json() as Promise<T>);

  const adapter: Adapter<QbitData> = {
    id: 'sabnzbd',
    label: 'SABnzbd',
    intervalMs: 5 * SECOND,
    async fetch() {
      const [{ queue }, { history }] = await Promise.all([
        api<{ queue: { paused: boolean; kbpersec: string; slots: SabSlot[] } }>('queue'),
        api<{ history: { slots: { name: string; status: string; completed: number }[] } }>('history', '&limit=20'),
      ]);
      const rate = Number(queue.kbpersec) * 1024 || 0;
      const slots = queue.slots ?? [];
      const day = Date.now() / 1000 - 86_400;
      return {
        kind: 'usenet',
        down: rate,
        up: 0,
        downloading: slots.length,
        seeding: 0,
        stalled: 0,
        errored: (history.slots ?? []).filter((h) => h.status === 'Failed' && h.completed > day).map((h) => h.name),
        paused: queue.paused,
        active: slots.slice(0, 4).map((s, i) => ({
          name: s.filename,
          progress: (Number(s.percentage) || 0) / 100,
          // SABnzbd downloads one job at a time; the rest wait.
          speed: i === 0 && !queue.paused ? rate : 0,
          etaSec: hms(s.timeleft),
        })),
      };
    },
  };
  const control: DownloadControl = async (action) => {
    await api(action);
  };

  const ok = (r: { status?: boolean; error?: string }) => {
    if (r.status === false) throw new Error(`SABnzbd: ${r.error ?? 'refused'}`);
  };
  const manage: DownloadManager = {
    async list() {
      const [{ queue }, { history }] = await Promise.all([
        api<{ queue: { paused: boolean; kbpersec: string; slots: SabFull[] } }>('queue'),
        api<{ history: { slots: SabDone[] } }>('history', '&limit=60'),
      ]);
      const rate = Number(queue.kbpersec) * 1024 || 0;
      return { kind: 'usenet', entries: [...(queue.slots ?? []).map((s, i) => fromSabQueue(s, i === 0 && !queue.paused ? rate : 0, queue.paused)), ...(history.slots ?? []).map(fromSabHistory)] };
    },
    async act(entry, action) {
      const id = encodeURIComponent(entry.id);
      if (entry.history) {
        if (action === 'remove' || action === 'delete') ok(await api('history', `&name=delete&value=${id}${action === 'delete' ? '&del_files=1' : ''}`));
        return;
      }
      // A half-downloaded job's files are no use to anyone: removing it from the queue clears them.
      if (action === 'pause' || action === 'resume') ok(await api('queue', `&name=${action}&value=${id}`));
      else ok(await api('queue', `&name=delete&value=${id}&del_files=1`));
    },
    async add(what) {
      if ('url' in what) return ok(await api('addurl', `&name=${encodeURIComponent(what.url)}`));
      const form = new FormData();
      form.append('name', new Blob([new Uint8Array(what.file.data)], { type: 'application/x-nzb' }), what.file.name);
      const res = await request(`${url}/api?mode=addfile&output=json&apikey=${encodeURIComponent(key)}`, { method: 'POST', body: form });
      ok((await res.json()) as { status?: boolean; error?: string });
    },
  };
  return { adapter, control, manage };
}

interface SabFull {
  nzo_id: string;
  filename: string;
  percentage: string;
  mb: string;
  mbleft: string;
  timeleft: string;
  status: string;
  cat?: string;
}

interface SabDone {
  nzo_id: string;
  name: string;
  status: string;
  bytes: number;
  completed: number;
  category?: string;
  fail_message?: string;
}

const MB = 1_048_576;

export function fromSabQueue(s: SabFull, rate: number, allPaused: boolean): DownloadEntry {
  const size = (Number(s.mb) || 0) * MB;
  const left = (Number(s.mbleft) || 0) * MB;
  const st = s.status.toLowerCase();
  const state: DownloadState = allPaused || st === 'paused' ? 'paused' : st === 'downloading' ? (rate ? 'downloading' : 'stalled') : st === 'checking' || st === 'fetching' || st === 'grabbing' ? 'checking' : 'queued';
  return {
    id: s.nzo_id,
    name: s.filename,
    state,
    progress: (Number(s.percentage) || 0) / 100,
    size,
    done: Math.max(0, size - left),
    down: state === 'downloading' ? rate : 0,
    up: 0,
    etaSec: state === 'downloading' ? hms(s.timeleft) : -1,
    category: s.cat && s.cat !== '*' ? s.cat : undefined,
  };
}

export function fromSabHistory(h: SabDone): DownloadEntry {
  const failed = h.status === 'Failed';
  const finished = h.status === 'Completed';
  return {
    id: h.nzo_id,
    name: h.name,
    // Still unpacking or moving: the work after the download.
    state: failed ? 'errored' : finished ? 'done' : 'checking',
    progress: 1,
    size: h.bytes,
    done: h.bytes,
    down: 0,
    up: 0,
    etaSec: -1,
    category: h.category && h.category !== '*' ? h.category : undefined,
    added: ms(h.completed),
    error: failed ? h.fail_message || undefined : undefined,
    history: true,
  };
}

// ---------- NZBGet: JSON RPC behind basic auth ----------

interface NzbGroup {
  NZBName: string;
  FileSizeMB: number;
  RemainingSizeMB: number;
  Status: string;
}

export function nzbgetClient() {
  const { url, username, password } = config.nzbget!;
  async function rpc<T>(method: string, params: unknown[] = []): Promise<T> {
    const res = await request(`${url}/jsonrpc`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...basic(username, password) },
      body: JSON.stringify({ method, params }),
    });
    const body = (await res.json()) as { result: T; error?: { message: string } };
    if (body.error) throw new Error(`NZBGet: ${body.error.message}`);
    return body.result;
  }

  const adapter: Adapter<QbitData> = {
    id: 'nzbget',
    label: 'NZBGet',
    intervalMs: 5 * SECOND,
    async fetch() {
      const [status, groups, history] = await Promise.all([
        rpc<{ DownloadRate: number; DownloadPaused: boolean }>('status'),
        rpc<NzbGroup[]>('listgroups', [0]),
        rpc<{ Name: string; Status: string; HistoryTime: number }[]>('history', [false]).catch(() => []),
      ]);
      const rate = status.DownloadRate;
      const day = Date.now() / 1000 - 86_400;
      return {
        kind: 'usenet',
        down: rate,
        up: 0,
        downloading: groups.length,
        seeding: 0,
        stalled: 0,
        errored: history.filter((h) => h.Status.startsWith('FAILURE') && h.HistoryTime > day).map((h) => h.Name),
        paused: status.DownloadPaused,
        active: groups.slice(0, 4).map((g, i) => {
          const leftBytes = g.RemainingSizeMB * 1_048_576;
          const speed = i === 0 && g.Status === 'DOWNLOADING' ? rate : 0;
          return {
            name: g.NZBName,
            progress: g.FileSizeMB ? 1 - g.RemainingSizeMB / g.FileSizeMB : 0,
            speed,
            etaSec: speed ? Math.round(leftBytes / speed) : -1,
          };
        }),
      };
    },
  };
  const control: DownloadControl = async (action) => {
    await rpc(action === 'pause' ? 'pausedownload' : 'resumedownload');
  };

  /** NZBGet 18 and later take (command, param, ids); older ones put an offset first. */
  const edit = async (command: string, id: number) => {
    let done: boolean;
    try {
      done = await rpc<boolean>('editqueue', [command, '', [id]]);
    } catch {
      done = await rpc<boolean>('editqueue', [command, 0, '', [id]]);
    }
    if (!done) throw new Error(`NZBGet refused ${command}`);
  };
  const manage: DownloadManager = {
    async list() {
      const [status, groups, history] = await Promise.all([
        rpc<{ DownloadRate: number; DownloadPaused: boolean }>('status'),
        rpc<NzbFull[]>('listgroups', [0]),
        rpc<NzbDone[]>('history', [false]).catch(() => [] as NzbDone[]),
      ]);
      return {
        kind: 'usenet',
        entries: [...groups.map((g, i) => fromNzbget(g, i === 0 && g.Status === 'DOWNLOADING' && !status.DownloadPaused ? status.DownloadRate : 0, status.DownloadPaused)), ...history.slice(0, 60).map(fromNzbgetHistory)],
      };
    },
    async act(entry, action) {
      const id = Number(entry.id);
      if (entry.history) {
        if (action === 'remove' || action === 'delete') await edit('HistoryDelete', id);
        return;
      }
      await edit(action === 'pause' ? 'GroupPause' : action === 'resume' ? 'GroupResume' : 'GroupFinalDelete', id);
    },
    async add(what) {
      // A link goes as the content; NZBGet fetches it. A file goes as base64.
      const name = 'url' in what ? '' : what.file.name;
      const content = 'url' in what ? what.url : what.file.data.toString('base64');
      const id = await rpc<number>('append', [name, content, '', 0, false, false, '', 0, 'SCORE', []]);
      if (!(id > 0)) throw new Error("NZBGet didn't take it");
    },
  };
  return { adapter, control, manage };
}

interface NzbFull {
  NZBID: number;
  NZBName: string;
  FileSizeMB: number;
  RemainingSizeMB: number;
  Status: string;
  Category?: string;
}

interface NzbDone {
  NZBID: number;
  Name: string;
  Status: string;
  FileSizeMB: number;
  Category?: string;
  HistoryTime: number;
}

export function fromNzbget(g: NzbFull, rate: number, allPaused: boolean): DownloadEntry {
  const size = g.FileSizeMB * MB;
  const left = g.RemainingSizeMB * MB;
  const st = g.Status;
  const state: DownloadState = allPaused || st === 'PAUSED' ? 'paused' : st === 'DOWNLOADING' ? (rate ? 'downloading' : 'stalled') : st === 'QUEUED' ? 'queued' : 'checking';
  return {
    id: String(g.NZBID),
    name: g.NZBName,
    state,
    progress: size ? 1 - left / size : 0,
    size,
    done: Math.max(0, size - left),
    down: state === 'downloading' ? rate : 0,
    up: 0,
    etaSec: state === 'downloading' && rate ? Math.round(left / rate) : -1,
    category: g.Category || undefined,
  };
}

export function fromNzbgetHistory(h: NzbDone): DownloadEntry {
  const failed = h.Status.startsWith('FAILURE');
  return {
    id: String(h.NZBID),
    name: h.Name,
    state: failed ? 'errored' : 'done',
    progress: 1,
    size: h.FileSizeMB * MB,
    done: h.FileSizeMB * MB,
    down: 0,
    up: 0,
    etaSec: -1,
    category: h.Category || undefined,
    added: ms(h.HistoryTime),
    error: failed ? h.Status.split('/')[1]?.toLowerCase() : undefined,
    history: true,
  };
}

export const DOWNLOAD_CLIENTS: DownloadClientId[] = ['qbit', 'transmission', 'deluge', 'sabnzbd', 'nzbget'];
