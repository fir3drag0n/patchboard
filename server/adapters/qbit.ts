// qBittorrent Web API v2. Login gives a SID cookie; on 403 we log in again.

import type { DownloadEntry, DownloadState, QbitData, QueueItem } from '../../shared/types.ts';
import { config } from '../config.ts';
import { HttpError, request } from '../http.ts';
import { type Adapter, SECOND } from './adapter.ts';
import type { FilePriority, TorrentDetail, TorrentFile } from '../../shared/types.ts';
import { type DownloadControl, type DownloadManager, type ItemAction, trackerHost } from './downloads.ts';

interface Torrent {
  hash: string;
  name: string;
  state: string;
  progress: number;
  dlspeed: number;
  eta: number;
}

const DOWNLOADING = new Set(['downloading', 'forcedDL', 'metaDL', 'checkingDL', 'queuedDL']);
const SEEDING = new Set(['uploading', 'forcedUP', 'stalledUP', 'queuedUP']);
const ERRORED = new Set(['error', 'missingFiles']);
// qBittorrent 5 renamed paused to stopped.
const PAUSED = new Set(['pausedDL', 'pausedUP', 'stoppedDL', 'stoppedUP']);
const LOGIN_BACKOFF = 30 * 60 * 1000;
const QUEUED = new Set(['queuedDL', 'checkingDL', 'metaDL']);

/** A torrent as one row: what it's doing, in the words the board uses. */
export function toItem(t: Torrent): QueueItem {
  const state: QueueItem['state'] = ERRORED.has(t.state) ? 'errored' : PAUSED.has(t.state) ? 'paused' : t.state === 'stalledDL' ? 'stalled' : QUEUED.has(t.state) ? 'queued' : 'downloading';
  return { id: t.hash, name: t.name, progress: t.progress, speed: t.dlspeed, etaSec: t.eta, state };
}

const ORDER: Record<QueueItem['state'], number> = { errored: 0, downloading: 1, stalled: 2, queued: 3, paused: 4 };

/** Unfinished torrents, errored first, then the fastest, up to 20. */
export function unfinished(torrents: Torrent[]): QueueItem[] {
  return torrents
    .filter((t) => t.progress < 1 || ERRORED.has(t.state))
    .map(toItem)
    .sort((a, b) => ORDER[a.state] - ORDER[b.state] || b.speed - a.speed)
    .slice(0, 20);
}

interface QbitFull extends Torrent {
  size: number;
  completed: number;
  upspeed: number;
  ratio: number;
  uploaded?: number;
  category: string;
  added_on: number;
  tracker: string;
}

const CHECKING = new Set(['checkingDL', 'checkingUP', 'checkingResumeData', 'moving', 'allocating']);

/** One torrent as the Downloads page shows it. */
export function fromQbit(t: QbitFull): DownloadEntry {
  const finished = t.progress >= 1;
  const state: DownloadState = ERRORED.has(t.state)
    ? 'errored'
    : PAUSED.has(t.state)
      ? finished ? 'done' : 'paused'
      : CHECKING.has(t.state)
        ? 'checking'
        : SEEDING.has(t.state)
          ? 'seeding'
          : t.state === 'stalledDL'
            ? 'stalled'
            : t.state === 'queuedDL'
              ? 'queued'
              : 'downloading';
  return {
    id: t.hash,
    name: t.name,
    state,
    progress: t.progress,
    size: t.size,
    done: t.completed,
    down: t.dlspeed,
    up: t.upspeed,
    etaSec: finished || t.eta >= 8_640_000 ? -1 : t.eta,
    ratio: t.ratio >= 0 ? t.ratio : undefined,
    ...(t.uploaded != null && t.uploaded >= 0 ? { uploaded: t.uploaded } : {}),
    category: t.category || undefined,
    added: t.added_on ? t.added_on * 1000 : undefined,
    tracker: trackerHost(t.tracker),
  };
}

export function qbitAdapter(): Adapter<QbitData> {
  return qbitClient().adapter;
}

interface QbitFile {
  index?: number;
  name: string;
  size: number;
  progress: number;
  priority: number;
}

