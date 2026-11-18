// The integration an app on the board stands for: Plex is Tautulli, the
// qBittorrent container is qbit. A tile offers to connect it until it is.

import { INTEGRATIONS, type Integration } from '../../shared/integrations.ts';
import { UI_SETUP } from '../../shared/setup.ts';
import type { Service, Snapshot } from '../../shared/types.ts';

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/** App, container and image names that don't match their integration's own. */
const ALIASES: Record<string, string> = {
  plex: 'tautulli',
  pmsdocker: 'tautulli',
  qbittorrent: 'qbit',
  homeassistant: 'homeassistant',
  uptimekuma: 'uptimekuma',
  adguardhome: 'adguard',
  paperlessngx: 'paperless',
  paperlesswebserver: 'paperless',
  pihole: 'pihole',
  jellyseerr: 'overseerr',
  seerr: 'overseerr',
  overseerr: 'overseerr',
  speedtesttracker: 'speedtest',
  forgejo: 'gitea',
};

/** The integration this app is, when Patchboard can set it up from Settings. */
export function integrationOf(s: Service): Integration | undefined {
  const names = [s.container, s.name, s.icon?.replace(/\.(png|svg|webp)$/, '')].filter(Boolean).map((n) => norm(n!));
  for (const n of names) {
    const id = ALIASES[n] ?? INTEGRATIONS.find((i) => norm(i.id) === n || norm(i.name) === n)?.id;
    const hit = id ? INTEGRATIONS.find((i) => i.id === id) : undefined;
    if (hit && UI_SETUP.has(hit.id)) return hit;
  }
  return undefined;
}

/** Set up already, from Settings or the environment. */
export function isConnected(snap: Snapshot, i: Integration): boolean {
  return !!snap.sources[i.id as keyof Snapshot['sources']] || !!snap.features?.includes(i.id);
}

/** Integration ids whose icon goes by another name in the icon sets. */
const ICON_NAMES: Record<string, string> = { qbit: 'qbittorrent', dockerhosts: 'docker', overseerr: 'overseerr', gitea: 'gitea', unifi: 'unifi', nut: 'nut', hardcover: 'hardcover', speedtest: 'speedtest-tracker', uptimekuma: 'uptime-kuma', adguard: 'adguard-home', homeassistant: 'home-assistant', synology: 'synology', truenas: 'truenas' };

/** The icon to draw for an integration: its id, as the icon sets name most apps. */
export const iconFor = (i: Integration): string => ICON_NAMES[i.id] ?? i.id;
