// Presence stays fresh while someone works (src/utils/presenceActivity.js).
// Found in the real two-account run (TEST-PLAN Part 9, 2026-10-06): a person
// editing on one page for 2+ minutes vanished from the other person's people
// token, because last_seen was written only on open and on page change.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createPresenceActivityBump, PRESENCE_ACTIVITY_EVENTS, PRESENCE_ACTIVITY_REFRESH_MS,
} from '../src/utils/presenceActivity.js';
import { PRESENCE_IDLE_MS } from '../src/components/presenceIdentity.js';
import { PRESENCE_STALE_MS } from '../src/hooks/presenceRoster.js';

test('refresh interval keeps an active person "here" and never stale', () => {
  assert.ok(PRESENCE_ACTIVITY_REFRESH_MS < PRESENCE_IDLE_MS);
  assert.ok(PRESENCE_ACTIVITY_REFRESH_MS < PRESENCE_STALE_MS);
  assert.deepEqual([...PRESENCE_ACTIVITY_EVENTS].sort(), ['keydown', 'pointerdown', 'touchstart', 'wheel']);
});

test('bumps at most once per interval, only on activity', () => {
  let t = 0;
  let bumps = 0;
  const b = createPresenceActivityBump({ onBump: () => { bumps += 1; }, refreshMs: 45_000, now: () => t });
  b.noteWrite(); // the open / page-change write
  for (t = 0; t < 45_000; t += 1000) b.onActivity();
  assert.equal(bumps, 0, 'no extra write inside the first interval');
  t = 45_000;
  assert.equal(b.onActivity(), true);
  assert.equal(bumps, 1);
  t = 60_000;
  assert.equal(b.onActivity(), false);
  t = 90_000;
  assert.equal(b.onActivity(), true);
  assert.equal(bumps, 2);
  // Two minutes with nobody touching anything: no writes at all (no timer).
  t = 210_000;
  assert.equal(bumps, 2);
});

test('input while this document sits in a background tab does not keep it fresh', () => {
  let t = 0;
  let bumps = 0;
  let front = false;
  const b = createPresenceActivityBump({ onBump: () => { bumps += 1; }, now: () => t, isActive: () => front });
  b.noteWrite();
  t = 100_000;
  assert.equal(b.onActivity(), false, 'another tab is in front');
  assert.equal(bumps, 0);
  front = true;
  assert.equal(b.onActivity(), true, 'back in front: the next input refreshes');
  assert.equal(bumps, 1);
});

test('desktop people token: you stay on the list after your row ages out; one row per person', async () => {
  const { presencePeopleRows } = await import('../src/components/presenceIdentity.js');
  const opts = { currentUserId: 'a', currentUserEmail: 'a@example.com', currentUserDisplayName: 'Claude Test' };
  const rows = presencePeopleRows([
    { user_id: 'b', display_name: 'b@example.com', last_seen: '2026-10-06T20:59:10Z' },
    { user_id: 'b', display_name: 'b@example.com', last_seen: '2026-10-06T20:59:50Z' },
    { user_id: 'c', display_name: 'c@example.com', last_seen: '2026-10-06T20:59:30Z' },
  ], opts);
  assert.deepEqual(rows.map((r) => [r.user_id, r.last_seen || null]), [
    ['a', null], ['b', '2026-10-06T20:59:50Z'], ['c', '2026-10-06T20:59:30Z'],
  ]);
  assert.equal(rows[0].name, 'Claude Test');
  // Your own fresh row is used as-is (not duplicated).
  const withSelf = presencePeopleRows([{ user_id: 'a', display_name: 'a@example.com', last_seen: '2026-10-06T21:00:00Z' }], opts);
  assert.deepEqual(withSelf.map((r) => r.user_id), ['a']);
  assert.equal(withSelf[0].last_seen, '2026-10-06T21:00:00Z');
  // Nobody at all yet: just you.
  assert.deepEqual(presencePeopleRows([], opts).map((r) => r.user_id), ['a']);
  // Signed out: nobody.
  assert.deepEqual(presencePeopleRows([], {}), []);
});

test('person working for 3 minutes on one page: last write never older than the idle line', () => {
  let t = 0;
  let last = 0;
  const b = createPresenceActivityBump({ onBump: () => { last = t; }, now: () => t });
  b.noteWrite();
  let worst = 0;
  for (t = 0; t <= 180_000; t += 5000) { // an action every 5 s
    b.onActivity();
    worst = Math.max(worst, t - last);
  }
  assert.ok(worst < PRESENCE_IDLE_MS, `oldest last_seen ${worst} ms`);
});

test('you stay on your own people list after your row ages out while others are fresh (phone list)', async () => {
  const { normalizeMobilePresence } = await import('../src/mobile/mobilePdfViewerModel.js');
  const now = Date.parse('2026-10-06T21:00:00Z');
  const users = normalizeMobilePresence({
    presence: [{ user_id: 'b', display_name: 'b@example.com', last_seen: '2026-10-06T20:59:50Z' }],
    currentUserId: 'a',
    currentUserEmail: 'a@example.com',
    currentUserDisplayName: 'Claude Test',
    now,
  });
  assert.deepEqual(users.map((u) => [u.id, u.isCurrent, u.state]), [['a', true, 'here'], ['b', false, 'here']]);
  // Nobody else: still just you.
  const alone = normalizeMobilePresence({ presence: [], currentUserId: 'a', currentUserDisplayName: 'Claude Test', now });
  assert.deepEqual(alone.map((u) => u.id), ['a']);
});
