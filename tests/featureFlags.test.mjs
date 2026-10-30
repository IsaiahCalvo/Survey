// Feature flags (src/featureFlags.js + the feature_flags migration): the read
// order in the browser, the server answer cache, and the database rules —
// only admins see or change flags, testers get only their own answers.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import {
  FEATURE_FLAGS, FLAG_CACHE_KEY, isBetaFlag, isFeatureOn, normalizeTesterEmails, refreshFeatureFlags, releaseChannel,
} from '../src/featureFlags.js';

function memoryStorage(seed = {}) {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
  };
}

test('flags: off by default, unknown flags always off', () => {
  const storage = memoryStorage();
  assert.equal(isFeatureOn('smart-fill', { storage, env: {} }), false);
  assert.equal(isFeatureOn('no-such-flag', { storage, env: { VITE_RELEASE_CHANNEL: 'nightly' } }), false);
});

test('flags: nightly turns every beta flag on (but a hidden one), and a browser override still wins', () => {
  const env = { VITE_RELEASE_CHANNEL: 'nightly' };
  assert.equal(releaseChannel(env), 'nightly');
  assert.equal(releaseChannel({}), 'stable');
  for (const key of Object.keys(FEATURE_FLAGS).filter(isBetaFlag)) {
    // A beta flag kept hidden (nightlyOn: false) waits for /flags or an override.
    const hidden = FEATURE_FLAGS[key].nightlyOn === false;
    assert.equal(isFeatureOn(key, { storage: memoryStorage(), env }), !hidden, key);
    if (hidden) assert.equal(isFeatureOn(key, { storage: memoryStorage({ [FLAG_CACHE_KEY]: JSON.stringify({ [key]: true }) }), env }), true, key);
  }
  assert.deepEqual(Object.keys(FEATURE_FLAGS).filter((key) => FEATURE_FLAGS[key].nightlyOn === false), ['conditional-lines']);
  assert.equal(isFeatureOn('smart-fill', { storage: memoryStorage({ 'survey.flag.smart-fill': '0' }), env }), false);
});

test('flags: nightly matches stable on rollout flags (owner 2026-10-27: nightly = live + beta)', () => {
  const rollout = Object.keys(FEATURE_FLAGS).filter((key) => !isBetaFlag(key));
  assert.ok(rollout.includes('pro-lock'));
  const nightly = { VITE_RELEASE_CHANNEL: 'nightly', MODE: 'production' };
  const stable = { MODE: 'production' };
  for (const key of rollout) {
    for (const storage of [
      memoryStorage(),
      memoryStorage({ [FLAG_CACHE_KEY]: JSON.stringify({ [key]: true }) }),
      memoryStorage({ [FLAG_CACHE_KEY]: JSON.stringify({ [key]: false }) }),
      memoryStorage({ [`survey.flag.${key}`]: '1' }),
    ]) {
      assert.equal(isFeatureOn(key, { storage, env: nightly }), isFeatureOn(key, { storage, env: stable }), key);
    }
  }
  // pro-lock off at /flags stays off on nightly, so nothing is locked there.
  assert.equal(isFeatureOn('pro-lock', { storage: memoryStorage(), env: nightly }), false);
});

test('flags: older smart fill key and build env var still work on a dev server', () => {
  const dev = { DEV: true };
  assert.equal(isFeatureOn('smart-fill', { storage: memoryStorage({ SMART_FILL_BETA: '1' }), env: dev }), true);
  assert.equal(isFeatureOn('smart-fill', { storage: memoryStorage({ SMART_FILL_BETA: '0' }), env: { ...dev, VITE_ENABLE_SMART_FILL: '1' } }), false);
  assert.equal(isFeatureOn('smart-fill', { storage: memoryStorage(), env: { ...dev, VITE_ENABLE_SMART_FILL: '1' } }), true);
});

test('flags: stable never shows a beta feature, even to testers or with an override', () => {
  const beta = Object.keys(FEATURE_FLAGS).filter((key) => FEATURE_FLAGS[key].stage === 'beta');
  assert.ok(beta.includes('survey-agent') && beta.includes('smart-fill') && beta.includes('layers'));
  const everything = Object.fromEntries(Object.keys(FEATURE_FLAGS).map((key) => [key, true]));
  for (const key of beta) {
    const def = FEATURE_FLAGS[key];
    const storage = memoryStorage({
      [FLAG_CACHE_KEY]: JSON.stringify(everything),
      [`survey.flag.${key}`]: '1',
      ...(def.legacyKey ? { [def.legacyKey]: '1' } : {}),
    });
    const env = def.env ? { [def.env]: '1' } : {};
    assert.equal(isBetaFlag(key), true, key);
    assert.equal(isFeatureOn(key, { storage, env }), false, key);
    assert.equal(isFeatureOn(key, { storage, env: { ...env, MODE: 'production' } }), false, key);
    assert.equal(isFeatureOn(key, { storage, env: { ...env, VITE_RELEASE_CHANNEL: 'nightly' } }), true, key);
    // Test builds (e2e harness, native-app walks) still follow the seeded flags.
    assert.equal(isFeatureOn(key, { storage, env: { ...env, MODE: 'e2e' } }), true, key);
  }
});

