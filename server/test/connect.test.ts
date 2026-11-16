import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { integrationOf, isConnected } from '../../web/lib/connect.ts';
import type { Service, Snapshot } from '../../shared/types.ts';

const app = (over: Partial<Service>): Service => ({ name: 'x', ...over }) as Service;

test('an app on the board knows which integration it is', () => {
  assert.equal(integrationOf(app({ name: 'Plex', container: 'plex' }))?.id, 'tautulli');
  assert.equal(integrationOf(app({ name: 'qBittorrent', container: 'qbittorrent' }))?.id, 'qbit');
  assert.equal(integrationOf(app({ name: 'Sonarr', container: 'sonarr' }))?.id, 'sonarr');
  assert.equal(integrationOf(app({ name: 'Paperless', container: 'paperless-ngx' }))?.id, 'paperless');
  assert.equal(integrationOf(app({ name: 'Cloudflared', container: 'cloudflared' })), undefined);
});

test('a tile offers Connect only until the integration is set up', () => {
  const sonarr = integrationOf(app({ container: 'sonarr' }))!;
  assert.equal(isConnected({ sources: {}, features: [] } as unknown as Snapshot, sonarr), false);
  assert.equal(isConnected({ sources: { sonarr: { ok: false } }, features: [] } as unknown as Snapshot, sonarr), true);
});
