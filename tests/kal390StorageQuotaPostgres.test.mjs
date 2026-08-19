// KAL-390 live proof on a disposable PostgreSQL cluster (same harness style as
// inviteDeliveryPostgres.test.mjs). Bootstraps a minimal Supabase mimic
// (auth.uid(), storage.objects + foldername(), documents, stub tier-limit
// functions with a tiny 100-byte quota), applies the real migration file, and
// proves both halves of the fix:
//   * a documents INSERT with spoofed file_size 0 is REJECTED once real bytes
//     in storage exceed the quota (the old counter-based policy always passed);
//   * a direct storage-API style INSERT into storage.objects is rejected at
//     quota, and allowed while under it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';

const RUN = process.env.SURVEY_POSTGRES_INTEGRATION === '1';
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrationPath = join(
  repoRoot,
  'supabase/migrations/20260817010000_kal390_storage_quota_enforcement.sql',
);
const USER_A = '10000000-0000-4000-8000-00000000000a';
const USER_B = '20000000-0000-4000-8000-00000000000b';

function psqlArgs(port, ...args) {
  return ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', 'postgres', ...args];
}

// A stock macOS dev box inherits a UTF-8 locale that makes the postmaster fail
// at startup with "postmaster became multithreaded during startup". Pinning
// LC_ALL=C for the cluster tools is the documented fix and keeps the harness
// runnable without the caller having to know that.
const PG_ENV = { ...process.env, LC_ALL: 'C' };

function run(file, args, options = {}) {
  return execFileSync(file, args, {
    encoding: 'utf8',
    stdio: options.capture === false ? 'inherit' : 'pipe',
    env: PG_ENV,
    ...options,
  }).trim();
}

async function freePort() {
  const server = createServer();
  await new Promise((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const { port } = server.address();
  await new Promise((resolveClose) => server.close(resolveClose));
  return port;
}

function authSql(userId, sql) {
  return `
    BEGIN;
    SET LOCAL ROLE authenticated;
    SELECT set_config('request.jwt.claim.sub', '${userId}', true);
    ${sql}
    COMMIT;
  `;
}

async function query(port, sql, { allowFailure = false } = {}) {
  const outcome = await new Promise((resolveQuery, rejectQuery) => {
    const child = spawn(
      'psql',
      psqlArgs(port, '-v', 'ON_ERROR_STOP=1', '-Atq', '-c', sql),
      { stdio: ['ignore', 'pipe', 'pipe'], env: PG_ENV },
    );
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => { stdout += chunk; });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    child.once('error', rejectQuery);
    child.once('close', (code) => {
      resolveQuery({ code, stdout, stderr });
    });
  });
  if (outcome.code !== 0) {
    if (allowFailure) return `ERROR:${outcome.stderr}`;
    throw new Error(`psql exited ${outcome.code}: ${outcome.stderr}`);
  }
  return outcome.stdout
    .trim()
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1) || '';
}

// Seed an object as the storage service would (bypassing RLS as table owner).
function seedObjectSql(userId, fileName, sizeBytes) {
  return `
    INSERT INTO storage.objects(bucket_id, name, metadata)
    VALUES ('documents', '${userId}/${fileName}', jsonb_build_object('size', ${sizeBytes}));
  `;
}

