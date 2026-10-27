// Mark library store (src/markLibrary/markLibraryStore.js): the signed-out
// library lives in this browser; signed in it reads and writes
// mark_library_items, follows realtime changes, and moves / duplicates /
// deletes items the way the panel expects.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createMarkLibraryStore, libraryErrorMessage } from '../src/markLibrary/markLibraryStore.js';

const memory = new Map();
globalThis.localStorage = {
  getItem: (k) => (memory.has(k) ? memory.get(k) : null),
  setItem: (k, v) => memory.set(k, String(v)),
  removeItem: (k) => memory.delete(k),
};

const payload = (left = 10) => ({
  version: 1,
  items: [{ kind: 'mark', object: { type: 'rect', left, top: 10, width: 20, height: 20, data: { id: `r${left}` } } }],
  pageWidth: 612,
  pageHeight: 792,
  origin: { left, top: 10 },
  extent: { left, top: 10, width: 20, height: 20 },
});

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

// A tiny stand-in for supabase-js: one table, eq/in filters, insert/update/
// delete returning rows, an RPC and a realtime channel the test can fire.
function fakeSupabase({ access = { can_read: true, can_add: true, can_manage: false, project_name: 'Tower B' }, me = 'me', maxRows = 1000 } = {}) {
  const rows = [];
  const handlers = [];
  let seq = 0;
  const query = (table) => {
    const filters = [];
    let op = 'select';
    let patch = null;
    let window = null;
    const api = {
      range(from, to) { window = [from, to]; return api; },
      select() { return api; },
      eq(col, val) { filters.push((r) => r[col] === val); return api; },
      in(col, vals) { filters.push((r) => vals.includes(r[col])); return api; },
      order() { return api; },
      limit() { return api; },
      insert(input) {
        op = 'insert';
        patch = (Array.isArray(input) ? input : [input]).map((row) => ({
          id: `id-${++seq}`, created_by: me, created_at: `2026-10-27T00:00:0${seq}Z`, updated_at: `2026-10-27T00:00:0${seq}Z`, ...row,
        }));
        return api;
      },
      update(input) { op = 'update'; patch = input; return api; },
      delete() { op = 'delete'; return api; },
      then(resolve) {
        assert.equal(table, 'mark_library_items');
        const hit = rows.filter((r) => filters.every((f) => f(r)));
        if (op === 'insert') { rows.push(...patch); return resolve({ data: patch, error: null }); }
        if (op === 'update') { hit.forEach((r) => Object.assign(r, patch)); return resolve({ data: hit, error: null }); }
        if (op === 'delete') {
          hit.forEach((r) => rows.splice(rows.indexOf(r), 1));
          return resolve({ data: hit.map((r) => ({ id: r.id })), error: null });
        }
        // Like PostgREST: the asked-for range, never more than max_rows.
        const page = window ? hit.slice(window[0], window[1] + 1) : hit;
        return resolve({ data: page.slice(0, maxRows), error: null });
      },
    };
    return api;
  };
  return {
    rows,
    from: query,
    rpc: async (name, args) => {
      assert.equal(name, 'mark_library_project_access');
      assert.equal(args.p_project_id, 'p1');
      return { data: access, error: null };
    },
    channel() {
      const ch = { on(_type, filter, fn) { handlers.push({ filter, fn }); return ch; }, subscribe() { return ch; } };
      return ch;
    },
    removeChannel() {},
    fire(payload) { handlers.forEach(({ fn }) => fn(payload)); },
    handlers,
  };
}

test('signed out: the personal library is kept in this browser', async () => {
  memory.clear();
  const store = createMarkLibraryStore({ supabase: null, available: () => false });
  store.setContext({ userId: null, projectId: 'p1' });
  await tick();
  assert.equal(store.getState().project.status, 'none');
  assert.deepEqual(store.addableLibraries(), ['personal']);
  const [saved] = await store.addItems([{ library: 'personal', name: 'Box', tags: ['A'], payload: payload() }]);
  assert.equal(saved.name, 'Box');
  await store.renameItem(saved.id, 'Big box');
  const again = createMarkLibraryStore({ supabase: null, available: () => false });
  again.setContext({ userId: null, projectId: null });
  await tick();
  assert.deepEqual(again.getState().personal.items.map((it) => it.name), ['Big box']);
  const removed = await again.deleteItems([saved.id]);
  assert.equal(removed.length, 1);
  assert.equal(again.getState().personal.items.length, 0);
});

