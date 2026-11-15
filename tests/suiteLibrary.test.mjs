// Kal Voe suite library (KAL-585): My library / Company library of
// Categories and Category Types. Create, link template Categories, who may
// rename or remove, offline sync one entry at a time, and the database rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  applyLibraryOp,
  canAddToLibrary,
  canManageEntry,
  flushLibraryOutbox,
  libraryTabs,
  libraryTree,
  linkTemplateCategories,
  mergeServerEntries,
  newLibraryEntry,
} from '../src/suite/libraryModel.js';
import { createLibraryStore } from '../src/suite/libraryStore.js';

const ME = 'u-me';
const OTHER = 'u-other';
const company = (role) => ({ id: 'org-1', name: 'Acme', my_role: role });
let n = 0;
const makeId = () => `id-${++n}`;

test('tabs: My library always, Company library only in a company', () => {
  assert.deepEqual(libraryTabs(null).map((t) => t.label), ['My library']);
  assert.deepEqual(libraryTabs(company('member')).map((t) => t.label), ['My library', 'Company library']);
});

test('create: a Category and a Category Type under it', () => {
  const cam = newLibraryEntry({ name: '  Camera ', userId: ME, id: 'c1' });
  assert.equal(cam.name, 'Camera');
  assert.equal(cam.scope, 'mine');
  assert.equal(cam.organizationId, null);
  const ptz = newLibraryEntry({ kind: 'categoryType', name: 'PTZ', parentId: 'c1', userId: ME, id: 't1' });
  assert.equal(ptz.parentId, 'c1');
  assert.throws(() => newLibraryEntry({ kind: 'categoryType', name: 'PTZ', userId: ME }), /needs a Category/);
  assert.throws(() => newLibraryEntry({ name: '   ', userId: ME }), /name/);
  assert.throws(() => newLibraryEntry({ name: 'Door', scope: 'company', userId: ME }), /cannot add/);
  const tree = libraryTree([cam, ptz], 'mine', { userId: ME });
  assert.equal(tree.length, 1);
  assert.deepEqual(tree[0].types.map((t) => t.name), ['PTZ']);
});

test('permissions: any member adds; only owners and admins rename or remove', () => {
  const companyEntry = { scope: 'company', organizationId: 'org-1', ownerId: OTHER };
  assert.equal(canAddToLibrary('company', { userId: ME, company: company('member') }), true);
  assert.equal(canAddToLibrary('company', { userId: ME, company: null }), false);
  assert.equal(canManageEntry(companyEntry, { userId: ME, company: company('member') }), false);
  assert.equal(canManageEntry(companyEntry, { userId: ME, company: company('admin') }), true);
  assert.equal(canManageEntry(companyEntry, { userId: ME, company: company('owner') }), true);
  assert.equal(canManageEntry({ ...companyEntry, organizationId: 'org-2' }, { userId: ME, company: company('owner') }), false);
  assert.equal(canManageEntry({ scope: 'mine', ownerId: ME }, { userId: ME }), true);
  assert.equal(canManageEntry({ scope: 'mine', ownerId: OTHER }, { userId: ME }), false);
});

test('a solo user sees only their own entries; Company library shows company ones', () => {
  const mine = newLibraryEntry({ name: 'Camera', userId: ME, id: 'm1' });
  const theirs = { ...newLibraryEntry({ name: 'Door', userId: OTHER, id: 'o1' }) };
  const shared = newLibraryEntry({ name: 'Speaker', scope: 'company', userId: OTHER, company: company('member'), id: 's1' });
  const all = [mine, theirs, shared];
  assert.deepEqual(libraryTree(all, 'mine', { userId: ME }).map((e) => e.name), ['Camera']);
  assert.deepEqual(libraryTree(all, 'company', { userId: ME, company: null }).map((e) => e.name), []);
  assert.deepEqual(libraryTree(all, 'company', { userId: ME, company: company('member') }).map((e) => e.name), ['Speaker']);
});

