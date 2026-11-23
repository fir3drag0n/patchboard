import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fromMailcow } from '../adapters/monitors.ts';

test('mailcow: containers become monitors, the queue goes down past its limit', () => {
  const containers = {
    'postfix-mailcow': { type: 'info', container: 'postfix-mailcow', state: 'running', started_at: '2026-11-19T08:05:13Z' },
    'dovecot-mailcow': { type: 'info', container: 'dovecot-mailcow', state: 'exited' },
  };
  const m = fromMailcow(containers, [], 20);
  assert.deepEqual(
    m.map((x) => [x.name, x.status]),
    [
      ['Mailcow dovecot', 'down'],
      ['Mailcow postfix', 'up'],
      ['Mail queue', 'up'],
    ],
  );
  assert.equal(m[0].msg, 'state exited');
  assert.equal(m[1].since, Date.parse('2026-11-19T08:05:13Z'));
  const busy = fromMailcow({}, new Array(21).fill({}), 20);
  assert.equal(busy[0].status, 'down');
  assert.equal(busy[0].msg, '21 mails waiting');
});
