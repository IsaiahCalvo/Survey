#!/usr/bin/env node
// scripts/test-archive-purge-sweep-postgres.mjs — KAL-431 proof harness.
//
// Spins up a disposable local Postgres (no Docker, nothing cloud), installs the
// REAL KAL-426 purge/archive functions extracted verbatim from the shipped
// migration, applies the KAL-431 sweep migration, and proves the auto-cleanup
// behaves against an actual database.
//
// Mirrors scripts/test-annotation-wal-postgres.mjs, the existing local-Postgres
// harness pattern in this repo.
//
// The function bodies under test are sliced out of the migration files by name,
// so there is no hand-copied SQL here to drift from production.
//
// Usage: node scripts/test-archive-purge-sweep-postgres.mjs

import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const KAL426 = join(root, 'supabase/migrations/20260802000000_kal426_user_archive_foundation.sql');
const KAL431 = join(root, 'supabase/migrations/20260811000000_kal431_archive_purge_sweep.sql');

const temp = mkdtempSync(join(tmpdir(), 'survey-archive-sweep-'));
const data = join(temp, 'data');
const socket = join(temp, 'socket');
const port = 59000 + Math.floor(Math.random() * 2000);
const psqlArgs = ['-h', socket, '-p', String(port), '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq'];

const OWNER_A = '10000000-0000-0000-0000-00000000000a';
const OWNER_B = '10000000-0000-0000-0000-00000000000b';

// macOS Postgres refuses to start ("postmaster became multithreaded during
// startup") unless a concrete locale is set, so pin one for every child process.
const pgEnv = { ...process.env, LC_ALL: 'C', LANG: 'C' };

let passed = 0;
const check = (label, fn) => {
  fn();
  passed += 1;
  console.log(`  ok  ${label}`);
};

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', env: pgEnv, ...options });
  if (result.status !== 0) {
    throw new Error(`${command} failed (${result.status})\n${result.stdout || ''}\n${result.stderr || ''}`);
  }
  return String(result.stdout || '').trim();
}

const sql = (source) => run('psql', [...psqlArgs, '-c', source]);

/**
 * Slice a function definition out of a migration by name so the harness tests
 * the production text itself, never a copy.
 */
function extractFunction(source, name) {
  const start = source.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  assert.notEqual(start, -1, `found ${name} in migration`);
  const end = source.indexOf('\n$$;', start);
  assert.notEqual(end, -1, `found terminator for ${name}`);
  return `${source.slice(start, end + 4)}\n`;
}