const template = () => ({
  id: 't1',
  name: 'Security',
  modules: [
    { id: 'm1', name: 'Installation', categories: [
      { id: 'c1', name: 'Cameras', checklist: [{ id: 'i1', text: 'Cable pulled?' }] },
      { id: 'c2', name: 'Doors', checklist: [{ id: 'i2', text: 'Hung?' }], libraryEntryId: 'lib-doors' },
    ] },
    { id: 'm2', name: 'Commissioning', categories: [
      { id: 'c3', name: 'cameras ', checklist: [{ id: 'i3', text: 'Aimed?' }] },
    ] },
  ],
});

test('making a Category in a template creates a library entry; the same name links once', () => {
  const tpl = template();
  const { templates, created } = linkTemplateCategories([tpl], [], { userId: ME, makeId });
  assert.equal(created.length, 1);
  assert.equal(created[0].name, 'Cameras');
  const [out] = templates;
  const cats = out.modules.flatMap((m) => m.categories);
  assert.equal(cats[0].libraryEntryId, created[0].id);
  assert.equal(cats[2].libraryEntryId, created[0].id, 'same name in another Module, one entry');
  assert.equal(cats[1].libraryEntryId, 'lib-doors', 'an existing link is kept');
  // Checklists are never changed.
  assert.deepEqual(cats.map((c) => c.checklist), tpl.modules.flatMap((m) => m.categories).map((c) => c.checklist));
  // Linking again changes nothing.
  const again = linkTemplateCategories(templates, created, { userId: ME, makeId });
  assert.equal(again.templates, templates);
  assert.equal(again.created.length, 0);
});

test('existing template Categories link to a matching entry by exact name, company first', () => {
  const mine = newLibraryEntry({ name: 'Cameras', userId: ME, id: 'mine-cam' });
  const shared = newLibraryEntry({ name: 'CAMERAS', scope: 'company', userId: OTHER, company: company('member'), id: 'co-cam' });
  const solo = linkTemplateCategories([template()], [mine, shared], { userId: ME, makeId });
  assert.equal(solo.templates[0].modules[0].categories[0].libraryEntryId, 'mine-cam');
  const inCompany = linkTemplateCategories([template()], [mine, shared], { userId: ME, company: company('member'), makeId });
  assert.equal(inCompany.templates[0].modules[0].categories[0].libraryEntryId, 'co-cam');
  assert.equal(inCompany.created.length, 0);
  // No near-miss guessing: "Camera" is not "Cameras".
  const near = linkTemplateCategories([template()], [newLibraryEntry({ name: 'Camera', userId: ME, id: 'x' })], { userId: ME, makeId });
  assert.equal(near.created.length, 1);
  // In a company, new entries go to the Company library.
  const fresh = linkTemplateCategories([template()], [], { userId: ME, company: company('member'), makeId });
  assert.equal(fresh.created[0].scope, 'company');
  assert.equal(fresh.created[0].organizationId, 'org-1');
});