/** qBittorrent: 0 skip, 1 normal, 6 high, 7 highest. */
const QB_PRIORITY: Record<FilePriority, number> = { skip: 0, normal: 1, high: 6 };

export function fromQbitDetail(files: QbitFile[], props: { dl_limit?: number; up_limit?: number }, category: string | undefined, categories: string[]): TorrentDetail {
  const many = files.length > 1;
  return {
    files: files.map((f, i): TorrentFile => ({
      index: f.index ?? i,
      name: many ? f.name.replace(/^[^/]+\//, '') : f.name,
      size: f.size,
      progress: f.progress,
      priority: f.priority === 0 ? 'skip' : f.priority >= 6 ? 'high' : 'normal',
    })),
    limits: { down: Math.max(0, props.dl_limit ?? 0), up: Math.max(0, props.up_limit ?? 0) },
    category: category ?? '',
    categories: categories.sort((a, b) => a.localeCompare(b)),
  };
}

export function qbitClient(): { adapter: Adapter<QbitData>; control: DownloadControl; item: (hash: string, action: ItemAction) => Promise<void>; altSpeed: () => Promise<void>; manage: DownloadManager } {
  const { url, username, password } = config.qbit!;
  let cookie = '';
  // qBittorrent bans an IP after a few failed logins, and the ban hits every
  // app behind that IP. So: one login in flight at a time, and after a failed
  // login, no further attempts until LOGIN_BACKOFF has passed.
  let pending: Promise<void> | null = null;
  let blockedUntil = 0;

  function login(): Promise<void> {
    pending ??= (async () => {
      if (Date.now() < blockedUntil) {
        throw new Error('qBittorrent rejected the last login. Check QBIT_USERNAME and QBIT_PASSWORD; Patchboard tries again in 30 minutes.');
      }
      try {
        const res = await request(`${url}/api/v2/auth/login`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Referer: url, Origin: url },
          body: new URLSearchParams({ username, password }),
        });
        const text = (await res.text()).trim();
        const sid = (res.headers.get('set-cookie') ?? '').split(';')[0];
        // qBittorrent 4.x answers 200 "Ok."; 5.x answers 204 with an empty body.
        // Either way success comes with a session cookie. The body is
        // qBittorrent's own message ("Fails.", a ban notice), never the credentials.
        if ((text !== 'Ok.' && text !== '') || !sid) {
          throw new Error(`qBittorrent rejected the login (HTTP ${res.status}: ${JSON.stringify(text.slice(0, 120))})`);
        }
        cookie = sid;
      } catch (err) {
        cookie = '';
        blockedUntil = Date.now() + LOGIN_BACKOFF;
        throw err;
      }
    })().finally(() => { pending = null; });
    return pending;
  }

  async function send(path: string, init: RequestInit = {}): Promise<Response> {
    if (!cookie) await login();
    const go = () => request(`${url}${path}`, { ...init, headers: { ...(init.headers as Record<string, string>), Cookie: cookie } });
    try {
      return await go();
    } catch (err) {
      // An expired session answers 403. Re-login once; login() itself is rate limited.
      if (err instanceof HttpError && err.status === 403) {
        cookie = '';
        await login();
        return go();
      }
      throw err;
    }
  }

  const get = async <T>(path: string): Promise<T> => (await (await send(path)).json()) as T;

  /** Every torrent at once. qBittorrent 5 calls it stop and start; 4.x, pause and resume. */
  const control: DownloadControl = async (action) => {
    const post = (verb: string) =>
      send(`/api/v2/torrents/${verb}`, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'hashes=all' });
    try {
      await post(action === 'pause' ? 'stop' : 'start');
    } catch (err) {
      if (!(err instanceof HttpError && err.status === 404)) throw err;
      await post(action);
    }
  };

  const form = (path: string, body: string) => send(path, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });

  /** One torrent. Remove keeps the downloaded files. */
  const item = async (hash: string, action: ItemAction): Promise<void> => {
    const h = `hashes=${encodeURIComponent(hash)}`;
    if (action === 'remove') return void (await form('/api/v2/torrents/delete', `${h}&deleteFiles=false`));
    try {
      await form(`/api/v2/torrents/${action === 'pause' ? 'stop' : 'start'}`, h);
    } catch (err) {
      if (!(err instanceof HttpError && err.status === 404)) throw err;
      await form(`/api/v2/torrents/${action}`, h);
    }
  };

  /** The alternative speed limits, on or off. */
  const altSpeed = async (): Promise<void> => void (await form('/api/v2/transfer/toggleSpeedLimitsMode', ''));

  const manage: DownloadManager = {
    async list() {
      return { kind: 'torrent', entries: (await get<QbitFull[]>('/api/v2/torrents/info')).map(fromQbit) };
    },
    async act(entry, action) {
      if (action === 'pause' || action === 'resume') return item(entry.id, action);
      await form('/api/v2/torrents/delete', `hashes=${encodeURIComponent(entry.id)}&deleteFiles=${action === 'delete'}`);
    },
    async add(what) {
      const body = new FormData();
      if ('url' in what) body.append('urls', what.url);
      else body.append('torrents', new Blob([new Uint8Array(what.file.data)], { type: 'application/x-bittorrent' }), what.file.name);
      const text = (await (await send('/api/v2/torrents/add', { method: 'POST', body })).text()).trim();
      if (text === 'Fails.') throw new Error("qBittorrent didn't take it: not a torrent, or already there");
    },
    async detail(entry) {
      const h = encodeURIComponent(entry.id);
      const [files, props, cats] = await Promise.all([
        get<QbitFile[]>(`/api/v2/torrents/files?hash=${h}`),
        get<{ dl_limit?: number; up_limit?: number }>(`/api/v2/torrents/properties?hash=${h}`),
        get<Record<string, unknown>>('/api/v2/torrents/categories').catch(() => ({})),
      ]);
      return fromQbitDetail(files, props, entry.category, Object.keys(cats));
    },
    async change(entry, change) {
      const h = `hash=${encodeURIComponent(entry.id)}`;
      const hs = `hashes=${encodeURIComponent(entry.id)}`;
      if ('files' in change) await form('/api/v2/torrents/filePrio', `${h}&id=${change.files.join('|')}&priority=${QB_PRIORITY[change.priority]}`);
      else if ('category' in change) await form('/api/v2/torrents/setCategory', `${hs}&category=${encodeURIComponent(change.category)}`);
      else {
        await form('/api/v2/torrents/setDownloadLimit', `${hs}&limit=${Math.round(change.limits.down)}`);
        await form('/api/v2/torrents/setUploadLimit', `${hs}&limit=${Math.round(change.limits.up)}`);
      }
    },
  };

  const adapter: Adapter<QbitData> = {
    id: 'qbit',
    label: 'qBittorrent',
    intervalMs: 5 * SECOND,
    async fetch() {
      const [info, torrents, mode] = await Promise.all([
        get<{ dl_info_speed: number; up_info_speed: number }>('/api/v2/transfer/info'),
        get<Torrent[]>('/api/v2/torrents/info'),
        send('/api/v2/transfer/speedLimitsMode').then((r) => r.text()).catch(() => '0'),
      ]);
      const active = torrents
        .filter((t) => DOWNLOADING.has(t.state))
        .sort((a, b) => b.dlspeed - a.dlspeed)
        .slice(0, 4)
        .map((t) => ({ name: t.name, progress: t.progress, speed: t.dlspeed, etaSec: t.eta }));
      return {
        kind: 'torrent',
        paused: torrents.length > 0 && torrents.every((t) => PAUSED.has(t.state)),
        down: info.dl_info_speed,
        up: info.up_info_speed,
        downloading: torrents.filter((t) => DOWNLOADING.has(t.state)).length,
        seeding: torrents.filter((t) => SEEDING.has(t.state)).length,
        stalled: torrents.filter((t) => t.state === 'stalledDL').length,
        errored: torrents.filter((t) => ERRORED.has(t.state)).map((t) => t.name),
        active,
        items: unfinished(torrents),
        altSpeed: mode.trim() === '1',
      };
    },
  };
  return { adapter, control, item, altSpeed, manage };
}
