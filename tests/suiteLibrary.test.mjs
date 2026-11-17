// Suite library (KAL-585): create, link, permissions and offline sync.
// libraryModel.js holds the rules; libraryStore.js keeps the device copy and
// sends changes one at a time. A fake server stands in for Supabase here and
// follows the same rules as supabase/migrations/20261115180000_suite_library.sql.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import {
  LIBRARY_SCOPE,
  canManageEntry,
  countUnlinkedCategories,
  findEntryByName,
  isPlaceholderCategoryName,
  libraryOutline,
  linkTemplateCategories,
  newLibraryEntry,
} from '../src/library/libraryModel.js';
import { classifyLibraryError, createLibraryStore } from '../src/library/libraryStore.js';

const ME = 'user-me';
const OTHER = 'user-other';
const COMPANY = { id: 'org-1', my_role: 'member' };

function memoryStorage() {
  const map = new Map();
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => map.set(k, String(v)), removeItem: (k) => map.delete(k) };
}

let counter = 0;
const mint = () => `00000000-0000-4000-8000-${String(++counter).padStart(12, '0')}`;

// A small Supabase stand-in: library_entries with the migration's rules.
function fakeServer({ userId = ME, role = null, companyId = 'org-1' } = {}) {
  const rows = [];
  const calls = [];
  let online = true;
  const manageable = (row) => (row.scope === 'mine' ? row.created_by === userId : (role === 'owner' || role === 'admin') && row.company_id === companyId);
  const visible = (row) => (row.scope === 'mine' ? row.created_by === userId : role && row.company_id === companyId);
  const offlineError = { message: 'TypeError: Failed to fetch' };
  const client = {
    from(table) {
      assert.equal(table, 'library_entries');
      return {
        select() {
          return { order: async () => (online ? { data: rows.filter(visible).map((r) => ({ ...r })), error: null } : { data: null, error: offlineError }) };
        },
        async insert(row) {
          calls.push({ op: 'insert', id: row.id });
          if (!online) return { error: offlineError };
          if (rows.some((r) => r.id === row.id)) return { error: { code: '23505', message: 'duplicate key' } };
          if (row.created_by !== userId) return { error: { code: '42501', message: 'rls' } };
          if (row.scope === 'company' && !(role && row.company_id === companyId)) return { error: { code: '42501', message: 'rls' } };
          rows.push({ ...row, created_at: new Date(Date.now() + rows.length).toISOString(), updated_at: null, removed_at: null });
          return { error: null };
        },
        update(patch) {
          return {
            eq(_col, id) {
              return {
                async select() {
                  calls.push({ op: 'update', id, patch });
                  if (!online) return { data: null, error: offlineError };
                  const row = rows.find((r) => r.id === id);
                  if (!row || !manageable(row)) return { data: [], error: null };
                  Object.assign(row, patch);
                  return { data: [{ id }], error: null };
                },
              };
            },
          };
        },
      };
    },
  };
  return { client, rows, calls, setOnline: (v) => { online = v; } };
}

test('library: placeholder names wait until the category is named', () => {
  assert.equal(isPlaceholderCategoryName('Category 3'), true);
  assert.equal(isPlaceholderCategoryName(' Untitled Category '), true);
  assert.equal(isPlaceholderCategoryName('Cameras'), false);
  assert.equal(isPlaceholderCategoryName('Category 3 cameras'), false);
});

test('library: making a Category in a template creates a library entry and links it', () => {
  const templates = [{
    id: 't1', name: 'Security',
    modules: [{ id: 'm1', name: 'Installation', categories: [
      { id: 'c1', name: 'Cameras', checklist: [{ id: 'i1', text: 'Cable pulled?' }] },
      { id: 'c2', name: 'Category 2', checklist: [] },
    ] }],
  }];
  const { templates: out, created, linked } = linkTemplateCategories(templates, { userId: ME, mintId: mint });
  assert.equal(created.length, 1);
  assert.equal(linked, 1);
  assert.equal(created[0].name, 'Cameras');
  assert.equal(created[0].scope, 'mine');
  const cat = out[0].modules[0].categories[0];
  assert.equal(cat.libraryEntryId, created[0].id);
  // The checklist and the rest of the category are left exactly as they were.
  assert.deepEqual(cat.checklist, templates[0].modules[0].categories[0].checklist);
  assert.equal(cat.name, 'Cameras');
  assert.equal(out[0].modules[0].categories[1].libraryEntryId, undefined, 'placeholder name is not saved');
});

