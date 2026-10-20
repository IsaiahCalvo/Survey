// Custom builds library: kits given to one customer (supabase/migrations/
// 20261021013000_custom_kits.sql), run on a throwaway local Postgres.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const tool = (name) => {
  try { return execFileSync('which', [name], { encoding: 'utf8' }).trim(); }
  catch { return ''; }
};
const pgEnv = { ...process.env, LC_ALL: 'C', LANG: 'C' };

const ALICE = '11111111-1111-4111-8111-111111111111';
const BOB = '22222222-2222-4222-8222-222222222222';

test('a person (or their agent) sees only the kits given to their own account, and cannot change any', {
  skip: !tool('initdb') || !tool('pg_ctl') || !tool('psql'),
}, () => {
  const cluster = mkdtempSync(join(tmpdir(), 'survey-kits-postgres-'));
  const socket = join(cluster, 'socket');
  const data = join(cluster, 'data');
  const port = String(32000 + Math.floor(Math.random() * 10000));
  let started = false;
  const psql = (sql) => execFileSync('psql', ['-h', socket, '-p', port, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq'],
    { input: sql, encoding: 'utf8', env: pgEnv, stdio: ['pipe', 'pipe', 'pipe'] }).trim();
  // Run as a signed-in person, like PostgREST does.
  const as = (uid, sql) => psql(`
    set role authenticated;
    select set_config('request.jwt.claims', '{"sub":"${uid}","role":"authenticated"}', false);
    ${sql}`).split('\n').pop();
  const refused = (uid, sql) => assert.throws(() => as(uid, sql), /permission denied|violates row-level security|never edited/);

  try {
    mkdirSync(socket);
    execFileSync('initdb', ['-D', data, '-A', 'trust', '-U', 'postgres', '--no-locale'], { stdio: 'ignore', env: pgEnv });
    execFileSync('pg_ctl', ['-D', data, '-l', join(cluster, 'pg.log'), '-o', `-F -k ${socket} -p ${port}`, '-w', 'start'], { stdio: 'ignore', env: pgEnv });
    started = true;
    psql(`
      create role anon; create role authenticated; create role service_role;
      create schema auth;
      grant usage on schema auth to authenticated, anon, service_role;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable
        as $$ select nullif(current_setting('request.jwt.claims', true)::jsonb ->> 'sub', '')::uuid $$;
      grant usage on schema public to authenticated, anon, service_role;
      insert into auth.users values ('${ALICE}'), ('${BOB}');
    `);
    psql(readFileSync(new URL('../supabase/migrations/20261021013000_custom_kits.sql', import.meta.url), 'utf8'));
    // Staff publish two kits and give one to Alice only.
    psql(`
      insert into public.kits (id, version, kind, label, definition) values
        ('acme-door-schedule', '1.0.0', 'exportKit', 'Acme doors', '{"columns":[]}'),
        ('beta-lock-schedule', '1.0.0', 'exportKit', 'Beta locks', '{"columns":[]}');
      insert into public.account_kits (user_id, kit_id, kit_version) values ('${ALICE}', 'acme-door-schedule', '1.0.0');
    `);

    assert.equal(as(ALICE, 'select string_agg(id, \',\') from public.kits;'), 'acme-door-schedule');
    assert.equal(as(ALICE, 'select count(*) from public.account_kits;'), '1');
    assert.equal(as(BOB, 'select count(*) from public.kits;'), '0');
    assert.equal(as(BOB, 'select count(*) from public.account_kits;'), '0');

    // Nobody signed in sees nothing at all.
    assert.throws(() => psql('set role anon; select count(*) from public.kits;'), /permission denied/);

    // People can't give themselves kits, publish kits, or edit them.
    refused(BOB, `insert into public.account_kits (user_id, kit_id, kit_version) values ('${BOB}', 'beta-lock-schedule', '1.0.0');`);
    refused(ALICE, `insert into public.kits (id, version, kind, definition) values ('x', '1.0.0', 'exportKit', '{}');`);
    refused(ALICE, `update public.account_kits set overrides = '{"a":1}';`);
    refused(ALICE, `delete from public.account_kits;`);

    // A published version is never edited, even by staff.
    assert.throws(() => psql(`update public.kits set label = 'changed' where id = 'acme-door-schedule';`), /never edited/);
    // Bad ids and versions are refused.
    assert.throws(() => psql(`insert into public.kits (id, version, kind, definition) values ('Bad Id', '1.0.0', 'exportKit', '{}');`));
    assert.throws(() => psql(`insert into public.kits (id, version, kind, definition) values ('ok', '1.0', 'exportKit', '{}');`));
    // A kit can't be given unless that version exists.
    assert.throws(() => psql(`insert into public.account_kits (user_id, kit_id, kit_version) values ('${BOB}', 'acme-door-schedule', '9.9.9');`));
  } finally {
    if (started) {
      try { execFileSync('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop'], { stdio: 'ignore', env: pgEnv }); } catch { /* reported above */ }
    }
    if (existsSync(cluster)) rmSync(cluster, { recursive: true, force: true });
  }
});
