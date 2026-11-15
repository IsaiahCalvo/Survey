// Guest link password and attempt limit (KAL-401, flag 'guest-links'): the
// client answers, the screens that use them, and the database rules.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  GUEST_PASSWORD_MESSAGES,
  listGuestLinks,
  redeemGuestLink,
  setGuestLinkPassword,
} from '../src/services/guestLinks.js';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');
const MIGRATION = 'supabase/migrations/20261115192000_guest_link_password.sql';

const rpcClient = (answer) => {
  const calls = [];
  return {
    calls,
    rpc: async (name, args) => { calls.push({ name, args }); return answer; },
  };
};

test('opening a link goes through the checked call and maps each answer', async () => {
  const ok = rpcClient({ data: { status: 'ok', document_id: 'd1', document_name: 'Plan', role: 'viewer', expires_at: 'x' }, error: null });
  assert.deepEqual(await redeemGuestLink(ok, { token: 't', name: ' Gus ' }), { status: 'ok', documentId: 'd1', documentName: 'Plan', role: 'viewer', expiresAt: 'x' });
  assert.deepEqual(ok.calls[0], { name: 'redeem_guest_link_checked', args: { p_token: 't', p_name: 'Gus', p_password: null } });

  for (const status of ['password', 'wrong', 'locked']) {
    const c = rpcClient({ data: { status }, error: null });
    assert.deepEqual(await redeemGuestLink(c, { token: 't', name: 'Gus', password: 'pw' }), { status, message: GUEST_PASSWORD_MESSAGES[status] });
    assert.equal(c.calls[0].args.p_password, 'pw');
  }
  assert.equal(GUEST_PASSWORD_MESSAGES.locked, 'Too many attempts. Try again later.');

  const ended = rpcClient({ data: null, error: { message: 'This guest link has ended or was turned off' } });
  await assert.rejects(redeemGuestLink(ended, { token: 't', name: 'Gus' }), /ended or was turned off/);
});

test('the owner sets or clears a password through one call', async () => {
  const c = rpcClient({ data: true, error: null });
  await setGuestLinkPassword(c, 'l1', 'open sesame');
  await setGuestLinkPassword(c, 'l1', '');
  assert.deepEqual(c.calls.map((x) => x.args), [
    { p_link_id: 'l1', p_password: 'open sesame' },
    { p_link_id: 'l1', p_password: null },
  ]);
  const bad = rpcClient({ data: null, error: { message: 'Use a password of 4 to 128 characters' } });
  await assert.rejects(setGuestLinkPassword(bad, 'l1', 'abc'), /4 to 128/);
});

test('the link list says which links have a password, never the hash', async () => {
  let linkColumns = '';
  const query = (rows) => {
    const q = { select: (cols) => { linkColumns ||= cols; return q; }, eq: () => q, order: () => Promise.resolve({ data: rows, error: null }), then: (r) => r({ data: [], error: null }) };
    return q;
  };
  const client = {
    from: (table) => (table === 'document_guest_links'
      ? query([{ id: 'l1', role: 'viewer', expires_at: new Date(Date.now() + 1e6).toISOString(), has_password: true }])
      : query([])),
  };
  const [link] = await listGuestLinks(client, 'd1');
  assert.equal(link.hasPassword, true);
  assert.match(linkColumns, /has_password/);
  assert.doesNotMatch(linkColumns, /password_hash|password_salt/);
});

test('the screens: the gate asks for a password, the owner can set one', () => {
  const gate = read('src/guest/GuestLinkGate.jsx');
  assert.match(gate, /data-guest-password/);
  assert.match(gate, /redeemGuestLink\(client, \{ token, name: label, password \}\)/);
  const section = read('src/guest/GuestLinksSection.jsx');
  assert.match(section, /data-guest-link-password/);
  assert.match(section, /setGuestLinkPassword/);
  assert.match(section, /Send the password separately\./);
});