test('library: existing categories link to an entry with the exact same name, never a near one', () => {
  const entries = [newLibraryEntry({ id: 'e-cam', name: 'Cameras', userId: ME })];
  const templates = [
    { id: 't1', modules: [{ categories: [{ id: 'a', name: '  Cameras ', checklist: ['x'] }] }] },
    { id: 't2', modules: [{ categories: [{ id: 'b', name: 'Camera', checklist: [] }] }] },
    { id: 't3', modules: [{ categories: [{ id: 'c', name: 'Camera', checklist: [] }] }] },
  ];
  const { templates: out, created } = linkTemplateCategories(templates, { entries, userId: ME, mintId: mint });
  assert.equal(out[0].modules[0].categories[0].libraryEntryId, 'e-cam');
  assert.deepEqual(out[0].modules[0].categories[0].checklist, ['x']);
  // "Camera" is not "Cameras": it gets its own entry, and both templates share it.
  assert.equal(created.length, 1);
  assert.equal(out[1].modules[0].categories[0].libraryEntryId, created[0].id);
  assert.equal(out[2].modules[0].categories[0].libraryEntryId, created[0].id);
});

test('library: a link already there is kept, and untouched templates stay the same object', () => {
  const kept = { id: 't1', modules: [{ categories: [{ id: 'a', name: 'Doors', libraryEntryId: 'gone-id' }] }] };
  const shared = { id: 't2', sharedFrom: { ownerId: OTHER }, modules: [{ categories: [{ id: 'b', name: 'Cameras' }] }] };
  const { templates: out, created } = linkTemplateCategories([kept, shared], { userId: ME, mintId: mint });
  assert.equal(out[0], kept);
  assert.equal(out[1], shared, 'a template shared with me is not mine to change');
  assert.equal(created.length, 0);
  assert.equal(countUnlinkedCategories([kept, shared]), 0);
  assert.equal(countUnlinkedCategories([{ modules: [{ categories: [{ name: 'Racks' }, { name: 'Category 1' }] }] }]), 1);
});

test('library: in a company, new entries go to the Company library', () => {
  const company = { id: 'org-1', role: 'member' };
  const { created } = linkTemplateCategories(
    [{ id: 't', modules: [{ categories: [{ id: 'c', name: 'Readers' }] }] }],
    { userId: ME, company, mintId: mint },
  );
  assert.equal(created[0].scope, LIBRARY_SCOPE.COMPANY);
  assert.equal(created[0].companyId, 'org-1');
});

test('library: rename and remove are refused for non-admins in the Company library', () => {
  const companyEntry = newLibraryEntry({ id: 'e1', name: 'Cameras', scope: 'company', companyId: 'org-1', userId: OTHER });
  const mineEntry = newLibraryEntry({ id: 'e2', name: 'Doors', userId: ME });
  assert.equal(canManageEntry(companyEntry, { userId: ME, company: { id: 'org-1', role: 'member' } }), false);
  assert.equal(canManageEntry(companyEntry, { userId: ME, company: { id: 'org-1', role: 'admin' } }), true);
  assert.equal(canManageEntry(companyEntry, { userId: ME, company: { id: 'org-1', role: 'owner' } }), true);
  assert.equal(canManageEntry(companyEntry, { userId: ME, company: { id: 'org-2', role: 'owner' } }), false);
  assert.equal(canManageEntry(mineEntry, { userId: ME }), true);
  assert.equal(canManageEntry(mineEntry, { userId: OTHER }), false);
});