test('KAL-390 migration enforces the storage quota against live storage.objects usage', {
  skip: !RUN && 'set SURVEY_POSTGRES_INTEGRATION=1 to run disposable PostgreSQL verification',
  timeout: 90_000,
}, async () => {
  const clusterDir = mkdtempSync(join(tmpdir(), 'survey-kal390-postgres-'));
  const bootstrapPath = join(clusterDir, 'bootstrap.sql');
  const postgresLogPath = join(clusterDir, 'postgres.log');
  const port = await freePort();
  let started = false;

  try {
    run('initdb', ['-D', clusterDir, '-A', 'trust', '-U', 'postgres', '--no-locale']);
    run('pg_ctl', [
      '-D',
      clusterDir,
      '-l',
      postgresLogPath,
      '-o',
      `-p ${port} -h 127.0.0.1`,
      '-w',
      'start',
    ]);
    started = true;

    writeFileSync(bootstrapPath, `
      CREATE EXTENSION IF NOT EXISTS pgcrypto;
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS UUID
      LANGUAGE SQL STABLE
      AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::UUID $$;

      -- Minimal Supabase storage mimic.
      CREATE SCHEMA storage;
      CREATE TABLE storage.objects (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        bucket_id TEXT NOT NULL,
        name TEXT NOT NULL,
        metadata JSONB,
        UNIQUE (bucket_id, name)
      );
      CREATE FUNCTION storage.foldername(name TEXT) RETURNS TEXT[]
      LANGUAGE SQL IMMUTABLE
      AS $$ SELECT (string_to_array(name, '/'))[1 : array_length(string_to_array(name, '/'), 1) - 1] $$;
      ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
      -- Production carries documents_owner_select (20260703030000); the UPDATE
      -- scenarios need it because an UPDATE's WHERE/RETURNING reads rows
      -- through SELECT policies.
      CREATE POLICY documents_owner_select ON storage.objects
        FOR SELECT TO public
        USING (bucket_id = 'documents' AND (storage.foldername(name))[1] = auth.uid()::text);
      GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
      GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated, service_role;

      CREATE TABLE public.documents (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL,
        name TEXT NOT NULL,
        file_path TEXT,
        file_size BIGINT,
        archived BOOLEAN NOT NULL DEFAULT FALSE
      );
      ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
      GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
      GRANT SELECT, INSERT, UPDATE, DELETE ON public.documents TO authenticated, service_role;

      -- Tiny stub quota so the tests stay byte-sized: 100-byte storage limit,
      -- 5-document count cap (the real tier functions are pre-existing prod
      -- code and are not under test here).
      CREATE FUNCTION public.get_storage_limit(p_user_id UUID) RETURNS BIGINT
      LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = ''
      AS $$ SELECT 100::bigint $$;
      CREATE FUNCTION public.get_document_limit(p_user_id UUID) RETURNS INTEGER
      LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = ''
      AS $$ SELECT 5 $$;
    `);

    run('psql', psqlArgs(port, '-v', 'ON_ERROR_STOP=1', '-f', bootstrapPath));
    run('psql', psqlArgs(port, '-v', 'ON_ERROR_STOP=1', '-f', migrationPath));

    // --- Baseline: fresh user under quota can insert a document row and
    //     upload to their own folder.
    assert.equal(
      await query(port, authSql(
        USER_A,
        `INSERT INTO public.documents(user_id, name, file_size) VALUES ('${USER_A}', 'first.pdf', 40) RETURNING 'inserted';`,
      )),
      'inserted',
      'under-quota document insert must pass',
    );
    assert.equal(
      await query(port, authSql(
        USER_A,
        `INSERT INTO storage.objects(bucket_id, name, metadata)
         VALUES ('documents', '${USER_A}/first.pdf', jsonb_build_object('size', 40))
         RETURNING 'uploaded';`,
      )),
      'uploaded',
      'under-quota upload to own folder must pass',
    );

    // --- Direct storage-API upload cannot exceed the quota: 40 used, limit
    //     100, incoming 61 bytes -> 101 > 100 rejected.
    const overUpload = await query(port, authSql(
      USER_A,
      `INSERT INTO storage.objects(bucket_id, name, metadata)
       VALUES ('documents', '${USER_A}/too-big.pdf', jsonb_build_object('size', 61));`,
    ), { allowFailure: true });
    assert.match(overUpload, /^ERROR:[\s\S]*row-level security/, 'over-quota direct upload must be rejected');

    // Exact fit still passes (40 + 60 = 100 <= 100).
    assert.equal(
      await query(port, authSql(
        USER_A,
        `INSERT INTO storage.objects(bucket_id, name, metadata)
         VALUES ('documents', '${USER_A}/exact-fit.pdf', jsonb_build_object('size', 60))
         RETURNING 'uploaded';`,
      )),
      'uploaded',
      'exact-fit upload must pass',
    );

    // --- At-limit user with an unknown-size upload (no metadata, as the
    //     storage service may insert the row before the bytes land) is still
    //     blocked: usage 100 + assumed 1 byte > 100.
    const unknownSize = await query(port, authSql(
      USER_A,
      `INSERT INTO storage.objects(bucket_id, name)
       VALUES ('documents', '${USER_A}/unknown-size.pdf');`,
    ), { allowFailure: true });
    assert.match(unknownSize, /^ERROR:[\s\S]*row-level security/, 'at-limit unknown-size upload must be rejected');

    // --- The spoofed-file_size bypass is closed: USER_A now has 100 real
    //     bytes in storage; a documents INSERT claiming file_size 0 (and one
    //     claiming NULL) must be rejected because live usage is already at the
    //     limit. Under the old counter-based policy both always passed.
    await query(port, seedObjectSql(USER_A, 'seeded-overage.pdf', 10)); // owner-seeded: 110 > 100
    for (const spoof of ['0', 'NULL']) {
      const spoofInsert = await query(port, authSql(
        USER_A,
        `INSERT INTO public.documents(user_id, name, file_size)
         VALUES ('${USER_A}', 'spoofed-${spoof}.pdf', ${spoof});`,
      ), { allowFailure: true });
      assert.match(
        spoofInsert,
        /^ERROR:[\s\S]*row-level security/,
        `document insert with spoofed file_size ${spoof} must be rejected once real storage exceeds the quota`,
      );
    }

    // --- Cross-user isolation is preserved: USER_B is unaffected by USER_A's
    //     usage, and still cannot write into USER_A's folder.
    assert.equal(
      await query(port, authSql(
        USER_B,
        `INSERT INTO storage.objects(bucket_id, name, metadata)
         VALUES ('documents', '${USER_B}/mine.pdf', jsonb_build_object('size', 99))
         RETURNING 'uploaded';`,
      )),
      'uploaded',
      'other users keep their own independent quota',
    );
    const foreignFolder = await query(port, authSql(
      USER_B,
      `INSERT INTO storage.objects(bucket_id, name, metadata)
       VALUES ('documents', '${USER_A}/intruder.pdf', jsonb_build_object('size', 1));`,
    ), { allowFailure: true });
    assert.match(foreignFolder, /^ERROR:[\s\S]*row-level security/, 'foreign-folder upload must stay rejected');

    // --- Deleting bytes frees quota immediately (live sum, no counter drift).
    await query(port, `DELETE FROM storage.objects WHERE bucket_id = 'documents' AND name = '${USER_A}/exact-fit.pdf';`);
    await query(port, `DELETE FROM storage.objects WHERE bucket_id = 'documents' AND name = '${USER_A}/seeded-overage.pdf';`);
    assert.equal(
      await query(port, authSql(
        USER_A,
        `INSERT INTO public.documents(user_id, name, file_size)
         VALUES ('${USER_A}', 'after-delete.pdf', 50) RETURNING 'inserted';`,
      )),
      'inserted',
      'freed storage must immediately allow new documents',
    );

    // --- Review round 2: overwrite growth is delta-gated (the tiny-insert-
    //     then-grow bypass). USER_A currently holds first.pdf at 40 bytes.
    const overwrite = (name, sizeSql) => authSql(
      USER_A,
      `UPDATE storage.objects SET metadata = ${sizeSql}
       WHERE bucket_id = 'documents' AND name = '${USER_A}/${name}'
       RETURNING 'overwritten';`,
    );
    assert.equal(
      await query(port, overwrite('first.pdf', "jsonb_build_object('size', 100)")),
      'overwritten',
      'growing an overwrite to exactly the limit must pass (40 − 40 + 100 = 100)',
    );
    const growPastLimit = await query(port, overwrite('first.pdf', "jsonb_build_object('size', 101)"), { allowFailure: true });
    assert.match(growPastLimit, /^ERROR:[\s\S]*row-level security/, 'growing past the limit via overwrite must be rejected');
    assert.equal(
      await query(port, overwrite('first.pdf', "jsonb_build_object('size', 100)")),
      'overwritten',
      'same-size save at the limit must keep working',
    );
    assert.equal(
      await query(port, overwrite('first.pdf', "jsonb_build_object('size', 10)")),
      'overwritten',
      'shrinking overwrites must always pass',
    );

    // The reported attack shape: mint a tiny object while under quota, then
    // inflate it through the storage API's upsert/UPDATE path.
    assert.equal(
      await query(port, authSql(
        USER_A,
        `INSERT INTO storage.objects(bucket_id, name, metadata)
         VALUES ('documents', '${USER_A}/tiny.pdf', jsonb_build_object('size', 1))
         RETURNING 'uploaded';`,
      )),
      'uploaded',
    );
    const inflate = await query(port, overwrite('tiny.pdf', "jsonb_build_object('size', 95)"), { allowFailure: true });
    assert.match(inflate, /^ERROR:[\s\S]*row-level security/, 'inflating a tiny object past the limit must be rejected (11 − 1 + 95 = 105)');
    assert.equal(
      await query(port, overwrite('tiny.pdf', "jsonb_build_object('size', 89)")),
      'overwritten',
      'growth that stays within the limit must pass (11 − 1 + 89 = 99)',
    );

    // Unknown-size intermediate write counts as "unchanged", not as growth.
    assert.equal(
      await query(port, overwrite('first.pdf', 'NULL')),
      'overwritten',
      'an unknown-size overwrite must be treated as the old size and pass',
    );

    // Self-scoping usage helper: USER_B asking for USER_A's total gets their
    // OWN total instead (mine.pdf = 99) — no cross-user storage disclosure.
    assert.equal(
      await query(port, authSql(
        USER_B,
        `SELECT public.get_actual_storage_usage('${USER_A}');`,
      )),
      '99',
      'authenticated callers must only ever read their own storage total',
    );
  } finally {
    if (started) {
      try {
        run('pg_ctl', ['-D', clusterDir, '-m', 'fast', '-w', 'stop']);
      } catch {
        // Best-effort shutdown; the temporary cluster path is still exact.
      }
    }
    assert.ok(clusterDir.startsWith(`${tmpdir()}/survey-kal390-postgres-`));
    rmSync(clusterDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// KAL-390 follow-up: the byte gate is a TRIGGER, because RLS never sees the
// uploaded object's size. The test above hands the policies a metadata blob
// containing `size`, which the real storage service never does — it checks RLS
// in a probe transaction carrying only {mimetype, contentLength} and then
// writes the real size through a privileged connection that bypasses RLS
// entirely. This test models that split faithfully.
// ---------------------------------------------------------------------------
const triggerMigrationPath = join(
  repoRoot,
  'supabase/migrations/20260818010000_kal390_storage_quota_trigger.sql',
);

// What the storage service's RLS permission probe actually looks like: no
// `size` key, only the declared content length.
function probeSql(userId, fileName, contentLength) {
  return authSql(
    userId,
    `INSERT INTO storage.objects(bucket_id, name, metadata)
     VALUES ('documents', '${userId}/${fileName}',
             jsonb_build_object('mimetype', 'application/pdf', 'contentLength', ${contentLength}))
     RETURNING 'probed';`,
  );
}

// What the storage service's completeUpload actually does: a privileged upsert
// carrying the backend-reported size. No RLS applies on this path.
function serviceUpsertSql(userId, fileName, sizeBytes) {
  return `
    INSERT INTO storage.objects(bucket_id, name, metadata)
    VALUES ('documents', '${userId}/${fileName}', jsonb_build_object('size', ${sizeBytes}))
    ON CONFLICT (bucket_id, name)
    DO UPDATE SET metadata = jsonb_build_object('size', ${sizeBytes})
    RETURNING 'stored';
  `;
}

test('KAL-390 trigger gates the privileged write that RLS never sees', {
  skip: !RUN && 'set SURVEY_POSTGRES_INTEGRATION=1 to run disposable PostgreSQL verification',
  timeout: 90_000,
}, async () => {
  const clusterDir = mkdtempSync(join(tmpdir(), 'survey-kal390-postgres-'));
  const bootstrapPath = join(clusterDir, 'bootstrap.sql');
  const postgresLogPath = join(clusterDir, 'postgres.log');
  const port = await freePort();
  let started = false;

  try {
    run('initdb', ['-D', clusterDir, '-A', 'trust', '-U', 'postgres', '--no-locale']);
    run('pg_ctl', [
      '-D', clusterDir, '-l', postgresLogPath, '-o', `-p ${port} -h 127.0.0.1`, '-w', 'start',
    ]);
    started = true;

    writeFileSync(bootstrapPath, `
      CREATE EXTENSION IF NOT EXISTS pgcrypto;
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS UUID
      LANGUAGE SQL STABLE
      AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::UUID $$;

      CREATE SCHEMA storage;
      CREATE TABLE storage.objects (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        bucket_id TEXT NOT NULL,
        name TEXT NOT NULL,
        metadata JSONB,
        UNIQUE (bucket_id, name)
      );
      CREATE FUNCTION storage.foldername(name TEXT) RETURNS TEXT[]
      LANGUAGE SQL IMMUTABLE
      AS $$ SELECT (string_to_array(name, '/'))[1 : array_length(string_to_array(name, '/'), 1) - 1] $$;
      ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
      CREATE POLICY documents_owner_select ON storage.objects
        FOR SELECT TO public
        USING (bucket_id = 'documents' AND (storage.foldername(name))[1] = auth.uid()::text);
      GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
      GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated, service_role;

      CREATE TABLE public.documents (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL,
        name TEXT NOT NULL,
        file_path TEXT,
        file_size BIGINT,
        archived BOOLEAN NOT NULL DEFAULT FALSE
      );
      ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
      GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
      GRANT SELECT, INSERT, UPDATE, DELETE ON public.documents TO authenticated, service_role;

      CREATE FUNCTION public.get_storage_limit(p_user_id UUID) RETURNS BIGINT
      LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = ''
      AS $$ SELECT 100::bigint $$;
      CREATE FUNCTION public.get_document_limit(p_user_id UUID) RETURNS INTEGER
      LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = ''
      AS $$ SELECT 5 $$;
    `);

    run('psql', psqlArgs(port, '-v', 'ON_ERROR_STOP=1', '-f', bootstrapPath));
    run('psql', psqlArgs(port, '-v', 'ON_ERROR_STOP=1', '-f', migrationPath));
    run('psql', psqlArgs(port, '-v', 'ON_ERROR_STOP=1', '-f', triggerMigrationPath));

    const usage = async (userId) => query(
      port,
      `SELECT COALESCE(SUM((metadata->>'size')::bigint), 0) FROM storage.objects
       WHERE bucket_id = 'documents' AND name LIKE '${userId}/%';`,
    );

    // --- The RLS permission probe (no `size` key) must never be blocked by the
    //     trigger: it is a size-neutral write.
    assert.equal(await query(port, probeSql(USER_A, 'probe.pdf', 40)), 'probed',
      'the storage service permission probe must pass the trigger');
    await query(port, `DELETE FROM storage.objects WHERE bucket_id='documents' AND name='${USER_A}/probe.pdf';`);

    // --- Fill to exactly the limit through the privileged service path.
    assert.equal(await query(port, serviceUpsertSql(USER_A, 'a.pdf', 60)), 'stored');
    assert.equal(await query(port, serviceUpsertSql(USER_A, 'b.pdf', 40)), 'stored');
    assert.equal(await usage(USER_A), '100', 'user must be exactly at the 100-byte limit');

    // --- Case 1: same-size overwrite at exactly the limit must still save.
    assert.equal(await query(port, serviceUpsertSql(USER_A, 'b.pdf', 40)), 'stored',
      'same-size overwrite at the limit must keep working');
    assert.equal(await usage(USER_A), '100');

    // --- Case 2: shrinking overwrite must always pass.
    assert.equal(await query(port, serviceUpsertSql(USER_A, 'b.pdf', 10)), 'stored',
      'shrinking overwrite must pass');
    assert.equal(await usage(USER_A), '70');

    // --- Case 3: growth that still fits must pass (70 - 10 + 40 = 100).
    assert.equal(await query(port, serviceUpsertSql(USER_A, 'b.pdf', 40)), 'stored',
      'growth that fits inside the limit must pass');
    assert.equal(await usage(USER_A), '100');

    // --- Case 4: growth past the limit is REJECTED. This is the reported
    //     bypass: it passed every RLS policy because RLS cannot see the size.
    const grewPastLimit = await query(port, serviceUpsertSql(USER_A, 'b.pdf', 41), { allowFailure: true });
    assert.match(grewPastLimit, /^ERROR:[\s\S]*Storage quota exceeded/,
      'growing an object past the limit must be rejected by the trigger');
    assert.equal(await usage(USER_A), '100', 'a rejected growth must not change usage');

    // --- The exact attack shape: a tiny object minted under quota, then
    //     inflated through the upsert path.
    assert.equal(await query(port, serviceUpsertSql(USER_A, 'b.pdf', 10)), 'stored');
    assert.equal(await query(port, serviceUpsertSql(USER_A, 'tiny.pdf', 1)), 'stored');
    assert.equal(await usage(USER_A), '71');
    const inflated = await query(port, serviceUpsertSql(USER_A, 'tiny.pdf', 60), { allowFailure: true });
    assert.match(inflated, /^ERROR:[\s\S]*Storage quota exceeded/,
      'inflating a tiny object past the limit must be rejected (70 + 60 = 130)');
    assert.equal(await usage(USER_A), '71', 'the inflation attempt must leave usage untouched');

    // --- Case 5: a brand-new object once the account is at its limit.
    assert.equal(await query(port, serviceUpsertSql(USER_A, 'tiny.pdf', 30)), 'stored');
    assert.equal(await usage(USER_A), '100');
    const brandNew = await query(port, serviceUpsertSql(USER_A, 'new.pdf', 5), { allowFailure: true });
    assert.match(brandNew, /^ERROR:[\s\S]*Storage quota exceeded/,
      'a new object at the limit must be rejected');

    // --- An over-quota account must still be able to save and shrink. The
    //     superseded UPDATE policy blocked EVERY overwrite in this state, which
    //     locked such accounts out of saving entirely. The realistic way to get
    //     here is a tier downgrade: the bytes are already stored, then the
    //     allowance shrinks under them.
    assert.equal(await usage(USER_A), '100');
    await query(port, `CREATE OR REPLACE FUNCTION public.get_storage_limit(p_user_id UUID) RETURNS BIGINT
                       LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = ''
                       AS $$ SELECT 50::bigint $$;`);
    assert.equal(await query(port, serviceUpsertSql(USER_A, 'b.pdf', 10)), 'stored',
      'an over-quota account must still be able to re-save at the same size');
    assert.equal(await query(port, serviceUpsertSql(USER_A, 'a.pdf', 20)), 'stored',
      'an over-quota account must still be able to shrink');
    assert.equal(await usage(USER_A), '60', 'shrinking must actually reduce usage');
    const overQuotaGrowth = await query(port, serviceUpsertSql(USER_A, 'a.pdf', 25), { allowFailure: true });
    assert.match(overQuotaGrowth, /^ERROR:[\s\S]*Storage quota exceeded/,
      'an over-quota account still must not grow an object');
    await query(port, `CREATE OR REPLACE FUNCTION public.get_storage_limit(p_user_id UUID) RETURNS BIGINT
                       LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = ''
                       AS $$ SELECT 100::bigint $$;`);

    // --- Cross-user isolation: USER_B has an independent allowance.
    assert.equal(await query(port, serviceUpsertSql(USER_B, 'mine.pdf', 99)), 'stored',
      'other users keep their own independent quota');

    // --- Buckets other than `documents` are not metered at all.
    assert.equal(
      await query(port, `
        INSERT INTO storage.objects(bucket_id, name, metadata)
        VALUES ('brand', '${USER_A}/logo.png', jsonb_build_object('size', 999999))
        RETURNING 'stored';`),
      'stored',
      'the gate must only meter the documents bucket',
    );

    // --- An object path with no UUID folder cannot be attributed to an owner
    //     and must pass through rather than error.
    assert.equal(
      await query(port, `
        INSERT INTO storage.objects(bucket_id, name, metadata)
        VALUES ('documents', 'shared/thing.pdf', jsonb_build_object('size', 999999))
        RETURNING 'stored';`),
      'stored',
      'an unattributable path must not raise',
    );
  } finally {
    if (started) {
      try {
        run('pg_ctl', ['-D', clusterDir, '-m', 'fast', '-w', 'stop']);
      } catch {
        // Best-effort shutdown; the temporary cluster path is still exact.
      }
    }
    assert.ok(clusterDir.startsWith(`${tmpdir()}/survey-kal390-postgres-`));
    rmSync(clusterDir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// KAL-390 final: the documents INSERT policy's client-supplied file_size term,
// and the legacy display counter.
//
// This test applies the three migrations PROGRESSIVELY in one cluster so the
// before/after is proved on the same data, not asserted:
//   1. after 20260817010000 + 20260818010000 — reproduce the two defects;
//   2. apply 20260819010000 — show both are gone and nothing else moved.
// ---------------------------------------------------------------------------
const groundTruthMigrationPath = join(
  repoRoot,
  'supabase/migrations/20260819010000_kal390_usage_meter_ground_truth.sql',
);

test('KAL-390 ground truth: documents policy and the display counter stop trusting the client', {
  skip: !RUN && 'set SURVEY_POSTGRES_INTEGRATION=1 to run disposable PostgreSQL verification',
  timeout: 90_000,
}, async () => {
  const clusterDir = mkdtempSync(join(tmpdir(), 'survey-kal390-postgres-'));
  const bootstrapPath = join(clusterDir, 'bootstrap.sql');
  const postgresLogPath = join(clusterDir, 'postgres.log');
  const port = await freePort();
  let started = false;

  try {
    run('initdb', ['-D', clusterDir, '-A', 'trust', '-U', 'postgres', '--no-locale']);
    run('pg_ctl', [
      '-D', clusterDir, '-l', postgresLogPath, '-o', `-p ${port} -h 127.0.0.1`, '-w', 'start',
    ]);
    started = true;

    writeFileSync(bootstrapPath, `
      CREATE EXTENSION IF NOT EXISTS pgcrypto;
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE ROLE service_role NOLOGIN;
      CREATE SCHEMA auth;
      CREATE FUNCTION auth.uid() RETURNS UUID
      LANGUAGE SQL STABLE
      AS $$ SELECT nullif(current_setting('request.jwt.claim.sub', true), '')::UUID $$;

      CREATE SCHEMA storage;
      CREATE TABLE storage.objects (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        bucket_id TEXT NOT NULL,
        name TEXT NOT NULL,
        metadata JSONB,
        UNIQUE (bucket_id, name)
      );
      CREATE FUNCTION storage.foldername(name TEXT) RETURNS TEXT[]
      LANGUAGE SQL IMMUTABLE
      AS $$ SELECT (string_to_array(name, '/'))[1 : array_length(string_to_array(name, '/'), 1) - 1] $$;
      ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
      CREATE POLICY documents_owner_select ON storage.objects
        FOR SELECT TO public
        USING (bucket_id = 'documents' AND (storage.foldername(name))[1] = auth.uid()::text);
      GRANT USAGE ON SCHEMA storage TO anon, authenticated, service_role;
      GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated, service_role;

      CREATE TABLE public.documents (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL,
        name TEXT NOT NULL,
        file_path TEXT,
        file_size BIGINT,
        archived BOOLEAN NOT NULL DEFAULT FALSE
      );
      ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
      -- Production lets a user read their own documents. Without a SELECT
      -- policy the count-cap subquery inside the INSERT policy's WITH CHECK
      -- sees zero rows for everyone and the cap can never bite, so the cap
      -- regression assertion below would pass vacuously.
      CREATE POLICY documents_owner_select ON public.documents
        FOR SELECT TO public USING (user_id = auth.uid());

      -- The legacy display counter (20241223000001). Its documents-table
      -- triggers are not replayed here: what matters is that the column can
      -- hold a value unrelated to storage, which is exactly its production
      -- state (measured 38.6% low on 2026-08-19).
      CREATE TABLE public.user_subscriptions (
        user_id UUID PRIMARY KEY,
        storage_used_bytes BIGINT DEFAULT 0
      );

      GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
      GRANT SELECT, INSERT, UPDATE, DELETE ON public.documents TO authenticated, service_role;
      GRANT SELECT ON public.user_subscriptions TO authenticated, service_role;

      CREATE FUNCTION public.get_storage_limit(p_user_id UUID) RETURNS BIGINT
      LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = ''
      AS $$ SELECT 100::bigint $$;
      CREATE FUNCTION public.get_document_limit(p_user_id UUID) RETURNS INTEGER
      LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = ''
      AS $$ SELECT 5 $$;
    `);

    run('psql', psqlArgs(port, '-v', 'ON_ERROR_STOP=1', '-f', bootstrapPath));
    run('psql', psqlArgs(port, '-v', 'ON_ERROR_STOP=1', '-f', migrationPath));
    run('psql', psqlArgs(port, '-v', 'ON_ERROR_STOP=1', '-f', triggerMigrationPath));

    const docRow = (userId, name, fileSizeSql) => authSql(
      userId,
      `INSERT INTO public.documents(user_id, name, file_size)
       VALUES ('${userId}', '${name}', ${fileSizeSql}) RETURNING 'inserted';`,
    );

    // =====================================================================
    // BEFORE 20260819010000
    // =====================================================================

    // --- Defect 1: the bytes-first upload paths (new-project bulk upload and
    //     document copy in src/Dashboard.jsx) put the object in storage BEFORE
    //     inserting the documents row, so live usage already includes the file
    //     and `usage + file_size` counts it twice.
    //
    //     30 bytes held, a 40-byte file copied in. The trigger accepts the
    //     bytes (0 other + 40 <= 100, total 70 of 100 — well inside quota).
    await query(port, seedObjectSql(USER_A, 'held.pdf', 30));
    await query(port, seedObjectSql(USER_A, 'copied.pdf', 40));
    assert.equal(
      await query(port, authSql(USER_A, `SELECT public.get_actual_storage_usage('${USER_A}');`)),
      '70',
      'the user is at 70 of 100 bytes — comfortably inside their allowance',
    );
    const doubleCounted = await query(port, docRow(USER_A, 'copied.pdf', '40'), { allowFailure: true });
    assert.match(
      doubleCounted,
      /^ERROR:[\s\S]*row-level security/,
      'BEFORE: the row for already-stored bytes is falsely rejected — 70 + 40 = 110 > 100 double-counts the incoming file',
    );

    // --- Defect 2: the outcome of the clause is CHOSEN BY THE CLIENT. Same
    //     account, same real file — only the declared number differs.
    //     (Note this is not a byte bypass: the trigger from 20260818010000
    //     meters the real bytes. It is a clause that looks like enforcement
    //     and enforces nothing an attacker cannot opt out of.)
    await query(port, `DELETE FROM public.documents;`);
    await query(port, `DELETE FROM storage.objects WHERE bucket_id='documents' AND name='${USER_A}/copied.pdf';`);
    assert.equal(
      await query(port, authSql(USER_A, `SELECT public.get_actual_storage_usage('${USER_A}');`)),
      '30',
      'reset to 30 of 100 bytes held',
    );
    const honest = await query(port, docRow(USER_A, 'ninety.pdf', '90'), { allowFailure: true });
    assert.match(
      honest,
      /^ERROR:[\s\S]*row-level security/,
      'BEFORE: an honest client declaring the real 90 bytes is rejected (30 + 90 = 120 > 100)',
    );
    assert.equal(
      await query(port, docRow(USER_A, 'ninety.pdf', '0')),
      'inserted',
      'BEFORE: the SAME file declared as 0 bytes is accepted — the clause is whatever the caller says it is',
    );

    // =====================================================================
    // APPLY 20260819010000
    // =====================================================================
    run('psql', psqlArgs(port, '-v', 'ON_ERROR_STOP=1', '-f', groundTruthMigrationPath));

    // Reset to the bytes-first scenario: 70 of 100 held.
    await query(port, `DELETE FROM public.documents;`);
    await query(port, `DELETE FROM storage.objects WHERE bucket_id = 'documents';`);
    await query(port, seedObjectSql(USER_A, 'held.pdf', 30));
    await query(port, seedObjectSql(USER_A, 'copied.pdf', 40));

    // --- Defect 1 fixed: the row for bytes that are already stored is accepted.
    assert.equal(
      await query(port, docRow(USER_A, 'copied.pdf', '40')),
      'inserted',
      'AFTER: a bytes-first save inside the allowance is no longer double-counted',
    );

    // --- The `<=` boundary. Fill to EXACTLY the limit through the privileged
    //     service path (the trigger allows it: other + new <= limit), then
    //     insert the row. `<` here would orphan those bytes.
    await query(port, seedObjectSql(USER_A, 'exact.pdf', 30)); // 100 of 100
    assert.equal(
      await query(port, authSql(USER_A, `SELECT public.get_actual_storage_usage('${USER_A}');`)),
      '100',
    );
    assert.equal(
      await query(port, docRow(USER_A, 'exact.pdf', '30')),
      'inserted',
      'a row must never be refused for bytes the trigger just accepted (usage == limit)',
    );

    // --- Defect 2 fixed: the declared number no longer changes the outcome.
    //     Reset to 30 of 100 held and repeat the pair from the BEFORE section:
    //     both declarations must now agree, because neither is consulted.
    await query(port, `DELETE FROM public.documents;`);
    await query(port, `DELETE FROM storage.objects WHERE bucket_id = 'documents';`);
    await query(port, seedObjectSql(USER_A, 'held.pdf', 30));
    for (const declared of ['90', '0', 'NULL']) {
      assert.equal(
        await query(port, docRow(USER_A, `declared-${declared}.pdf`, declared)),
        'inserted',
        `AFTER: declared file_size ${declared} must not change the decision for an in-allowance account`,
      );
    }
    // and the bytes those rows describe are still refused by the real gate.
    const realBytes = await query(port, `
      INSERT INTO storage.objects(bucket_id, name, metadata)
      VALUES ('documents', '${USER_A}/declared-0.pdf', jsonb_build_object('size', 90))
      RETURNING 'stored';`, { allowFailure: true });
    assert.match(
      realBytes,
      /^ERROR:[\s\S]*Storage quota exceeded/,
      'the trigger, not the documents policy, is what stops the 90 bytes (30 + 90 = 120 > 100)',
    );

    // --- The unspoofable floor: once the account is genuinely over its
    //     allowance, no declared file_size gets a new row through.
    //     An over-allowance account is a real state (legacy overage, tier
    //     downgrade) that the trigger will not let us create by uploading, so
    //     plant it the only way it can occur — behind the gate.
    await query(port, `DELETE FROM public.documents;`);
    await query(port, `ALTER TABLE storage.objects DISABLE TRIGGER enforce_documents_storage_quota;`);
    await query(port, seedObjectSql(USER_A, 'overage.pdf', 115)); // 145 of 100
    await query(port, `ALTER TABLE storage.objects ENABLE TRIGGER enforce_documents_storage_quota;`);
    assert.equal(
      await query(port, authSql(USER_A, `SELECT public.get_actual_storage_usage('${USER_A}');`)),
      '145',
      'the account is genuinely over its allowance',
    );
    for (const spoof of ['0', 'NULL', '1']) {
      const spoofed = await query(port, docRow(USER_A, `spoofed-${spoof}.pdf`, spoof), { allowFailure: true });
      assert.match(
        spoofed,
        /^ERROR:[\s\S]*row-level security/,
        `AFTER: file_size ${spoof} must not get a document row past an over-allowance account`,
      );
    }

    // --- The count cap is untouched and still enforced. Clear the overage so
    //     the storage clause passes, then add rows up to the 5-document cap.
    await query(port, `DELETE FROM storage.objects WHERE bucket_id='documents' AND name='${USER_A}/overage.pdf';`);
    await query(port, `DELETE FROM public.documents;`);
    for (let i = 0; i < 5; i += 1) {
      assert.equal(
        await query(port, docRow(USER_A, `capped-${i}.pdf`, '1')),
        'inserted',
        `document ${i + 1} of the 5-document cap must be allowed`,
      );
    }
    const overCount = await query(port, docRow(USER_A, 'sixth.pdf', '1'), { allowFailure: true });
    assert.match(overCount, /^ERROR:[\s\S]*row-level security/, 'the document COUNT cap must still bite');

    // --- The trigger is still the byte gate, unchanged by this migration.
    //     USER_A now holds only held.pdf at 30 bytes.
    const grow = await query(port, `
      INSERT INTO storage.objects(bucket_id, name, metadata)
      VALUES ('documents', '${USER_A}/held.pdf', jsonb_build_object('size', 101))
      ON CONFLICT (bucket_id, name) DO UPDATE SET metadata = jsonb_build_object('size', 101)
      RETURNING 'stored';`, { allowFailure: true });
    assert.match(
      grow,
      /^ERROR:[\s\S]*Storage quota exceeded/,
      'the trigger must still refuse growth past the limit (0 other + 101 > 100)',
    );
    assert.equal(
      await query(port, authSql(USER_A, `SELECT public.get_actual_storage_usage('${USER_A}');`)),
      '30',
      'a refused growth must leave usage untouched',
    );

    // --- Cross-user isolation survives: USER_B is unaffected by USER_A and can
    //     still store bytes and create rows.
    await query(port, seedObjectSql(USER_B, 'theirs.pdf', 25));
    assert.equal(
      await query(port, docRow(USER_B, 'theirs.pdf', '0')),
      'inserted',
      'another user must not be blocked by USER_A usage',
    );

    // =====================================================================
    // The legacy display counter's reconciliation path
    // =====================================================================
    await query(port, `
      INSERT INTO public.user_subscriptions(user_id, storage_used_bytes)
      VALUES ('${USER_A}', 999999), ('${USER_B}', 888888);`);

    const counter = (userId) => query(
      port,
      `SELECT storage_used_bytes FROM public.user_subscriptions WHERE user_id = '${userId}';`,
    );
    const liveBytes = async (userId) => query(
      port,
      `SELECT COALESCE(SUM((metadata->>'size')::bigint), 0) FROM storage.objects
       WHERE bucket_id = 'documents' AND name LIKE '${userId}/%';`,
    );

    // --- recalculate_user_storage now writes GROUND TRUTH, not
    //     SUM(documents.file_size). The two differ here — USER_A's five
    //     documents rows claim 5 bytes between them while storage really holds
    //     30 — so this assertion can only pass if it read storage.objects.
    //     (That divergence is the production condition in miniature: counter
    //     329,468,006 vs 536,536,186 real bytes, measured 2026-08-19.)
    assert.equal(
      await query(port, `SELECT COALESCE(SUM(file_size), 0) FROM public.documents WHERE user_id = '${USER_A}';`),
      '5',
      'the documents rows claim 5 bytes',
    );
    assert.equal(await liveBytes(USER_A), '30', 'storage really holds 30 bytes');
    assert.equal(
      await query(port, authSql(USER_A, `SELECT public.recalculate_user_storage('${USER_A}');`)),
      '30',
      'reconciliation must return live storage bytes, not the documents sum',
    );
    assert.equal(await counter(USER_A), '30', 'and must write that value to the counter');

    // --- Self-scoping: USER_B asking to reconcile USER_A reconciles their OWN
    //     row instead (25 bytes, not USER_A's 30). USER_A's counter must not move.
    assert.equal(await liveBytes(USER_B), '25');
    assert.equal(
      await query(port, authSql(USER_B, `SELECT public.recalculate_user_storage('${USER_A}');`)),
      '25',
      'an authenticated caller always reconciles their own row',
    );
    assert.equal(await counter(USER_A), '30', "USER_B must not have rewritten USER_A's counter");
    assert.equal(await counter(USER_B), '25', 'USER_B reconciled their own row instead');

    // --- Whole-table maintenance is no longer reachable by an end user.
    const allAsUser = await query(
      port,
      authSql(USER_B, `SELECT * FROM public.recalculate_all_user_storage();`),
      { allowFailure: true },
    );
    assert.match(
      allAsUser,
      /^ERROR:[\s\S]*permission denied/,
      'authenticated must not be able to rewrite every user\'s counter',
    );

    // --- but still works for the service role, and covers users whose objects
    //     have no documents row at all (invisible to the old documents-sum
    //     version).
    await query(port, `UPDATE public.user_subscriptions SET storage_used_bytes = 424242;`);
    await query(port, `SET ROLE service_role; SELECT * FROM public.recalculate_all_user_storage(); RESET ROLE;`);
    assert.equal(await counter(USER_A), await liveBytes(USER_A), 'service-role reconciliation must write truth for USER_A');
    assert.equal(await counter(USER_B), await liveBytes(USER_B), 'service-role reconciliation must write truth for USER_B');
  } finally {
    if (started) {
      try {
        run('pg_ctl', ['-D', clusterDir, '-m', 'fast', '-w', 'stop']);
      } catch {
        // Best-effort shutdown; the temporary cluster path is still exact.
      }
    }
    assert.ok(clusterDir.startsWith(`${tmpdir()}/survey-kal390-postgres-`));
    rmSync(clusterDir, { recursive: true, force: true });
  }
});