try {
  run('mkdir', ['-p', socket]);
  run('initdb', ['-D', data, '--auth=trust', '--no-locale', '-E', 'UTF8']);
  const started = spawnSync(
    'pg_ctl',
    ['-D', data, '-o', `-F -p ${port} -k ${socket}`, '-w', 'start'],
    { encoding: 'utf8', env: pgEnv, timeout: 15000 },
  );
  if (started.status !== 0) console.error(started.stdout, started.stderr);
  assert.equal(started.status, 0, 'disposable Postgres starts');

  // ── Supabase-shaped scaffolding ────────────────────────────────────────────
  // auth.uid() reads the same GUCs real Supabase reads, which is exactly the
  // mechanism the sweep uses to adopt each row owner's identity.
  sql(`
    CREATE ROLE authenticated;
    CREATE ROLE service_role;
    CREATE ROLE anon;
    CREATE EXTENSION IF NOT EXISTS pgcrypto;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $fn$
      SELECT COALESCE(
        NULLIF(current_setting('request.jwt.claim.sub', true), ''),
        (NULLIF(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
      )::uuid
    $fn$;

    CREATE TABLE public.projects (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL,
      name text,
      user_archived_at timestamptz,
      user_archive_expires_at timestamptz,
      user_archived_by uuid,
      archive_group_id uuid
    );
    CREATE TABLE public.documents (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL,
      project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
      name text,
      file_path text,
      user_archived_at timestamptz,
      user_archive_expires_at timestamptz,
      user_archived_by uuid,
      archive_group_id uuid
    );
    CREATE TABLE public.templates (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id uuid NOT NULL,
      name text,
      user_archived_at timestamptz,
      user_archive_expires_at timestamptz,
      user_archived_by uuid,
      archive_group_id uuid
    );
  `);

  // ── Real KAL-426 functions, verbatim ───────────────────────────────────────
  const kal426 = readFileSync(KAL426, 'utf8');
  const wanted = [
    'archive_retention_interval',
    'archive_document',
    'archive_project',
    'archive_template',
    'purge_archived_document',
    'purge_archived_project',
    'purge_archived_template',
  ];
  sql(wanted.map((n) => extractFunction(kal426, n)).join('\n'));
  console.log(`[kal431] installed ${wanted.length} real KAL-426 functions from the shipped migration`);

  // ── The migration under test ───────────────────────────────────────────────
  sql(readFileSync(KAL431, 'utf8'));
  console.log('[kal431] applied the KAL-431 sweep migration');

  const sweep = (limit = 50, dryRun = false) =>
    JSON.parse(sql(`SELECT public.sweep_expired_archives(${limit}, ${dryRun});`));

  const exists = (table, id) =>
    sql(`SELECT count(*) FROM public.${table} WHERE id = '${id}';`) === '1';

  // ════════════════════════════════════════════════════════════════════════
  console.log('\n── Case 1: expiry boundary ──');
  // Two standalone documents for the same owner: one 1 day past its window, one
  // with 5 days left. Only the expired one may go.
  const docExpired = '20000000-0000-0000-0000-000000000001';
  const docLive = '20000000-0000-0000-0000-000000000002';
  sql(`
    INSERT INTO public.documents (id, user_id, name, file_path, user_archived_at, user_archive_expires_at, user_archived_by)
    VALUES
      ('${docExpired}', '${OWNER_A}', 'expired', 'solo/expired.pdf',
       now() - interval '31 days', now() - interval '1 day', '${OWNER_A}'),
      ('${docLive}', '${OWNER_A}', 'still-in-window', 'solo/live.pdf',
       now() - interval '25 days', now() + interval '5 days', '${OWNER_A}');
  `);

  let r = sweep();
  check('expired document is purged', () => assert.equal(exists('documents', docExpired), false));
  check('document inside its window survives', () => assert.equal(exists('documents', docLive), true));
  check('run reports exactly one document purged', () => assert.equal(r.documents_purged, 1));
  check('purged document\'s unreferenced file is reported orphaned', () =>
    assert.deepEqual(r.orphaned_paths, ['solo/expired.pdf']));

  // ════════════════════════════════════════════════════════════════════════
  console.log('\n── Case 2: re-run is a no-op ──');
  r = sweep();
  check('second run purges nothing', () =>
    assert.equal(r.documents_purged + r.projects_purged + r.templates_purged, 0));
  check('second run reports no failures', () => assert.equal(r.failed, 0));
  check('second run unlinks nothing', () => assert.deepEqual(r.orphaned_paths, []));
  check('document inside its window still survives a second run', () =>
    assert.equal(exists('documents', docLive), true));

  // ════════════════════════════════════════════════════════════════════════
  console.log('\n── Case 3: a project purges as one group ──');
  // Archived through the REAL archive_project, then aged past its window, so the
  // group semantics under test are the ones production actually produces.
  const proj = '30000000-0000-0000-0000-000000000001';
  const child1 = '30000000-0000-0000-0000-0000000000c1';
  const child2 = '30000000-0000-0000-0000-0000000000c2';
  sql(`
    INSERT INTO public.projects (id, user_id, name) VALUES ('${proj}', '${OWNER_A}', 'doomed');
    INSERT INTO public.documents (id, user_id, project_id, name, file_path)
    VALUES ('${child1}', '${OWNER_A}', '${proj}', 'c1', 'proj/c1.pdf'),
           ('${child2}', '${OWNER_A}', '${proj}', 'c2', 'proj/c2.pdf');
    SELECT set_config('request.jwt.claim.sub', '${OWNER_A}', false);
    SELECT public.archive_project('${proj}');
    SELECT set_config('request.jwt.claim.sub', '', false);
    -- Age the whole group past its retention window.
    UPDATE public.projects SET user_archive_expires_at = now() - interval '1 day' WHERE id = '${proj}';
    UPDATE public.documents SET user_archive_expires_at = now() - interval '1 day' WHERE project_id = '${proj}';
  `);

  check('archive_project stamped both children into one group', () =>
    assert.equal(sql(`SELECT count(*) FROM public.documents d JOIN public.projects p
                        ON p.archive_group_id = d.archive_group_id WHERE p.id = '${proj}';`), '2'));

  r = sweep();
  check('the project is purged', () => assert.equal(exists('projects', proj), false));
  check('child 1 goes with it', () => assert.equal(exists('documents', child1), false));
  check('child 2 goes with it', () => assert.equal(exists('documents', child2), false));
  check('run counts one project, not the children separately', () => {
    assert.equal(r.projects_purged, 1);
    assert.equal(r.documents_purged, 0);
  });
  check('both child files are reported orphaned', () =>
    assert.deepEqual([...r.orphaned_paths].sort(), ['proj/c1.pdf', 'proj/c2.pdf']));

  // ════════════════════════════════════════════════════════════════════════
  console.log('\n── Case 4: a shared stored file is never unlinked ──');
  // Two documents point at the same content-addressed object. Purging one must
  // NOT report that path as orphaned, because the other still references it.
  const sharedGone = '40000000-0000-0000-0000-000000000001';
  const sharedKept = '40000000-0000-0000-0000-000000000002';
  sql(`
    INSERT INTO public.documents (id, user_id, name, file_path, user_archived_at, user_archive_expires_at, user_archived_by)
    VALUES ('${sharedGone}', '${OWNER_A}', 'copy-a', 'shared/same.pdf',
            now() - interval '31 days', now() - interval '1 day', '${OWNER_A}');
    INSERT INTO public.documents (id, user_id, name, file_path)
    VALUES ('${sharedKept}', '${OWNER_B}', 'copy-b', 'shared/same.pdf');
  `);

  r = sweep();
  check('the expired copy is purged', () => assert.equal(exists('documents', sharedGone), false));
  check('the surviving copy is untouched', () => assert.equal(exists('documents', sharedKept), true));
  check('the shared file is NOT reported orphaned', () =>
    assert.equal(r.orphaned_paths.includes('shared/same.pdf'), false));
  check('nothing else was unlinked either', () => assert.deepEqual(r.orphaned_paths, []));

  // ════════════════════════════════════════════════════════════════════════
  console.log('\n── Case 5: a child is never purged out from under its parent ──');
  // (a) Child of an ARCHIVED project whose own window has NOT closed: the child
  //     is due on its own, but must wait for the project's group purge.
  const slowProj = '50000000-0000-0000-0000-000000000001';
  const slowChild = '50000000-0000-0000-0000-0000000000c1';
  // (b) Child of a LIVE project: must never be purged, whatever its expiry.
  const liveProj = '50000000-0000-0000-0000-000000000002';
  const orphanRisk = '50000000-0000-0000-0000-0000000000c2';
  sql(`
    INSERT INTO public.projects (id, user_id, name) VALUES ('${slowProj}', '${OWNER_A}', 'slow');
    INSERT INTO public.documents (id, user_id, project_id, name, file_path)
      VALUES ('${slowChild}', '${OWNER_A}', '${slowProj}', 'slow-child', 'slow/c.pdf');
    SELECT set_config('request.jwt.claim.sub', '${OWNER_A}', false);
    SELECT public.archive_project('${slowProj}');
    SELECT set_config('request.jwt.claim.sub', '', false);
    -- Project still has time left; the child is forced past its own window.
    UPDATE public.projects SET user_archive_expires_at = now() + interval '5 days' WHERE id = '${slowProj}';
    UPDATE public.documents SET user_archive_expires_at = now() - interval '1 day' WHERE id = '${slowChild}';

    INSERT INTO public.projects (id, user_id, name) VALUES ('${liveProj}', '${OWNER_A}', 'live-project');
    INSERT INTO public.documents (id, user_id, project_id, name, file_path,
                                  user_archived_at, user_archive_expires_at, user_archived_by)
      VALUES ('${orphanRisk}', '${OWNER_A}', '${liveProj}', 'risky', 'live/c.pdf',
              now() - interval '31 days', now() - interval '1 day', '${OWNER_A}');
  `);

  r = sweep();
  check('child of an archived project is NOT purged individually', () =>
    assert.equal(exists('documents', slowChild), true));
  check('the archived project itself is untouched while in window', () =>
    assert.equal(exists('projects', slowProj), true));
  check('child of a LIVE project is NOT purged', () =>
    assert.equal(exists('documents', orphanRisk), true));
  check('run purged nothing at all', () =>
    assert.equal(r.documents_purged + r.projects_purged + r.templates_purged, 0));
  check('both refusals are recorded as skipped', () => assert.equal(r.skipped, 2));
  check('skip reasons name the cause', () => {
    const reasons = r.details.filter((d) => d.outcome === 'skipped').map((d) => d.reason).sort();
    assert.deepEqual(reasons, ['deferred_to_project_group', 'parent_project_survives']);
  });

  // Once the project's own window closes, the group goes together.
  sql(`UPDATE public.projects SET user_archive_expires_at = now() - interval '1 day' WHERE id = '${slowProj}';`);
  r = sweep();
  check('when the project expires, it and its child purge as one group', () => {
    assert.equal(exists('projects', slowProj), false);
    assert.equal(exists('documents', slowChild), false);
    assert.equal(r.projects_purged, 1);
  });

  // ════════════════════════════════════════════════════════════════════════
  console.log('\n── Case 6: templates ──');
  const tplExpired = '60000000-0000-0000-0000-000000000001';
  const tplLive = '60000000-0000-0000-0000-000000000002';
  sql(`
    INSERT INTO public.templates (id, user_id, name, user_archived_at, user_archive_expires_at, user_archived_by)
    VALUES ('${tplExpired}', '${OWNER_B}', 'old', now() - interval '31 days', now() - interval '1 day', '${OWNER_B}'),
           ('${tplLive}', '${OWNER_B}', 'fresh', now() - interval '2 days', now() + interval '28 days', '${OWNER_B}');
  `);
  r = sweep();
  check('expired template is purged', () => assert.equal(exists('templates', tplExpired), false));
  check('in-window template survives', () => assert.equal(exists('templates', tplLive), true));
  check('template purge is counted', () => assert.equal(r.templates_purged, 1));

  // ════════════════════════════════════════════════════════════════════════
  console.log('\n── Case 7: the batch is bounded ──');
  sql(`
    INSERT INTO public.documents (id, user_id, name, file_path, user_archived_at, user_archive_expires_at, user_archived_by)
    SELECT gen_random_uuid(), '${OWNER_A}', 'bulk-' || i, 'bulk/' || i || '.pdf',
           now() - interval '31 days', now() - (i || ' days')::interval, '${OWNER_A}'
      FROM generate_series(1, 7) AS i;
  `);
  r = sweep(3);
  check('a run never exceeds its batch limit', () => assert.equal(r.documents_purged, 3));
  check('the rest are left for the next run', () =>
    assert.equal(sql(`SELECT count(*) FROM public.documents WHERE name LIKE 'bulk-%';`), '4'));
  check('the next run continues the backlog', () => {
    const next = sweep(3);
    assert.equal(next.documents_purged, 3);
    assert.equal(sql(`SELECT count(*) FROM public.documents WHERE name LIKE 'bulk-%';`), '1');
  });
  check('oldest expiry drains first', () =>
    assert.equal(sql(`SELECT name FROM public.documents WHERE name LIKE 'bulk-%';`), 'bulk-1'));
  check('a garbage limit falls back to the default rather than sweeping everything', () => {
    const clamped = sweep(-5);
    assert.equal(clamped.batch_limit, 50);
  });

  // ════════════════════════════════════════════════════════════════════════
  console.log('\n── Case 8: one bad row does not abort the run ──');
  // A trigger makes one specific document undeletable. The run must record it
  // and still purge its neighbours.
  const poison = '70000000-0000-0000-0000-0000000000ff';
  const neighbourA = '70000000-0000-0000-0000-00000000000a';
  const neighbourB = '70000000-0000-0000-0000-00000000000b';
  sql(`
    INSERT INTO public.documents (id, user_id, name, file_path, user_archived_at, user_archive_expires_at, user_archived_by)
    VALUES ('${poison}', '${OWNER_A}', 'poison', 'p/x.pdf', now() - interval '31 days', now() - interval '3 days', '${OWNER_A}'),
           ('${neighbourA}', '${OWNER_A}', 'nA', 'p/a.pdf', now() - interval '31 days', now() - interval '2 days', '${OWNER_A}'),
           ('${neighbourB}', '${OWNER_A}', 'nB', 'p/b.pdf', now() - interval '31 days', now() - interval '1 day', '${OWNER_A}');

    CREATE FUNCTION public.block_poison() RETURNS trigger LANGUAGE plpgsql AS $t$
    BEGIN
      IF OLD.id = '${poison}' THEN RAISE EXCEPTION 'simulated purge failure'; END IF;
      RETURN OLD;
    END $t$;
    CREATE TRIGGER trg_block_poison BEFORE DELETE ON public.documents
      FOR EACH ROW EXECUTE FUNCTION public.block_poison();
  `);

  r = sweep();
  check('the bad row survives and is recorded as an error', () => {
    assert.equal(exists('documents', poison), true);
    assert.equal(r.failed, 1);
    const err = r.details.find((d) => d.id === poison);
    assert.equal(err.outcome, 'error');
    assert.match(err.error, /simulated purge failure/);
  });
  check('its neighbours still purge in the same run', () => {
    assert.equal(exists('documents', neighbourA), false);
    assert.equal(exists('documents', neighbourB), false);
  });
  check('a wedging row cannot stop later runs making progress', () => {
    sql(`INSERT INTO public.documents (id, user_id, name, file_path, user_archived_at, user_archive_expires_at, user_archived_by)
         VALUES (gen_random_uuid(), '${OWNER_A}', 'after-poison', 'p/c.pdf',
                 now() - interval '31 days', now() - interval '1 day', '${OWNER_A}');`);
    const next = sweep();
    assert.equal(next.documents_purged, 1);
    assert.equal(next.failed, 1);
  });

  sql(`DROP TRIGGER trg_block_poison ON public.documents; DELETE FROM public.documents WHERE id = '${poison}';`);

  // ════════════════════════════════════════════════════════════════════════
  console.log('\n── Case 9: overlapping runs stand down ──');
  // A second session holds the job's advisory lock; the sweep must no-op rather
  // than race it through the same rows.
  const holder = spawn('psql', [...psqlArgs, '-c',
    `SELECT pg_advisory_lock(431431431); SELECT pg_sleep(4);`],
    { cwd: root, env: pgEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  await new Promise((r2) => setTimeout(r2, 1200));
  const contended = sweep();
  check('the contending run stands down instead of double-purging', () => {
    assert.equal(contended.skipped_lock, true);
    assert.equal(contended.documents_purged, 0);
  });
  holder.kill('SIGINT');
  await new Promise((r2) => { holder.on('close', r2); setTimeout(r2, 3000); });

  check('the lock is released after a normal run', () => {
    const after = sweep();
    assert.equal(after.skipped_lock, false);
  });

  // ════════════════════════════════════════════════════════════════════════
  console.log('\n── Case 10: every run is logged ──');
  const runs = Number(sql(`SELECT count(*) FROM public.archive_purge_runs;`));
  check('the run log has a row per run', () => assert.ok(runs >= 10, `expected >=10 runs, got ${runs}`));
  check('finished runs record their outcome', () =>
    assert.equal(sql(`SELECT count(*) FROM public.archive_purge_runs
                       WHERE finished_at IS NULL AND skipped_lock = false;`), '0'));
  check('the log preserves what was purged and why things were skipped', () => {
    const withDetail = Number(sql(`SELECT count(*) FROM public.archive_purge_runs
                                    WHERE jsonb_array_length(details) > 0;`));
    assert.ok(withDetail >= 5, `expected detailed runs, got ${withDetail}`);
    const skipRows = Number(sql(`SELECT count(*) FROM public.archive_purge_runs WHERE skipped_count > 0;`));
    assert.ok(skipRows >= 1, 'a run recorded skipped items');
  });

  // ════════════════════════════════════════════════════════════════════════
  console.log('\n── Case 11: the sweep is not reachable by app clients ──');
  check('authenticated/anon have no EXECUTE on the sweep', () => {
    assert.equal(sql(`SELECT has_function_privilege('authenticated',
      'public.sweep_expired_archives(integer, boolean)', 'EXECUTE');`), 'f');
    assert.equal(sql(`SELECT has_function_privilege('anon',
      'public.sweep_expired_archives(integer, boolean)', 'EXECUTE');`), 'f');
  });
  check('service_role can execute it', () =>
    assert.equal(sql(`SELECT has_function_privilege('service_role',
      'public.sweep_expired_archives(integer, boolean)', 'EXECUTE');`), 't'));
  check('retention still comes from archive_retention_interval()', () =>
    assert.equal(sql(`SELECT public.archive_retention_interval();`), '30 days'));

  // ════════════════════════════════════════════════════════════════════════
  console.log('\n── Case 12: a dry run deletes nothing ──');
  const dryDoc = 'a0000000-0000-0000-0000-000000000001';
  sql(`
    INSERT INTO public.documents (id, user_id, name, file_path, user_archived_at, user_archive_expires_at, user_archived_by)
    VALUES ('${dryDoc}', '${OWNER_A}', 'dry', 'dry/x.pdf',
            now() - interval '31 days', now() - interval '1 day', '${OWNER_A}');
  `);
  const dry = sweep(50, true);
  check('a dry run reports what it would purge', () => {
    assert.equal(dry.dry_run, true);
    assert.equal(dry.documents_purged, 1);
    assert.ok(dry.details.some((d) => d.id === dryDoc && d.outcome === 'would_purge'));
  });
  check('a dry run deletes NOTHING', () => assert.equal(exists('documents', dryDoc), true));
  check('a dry run reports no storage to unlink', () => assert.deepEqual(dry.orphaned_paths, []));
  check('the real run afterwards does purge it', () => {
    const wet = sweep();
    assert.equal(wet.documents_purged, 1);
    assert.equal(exists('documents', dryDoc), false);
  });

  // ════════════════════════════════════════════════════════════════════════
  console.log('\n── Case 13: a project holding a LIVE document is refused ──');
  // KAL-426's purge_archived_project deletes children by project_id with no
  // owner/archived filter, so a collaborator's live document inside an archived
  // project would be destroyed. The sweep must refuse the project entirely.
  const mixedProj = 'b0000000-0000-0000-0000-000000000001';
  const foreignLiveDoc = 'b0000000-0000-0000-0000-0000000000c1';
  sql(`
    INSERT INTO public.projects (id, user_id, name, user_archived_at, user_archive_expires_at, user_archived_by, archive_group_id)
    VALUES ('${mixedProj}', '${OWNER_A}', 'mixed', now() - interval '31 days',
            now() - interval '1 day', '${OWNER_A}', gen_random_uuid());
    -- Another user's document, never archived, sitting in that project.
    INSERT INTO public.documents (id, user_id, project_id, name, file_path)
    VALUES ('${foreignLiveDoc}', '${OWNER_B}', '${mixedProj}', 'collaborator-doc', 'mixed/live.pdf');
  `);
  r = sweep();
  check('the project is NOT purged while it holds a live document', () =>
    assert.equal(exists('projects', mixedProj), true));
  check('the collaborator\'s live document is untouched', () =>
    assert.equal(exists('documents', foreignLiveDoc), true));
  check('the refusal is reported with a reason', () =>
    assert.ok(r.details.some((d) => d.id === mixedProj && d.reason === 'project_holds_live_document')));

  // Once that document is archived too, the group may go.
  sql(`UPDATE public.documents SET user_archived_at = now() - interval '31 days',
         user_archive_expires_at = now() - interval '1 day'
       WHERE id = '${foreignLiveDoc}';`);
  r = sweep();
  check('once nothing live remains, the project purges as one group', () => {
    assert.equal(exists('projects', mixedProj), false);
    assert.equal(exists('documents', foreignLiveDoc), false);
  });

  // ════════════════════════════════════════════════════════════════════════
  console.log('\n── Case 14: a permanently-failing row is quarantined, not a wedge ──');
  // Enough poison rows to fill a small batch. Without quarantine they would be
  // re-selected first (oldest expiry) forever and starve every healthy row.
  sql(`
    INSERT INTO public.documents (id, user_id, name, file_path, user_archived_at, user_archive_expires_at, user_archived_by)
    SELECT gen_random_uuid(), '${OWNER_A}', 'poison-' || i, 'q/p' || i || '.pdf',
           now() - interval '60 days', now() - (30 - i || ' days')::interval, '${OWNER_A}'
      FROM generate_series(1, 2) AS i;
    INSERT INTO public.documents (id, user_id, name, file_path, user_archived_at, user_archive_expires_at, user_archived_by)
    VALUES (gen_random_uuid(), '${OWNER_A}', 'healthy', 'q/h.pdf',
            now() - interval '31 days', now() - interval '1 day', '${OWNER_A}');

    CREATE FUNCTION public.block_poison2() RETURNS trigger LANGUAGE plpgsql AS $t$
    BEGIN
      IF OLD.name LIKE 'poison-%' THEN RAISE EXCEPTION 'permanent failure'; END IF;
      RETURN OLD;
    END $t$;
    CREATE TRIGGER trg_block_poison2 BEFORE DELETE ON public.documents
      FOR EACH ROW EXECUTE FUNCTION public.block_poison2();
  `);

  // Batch of 2 = exactly the poison rows (they are the oldest). The healthy row
  // is starved until quarantine kicks in.
  for (let i = 0; i < 5; i += 1) sweep(2);

  check('the poison rows are quarantined after repeated failures', () =>
    assert.equal(sql(`SELECT count(*) FROM public.archive_purge_failures WHERE attempts >= 5;`), '2'));
  check('the starved healthy row finally purges once they are quarantined', () => {
    const after = sweep(2);
    assert.equal(after.documents_purged, 1);
    assert.equal(sql(`SELECT count(*) FROM public.documents WHERE name = 'healthy';`), '0');
  });
  check('quarantined rows are reported as skipped, not silently dropped', () => {
    const after = sweep(2);
    assert.ok(after.details.some((d) => d.reason === 'quarantined_after_repeated_failure'));
  });
  sql(`DROP TRIGGER trg_block_poison2 ON public.documents;
       DELETE FROM public.archive_purge_failures;
       DELETE FROM public.documents WHERE name LIKE 'poison-%';`);

  // ════════════════════════════════════════════════════════════════════════
  console.log('\n── Case 15: an item re-archived mid-run is not purged early ──');
  // The candidate set is a snapshot. A user can restore and re-archive an item
  // while the run works, resetting its 30-day clock. The sweep must re-verify
  // expiry under a row lock before purging. The trigger below simulates that
  // race deterministically: purging the canary pushes the victim's expiry out.
  const canary = 'c0000000-0000-0000-0000-000000000001';
  const victim = 'c0000000-0000-0000-0000-000000000002';
  sql(`
    INSERT INTO public.documents (id, user_id, name, file_path, user_archived_at, user_archive_expires_at, user_archived_by)
    VALUES ('${canary}', '${OWNER_A}', 'canary', 'r/canary.pdf',
            now() - interval '60 days', now() - interval '10 days', '${OWNER_A}'),
           ('${victim}', '${OWNER_A}', 'victim', 'r/victim.pdf',
            now() - interval '31 days', now() - interval '1 day', '${OWNER_A}');

    CREATE FUNCTION public.simulate_rearchive() RETURNS trigger LANGUAGE plpgsql AS $t$
    BEGIN
      IF OLD.id = '${canary}' THEN
        UPDATE public.documents
           SET user_archived_at = now(), user_archive_expires_at = now() + interval '30 days'
         WHERE id = '${victim}';
      END IF;
      RETURN OLD;
    END $t$;
    CREATE TRIGGER trg_simulate_rearchive BEFORE DELETE ON public.documents
      FOR EACH ROW EXECUTE FUNCTION public.simulate_rearchive();
  `);

  r = sweep();
  check('the canary purges as normal', () => assert.equal(exists('documents', canary), false));
  check('the re-archived item is NOT deleted 30 days early', () =>
    assert.equal(exists('documents', victim), true));
  check('it is reported as no longer due', () =>
    assert.ok(r.details.some((d) => d.id === victim && d.reason === 'no_longer_due')));
  sql(`DROP TRIGGER trg_simulate_rearchive ON public.documents;
       DELETE FROM public.documents WHERE id = '${victim}';`);

  // ════════════════════════════════════════════════════════════════════════
  console.log('\n── Case 16: the advisory lock cannot leak ──');
  check('no advisory lock is held once a run returns', () =>
    assert.equal(sql(`SELECT count(*) FROM pg_locks
                       WHERE locktype = 'advisory' AND objid = 431431431 AND granted;`), '0'));
  check('the batch cap is reported so a backlog is visible', () => {
    sql(`INSERT INTO public.documents (id, user_id, name, file_path, user_archived_at, user_archive_expires_at, user_archived_by)
         SELECT gen_random_uuid(), '${OWNER_A}', 'backlog-' || i, 'bl/' || i || '.pdf',
                now() - interval '31 days', now() - interval '1 day', '${OWNER_A}'
           FROM generate_series(1, 5) AS i;`);
    const capped = sweep(2);
    assert.equal(capped.documents_purged, 2);
    assert.equal(capped.over_limit, 3, 'the remaining backlog is counted');
  });

  console.log(`\n[kal431] ALL ${passed} CHECKS PASSED against real Postgres.`);
} finally {
  spawnSync('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop'], { stdio: 'ignore', timeout: 15000 });
  rmSync(temp, { recursive: true, force: true });
}