test('library store: a member can add to the Company library but not rename or remove', async () => {
  const server = fakeServer({ role: 'member' });
  const store = createLibraryStore({ client: server.client, userId: ME, storage: memoryStorage(), mintId: mint, loadCompany: async () => COMPANY });
  await store.refresh();
  const added = store.add({ name: 'Cameras', scope: 'company' });
  assert.equal(added.ok, true);
  await store.flush();
  assert.equal(server.rows.length, 1);
  const renamed = store.rename(added.entry.id, 'CCTV');
  assert.equal(renamed.ok, false);
  assert.match(renamed.reason, /owners and admins/);
  assert.equal(store.remove(added.entry.id).ok, false);
  assert.equal(server.calls.filter((c) => c.op === 'update').length, 0, 'nothing was sent');
});

test('library store: a rename the server refuses is dropped and the server name comes back', async () => {
  const server = fakeServer({ role: 'member' });
  server.rows.push({ id: 'e-x', kind: 'category', parent_id: null, name: 'Cameras', scope: 'company', company_id: 'org-1', created_by: OTHER, created_at: '2026-01-01', updated_at: null, removed_at: null });
  // This device still thinks it is an admin (role changed on the server).
  const store = createLibraryStore({ client: server.client, userId: ME, storage: memoryStorage(), mintId: mint, loadCompany: async () => ({ id: 'org-1', my_role: 'admin' }) });
  await store.refresh();
  assert.equal(store.rename('e-x', 'CCTV').ok, true);
  await store.flush();
  assert.equal(server.rows[0].name, 'Cameras');
  const state = store.getState();
  assert.equal(state.outbox.length, 0);
  assert.equal(state.entries.find((e) => e.id === 'e-x').name, 'Cameras');
  assert.match(state.error, /owners and admins/);
});

test('library store: works offline and syncs one entry at a time, in order, without twins', async () => {
  const server = fakeServer();
  const storage = memoryStorage();
  const store = createLibraryStore({ client: server.client, userId: ME, storage, mintId: mint, loadCompany: async () => null });
  server.setOnline(false);
  const a = store.add({ name: 'Cameras' });
  const b = store.add({ name: 'Doors' });
  await store.flush();
  assert.equal(store.getState().status, 'offline');
  assert.equal(store.getState().outbox.length, 2);
  assert.deepEqual(libraryOutline(store.getState().entries, { scope: 'mine', userId: ME }).map((e) => e.name), ['Cameras', 'Doors']);
  assert.equal(store.rename(b.entry.id, 'Door readers').ok, true);

  // The app closes; a new store on the same device keeps the queue.
  const reopened = createLibraryStore({ client: server.client, userId: ME, storage, mintId: mint, loadCompany: async () => null });
  assert.equal(reopened.getState().outbox.length, 3);
  server.setOnline(true);
  await reopened.refresh();
  assert.equal(reopened.getState().outbox.length, 0);
  assert.deepEqual(server.calls.filter((c) => c.op === 'insert' || c.op === 'update').slice(-3).map((c) => c.op), ['insert', 'insert', 'update']);
  assert.deepEqual(server.rows.map((r) => r.name), ['Cameras', 'Door readers']);
  assert.equal(server.rows[0].id, a.entry.id, 'the id made on the device is the id on the server');
});

test('library store: a second Category with the same name is refused, by add or rename', async () => {
  const server = fakeServer();
  const store = createLibraryStore({ client: server.client, userId: ME, storage: memoryStorage(), mintId: mint, loadCompany: async () => null });
  server.setOnline(false);
  const door = store.add({ name: 'Door' });
  const camera = store.add({ name: 'Camera' });
  const twin = store.add({ name: ' door ' });
  assert.equal(twin.ok, false);
  assert.match(twin.reason, /already in this library/);
  const renamed = store.rename(camera.entry.id, 'DOOR');
  assert.equal(renamed.ok, false);
  assert.match(renamed.reason, /“Door” is already in this library/);
  // A Type may share a name with a Type under another Category.
  assert.equal(store.add({ kind: 'categoryType', name: 'Single', parentId: door.entry.id }).ok, true);
  assert.equal(store.add({ kind: 'categoryType', name: 'Single', parentId: camera.entry.id }).ok, true);
  assert.equal(store.add({ kind: 'categoryType', name: 'single', parentId: door.entry.id }).ok, false);
  // Renaming an entry to its own name in other case is fine.
  assert.equal(store.rename(door.entry.id, 'DOOR').ok, true);
});

