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

function run(file, args, options = {}) {
  return execFileSync(file, args, {
    encoding: 'utf8',
    stdio: options.capture === false ? 'inherit' : 'pipe',
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
      { stdio: ['ignore', 'pipe', 'pipe'] },
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
