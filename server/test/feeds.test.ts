import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ALSO_READ, feedsOf, PAGE_SOURCES, sourceOf, WIDGET_SOURCES } from '../../shared/feeds.ts';
import { INTEGRATIONS } from '../../shared/integrations.ts';
import { NEEDS } from '../../web/board/ready.ts';

test('what an integration lights up: widgets and pages', () => {
  const sonarr = feedsOf('sonarr');
  assert.ok(sonarr.widgets.includes('downloads'));
  assert.ok(sonarr.widgets.includes('upcoming'), 'This week reads Sonarr too');
  assert.deepEqual(sonarr.pages, ['/library']);
  // Plex reports in Tautulli's place.
  assert.equal(sourceOf('plex'), 'tautulli');
  assert.ok(feedsOf('plex').widgets.includes('watched'));
  assert.deepEqual(feedsOf('plex').pages, ['/media']);
  assert.ok(feedsOf('homeassistant').widgets.includes('printer'));
  assert.deepEqual(feedsOf('weather'), { widgets: [], pages: [] });
});

test('the table names only real sources, and covers every widget that waits for one', () => {
  const known = new Set(INTEGRATIONS.map((i) => sourceOf(i.id)));
  for (const [w, list] of Object.entries(WIDGET_SOURCES)) for (const s of list) assert.ok(known.has(s), `${w} reads ${s}, which no integration provides`);
  for (const [w, list] of Object.entries(ALSO_READ)) for (const s of list) assert.ok(known.has(s), `${w} reads ${s}, which no integration provides`);
  for (const [p, list] of Object.entries(PAGE_SOURCES)) for (const s of list) assert.ok(known.has(s), `${p} needs ${s}, which no integration provides`);
  // Wake-on-LAN is a feature, not an integration.
  for (const w of Object.keys(NEEDS)) if (w !== 'wake') assert.ok(WIDGET_SOURCES[w as keyof typeof WIDGET_SOURCES], `${w} waits for a setup but lists no sources`);
});
