// Home extras copied from Drawboard PDF's Home (src/home/homeLibrary.js):
// tags, Shared by me / with me, Last opened + Created, sorts, list sizes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  allTags, firstSortDir, hasTag, homeLedgerColumns, homeViewCounts, inHomeView, matchesHomeSearch,
  parseTagInput, readListView, relativeTime, sortHomeRows, tagCounts, writeListView,
} from '../src/home/homeLibrary.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

test('tags: comma list, trimmed, no repeats in any case, 40 letters at most', () => {
  assert.deepEqual(parseTagInput(' r2a,  r2a-two ,,R2A, Level   2 '), ['r2a', 'r2a-two', 'Level 2']);
  assert.deepEqual(parseTagInput(''), []);
  assert.equal(parseTagInput('x'.repeat(60))[0].length, 40);
  assert.ok(hasTag(['Electrical'], 'electrical'));
  assert.ok(!hasTag(['Electrical'], 'elec'));
});

test('tags: the Tags list counts only listed documents, a to z', () => {
  const tags = new Map([
    ['a', ['zeta', 'Alpha']],
    ['b', ['alpha']],
    ['gone', ['beta']],
  ]);
  assert.deepEqual(tagCounts(tags, ['a', 'b']), [{ tag: 'Alpha', count: 2 }, { tag: 'zeta', count: 1 }]);
  assert.deepEqual(allTags(tags), ['Alpha', 'beta', 'zeta']);
});

test('views: shared by me needs my own doc in the shared set; shared with me is someone else\'s', () => {
  const me = 'u1';
  const sharedByMeIds = new Set(['d1']);
  const docs = [
    { id: 'd1', user_id: me },
    { id: 'd2', user_id: me },
    { id: 'd3', user_id: 'u2' },
  ];
  assert.deepEqual(docs.filter((d) => inHomeView(d, { view: 'shared-by-me', userId: me, sharedByMeIds })).map((d) => d.id), ['d1']);
  assert.deepEqual(docs.filter((d) => inHomeView(d, { view: 'shared-with-me', userId: me })).map((d) => d.id), ['d3']);
  assert.equal(docs.filter((d) => inHomeView(d, { view: 'all' })).length, 3);
  assert.deepEqual(homeViewCounts(docs, { userId: me, sharedByMeIds }), { all: 3, 'shared-by-me': 1, 'shared-with-me': 1 });
  // Signed out: nothing is "shared with me".
  assert.equal(inHomeView(docs[2], { view: 'shared-with-me', userId: null }), false);
});

test('search: the name or any tag', () => {
  assert.ok(matchesHomeSearch('A-101 Plan.pdf', [], 'a-101'));
  assert.ok(matchesHomeSearch('Plan.pdf', ['Electrical'], 'elec'));
  assert.ok(!matchesHomeSearch('Plan.pdf', null, 'elec'));
  assert.ok(matchesHomeSearch('Plan.pdf', null, '  '));
});

test('sorts: dates newest first on the first click; never-opened rows sit last both ways', () => {
  const rows = [
    { name: 'b', openedMs: 0, createdMs: 3, editedMs: 1, sizeBytes: 5, pages: 2 },
    { name: 'a', openedMs: 200, createdMs: 1, editedMs: 3, sizeBytes: 9, pages: 0 },
    { name: 'c', openedMs: 100, createdMs: 2, editedMs: 2, sizeBytes: 1, pages: 7 },
  ];
  assert.equal(firstSortDir('opened'), 'desc');
  assert.equal(firstSortDir('name'), 'asc');
  assert.deepEqual(sortHomeRows(rows, 'opened', 'desc').map((r) => r.name), ['a', 'c', 'b']);
  assert.deepEqual(sortHomeRows(rows, 'opened', 'asc').map((r) => r.name), ['c', 'a', 'b']);
  assert.deepEqual(sortHomeRows(rows, 'created', 'desc').map((r) => r.name), ['b', 'c', 'a']);
  assert.deepEqual(sortHomeRows(rows, 'name', 'asc').map((r) => r.name), ['a', 'b', 'c']);
  assert.deepEqual(sortHomeRows(rows, 'pages', 'desc').map((r) => r.name), ['c', 'b', 'a']);
  // Sorting never changes the list it was given.
  assert.equal(rows[0].name, 'b');
});

test('relative times read like Drawboard', () => {
  const now = Date.UTC(2026, 10, 10, 12, 0, 0);
  assert.equal(relativeTime(now - 20_000, now), 'Just now');
  assert.equal(relativeTime(now - 60_000, now), '1 min ago');
  assert.equal(relativeTime(now - 3 * 60_000, now), '3 mins ago');
  assert.equal(relativeTime(now - 2 * 3600_000, now), '2 hours ago');
  assert.equal(relativeTime(now - 30 * 3600_000, now), 'Yesterday');
  assert.equal(relativeTime(now - 4 * 86400_000, now), '4 days ago');
  assert.match(relativeTime(now - 40 * 86400_000, now), /2026/);
  assert.equal(relativeTime(0, now), '');
});

test('columns drop one at a time as the list narrows, the name keeps 160 px', () => {
  const wide = homeLedgerColumns({ width: 1400, opened: true, created: true, tags: true });
  assert.deepEqual(wide.keys, ['project', 'opened', 'created', 'edited', 'size', 'tags']);
  const mid = homeLedgerColumns({ width: 760, opened: true, created: true, tags: true });
  assert.ok(!mid.keys.includes('size') && !mid.keys.includes('created'));
  assert.ok(mid.keys.includes('opened'));
  const narrow = homeLedgerColumns({ width: 380, opened: true, created: true, tags: true });
  assert.deepEqual(narrow.keys, []);
  // The template always has check, thumbnail, name, the shown columns and More.
  assert.equal(wide.template.split(/ (?![^(]*\))/).length, 3 + wide.keys.length + 1);
  // Flags off for the extras: Survey's own four columns.
  assert.deepEqual(homeLedgerColumns({ width: 2000 }).keys, ['project', 'edited', 'size']);
});

test('list size is remembered on this device', () => {
  const store = new Map();
  const storage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  assert.equal(readListView(storage).density, 'medium');
  writeListView(storage, { density: 'tiles' });
  assert.equal(readListView(storage).density, 'tiles');
  store.set('survey.home.listView', '{"density":"huge"}');
  assert.equal(readListView(storage).density, 'medium');
});

test('flags and migration: each Home extra has its own beta flag and a row', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261110171000_home_library.sql', import.meta.url), 'utf8');
  for (const key of ['home-tags', 'home-shared-views', 'home-columns']) {
    assert.equal(FEATURE_FLAGS[key]?.stage, 'beta', key);
    assert.match(sql, new RegExp(`'${key}', 'off'`));
  }
  // Personal rows: RLS on both tables, reads only your own.
  assert.match(sql, /ALTER TABLE public\.document_tags ENABLE ROW LEVEL SECURITY/);
  assert.match(sql, /ALTER TABLE public\.document_opens ENABLE ROW LEVEL SECURITY/);
  assert.equal((sql.match(/USING \(user_id = auth\.uid\(\)\)/g) || []).length, 3);
  // Guests never tag or stamp opens; the open stamp uses the server clock.
  assert.match(sql, /NOT public\.is_guest_session\(\)\s+AND public\.user_can_access_document\(document_id, 'viewer'\)/);
  assert.match(sql, /v_now timestamptz := now\(\)/);
  // No direct writes to document_opens (only the definer function).
  assert.doesNotMatch(sql, /GRANT [^;]*INSERT[^;]*ON public\.document_opens/);
});