test('signed in: loads both libraries, the project name and what the person may do', async () => {
  const supabase = fakeSupabase();
  supabase.rows.push(
    { id: 'x1', library: 'personal', project_id: null, created_by: 'me', name: 'Mine', tags: [], payload: payload(), updated_at: '1' },
    { id: 'x2', library: 'project', project_id: 'p1', created_by: 'them', name: 'Team', tags: [], payload: payload(), updated_at: '2' },
    { id: 'x3', library: 'project', project_id: 'p2', created_by: 'them', name: 'Other project', tags: [], payload: payload(), updated_at: '3' },
  );
  const store = createMarkLibraryStore({ supabase, available: () => true });
  store.setContext({ userId: 'me', projectId: 'p1' });
  await tick(); await tick();
  const state = store.getState();
  assert.deepEqual(state.personal.items.map((it) => it.id), ['x1']);
  assert.deepEqual(state.project.items.map((it) => it.id), ['x2']);
  assert.equal(state.access.projectName, 'Tower B');
  assert.deepEqual(store.addableLibraries(), ['personal', 'project']);
  assert.equal(store.canChange(state.project.items[0]), false, 'someone else\'s project item');
  const listens = supabase.handlers.map((h) => `${h.filter.event}:${h.filter.filter || '*'}`).sort();
  // Adds and edits filtered to my items and the project's; deletes can't be
  // filtered (realtime only sends the old id), so they come unfiltered.
  assert.deepEqual(listens, [
    'DELETE:*', 'INSERT:created_by=eq.me', 'INSERT:project_id=eq.p1', 'UPDATE:created_by=eq.me', 'UPDATE:project_id=eq.p1',
  ]);
});

test('realtime: a teammate\'s new item arrives, a delete leaves', async () => {
  const supabase = fakeSupabase();
  const store = createMarkLibraryStore({ supabase, available: () => true });
  store.setContext({ userId: 'me', projectId: 'p1' });
  await tick(); await tick();
  supabase.fire({ eventType: 'INSERT', new: { id: 'n1', library: 'project', project_id: 'p1', created_by: 'them', name: 'New', tags: [], payload: payload() } });
  assert.deepEqual(store.getState().project.items.map((it) => it.id), ['n1']);
  supabase.fire({ eventType: 'INSERT', new: { id: 'n2', library: 'project', project_id: 'p9', created_by: 'me', name: 'Elsewhere', tags: [], payload: payload() } });
  assert.deepEqual(store.getState().project.items.map((it) => it.id), ['n1'], 'my item in another project stays out');
  supabase.fire({ eventType: 'DELETE', old: { id: 'n1' } });
  assert.equal(store.getState().project.items.length, 0);
});

test('move to the project library copies there and removes the personal one; duplicate names a copy', async () => {
  const supabase = fakeSupabase();
  const store = createMarkLibraryStore({ supabase, available: () => true });
  store.setContext({ userId: 'me', projectId: 'p1' });
  await tick(); await tick();
  const [item] = await store.addItems([{ library: 'personal', name: 'Door tag', tags: ['Doors'], payload: payload() }]);
  const [copy] = await store.duplicateItems([item.id]);
  assert.equal(copy.name, 'Door tag copy');
  const moved = await store.moveItems([item.id], 'project');
  assert.equal(moved.length, 1);
  assert.equal(moved[0].library, 'project');
  assert.equal(moved[0].project_id ?? moved[0].projectId, 'p1');
  const state = store.getState();
  assert.deepEqual(state.personal.items.map((it) => it.name), ['Door tag copy']);
  assert.deepEqual(state.project.items.map((it) => it.name), ['Door tag']);
});

test('saving to a project library you can\'t add to is refused before the request', async () => {
  const supabase = fakeSupabase({ access: { can_read: true, can_add: false, can_manage: false, project_name: 'P' } });
  const store = createMarkLibraryStore({ supabase, available: () => true });
  store.setContext({ userId: 'me', projectId: 'p1' });
  await tick(); await tick();
  await assert.rejects(store.addItems([{ library: 'project', name: 'x', payload: payload() }]), /permission/);
  const huge = payload();
  huge.items[0].object.src = 'x'.repeat(1024 * 1024);
  await assert.rejects(store.addItems([{ library: 'personal', name: 'big', payload: huge }]), /too_big/);
});

test('error sentences', () => {
  assert.match(libraryErrorMessage({ message: 'mark_library_full' }), /full/);
  assert.match(libraryErrorMessage({ message: 'new row violates row-level security policy' }), /can't change/);
  assert.match(libraryErrorMessage(new Error('too_big')), /too big/);
  assert.match(libraryErrorMessage(new Error('Failed to fetch')), /connection/);
});

test('a library bigger than one API page loads in full', async () => {
  const supabase = fakeSupabase({ maxRows: 1000 });
  for (let i = 0; i < 1500; i += 1) {
    supabase.rows.push({ id: `r${i}`, library: 'personal', project_id: null, created_by: 'me', name: `Item ${i}`, tags: [], payload: payload(), updated_at: String(i) });
  }
  const store = createMarkLibraryStore({ supabase, available: () => true });
  store.setContext({ userId: 'me', projectId: null });
  for (let i = 0; i < 6; i += 1) await tick(); // eslint-disable-line no-await-in-loop
  assert.equal(store.getState().personal.items.length, 1500);
});

test('undoing a delete puts a project item back in its own project, never the open one', async () => {
  const supabase = fakeSupabase();
  const store = createMarkLibraryStore({ supabase, available: () => true });
  store.setContext({ userId: 'me', projectId: 'p1' });
  await tick(); await tick();
  await assert.rejects(
    store.addItems([{ library: 'project', projectId: 'p2', name: 'From A', payload: payload() }]),
    /other_project/,
  );
  assert.equal(supabase.rows.length, 0);
  const [back] = await store.addItems([{ library: 'project', projectId: 'p1', name: 'From A', payload: payload() }]);
  assert.equal(back.projectId, 'p1');
});