test('library store: an insert whose answer was lost is not sent twice as a new entry', async () => {
  const server = fakeServer();
  const storage = memoryStorage();
  const store = createLibraryStore({ client: server.client, userId: ME, storage, mintId: mint, loadCompany: async () => null });
  const { entry } = store.add({ name: 'Racks' });
  await store.flush();
  // Pretend the answer was lost: put the same add back in the queue.
  storage.setItem(`survey.suiteLibrary.v1:${ME}`, JSON.stringify({ serverRows: [], outbox: [{ op: 'add', entry }], company: null }));
  const again = createLibraryStore({ client: server.client, userId: ME, storage, mintId: mint, loadCompany: async () => null });
  await again.flush();
  assert.equal(server.rows.length, 1);
  assert.equal(again.getState().outbox.length, 0);
  assert.equal(again.getState().error, '');
});

test('library store: until the table is on the server, changes wait on the device', async () => {
  const client = { from: () => ({
    select: () => ({ order: async () => ({ data: null, error: { code: 'PGRST205', message: 'Could not find the table' } }) }),
    insert: async () => ({ error: { code: 'PGRST205', message: 'Could not find the table' } }),
  }) };
  const store = createLibraryStore({ client, userId: ME, storage: memoryStorage(), mintId: mint });
  store.add({ name: 'Cameras' });
  await store.flush();
  assert.equal(store.getState().status, 'not-on-server');
  assert.equal(store.getState().outbox.length, 1);
  assert.equal(classifyLibraryError({ message: 'Failed to fetch' }), 'offline');
  assert.equal(classifyLibraryError({ code: '42501', message: 'x' }), 'refused');
});

test('library store: linking templates queues the new entries and a Category Type needs a Category', async () => {
  const server = fakeServer();
  const store = createLibraryStore({ client: server.client, userId: ME, storage: memoryStorage(), mintId: mint, loadCompany: async () => null });
  const { templates } = store.linkTemplates([{ id: 't', modules: [{ categories: [{ id: 'c', name: 'Cameras' }] }] }]);
  await store.flush();
  assert.equal(server.rows.length, 1);
  const cameras = findEntryByName(store.getState().entries, { name: 'Cameras', scope: 'mine', userId: ME });
  assert.equal(templates[0].modules[0].categories[0].libraryEntryId, cameras.id);
  assert.equal(store.add({ kind: 'categoryType', name: 'PTZ' }).ok, false);
  const ptz = store.add({ kind: 'categoryType', name: 'PTZ', parentId: cameras.id });
  assert.equal(ptz.ok, true);
  await store.flush();
  assert.deepEqual(libraryOutline(store.getState().entries, { scope: 'mine', userId: ME })[0].types.map((t) => t.name), ['PTZ']);
});

test('library: the migration keeps the rules the app relies on', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261115180000_suite_library.sql', import.meta.url), 'utf8');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS public\.library_entries/);
  assert.match(sql, /REVOKE DELETE, TRUNCATE ON public\.library_entries FROM authenticated/);
  assert.match(sql, /my_org_role\(p_company\) IN \('owner', 'admin'\)/);
  assert.match(sql, /Only the name of a library entry can change/);
  assert.doesNotMatch(sql, /ALTER TABLE public\.(templates|documents|projects)/, 'new table only');
});

test('library store: the first read loads the company once, so a member links into the Company library', async () => {
  const server = fakeServer({ role: 'member' });
  let companyReads = 0;
  const store = createLibraryStore({ client: server.client, userId: ME, storage: memoryStorage(), mintId: mint, loadCompany: async () => { companyReads += 1; return COMPANY; } });
  await Promise.all([store.ready(), store.ready()]);
  assert.equal(companyReads, 1);
  const { created } = store.linkTemplates([{ id: 't', modules: [{ categories: [{ id: 'c', name: 'Intercoms' }] }] }]);
  assert.equal(created[0].scope, 'company');
  await store.flush();
  assert.equal(server.rows[0].company_id, 'org-1');
});
