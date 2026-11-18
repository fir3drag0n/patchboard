// Which widgets have something to show: an integration widget is ready once
// its integration is on. The add drawer offers only ready widgets, and a
// starting layout drops the ones that would land empty.

import { type Board, WIDGET_INFO, type WidgetType } from '../../shared/board.ts';
import { anyOn, WIDGET_SOURCES } from '../../shared/feeds.ts';
import type { HomeAssistantData, Snapshot } from '../../shared/types.ts';

export function widgetReady(snap: Snapshot | null | undefined): Partial<Record<WidgetType, boolean>> {
  const has = (id: string) => !!snap?.sources[id as keyof Snapshot['sources']];
  const out: Partial<Record<WidgetType, boolean>> = Object.fromEntries((Object.entries(WIDGET_SOURCES) as [WidgetType, string[]][]).map(([w, s]) => [w, anyOn(s, has)]));
  // Only once Home Assistant has a printer to show.
  out.printer = !!(snap?.sources.homeassistant?.data as HomeAssistantData | undefined)?.printers?.length;
  out.wake = !!snap?.features?.includes('wake');
  return out;
}

/** What a widget waits for: the integration to name, and the one Settings opens to set it up. */
export const NEEDS: Partial<Record<WidgetType, { label: string; setup: string }>> = {
  homeassistant: { label: 'Home Assistant', setup: 'homeassistant' },
  car: { label: 'Tessie', setup: 'tessie' },
  printer: { label: 'Home Assistant with the Bambu Lab integration', setup: 'homeassistant' },
  uptime: { label: 'Uptime Kuma, Gatus or Healthchecks.io', setup: 'uptimekuma' },
  dns: { label: 'Pi-hole or AdGuard Home', setup: 'pihole' },
  speed: { label: 'Speedtest Tracker', setup: 'speedtest' },
  photos: { label: 'Immich', setup: 'immich' },
  cameras: { label: 'Frigate', setup: 'frigate' },
  proxmox: { label: 'Proxmox', setup: 'proxmox' },
  drives: { label: 'Scrutiny', setup: 'scrutiny' },
  sync: { label: 'Syncthing', setup: 'syncthing' },
  hosts: { label: 'Glances or Beszel', setup: 'glances' },
  power: { label: 'NUT', setup: 'nut' },
  storage: { label: 'Unraid, Synology or QNAP', setup: 'unraid' },
  dockerhosts: { label: 'Portainer', setup: 'portainer' },
  network: { label: 'UniFi or Tailscale', setup: 'unifi' },
  calendar: { label: 'a calendar', setup: 'calendar' },
  books: { label: 'Hardcover or Goodreads', setup: 'hardcover' },
  requests: { label: 'Overseerr or Jellyseerr', setup: 'overseerr' },
  wake: { label: 'Wake-on-LAN machines', setup: 'wake' },
  nextup: { label: 'Jellyfin or Emby', setup: 'jellyfin' },
  downloads: { label: 'a download client, Sonarr or Radarr', setup: 'qbit' },
  watched: { label: 'Plex, Jellyfin or Emby', setup: 'plex' },
  listening: { label: 'Audiobookshelf or Navidrome', setup: 'audiobookshelf' },
  managers: { label: 'Lidarr, Readarr, Prowlarr or Bazarr', setup: 'lidarr' },
  documents: { label: 'Paperless-ngx', setup: 'paperless' },
  nextcloud: { label: 'Nextcloud', setup: 'nextcloud' },
  git: { label: 'Gitea or Forgejo', setup: 'gitea' },
  monitoring: { label: 'Netdata or Prometheus', setup: 'netdata' },
  halist: { label: 'Home Assistant', setup: 'homeassistant' },
  climate: { label: 'Home Assistant', setup: 'homeassistant' },
  shades: { label: 'Home Assistant', setup: 'homeassistant' },
  people: { label: 'Home Assistant', setup: 'homeassistant' },
  rooms: { label: 'Home Assistant', setup: 'homeassistant' },
  miners: { label: 'BitAxe', setup: 'bitaxe' },
};

/** Where to set up what a widget needs. */
export const setupHref = (t: WidgetType): string => `/settings?tab=connections&setup=${NEEDS[t]?.setup ?? ''}`;

/** The widgets a layout would drop here, by name, for a note beside it. */
export function leftOut(board: Board, snap: Snapshot | null | undefined): string[] {
  const ready = widgetReady(snap);
  return board.widgets.filter((w) => ready[w.type] === false).map((w) => WIDGET_INFO[w.type].name);
}

/** A starting layout with the widgets that would land empty taken out. */
export function forThisServer(board: Board, snap: Snapshot | null | undefined): Board {
  const ready = widgetReady(snap);
  return { ...structuredClone(board), widgets: board.widgets.filter((w) => ready[w.type] !== false && WIDGET_INFO[w.type]) };
}
