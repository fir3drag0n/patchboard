// What each integration lights up: the widgets that read it and the pages
// that appear once it's set up. One table, read three ways: the add drawer
// offers a widget once one of its sources is on, the navigation shows a page
// once one of its sources is on, and an app's sheet lists everything its
// connection feeds.

import type { WidgetType } from './board.ts';
import { NAS_SOURCES } from './types.ts';

/** The sources each widget reads; any one is enough. Widgets that need none are left out. */
export const WIDGET_SOURCES: Partial<Record<WidgetType, string[]>> = {
  homeassistant: ['homeassistant'],
  halist: ['homeassistant'],
  climate: ['homeassistant'],
  shades: ['homeassistant'],
  people: ['homeassistant'],
  rooms: ['homeassistant'],
  // Only once Home Assistant reports a printer; see widgetReady.
  printer: ['homeassistant'],
  car: ['tessie'],
  uptime: ['uptimekuma', 'gatus', 'healthchecks'],
  dns: ['pihole', 'adguard'],
  speed: ['speedtest'],
  photos: ['immich'],
  cameras: ['frigate'],
  proxmox: ['proxmox'],
  drives: ['scrutiny'],
  sync: ['syncthing'],
  hosts: ['glances', 'beszel'],
  power: ['nut'],
  storage: [...NAS_SOURCES],
  dockerhosts: ['portainer'],
  network: ['unifi', 'tailscale'],
  calendar: ['calendar'],
  books: ['books'],
  requests: ['overseerr'],
  nextup: ['jellyfin', 'emby'],
  watched: ['tautulli', 'jellyfin', 'emby'],
  listening: ['audiobookshelf', 'navidrome'],
  downloads: ['qbit', 'transmission', 'deluge', 'sabnzbd', 'nzbget', 'sonarr', 'radarr'],
  managers: ['lidarr', 'readarr', 'prowlarr', 'bazarr'],
  documents: ['paperless'],
  nextcloud: ['nextcloud'],
  git: ['gitea'],
  monitoring: ['netdata', 'prometheus'],
  miners: ['bitaxe'],
};

/** Widgets that show without any of these, and read them when they're on. */
export const ALSO_READ: Partial<Record<WidgetType, string[]>> = {
  now: ['tautulli', 'jellyfin', 'emby', 'audiobookshelf', 'navidrome'],
  upcoming: ['sonarr', 'radarr', 'trakt'],
  recent: ['tautulli', 'jellyfin', 'emby'],
  inbox: ['fastmail'],
  feeds: ['miniflux'],
};

/** Pages that join the navigation once one of these sources is on. */
export const PAGE_SOURCES: Record<string, string[]> = {
  '/downloads': ['qbit', 'transmission', 'deluge', 'sabnzbd', 'nzbget'],
  '/library': ['sonarr', 'radarr'],
  '/requests': ['overseerr'],
  '/media': ['tautulli', 'jellyfin', 'emby'],
  '/blocking': ['pihole', 'adguard'],
  '/reading': ['miniflux'],
};

/** Integrations that report under another source's name: Plex is read through Tautulli's place. */
const SOURCE_OF: Record<string, string> = { plex: 'tautulli', hardcover: 'books', goodreads: 'books' };

/** The source an integration's data arrives as. */
export const sourceOf = (integration: string): string => SOURCE_OF[integration] ?? integration;

/** Whether any of a list of sources is on. */
export const anyOn = (sources: string[], on: (id: string) => boolean): boolean => sources.some(on);

/** Everything an integration feeds: the widgets that read it and the pages it brings. */
export function feedsOf(integration: string): { widgets: WidgetType[]; pages: string[] } {
  const src = sourceOf(integration);
  return {
    widgets: (Object.entries({ ...ALSO_READ, ...WIDGET_SOURCES }) as [WidgetType, string[]][]).filter(([, s]) => s.includes(src)).map(([w]) => w),
    pages: Object.entries(PAGE_SOURCES)
      .filter(([, s]) => s.includes(src))
      .map(([p]) => p),
  };
}
