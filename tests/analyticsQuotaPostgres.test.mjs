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

test('analytics quota migration atomically caps usage and prunes expired counter rows', {
  skip: !tool('initdb') || !tool('pg_ctl') || !tool('psql'),
}, () => {
  const cluster = mkdtempSync(join(tmpdir(), 'survey-analytics-postgres-'));
  const socket = join(cluster, 'socket');
  const data = join(cluster, 'data');
  const log = join(cluster, 'postgres.log');
  const port = String(32000 + Math.floor(Math.random() * 10000));
  let started = false;
  const psql = (sql) => execFileSync('psql', [
    '-h', socket,
    '-p', port,
    '-U', 'postgres',
    '-d', 'postgres',
    '-v', 'ON_ERROR_STOP=1',
    '-Atq',
  ], { input: sql, encoding: 'utf8' }).trim();

  try {
    mkdirSync(socket);
    execFileSync('initdb', ['-D', data, '-A', 'trust', '-U', 'postgres', '--no-locale'], { stdio: 'ignore' });
    execFileSync('pg_ctl', [
      '-D', data,
      '-l', log,
      '-o', `-F -k ${socket} -p ${port}`,
      '-w', 'start',
    ], { stdio: 'ignore' });
    started = true;
    psql(`
      create role anon;
      create role authenticated;
      create role service_role;
      create schema auth;
      create function auth.role() returns text language sql stable
      as $$ select current_setting('request.jwt.claim.role', true) $$;
    `);
    psql(readFileSync(new URL(
      '../supabase/migrations/20260811130000_analytics_ingestion_daily_cap.sql',
      import.meta.url,
    ), 'utf8'));
    psql(`
      insert into public.analytics_ingestion_daily_counters values
        ((now() at time zone 'utc')::date - 8, 'expired', 1),
        ((now() at time zone 'utc')::date - 7, 'retained', 1);
      set request.jwt.claim.role = 'service_role';
      select public.reserve_analytics_ingestion_slot('11111111-1111-4111-8111-111111111111');
    `);

    assert.equal(psql(`
      select count(*) from public.analytics_ingestion_daily_counters
      where scope_key = 'expired';
    `), '0');
    assert.equal(psql(`
      select count(*) from public.analytics_ingestion_daily_counters
      where scope_key = 'retained';
    `), '1');
    assert.equal(psql(`
      select event_count from public.analytics_ingestion_daily_counters
      where usage_date = (now() at time zone 'utc')::date and scope_key = 'global';
    `), '1');

    psql(`
      update public.analytics_ingestion_daily_counters set event_count = 10000
      where usage_date = (now() at time zone 'utc')::date and scope_key = 'global';
    `);
    assert.equal(psql(`
      set request.jwt.claim.role = 'service_role';
      select public.reserve_analytics_ingestion_slot('22222222-2222-4222-8222-222222222222');
    `), 'f');
  } finally {
    if (started) {
      try { execFileSync('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop'], { stdio: 'ignore' }); }
      catch { /* test failure reports from the primary assertion */ }
    }
    if (existsSync(cluster)) rmSync(cluster, { recursive: true, force: true });
  }
});
