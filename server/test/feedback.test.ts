import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { browserLabel, ideaUrl, pageLabel } from '../../web/lib/feedback.ts';

test('an idea opens the GitHub form with the page and version, and nothing private', () => {
  const url = new URL(ideaUrl('1.15.0', '/c/plex'));
  assert.equal(url.origin + url.pathname, 'https://github.com/sourpatchdad/patchboard/issues/new');
  assert.equal(url.searchParams.get('template'), 'feature.yml');
  assert.equal(url.searchParams.get('else'), "Sent from a container's page, Patchboard 1.15.0.");
  assert.equal(url.href.includes('plex'), false, 'a container name never leaves');
  assert.deepEqual(['/', '/downloads', '/settings'].map(pageLabel), ['Home', 'Downloads', 'Settings']);
});

test('a problem report names the browser the way people would', () => {
  const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 26_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
  assert.equal(browserLabel(iphone, true), 'Safari on iPhone (installed as an app)');
  assert.equal(browserLabel('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0 Safari/537.36 Edg/140.0', false), 'Edge on Windows');
});