test('the migration keeps only a salted hash and closes the old call', () => {
  const sql = read(MIGRATION);
  assert.match(sql, /GRANT SELECT \(has_password\) ON public\.document_guest_links TO authenticated;/);
  assert.doesNotMatch(sql, /GRANT SELECT[^;]*password_(hash|salt)/);
  assert.match(sql, /REVOKE ALL ON TABLE public\.document_guest_link_attempts FROM PUBLIC, anon, authenticated;/);
  assert.match(sql, /This guest link needs a password/);
});

const tool = (name) => {
  try { return execFileSync('which', [name], { encoding: 'utf8' }).trim(); } catch { return ''; }
};
const pgEnv = { ...process.env, LC_ALL: 'C', LANG: 'C' };
const isRoot = process.getuid?.() === 0;

test('guest link password: database rules', { skip: isRoot || !tool('initdb') || !tool('pg_ctl') || !tool('psql') }, () => {
  const cluster = mkdtempSync(join(tmpdir(), 'survey-guest-password-postgres-'));
  const socket = join(cluster, 'socket');
  const data = join(cluster, 'data');
  const port = String(32000 + Math.floor(Math.random() * 10000));
  let started = false;
  const psql = (sql) => execFileSync(tool('psql'), ['-h', socket, '-p', port, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq'], { input: sql, encoding: 'utf8', env: pgEnv, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  const OWNER = '11111111-1111-4111-8111-111111111111';
  const EDITOR = '22222222-2222-4222-8222-222222222222';
  const doc = 'dddddddd-0000-4000-8000-000000000001';
  const link = 'eeeeeeee-0000-4000-8000-000000000001';
  const guest = (n) => `99999999-0000-4000-8000-${String(n).padStart(12, '0')}`;
  const as = (uid, sql, claims = {}) => psql(`
    set role authenticated;
    set request.jwt.claims = '${JSON.stringify({ sub: uid, role: 'authenticated', ...claims })}';
    ${sql}
  `);
  const redeem = (uid, password) => as(uid, `select public.redeem_guest_link_checked('tok', 'Gus', ${password == null ? 'null' : `'${password}'`}) ->> 'status';`, { is_anonymous: true });
  const fails = (fn, re) => assert.throws(fn, (err) => re.test(String(err.stderr || err.message)));
  try {
    mkdirSync(socket);
    execFileSync(tool('initdb'), ['-D', data, '-A', 'trust', '-U', 'postgres', '--no-locale'], { stdio: 'ignore', env: pgEnv });
    execFileSync(tool('pg_ctl'), ['-D', data, '-l', join(cluster, 'pg.log'), '-o', `-F -k ${socket} -p ${port}`, '-w', 'start'], { stdio: 'ignore', env: pgEnv });
    started = true;
    psql(`
      create role anon; create role authenticated; create role service_role;
      create schema auth;
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
      grant usage on schema public to authenticated;
      create table public.documents (id uuid primary key, name text, owner uuid);
      create function public.user_can_access_document(p_doc uuid, p_level text) returns boolean language sql stable security definer set search_path = ''
        as $$ select exists (select 1 from public.documents d where d.id = p_doc and d.owner = auth.uid()) $$;
      create table public.document_guest_links (
        id uuid primary key, document_id uuid not null references public.documents(id), role text not null,
        token_hash text not null unique, expires_at timestamptz not null, revoked_at timestamptz,
        created_at timestamptz not null default now(), last_used_at timestamptz, use_count integer not null default 0);
      create table public.document_guests (
        id uuid primary key default gen_random_uuid(), link_id uuid not null references public.document_guest_links(id),
        document_id uuid not null, user_id uuid not null, display_name text not null, joined_at timestamptz not null default now(),
        unique (link_id, user_id));
      alter table public.document_guest_links enable row level security;
      revoke all on table public.document_guest_links from public, anon, authenticated;
      grant select (id, document_id, role, expires_at, revoked_at, created_at, last_used_at, use_count) on public.document_guest_links to authenticated;
      create policy owner_read on public.document_guest_links for select to authenticated using (public.user_can_access_document(document_id, 'owner'));
      insert into public.documents values ('${doc}', 'Plan', '${OWNER}');
      insert into public.document_guest_links (id, document_id, role, token_hash, expires_at)
        values ('${link}', '${doc}', 'viewer', encode(sha256(convert_to('tok', 'UTF8')), 'hex'), now() + interval '1 day');
    `);
    psql(read(MIGRATION));

    // Only the owner sets it, 4 to 128 characters; nobody reads the hash.
    fails(() => as(EDITOR, `select public.set_guest_link_password('${link}', 'open sesame');`), /Link not found/);
    fails(() => as(OWNER, `select public.set_guest_link_password('${link}', 'abc');`), /4 to 128/);
    fails(() => as(OWNER, `select public.set_guest_link_password('${link}', 'open sesame');`, { is_anonymous: true }), /Not allowed/);
    assert.equal(as(OWNER, `select public.set_guest_link_password('${link}', 'open sesame');`), 't');
    assert.equal(as(OWNER, `select has_password from public.document_guest_links where id = '${link}';`), 't');
    fails(() => as(OWNER, `select password_hash from public.document_guest_links;`), /permission denied/);
    fails(() => as(OWNER, `select * from public.document_guest_link_attempts;`), /permission denied/);
    fails(() => as(OWNER, `select public._guest_password_hash('a', 'b');`), /permission denied/);

    // The old call can't skip it.
    fails(() => as(guest(1), `select * from public.redeem_guest_link('tok', 'Gus');`, { is_anonymous: true }), /needs a password/);
    assert.equal(redeem(guest(1), null), 'password');
    assert.equal(redeem(guest(1), ''), 'password');

    // Five wrong tries by one session lock it for that session, even with the right password.
    for (let i = 0; i < 5; i += 1) assert.equal(redeem(guest(1), `nope${i}`), 'wrong');
    assert.equal(redeem(guest(1), 'open sesame'), 'locked');
    assert.equal(psql(`select count(*) from public.document_guests;`), '0');

    // Another session still gets in with the right password, and stays in after a change.
    assert.equal(redeem(guest(2), 'open sesame'), 'ok');
    assert.equal(as(OWNER, `select public.set_guest_link_password('${link}', 'new secret');`), 't');
    assert.equal(redeem(guest(2), null), 'ok');
    assert.equal(psql(`select count(*) from public.document_guests where user_id = '${guest(2)}';`), '1');
    assert.equal(as(guest(2), `select count(*) from public.redeem_guest_link('tok', 'Gus');`, { is_anonymous: true }), '1');

    // Twenty wrong tries across sessions lock the link for newcomers.
    for (let n = 10; n < 25; n += 1) assert.equal(redeem(guest(n), 'bad'), 'wrong');
    assert.equal(redeem(guest(30), 'new secret'), 'locked');
    // After the window it opens again; old tries are pruned on the next wrong one.
    psql(`update public.document_guest_link_attempts set at = now() - interval '2 days';`);
    assert.equal(redeem(guest(31), 'bad'), 'wrong');
    assert.equal(psql(`select count(*) from public.document_guest_link_attempts;`), '1');
    assert.equal(redeem(guest(30), 'new secret'), 'ok');

    // Clearing the password opens it with the old call again.
    assert.equal(as(OWNER, `select public.set_guest_link_password('${link}', '');`), 't');
    assert.equal(as(OWNER, `select has_password from public.document_guest_links where id = '${link}';`), 'f');
    assert.equal(as(guest(40), `select count(*) from public.redeem_guest_link('tok', 'Gus');`, { is_anonymous: true }), '1');
  } finally {
    if (started) {
      try { execFileSync(tool('pg_ctl'), ['-D', data, '-m', 'immediate', 'stop'], { stdio: 'ignore', env: pgEnv }); } catch { /* already stopped */ }
    }
    rmSync(cluster, { recursive: true, force: true });
  }
});