test('flags: every flag says whether it is beta (nightly only) or rolling out on stable', () => {
  for (const [key, def] of Object.entries(FEATURE_FLAGS)) {
    assert.ok(def.stage === 'beta' || def.stage === 'rollout', key);
  }
  // Rollout flags still follow /flags on stable.
  const storage = memoryStorage({ [FLAG_CACHE_KEY]: JSON.stringify({ 'pro-lock': true }) });
  assert.equal(isFeatureOn('pro-lock', { storage, env: {} }), true);
  assert.equal(isBetaFlag('pro-lock'), false);
});

test('flags: the saved server answer decides when nothing else does', async () => {
  const storage = memoryStorage();
  const supabase = { rpc: async (name) => {
    assert.equal(name, 'get_my_feature_flags');
    return { data: { 'pro-lock': true, 'gone-flag': true }, error: null };
  } };
  assert.equal(await refreshFeatureFlags(supabase, { storage }), true);
  const expected = Object.fromEntries(Object.keys(FEATURE_FLAGS).map((key) => [key, key === 'pro-lock']));
  assert.deepEqual(JSON.parse(storage.getItem(FLAG_CACHE_KEY)), expected, 'known flags only; missing ones are off');
  assert.equal(isFeatureOn('pro-lock', { storage, env: {} }), true);
  assert.equal(await refreshFeatureFlags(supabase, { storage }), false, 'same answer is not a change');

  const failing = { rpc: async () => ({ data: null, error: { message: 'offline' } }) };
  assert.equal(await refreshFeatureFlags(failing, { storage }), false);
  assert.equal(isFeatureOn('pro-lock', { storage, env: {} }), true, 'an error keeps the last answer');
});

test('flags: tester email list is tidied', () => {
  assert.deepEqual(normalizeTesterEmails(' B@x.com, a@x.com;\nb@x.com  not-an-email '), ['a@x.com', 'b@x.com']);
});

test('flags: every client flag is seeded in a migration', () => {
  const dir = new URL('../supabase/migrations/', import.meta.url);
  const sql = readdirSync(dir).filter((f) => f.endsWith('.sql')).map((f) => readFileSync(new URL(f, dir), 'utf8')).join('\n');
  for (const key of Object.keys(FEATURE_FLAGS)) assert.match(sql, new RegExp(`\\('${key}', 'off'`), key);
});

const pgBin = ['/usr/lib/postgresql/16/bin', '/opt/homebrew/bin', '/usr/local/bin']
  .find((dir) => existsSync(join(dir, 'initdb')));
const tool = (name) => {
  if (pgBin && existsSync(join(pgBin, name))) return join(pgBin, name);
  try { return execFileSync('which', [name], { encoding: 'utf8' }).trim(); }
  catch { return ''; }
};
const pgEnv = { ...process.env, LC_ALL: 'C', LANG: 'C' };

