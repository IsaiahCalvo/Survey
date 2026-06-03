// Audit #4 — incremental presence roster reducer.
//
// The "who's viewing this document" avatar list switched from re-SELECTing the
// whole document_presence table on every realtime event to applying each WAL
// event as a delta. These tests model the exact event contract Supabase emits
// ({ type, row, prevRow }) and lock in the correctness guards an adversarial
// review flagged: the seed/subscribe race, NOT self-filtering, the last_seen
// monotonic guard, client-side staleness age-out, and order-insensitive
// equality. None of this can be exercised against the real channel here, so the
// pure reducer carries the contract.

import test from 'node:test';
import assert from 'node:assert/strict';

import {
  PRESENCE_STALE_MS,
  rowKey,
  isFreshRow,
  applyPresenceEvent,
  seedRoster,
  ageOutRoster,
  rosterFromMap,
  rostersEqual
} from '../../src/hooks/presenceRoster.js';

const NOW = Date.parse('2026-06-03T20:00:00.000Z');
const iso = (msAgo) => new Date(NOW - msAgo).toISOString();

function row(o = {}) {
  const user_id = o.user_id ?? 'u1';
  const client_type = o.client_type ?? 'app';
  return {
    id: o.id ?? `pk-${user_id}-${client_type}`,
    document_id: o.document_id ?? 'doc1',
    user_id,
    client_type,
    display_name: o.display_name ?? 'User One',
    current_page: o.current_page ?? 1,
    last_seen: o.last_seen ?? iso(0)
  };
}

const mapOf = (...rows) => {
  const m = new Map();
  for (const r of rows) m.set(rowKey(r), r);
  return m;
};

test('rowKey prefers the primary key, falls back to the composite key', () => {
  assert.equal(rowKey(row({ id: 'X' })), 'X');
  assert.equal(rowKey({ document_id: 'd', user_id: 'u', client_type: 'app' }), 'd|u|app');
  assert.equal(rowKey(undefined), undefined);
});

test('INSERT adds a viewer without a re-fetch', () => {
  const map = new Map();
  applyPresenceEvent(map, { type: 'INSERT', row: row({ user_id: 'B' }) }, NOW);
  const roster = rosterFromMap(map);
  assert.equal(roster.length, 1);
  assert.equal(roster[0].user_id, 'B');
});

test('UPDATE replaces the matching row by id', () => {
  const a = row({ user_id: 'A', current_page: 1, last_seen: iso(5000) });
  const map = mapOf(a);
  applyPresenceEvent(map, {
    type: 'UPDATE',
    row: row({ user_id: 'A', current_page: 7, last_seen: iso(0) })
  }, NOW);
  const roster = rosterFromMap(map);
  assert.equal(roster.length, 1);
  assert.equal(roster[0].current_page, 7);
});

test('DELETE removes the row (prevRow carries the id under REPLICA IDENTITY FULL)', () => {
  const a = row({ user_id: 'A' });
  const map = mapOf(a);
  applyPresenceEvent(map, { type: 'DELETE', prevRow: a }, NOW);
  assert.equal(rosterFromMap(map).length, 0);
});

test('a viewer\'s own repeated events do not duplicate — self-filtering is unnecessary', () => {
  const map = new Map();
  const me = row({ user_id: 'me', current_page: 1, last_seen: iso(2000) });
  applyPresenceEvent(map, { type: 'INSERT', row: me }, NOW);
  applyPresenceEvent(map, {
    type: 'UPDATE',
    row: row({ user_id: 'me', current_page: 4, last_seen: iso(0) })
  }, NOW);
  const roster = rosterFromMap(map);
  assert.equal(roster.length, 1, 'own UPDATE must not create a second row');
  assert.equal(roster[0].current_page, 4);
});

test('two client types for the same user are both retained (no user_id over-filter)', () => {
  const map = new Map();
  applyPresenceEvent(map, { type: 'INSERT', row: row({ user_id: 'u', client_type: 'app', id: 'id-app' }) }, NOW);
  applyPresenceEvent(map, { type: 'INSERT', row: row({ user_id: 'u', client_type: 'web', id: 'id-web' }) }, NOW);
  assert.equal(rosterFromMap(map).length, 2);
});

