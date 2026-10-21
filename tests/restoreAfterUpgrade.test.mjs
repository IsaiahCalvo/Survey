// Upgrading back to a paid tier un-archives what the downgrade to Free
// archived, and nothing the person archived or deleted themselves.
// Source-assertion half (kal404DowngradeArchival.test.mjs style) plus a live
// half on a disposable PostgreSQL cluster (kal390StorageQuotaPostgres style),
// skipped unless SURVEY_POSTGRES_INTEGRATION=1.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrationPath = join(repoRoot, 'supabase/migrations/20261023090000_restore_after_upgrade.sql');
const MIGRATION = readFileSync(migrationPath, 'utf8');
const WEBHOOK = readFileSync(join(repoRoot, 'supabase/functions/stripe-webhook/index.ts'), 'utf8');

function functionBody(name) {
  const start = WEBHOOK.indexOf(`async function ${name}`);
  assert.ok(start >= 0, `${name} must exist`);
  const next = WEBHOOK.indexOf('\nasync function ', start + 1);
  return WEBHOOK.slice(start, next === -1 ? WEBHOOK.length : next);
}

function sqlFunction(name) {
  const body = MIGRATION.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`))?.[0];
  assert.ok(body, `${name} is defined`);
  return body;
}

test('migration: downgrade marks what it archives; restore touches only marked rows', () => {
  for (const table of ['projects', 'documents']) {
    assert.match(MIGRATION, new RegExp(`ALTER TABLE public\\.${table}\\s+ADD COLUMN IF NOT EXISTS archived_by_downgrade BOOLEAN NOT NULL DEFAULT FALSE`));
  }
  const downgrade = sqlFunction('handle_downgrade_to_free');
  assert.match(downgrade, /SET archived_by_downgrade = TRUE/);
  const restore = sqlFunction('restore_after_upgrade');
  const updates = restore.match(/UPDATE public\.\w+[\s\S]*?;/g) || [];
  assert.equal(updates.length, 2);
  for (const update of updates) {
    assert.match(update, /WHERE user_id = p_user_id AND archived_by_downgrade;/);
    assert.match(update, /archived_by_downgrade = FALSE/);
  }
});

test('migration: new definer functions pin search_path and are service-role only', () => {
  for (const name of ['handle_downgrade_to_free', 'restore_after_upgrade']) {
    const body = sqlFunction(name);
    assert.match(body, /SECURITY DEFINER\s+SET search_path = public/);
    assert.match(MIGRATION, new RegExp(`REVOKE EXECUTE ON FUNCTION public\\.${name}\\(uuid\\) FROM public, anon, authenticated;`));
    assert.match(MIGRATION, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\(uuid\\) TO service_role;`));
    assert.doesNotMatch(MIGRATION, new RegExp(`GRANT EXECUTE ON FUNCTION public\\.${name}\\(uuid\\) TO [^;]*authenticated`));
  }
});

test('webhook: checkout to a paid tier restores after the tier is written', () => {
  const body = functionBody('handleCheckoutCompleted');
  const calls = body.match(/if \(tier !== 'free'\) await restoreAfterUpgrade\(supabase, userId\);/g) || [];
  assert.equal(calls.length, 2, 'both the insert and the update path restore');
  assert.ok(body.indexOf("'SUCCESS: Created new subscription record'") < body.indexOf('restoreAfterUpgrade'));
  assert.ok(body.lastIndexOf(".update(updateData)") < body.lastIndexOf('restoreAfterUpgrade'));
});

test('webhook: subscription update Free -> paid restores inside the success branch', () => {
  const body = functionBody('handleSubscriptionUpdate');
  assert.match(body, /isUpgradeFromFree = oldTier === 'free' && tier !== 'free'/);
  const successLog = body.indexOf('Subscription updated for user');
  const call = body.indexOf('await restoreAfterUpgrade(supabase, actualUserId)');
  assert.ok(successLog >= 0 && call > successLog);
});

