import test from 'node:test';
import assert from 'node:assert/strict';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync, spawn } from 'node:child_process';
const RUN = process.env.SURVEY_POSTGRES_INTEGRATION === '1';
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrationPath = join(
  repoRoot,
  'supabase/migrations/20260728010000_atomic_invite_email_delivery.sql',
);
const OWNER_ID = '10000000-0000-4000-8000-000000000001';
const OTHER_ID = '20000000-0000-4000-8000-000000000002';

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

function uuidFor(kindIndex, attemptIndex) {
  return `${String(kindIndex + 3).padStart(8, '0')}-0000-4000-8000-${String(attemptIndex + 1).padStart(12, '0')}`;
}

test('invite delivery migration executes on PostgreSQL and serializes authenticated claims', {
  skip: !RUN && 'set SURVEY_POSTGRES_INTEGRATION=1 to run disposable PostgreSQL verification',
  timeout: 90_000,
}, async () => {
  const clusterDir = mkdtempSync(join(tmpdir(), 'survey-invite-postgres-'));
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

      CREATE TABLE public.test_invite_owners (
        kind TEXT NOT NULL,
        entity_id UUID NOT NULL,
        user_id UUID NOT NULL,
        PRIMARY KEY (kind, entity_id, user_id)
      );
      CREATE FUNCTION public.user_can_access_document(entity_id UUID, needed_role TEXT)
      RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = ''
      AS $$ SELECT EXISTS (
        SELECT 1 FROM public.test_invite_owners
        WHERE kind = 'document' AND test_invite_owners.entity_id = $1
          AND user_id = auth.uid()
      ) $$;
      CREATE FUNCTION public.user_can_access_project(entity_id UUID, needed_role TEXT)
      RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = ''
      AS $$ SELECT EXISTS (
        SELECT 1 FROM public.test_invite_owners
        WHERE kind = 'project' AND test_invite_owners.entity_id = $1
          AND user_id = auth.uid()
      ) $$;
      CREATE FUNCTION public.user_can_access_template(entity_id UUID, needed_role TEXT)
      RETURNS BOOLEAN LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = ''
      AS $$ SELECT EXISTS (
        SELECT 1 FROM public.test_invite_owners
        WHERE kind = 'template' AND test_invite_owners.entity_id = $1
          AND user_id = auth.uid()
      ) $$;

      CREATE TABLE public.document_invites (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        document_id UUID NOT NULL,
        token TEXT NOT NULL UNIQUE,
        target_email TEXT,
        expires_at TIMESTAMPTZ NOT NULL,
        revoked_at TIMESTAMPTZ,
        accepted_at TIMESTAMPTZ
      );
      CREATE TABLE public.project_invites (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        project_id UUID NOT NULL,
        token TEXT NOT NULL UNIQUE,
        target_email TEXT,
        expires_at TIMESTAMPTZ NOT NULL,
        revoked_at TIMESTAMPTZ,
        accepted_at TIMESTAMPTZ
      );
      CREATE TABLE public.template_invites (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        template_id UUID NOT NULL,
        token TEXT NOT NULL UNIQUE,
        target_email TEXT,
        expires_at TIMESTAMPTZ NOT NULL,
        revoked_at TIMESTAMPTZ,
        accepted_at TIMESTAMPTZ
      );
    `);

    run('psql', psqlArgs(port, '-v', 'ON_ERROR_STOP=1', '-f', bootstrapPath));
    run('psql', psqlArgs(port, '-v', 'ON_ERROR_STOP=1', '-f', migrationPath));

    const kinds = ['document', 'project', 'template'];
    for (const [kindIndex, kind] of kinds.entries()) {
      const entityId = `${String(kindIndex + 1).padStart(8, '0')}-0000-4000-8000-000000000001`;
      const inviteId = `${String(kindIndex + 6).padStart(8, '0')}-0000-4000-8000-000000000001`;
      const token = `postgres-${kind}-token`;
      const entityColumn = `${kind}_id`;
      await query(port, `
        INSERT INTO public.test_invite_owners(kind, entity_id, user_id)
        VALUES ('${kind}', '${entityId}', '${OWNER_ID}');
        INSERT INTO public.${kind}_invites(
          id, ${entityColumn}, token, target_email, expires_at
        ) VALUES (
          '${inviteId}', '${entityId}', '${token}', 'bot@example.test', now() + interval '7 days'
        );
      `);

      const claimIds = Array.from({ length: 12 }, (_, attemptIndex) => uuidFor(kindIndex, attemptIndex));
      const results = await Promise.all(claimIds.map((claimId) => query(
        port,
        authSql(
          OWNER_ID,
          `SELECT public.claim_invite_email_delivery('${kind}', '${token}', '${claimId}', 30);`,
        ),
      )));
      assert.equal(results.filter((value) => value === 'claimed').length, 1, `${kind}: exactly one claimant`);
      assert.equal(results.filter((value) => value === 'busy').length, 11, `${kind}: all competing claims stay busy`);

      const winningClaim = claimIds[results.indexOf('claimed')];
      assert.equal(
        await query(port, authSql(
          OWNER_ID,
          `SELECT public.complete_invite_email_delivery('${winningClaim}');`,
        )),
        't',
      );
      assert.equal(
        await query(port, authSql(
          OWNER_ID,
          `SELECT public.claim_invite_email_delivery('${kind}', '${token}', '${uuidFor(kindIndex, 20)}', 30);`,
        )),
        'completed',
        `${kind}: completed generation is idempotent`,
      );

      await query(port, `
        UPDATE public.${kind}_invites
        SET expires_at = now() + interval '14 days'
        WHERE id = '${inviteId}';
      `);
      assert.equal(
        await query(port, authSql(
          OWNER_ID,
          `SELECT public.claim_invite_email_delivery('${kind}', '${token}', '${uuidFor(kindIndex, 21)}', 30);`,
        )),
        'completed',
        `${kind}: expiry refresh does not create another send generation`,
      );

      const rotate = await query(port, authSql(
        OWNER_ID,
        `SELECT public.rotate_invite_email_delivery('${kind}', '${inviteId}') IS NOT NULL;`,
      ));
      assert.equal(rotate, 't', `${kind}: owner can explicitly rotate delivery`);
      assert.equal(
        await query(port, authSql(
          OWNER_ID,
          `SELECT public.claim_invite_email_delivery('${kind}', '${token}', '${uuidFor(kindIndex, 22)}', 30);`,
        )),
        'claimed',
        `${kind}: explicit rotation creates exactly one new generation`,
      );
    }

    assert.equal(
      await query(port, authSql(
        OTHER_ID,
        "SELECT public.claim_invite_email_delivery('document', 'postgres-document-token', '90000000-0000-4000-8000-000000000001', 30);",
      )),
      'error',
      'non-owner cannot claim a delivery',
    );

    const directRead = await query(
      port,
      authSql(OWNER_ID, 'SELECT count(*) FROM public.invite_email_deliveries;'),
      { allowFailure: true },
    );
    assert.match(directRead, /^ERROR:/, 'authenticated callers cannot read the private delivery table');

    const migration = readFileSync(migrationPath, 'utf8');
    assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.claim_invite_email_delivery/);
    assert.match(migration, /TO authenticated, service_role/);
  } finally {
    if (started) {
      try {
        run('pg_ctl', ['-D', clusterDir, '-m', 'fast', '-w', 'stop']);
      } catch {
        // Best-effort shutdown; the temporary cluster path is still exact.
      }
    }
    assert.ok(clusterDir.startsWith(`${tmpdir()}/survey-invite-postgres-`));
    rmSync(clusterDir, { recursive: true, force: true });
  }
});