test('outbox: ops show at once, send one at a time, stop offline, drop refused ones', async () => {
  const cam = newLibraryEntry({ name: 'Camera', userId: ME, id: 'c1' });
  const door = newLibraryEntry({ name: 'Door', userId: ME, id: 'c2' });
  const outbox = [{ op: 'create', entry: cam }, { op: 'rename', id: 'c1', name: 'Cameras' }, { op: 'create', entry: door }];
  const shown = mergeServerEntries([], outbox);
  assert.deepEqual(shown.map((e) => e.name), ['Cameras', 'Door']);

  const seen = [];
  let online = false;
  const send = async (op) => {
    if (!online) { const e = new Error('Failed to fetch'); e.offline = true; throw e; }
    seen.push(op.op);
  };
  const offline = await flushLibraryOutbox(outbox, send);
  assert.equal(offline.outbox.length, 3);
  assert.equal(seen.length, 0);
  online = true;
  const done = await flushLibraryOutbox(offline.outbox, send);
  assert.deepEqual(seen, ['create', 'rename', 'create']);
  assert.equal(done.outbox.length, 0);

  const refused = await flushLibraryOutbox([{ op: 'rename', id: 'c9', name: 'X' }, { op: 'create', entry: door }], async (op) => {
    if (op.op === 'rename') throw new Error('Only an owner or admin can rename that.');
  });
  assert.equal(refused.refused.length, 1);
  assert.equal(refused.sent.length, 1);

  // Removing a Category removes its Types too (on the device).
  const ptz = newLibraryEntry({ kind: 'categoryType', name: 'PTZ', parentId: 'c1', userId: ME, id: 't1' });
  const after = applyLibraryOp([cam, ptz], { op: 'remove', id: 'c1' });
  assert.ok(after.every((e) => e.removedAt));
});

function fakeClient({ online = { value: true }, rows = [] } = {}) {
  const calls = [];
  const table = {
    _q: null,
    upsert(row) { calls.push(['upsert', row.id]); if (!online.value) return Promise.resolve({ error: { message: 'Failed to fetch' } }); rows.push(row); return Promise.resolve({ error: null }); },
    update(patch) {
      const q = { patch, filters: [] };
      const chain = {
        eq(col, val) { q.filters.push([col, val]); return chain; },
        is() { return chain; },
        select() { calls.push(['update', q.patch, q.filters]); return Promise.resolve({ data: [{ id: q.filters[0]?.[1] }], error: null }); },
        then(res, rej) { calls.push(['update', q.patch, q.filters]); return Promise.resolve({ error: null }).then(res, rej); },
      };
      return chain;
    },
    select() { return { limit: () => Promise.resolve({ data: rows.map((r) => ({ ...r, created_at: null, updated_at: null, removed_at: null })), error: null }) }; },
  };
  return {
    calls,
    from: () => table,
    rpc: () => Promise.resolve({ data: null, error: null }),
  };
}

function memoryStorage() {
  const m = new Map();
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}

test('store: works offline, keeps the outbox on the device, syncs one entry at a time when back', async () => {
  const online = { value: false };
  const client = fakeClient({ online });
  const storage = memoryStorage();
  const store = createLibraryStore({ client, userId: ME, storage });
  const cam = store.add({ name: 'Camera', scope: 'mine' });
  await store.flush();
  assert.deepEqual(store.getState().entries.map((e) => e.name), ['Camera']);
  assert.equal(store.getState().outbox.length, 1, 'still waiting');

  // A new session on the same device still has it.
  const reopened = createLibraryStore({ client, userId: ME, storage });
  assert.deepEqual(reopened.getState().entries.map((e) => e.id), [cam.id]);

  online.value = true;
  const res = await reopened.flush();
  assert.equal(res.sent.length, 1);
  assert.equal(reopened.getState().outbox.length, 0);
  assert.deepEqual(client.calls.filter((c) => c[0] === 'upsert').map((c) => c[1]), [cam.id, cam.id]);
});

test('templates editor and hub carry the link and the Library tab behind the flag', () => {
  const editor = readFileSync(new URL('../src/home/TemplatesEditor.jsx', import.meta.url), 'utf8');
  assert.match(editor, /\.\.\.\(c\?\.libraryEntryId \? \{ libraryEntryId: c\.libraryEntryId \} : \{\}\)/);
  assert.match(editor, /\.\.\.\(c\.libraryEntryId \? \{ libraryEntryId: c\.libraryEntryId \} : \{\}\)/);
  assert.match(editor, /const linked = linkTemplatesForSave\(payload, user\?\.id\);/);
  const shell = readFileSync(new URL('../src/home/HubShell.jsx', import.meta.url), 'utf8');
  assert.match(shell, /\.\.\.\(isSuiteOn\(\) \? \[\['library', 'library', 'Library', false\]\] : \[\]\)/);
  const hub = readFileSync(new URL('../src/home/SurveyHub.jsx', import.meta.url), 'utf8');
  assert.match(hub, /tab === 'library' && isSuiteOn\(\)/);
});

