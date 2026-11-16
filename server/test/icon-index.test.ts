import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { buildIndex, resolveIn, variants } from '../icon-index.ts';

const dash = { plex: { aliases: ['pms-docker', 'plex media server'] }, portainer: { aliases: [] }, jellyfin: { aliases: [] } };
const selfhst = [
  { Reference: 'jellyfin', Name: 'Jellyfin', PNG: 'Yes' },
  { Reference: 'pocket-id', Name: 'Pocket ID', PNG: 'Yes' },
  { Reference: 'no-png', Name: 'No PNG', PNG: 'No' },
];
const index = buildIndex(dash, selfhst);

test('icon names: aliases, extra words and the second set all find an icon', () => {
  assert.deepEqual(resolveIn(index, ['pms-docker']), { set: 'dash', ref: 'plex' });
  assert.deepEqual(resolveIn(index, ['portainer-ce']), { set: 'dash', ref: 'portainer' });
  assert.deepEqual(resolveIn(index, ['jellyfin-server']), { set: 'dash', ref: 'jellyfin' }, 'dashboard icons first');
  assert.deepEqual(resolveIn(index, ['Pocket ID']), { set: 'selfhst', ref: 'pocket-id' });
  assert.equal(resolveIn(index, ['no-png']), null, 'a selfh.st entry without a PNG is skipped');
  assert.equal(resolveIn(index, ['made-up-thing']), null);
  // The first name that matches wins, in the order given.
  assert.deepEqual(resolveIn(index, ['nothing-here', 'plex']), { set: 'dash', ref: 'plex' });
});

test('variants take the extra words off one at a time', () => {
  assert.deepEqual(variants('linuxserver-sonarr'), ['linuxserver-sonarr', 'sonarr']);
  assert.deepEqual(variants('paperless-ngx'), ['paperless-ngx', 'paperless']);
});