test('webhook: a failed restore is logged, never fails the webhook', () => {
  const body = functionBody('restoreAfterUpgrade');
  assert.match(body, /rpc\('restore_after_upgrade',\s*\{\s*p_user_id: userId\s*\}/);
  assert.match(body, /try \{[\s\S]*\} catch \(restoreErr\) \{/);
  assert.doesNotMatch(body, /failWrite|throw /);
});

// ---------------------------------------------------------------------------
// Live half.

const RUN = process.env.SURVEY_POSTGRES_INTEGRATION === '1';
const PG_ENV = { ...process.env, LC_ALL: 'C' };
const USER_A = '10000000-0000-4000-8000-00000000000a';
const USER_B = '20000000-0000-4000-8000-00000000000b';

function run(file, args) {
  return execFileSync(file, args, { encoding: 'utf8', stdio: 'pipe', env: PG_ENV }).trim();
}

async function freePort() {
  const server = createServer();
  await new Promise((ok, fail) => { server.once('error', fail); server.listen(0, '127.0.0.1', ok); });
  const { port } = server.address();
  await new Promise((ok) => server.close(ok));
  return port;
}

test('live: downgrade, hand changes, then upgrade restores only downgrade-archived rows', {
  skip: !RUN && 'set SURVEY_POSTGRES_INTEGRATION=1 to run disposable PostgreSQL verification',
  timeout: 90_000,
}, async () => {
  const clusterDir = mkdtempSync(join(tmpdir(), 'survey-restore-upgrade-postgres-'));
  const port = await freePort();
  const psql = (...args) => run('psql', ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq', ...args]);
  const sql = (text) => psql('-c', text);
  let started = false;
  try {
    run('initdb', ['-D', clusterDir, '-A', 'trust', '-U', 'postgres', '--no-locale']);
    run('pg_ctl', ['-D', clusterDir, '-l', join(clusterDir, 'postgres.log'), '-o', `-p ${port} -h 127.0.0.1`, '-w', 'start']);
    started = true;

    // Minimal mimic: roles, the two tables, and the archive helpers exactly as
    // 20241226000002_add_archived_columns.sql defines them.
    const plan = readFileSync(join(repoRoot, 'supabase/migrations/20241226000002_add_archived_columns.sql'), 'utf8');
    const helpers = plan.match(/CREATE OR REPLACE FUNCTION archive_excess_projects[\s\S]*?SECURITY DEFINER;\n[\s\S]*?CREATE OR REPLACE FUNCTION archive_excess_documents[\s\S]*?SECURITY DEFINER;/)[0];
    const bootstrap = join(clusterDir, 'bootstrap.sql');
    writeFileSync(bootstrap, `
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN;
      CREATE TABLE public.projects (
        id UUID PRIMARY KEY, user_id UUID NOT NULL, name TEXT,
        archived BOOLEAN NOT NULL DEFAULT FALSE, updated_at TIMESTAMPTZ NOT NULL);
      CREATE TABLE public.documents (
        id UUID PRIMARY KEY, user_id UUID NOT NULL, project_id UUID, name TEXT,
        archived BOOLEAN NOT NULL DEFAULT FALSE, updated_at TIMESTAMPTZ NOT NULL);
      ${helpers}
      CREATE FUNCTION public.handle_downgrade_to_free(p_user_id UUID) RETURNS JSON
        LANGUAGE sql AS $$ SELECT NULL::json $$;
      -- USER_A: 3 projects, 8 documents (newest = highest n). USER_B: 1 overage doc.
      INSERT INTO public.projects
        SELECT ('00000000-0000-4000-8000-00000000010' || n)::uuid, '${USER_A}', 'p' || n, FALSE, now() - (10 - n) * interval '1 hour'
        FROM generate_series(1, 3) n;
      INSERT INTO public.documents
        SELECT ('00000000-0000-4000-8000-00000000020' || n)::uuid, '${USER_A}', NULL, 'd' || n, FALSE, now() - (10 - n) * interval '1 hour'
        FROM generate_series(1, 8) n;
      -- d9: deleted by hand before the downgrade (archived, not by downgrade).
      INSERT INTO public.documents VALUES
        ('00000000-0000-4000-8000-000000000209', '${USER_A}', NULL, 'd9', TRUE, now());
      INSERT INTO public.documents
        SELECT ('00000000-0000-4000-8000-00000000030' || n)::uuid, '${USER_B}', NULL, 'b' || n, FALSE, now()
        FROM generate_series(1, 6) n;
    `);
    psql('-f', bootstrap);
    psql('-f', migrationPath);

    const result = JSON.parse(sql(`SELECT public.handle_downgrade_to_free('${USER_A}');`));
    assert.equal(result.projects_archived_count, 2);
    assert.equal(result.documents_archived_count, 3);
    sql(`SELECT public.handle_downgrade_to_free('${USER_B}');`);
    assert.equal(sql(`SELECT string_agg(name, ',' ORDER BY name) FROM public.documents WHERE archived_by_downgrade AND user_id = '${USER_A}';`), 'd1,d2,d3');
    assert.equal(sql(`SELECT string_agg(name, ',' ORDER BY name) FROM public.projects WHERE archived_by_downgrade;`), 'p1,p2');

    // Hand changes after the downgrade: the person revives d1 and then deletes
    // it again, and deletes d8 (live). Neither may come back on upgrade.
    sql(`UPDATE public.documents SET archived = FALSE WHERE name = 'd1';`);
    sql(`UPDATE public.documents SET archived = TRUE WHERE name IN ('d1', 'd8');`);

    // Signed-in callers cannot run either function.
    for (const fn of ['restore_after_upgrade', 'handle_downgrade_to_free']) {
      assert.throws(
        () => sql(`BEGIN; SET LOCAL ROLE authenticated; SELECT public.${fn}('${USER_A}'); COMMIT;`),
        /permission denied/,
      );
    }
    assert.equal(sql(`BEGIN; SET LOCAL ROLE service_role; SELECT (public.restore_after_upgrade('${USER_A}')->>'documents_restored_count'); COMMIT;`), '2');

    assert.equal(sql(`SELECT string_agg(name, ',' ORDER BY name) FROM public.documents WHERE user_id = '${USER_A}' AND archived;`), 'd1,d8,d9');
    assert.equal(sql(`SELECT count(*) FROM public.projects WHERE archived;`), '0');
    assert.equal(sql(`SELECT count(*) FROM public.documents WHERE user_id = '${USER_A}' AND archived_by_downgrade;`), '0');
    assert.equal(sql(`SELECT count(*) FROM public.documents WHERE user_id = '${USER_B}' AND archived_by_downgrade;`), '1', 'other users are untouched');
  } finally {
    if (started) {
      try { run('pg_ctl', ['-D', clusterDir, '-m', 'fast', '-w', 'stop']); } catch { /* best effort */ }
    }
    assert.ok(clusterDir.startsWith(`${tmpdir()}/survey-restore-upgrade-postgres-`));
    rmSync(clusterDir, { recursive: true, force: true });
  }
});