// ---------------------------------------------------------------------------
// Database rules (run where Postgres is installed and not as root, like
// tests/featureFlags.test.mjs).
// ---------------------------------------------------------------------------
const pgBin = ['/usr/lib/postgresql/16/bin', '/opt/homebrew/bin', '/usr/local/bin'].find((dir) => existsSync(join(dir, 'initdb')));
const tool = (name) => {
  if (pgBin && existsSync(join(pgBin, name))) return join(pgBin, name);
  try { return execFileSync('which', [name], { encoding: 'utf8' }).trim(); } catch { return ''; }
};
const pgEnv = { ...process.env, LC_ALL: 'C', LANG: 'C' };
const isRoot = process.getuid?.() === 0;

test('library: database rules', { skip: isRoot || !tool('initdb') || !tool('pg_ctl') || !tool('psql') }, () => {
  const cluster = mkdtempSync(join(tmpdir(), 'survey-library-postgres-'));
  const socket = join(cluster, 'socket');
  const data = join(cluster, 'data');
  const port = String(32000 + Math.floor(Math.random() * 10000));
  let started = false;
  const psql = (sql) => execFileSync(tool('psql'), ['-h', socket, '-p', port, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq'], { input: sql, encoding: 'utf8', env: pgEnv, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  const OWNER = '11111111-1111-4111-8111-111111111111';
  const MEMBER = '22222222-2222-4222-8222-222222222222';
  const SOLO = '33333333-3333-4333-8333-333333333333';
  const ORG = '44444444-4444-4444-8444-444444444444';
  const as = (uid, sql, claims = {}) => psql(`
    set role authenticated;
    set request.jwt.claims = '${JSON.stringify({ sub: uid, role: 'authenticated', ...claims })}';
    ${sql}
  `);
  const fails = (fn, re) => assert.throws(fn, (err) => re.test(String(err.stderr || err.message)));
  try {
    mkdirSync(socket);
    execFileSync(tool('initdb'), ['-D', data, '-A', 'trust', '-U', 'postgres', '--no-locale'], { stdio: 'ignore', env: pgEnv });
    execFileSync(tool('pg_ctl'), ['-D', data, '-l', join(cluster, 'pg.log'), '-o', `-F -k ${socket} -p ${port}`, '-w', 'start'], { stdio: 'ignore', env: pgEnv });
    started = true;
    psql(`
      create role anon; create role authenticated; create role service_role;
      create schema auth;
      create table auth.users (id uuid primary key);
      create function auth.jwt() returns jsonb language sql stable
        as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
      create function auth.uid() returns uuid language sql stable
        as $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
      create function public.is_agent_session() returns boolean language sql stable
        as $$ select coalesce(auth.jwt() ->> 'client_id', '') <> '' $$;
      create function public.is_guest_session() returns boolean language sql stable
        as $$ select coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) $$;
      grant usage on schema auth to anon, authenticated;
      grant execute on all functions in schema auth to anon, authenticated;
      create table public.organizations (id uuid primary key);
      create table public.organization_members (organization_id uuid, user_id uuid, role text);
      create function public.my_org_role(p_org uuid) returns text language sql stable security definer set search_path = ''
        as $$ select m.role from public.organization_members m where m.organization_id = p_org and m.user_id = auth.uid() $$;
      grant usage on schema public to authenticated;
      insert into auth.users values ('${OWNER}'), ('${MEMBER}'), ('${SOLO}');
      insert into public.organizations values ('${ORG}');
      insert into public.organization_members values ('${ORG}', '${OWNER}', 'owner'), ('${ORG}', '${MEMBER}', 'member');
    `);
    psql(readFileSync(new URL('../supabase/migrations/20261115191000_suite_library.sql', import.meta.url), 'utf8'));

    const cat = 'aaaaaaaa-0000-4000-8000-000000000001';
    const type = 'aaaaaaaa-0000-4000-8000-000000000002';
    const mine = 'aaaaaaaa-0000-4000-8000-000000000003';
    // A member adds to the Company library, and a Type under it.
    as(MEMBER, `insert into public.library_entries (id, kind, name, scope, owner_id, organization_id) values ('${cat}', 'category', 'Camera', 'company', '${MEMBER}', '${ORG}');`);
    as(MEMBER, `insert into public.library_entries (id, kind, parent_id, name, scope, owner_id, organization_id) values ('${type}', 'categoryType', '${cat}', 'PTZ', 'company', '${MEMBER}', '${ORG}');`);
    // The same insert again (an offline retry) is a no-op.
    as(MEMBER, `insert into public.library_entries (id, kind, name, scope, owner_id, organization_id) values ('${cat}', 'category', 'Camera', 'company', '${MEMBER}', '${ORG}') on conflict (id) do nothing;`);
    // A solo user's My library is theirs alone.
    as(SOLO, `insert into public.library_entries (id, kind, name, scope, owner_id) values ('${mine}', 'category', 'Door', 'mine', '${SOLO}');`);
    assert.equal(as(SOLO, 'select count(*) from public.library_entries;'), '1');
    assert.equal(as(OWNER, 'select count(*) from public.library_entries;'), '2');
    assert.equal(as(MEMBER, `select count(*) from public.library_entries where id = '${mine}';`), '0');
    // Nobody adds to a company they are not in, or as someone else.
    fails(() => as(SOLO, `insert into public.library_entries (kind, name, scope, owner_id, organization_id) values ('category', 'X', 'company', '${SOLO}', '${ORG}');`), /row-level security/);
    fails(() => as(MEMBER, `insert into public.library_entries (kind, name, scope, owner_id) values ('category', 'X', 'mine', '${SOLO}');`), /row-level security/);
    fails(() => as(MEMBER, `insert into public.library_entries (kind, name, scope, owner_id) values ('category', 'X', 'mine', '${MEMBER}');`, { client_id: 'agent' }), /row-level security/);
    // A Type needs a Category of the same library.
    fails(() => as(SOLO, `insert into public.library_entries (kind, parent_id, name, scope, owner_id) values ('categoryType', '${cat}', 'X', 'mine', '${SOLO}');`), /Category/);
    // A member cannot rename or remove; the change touches no row.
    assert.equal(as(MEMBER, `with u as (update public.library_entries set name = 'Cam' where id = '${cat}' returning 1) select count(*) from u;`), '0');
    assert.equal(as(MEMBER, `with u as (update public.library_entries set removed_at = now() where id = '${cat}' returning 1) select count(*) from u;`), '0');
    fails(() => as(MEMBER, `delete from public.library_entries where id = '${cat}';`), /permission denied/);
    // The owner can; only the name or removal may change.
    assert.equal(as(OWNER, `with u as (update public.library_entries set name = ' Cameras ' where id = '${cat}' returning name) select name from u;`), 'Cameras');
    fails(() => as(OWNER, `update public.library_entries set scope = 'mine', organization_id = null where id = '${cat}';`), /Only the name/);
    as(OWNER, `update public.library_entries set removed_at = now() where id = '${cat}';`);
    assert.equal(psql(`select count(*) from public.library_entries where removed_at is not null;`), '1', 'removed, not deleted');
  } finally {
    if (started) { try { execFileSync(tool('pg_ctl'), ['-D', data, '-m', 'immediate', 'stop'], { stdio: 'ignore', env: pgEnv }); } catch { /* already down */ } }
    rmSync(cluster, { recursive: true, force: true });
  }
});