const isRoot = process.getuid?.() === 0; // initdb refuses to run as root
test('flags: database rules', { skip: isRoot || !tool('initdb') || !tool('pg_ctl') || !tool('psql') }, () => {
  const cluster = mkdtempSync(join(tmpdir(), 'survey-flags-postgres-'));
  const socket = join(cluster, 'socket');
  const data = join(cluster, 'data');
  const port = String(32000 + Math.floor(Math.random() * 10000));
  let started = false;
  const psql = (sql) => execFileSync(tool('psql'), [
    '-h', socket, '-p', port, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq',
  ], { input: sql, encoding: 'utf8', env: pgEnv }).trim();
  const ADMIN = '11111111-1111-4111-8111-111111111111';
  const TESTER = '22222222-2222-4222-8222-222222222222';
  const as = (uid, email, sql, extraClaims = {}) => psql(`
    set role authenticated;
    set request.jwt.claims = '${JSON.stringify({ sub: uid, email, role: 'authenticated', ...extraClaims })}';
    ${sql}
  `);

  try {
    mkdirSync(socket);
    execFileSync(tool('initdb'), ['-D', data, '-A', 'trust', '-U', 'postgres', '--no-locale'], { stdio: 'ignore', env: pgEnv });
    execFileSync(tool('pg_ctl'), ['-D', data, '-l', join(cluster, 'pg.log'), '-o', `-F -k ${socket} -p ${port}`, '-w', 'start'], { stdio: 'ignore', env: pgEnv });
    started = true;
    psql(`
      create role anon; create role authenticated; create role service_role;
      create schema auth;
      create table auth.users (id uuid primary key, email text);
      create function auth.jwt() returns jsonb language sql stable
        as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
      create function auth.uid() returns uuid language sql stable
        as $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
      create function public.is_agent_session() returns boolean language sql stable
        as $$ select coalesce(auth.jwt() ->> 'client_id', '') <> '' $$;
      grant usage on schema auth to anon, authenticated;
      grant execute on all functions in schema auth to anon, authenticated;
      insert into auth.users values ('${ADMIN}', 'boss@x.com'), ('${TESTER}', 'tester@x.com');
    `);
    psql(readFileSync(new URL('../supabase/migrations/20261021030000_feature_flags.sql', import.meta.url), 'utf8'));
    psql(`
      grant select, insert, update, delete on all tables in schema public to anon, authenticated;
      insert into public.feature_flag_admins values ('${ADMIN}');
    `);

    // Not an admin: sees no rows, cannot change anything, answer is off.
    assert.equal(as(TESTER, 'tester@x.com', 'select count(*) from public.feature_flags;'), '0');
    as(TESTER, 'tester@x.com', `update public.feature_flags set mode = 'on';`);
    assert.equal(as(TESTER, 'tester@x.com', `select public.get_my_feature_flags() ->> 'smart-fill';`), 'false');

    // Admin puts the tester on the list.
    assert.equal(as(ADMIN, 'boss@x.com', 'select public.is_feature_flag_admin();'), 't');
    as(ADMIN, 'boss@x.com', `update public.feature_flags set mode = 'testers', tester_emails = array[' Tester@X.com ', ''] where key = 'smart-fill';`);
    assert.equal(psql(`select array_to_string(tester_emails, ',') || '|' || updated_by from public.feature_flags where key = 'smart-fill';`), `tester@x.com|${ADMIN}`);
    assert.equal(as(TESTER, 'tester@x.com', `select public.get_my_feature_flags() ->> 'smart-fill';`), 'true');
    assert.equal(as(ADMIN, 'boss@x.com', `select public.get_my_feature_flags() ->> 'smart-fill';`), 'false');
    assert.equal(psql(`set role anon; select public.get_my_feature_flags() ->> 'smart-fill';`), 'false');

    // Survey Nightly: flag admins and listed testers only, never an AI agent or a stranger.
    psql(readFileSync(new URL('../supabase/migrations/20261024160000_can_use_nightly.sql', import.meta.url), 'utf8'));
    const nightly = (uid, email, claims) => as(uid, email, 'select public.can_use_nightly();', claims);
    assert.equal(nightly(ADMIN, 'boss@x.com'), 't');
    assert.equal(nightly(TESTER, 'tester@x.com'), 't');
    assert.equal(nightly('33333333-3333-4333-8333-333333333333', 'someone@x.com'), 'f');
    assert.equal(nightly(TESTER, 'tester@x.com', { client_id: 'agent' }), 'f');
    assert.equal(psql('set role anon; select public.can_use_nightly();'), 'f');

    // An AI agent acting for the admin cannot change flags.
    assert.equal(as(ADMIN, 'boss@x.com', 'select public.is_feature_flag_admin();', { client_id: 'agent' }), 'f');
    as(ADMIN, 'boss@x.com', `update public.feature_flags set mode = 'off' where key = 'smart-fill';`, { client_id: 'agent' });
    assert.equal(psql(`select mode from public.feature_flags where key = 'smart-fill';`), 'testers');

    // On for everyone, signed out included.
    as(ADMIN, 'boss@x.com', `update public.feature_flags set mode = 'on' where key = 'smart-fill';`);
    assert.equal(psql(`set role anon; select public.get_my_feature_flags() ->> 'smart-fill';`), 'true');

    // A bad mode is refused.
    assert.throws(() => as(ADMIN, 'boss@x.com', `update public.feature_flags set mode = 'maybe';`));
  } finally {
    if (started) {
      try { execFileSync(tool('pg_ctl'), ['-D', data, '-m', 'fast', '-w', 'stop'], { stdio: 'ignore', env: pgEnv }); }
      catch { /* the assertion above reports */ }
    }
    if (existsSync(cluster)) rmSync(cluster, { recursive: true, force: true });
  }
});