test('monotonic guard ignores an out-of-order older event', () => {
  const fresh = row({ user_id: 'A', current_page: 9, last_seen: iso(0) });
  const map = mapOf(fresh);
  applyPresenceEvent(map, {
    type: 'UPDATE',
    row: row({ user_id: 'A', current_page: 2, last_seen: iso(10000) }) // older
  }, NOW);
  const roster = rosterFromMap(map);
  assert.equal(roster[0].current_page, 9, 'older event must not overwrite a newer row');
});

test('an event for a row already past the cutoff drops it instead of adding it', () => {
  const map = new Map();
  applyPresenceEvent(map, {
    type: 'UPDATE',
    row: row({ user_id: 'ghost', last_seen: iso(PRESENCE_STALE_MS + 1000) })
  }, NOW);
  assert.equal(rosterFromMap(map).length, 0);
});

test('seedRoster replays a buffered INSERT on top of the snapshot (race fix)', () => {
  // B joins after the snapshot SELECT returns [A] but before live-apply starts.
  const map = new Map();
  seedRoster(map, [row({ user_id: 'A' })], [{ type: 'INSERT', row: row({ user_id: 'B' }) }], NOW);
  const ids = rosterFromMap(map).map((r) => r.user_id).sort();
  assert.deepEqual(ids, ['A', 'B']);
});

test('seedRoster replays a buffered DELETE that lands during the fetch', () => {
  const b = row({ user_id: 'B' });
  const map = new Map();
  seedRoster(map, [row({ user_id: 'A' }), b], [{ type: 'DELETE', prevRow: b }], NOW);
  const ids = rosterFromMap(map).map((r) => r.user_id);
  assert.deepEqual(ids, ['A']);
});

test('seedRoster drops stale rows from the snapshot', () => {
  const map = new Map();
  seedRoster(map, [
    row({ user_id: 'A', last_seen: iso(0) }),
    row({ user_id: 'C', last_seen: iso(PRESENCE_STALE_MS + 5000) })
  ], [], NOW);
  const ids = rosterFromMap(map).map((r) => r.user_id);
  assert.deepEqual(ids, ['A']);
});

test('ageOutRoster removes viewers past the cutoff, keeps fresh ones', () => {
  const map = mapOf(
    row({ user_id: 'A', last_seen: iso(1000) }),
    row({ user_id: 'C', last_seen: iso(PRESENCE_STALE_MS + 1) })
  );
  ageOutRoster(map, NOW);
  const ids = rosterFromMap(map).map((r) => r.user_id);
  assert.deepEqual(ids, ['A']);
});

test('isFreshRow honors the cutoff and keeps rows with no timestamp', () => {
  assert.equal(isFreshRow(row({ last_seen: iso(0) }), NOW), true);
  assert.equal(isFreshRow(row({ last_seen: iso(PRESENCE_STALE_MS - 1) }), NOW), true);
  assert.equal(isFreshRow(row({ last_seen: iso(PRESENCE_STALE_MS + 1) }), NOW), false);
  assert.equal(isFreshRow({ user_id: 'x' }, NOW), true);
});

test('rostersEqual is order-insensitive but field-sensitive', () => {
  const a = row({ user_id: 'A' });
  const b = row({ user_id: 'B', id: 'pk-B' });
  assert.equal(rostersEqual([a, b], [b, a]), true);
  assert.equal(rostersEqual([a, b], [a]), false);
  assert.equal(
    rostersEqual([a], [row({ user_id: 'A', current_page: 99 })]),
    false,
    'a current_page change must register'
  );
  assert.equal(
    rostersEqual([a], [row({ user_id: 'A', last_seen: iso(12345) })]),
    false,
    'a last_seen change must register'
  );
  assert.equal(
    rostersEqual([a], [row({ user_id: 'A', display_name: 'Renamed' })]),
    false,
    'a display_name change must register'
  );
});
