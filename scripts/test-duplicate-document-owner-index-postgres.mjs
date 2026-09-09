// Disposable local PostgreSQL only. This script accepts no remote connection.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { withDisposablePostgres } from './helpers/disposablePostgres.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const migration = join(root, 'supabase/migrations/20260909104000_remove_duplicate_document_owner_index.sql');
const migrationSql = readFileSync(migration, 'utf8');

await withDisposablePostgres(async ({ sql, scalar, asRole, session, blocked, applyMigration }) => {
  const exists = name => scalar(`SELECT to_regclass('public.${name}') IS NOT NULL`);
  const reset = (survivor = '(user_id)', duplicate = '(user_id)') => sql(`
    DROP TABLE IF EXISTS public.documents CASCADE;
    CREATE TABLE public.documents(id bigint PRIMARY KEY, user_id uuid NOT NULL, project_id uuid);
    INSERT INTO public.documents VALUES
      (1,'10000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001'),
      (2,'20000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000002');
    ${survivor ? `CREATE INDEX documents_user_id_idx ON public.documents ${survivor};` : ''}
    ${duplicate ? `CREATE INDEX idx_documents_user_id ON public.documents ${duplicate};` : ''}
  `);
  const ownerRows = () => scalar("SELECT array_agg(id ORDER BY id) FROM public.documents WHERE user_id='10000000-0000-4000-8000-000000000001'");

  reset();
  sql(`
    CREATE ROLE authenticated NOLOGIN;
    CREATE SCHEMA auth;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE
      AS $$SELECT nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    ALTER TABLE public.documents ENABLE ROW LEVEL SECURITY;
    CREATE POLICY document_owner_read ON public.documents FOR SELECT USING (user_id=auth.uid());
    GRANT USAGE ON SCHEMA public,auth TO authenticated;
    GRANT SELECT ON public.documents TO authenticated;
  `);
  const before = ownerRows();
  const ownerBefore = asRole('10000000-0000-4000-8000-000000000001', 'SELECT array_agg(id ORDER BY id) FROM public.documents').stdout;
  const otherBefore = asRole('20000000-0000-4000-8000-000000000002', 'SELECT array_agg(id ORDER BY id) FROM public.documents').stdout;
  applyMigration(migration);
  assert.equal(exists('documents_user_id_idx'), 't');
  assert.equal(exists('idx_documents_user_id'), 'f');
  assert.equal(ownerRows(), before);
  assert.equal(asRole('10000000-0000-4000-8000-000000000001', 'SELECT array_agg(id ORDER BY id) FROM public.documents').stdout, ownerBefore);
  assert.equal(asRole('20000000-0000-4000-8000-000000000002', 'SELECT array_agg(id ORDER BY id) FROM public.documents').stdout, otherBefore);
  assert.equal(ownerBefore, '{1}');
  assert.equal(otherBefore, '{2}');
  assert.match(sql("SET enable_seqscan=off; EXPLAIN SELECT id FROM public.documents WHERE user_id='10000000-0000-4000-8000-000000000001'").stdout,
    /Index Scan using documents_user_id_idx/);
  applyMigration(migration);
  assert.equal(exists('documents_user_id_idx'), 't', 'replay keeps the intentional index');

  reset(null, '(user_id)');
  applyMigration(migration);
  assert.equal(exists('idx_documents_user_id'), 't', 'a missing survivor preserves the candidate');

  reset('(user_id)', '(project_id)');
  applyMigration(migration);
  assert.equal(exists('idx_documents_user_id'), 't', 'different keys preserve the candidate');

  reset('(project_id)', '(project_id)');
  applyMigration(migration);
  assert.equal(exists('idx_documents_user_id'), 't', 'two identically drifted keys are not owner indexes');

  reset('(user_id) WHERE user_id IS NOT NULL', '(user_id)');
  applyMigration(migration);
  assert.equal(exists('idx_documents_user_id'), 't', 'predicate drift preserves the candidate');

  reset('(user_id) WHERE user_id IS NOT NULL', '(user_id) WHERE user_id IS NOT NULL');
  applyMigration(migration);
  assert.equal(exists('idx_documents_user_id'), 't', 'two matching partial indexes are not plain owner indexes');

  reset('(user_id) INCLUDE (project_id)', '(user_id) INCLUDE (project_id)');
  applyMigration(migration);
  assert.equal(exists('idx_documents_user_id'), 't', 'two matching covering indexes are not the plain owner index');

  reset('(user_id)', '(user_id DESC)');
  applyMigration(migration);
  assert.equal(exists('idx_documents_user_id'), 't', 'index option drift preserves the candidate');

  reset('(user_id)', null);
  sql('ALTER TABLE public.documents ADD CONSTRAINT idx_documents_user_id UNIQUE(user_id)');
  applyMigration(migration);
  assert.equal(exists('idx_documents_user_id'), 't', 'a constraint-owned index is never removed');

  reset();
  sql("UPDATE pg_catalog.pg_index SET indisvalid=false, indisready=false WHERE indexrelid='public.documents_user_id_idx'::regclass");
  applyMigration(migration);
  assert.equal(exists('idx_documents_user_id'), 't', 'an invalid survivor preserves the candidate');

  reset();
  const holder = session('document-owner-index-lock', { role: 'postgres' });
  holder.send("LOCK TABLE public.documents IN ACCESS SHARE MODE; SELECT 'index-lock-held';");
  await holder.wait('index-lock-held');
  const blockedCleanup = sql(migrationSql, false);
  assert.notEqual(blockedCleanup.status, 0);
  assert.match(blockedCleanup.stderr, /55P03:|could not obtain lock/);
  assert.equal(exists('documents_user_id_idx'), 't');
  assert.equal(exists('idx_documents_user_id'), 't');
  await holder.finish(false);
  applyMigration(migration);
  assert.equal(exists('idx_documents_user_id'), 'f', 'retry removes the duplicate after the lock clears');

  reset();
  const doOnlyMigration = migrationSql.slice(migrationSql.indexOf('DO $cleanup$'));
  assert.ok(doOnlyMigration.startsWith('DO $cleanup$') && !doOnlyMigration.includes('SET LOCAL lock_timeout'),
    'DO-only fixture must rely on the timeout set inside the block');
  const indexLock = session('document-owner-index-relation-lock', { role: 'postgres' });
  indexLock.send("ALTER INDEX public.idx_documents_user_id RENAME TO idx_documents_user_id_locked; SELECT 'index-relation-lock-held';");
  await indexLock.wait('index-relation-lock-held');
  const indexBlockedCleanup = sql(doOnlyMigration, false);
  assert.notEqual(indexBlockedCleanup.status, 0);
  assert.match(indexBlockedCleanup.stderr, /55P03:|lock timeout/);
  assert.equal(exists('documents_user_id_idx'), 't');
  assert.equal(exists('idx_documents_user_id'), 't');
  await indexLock.finish(false);
  applyMigration(migration);
  assert.equal(exists('idx_documents_user_id'), 'f', 'DO-only index lock timeout leaves a safe retry');

  reset();
  sql('CREATE INDEX idx_documents_user_id_decoy ON public.documents(project_id)');
  const originalOids = scalar(`SELECT json_agg(oid ORDER BY oid) FROM pg_catalog.pg_class
    WHERE relname IN ('documents_user_id_idx','idx_documents_user_id','idx_documents_user_id_decoy')`);
  const dropAnchor = "    EXECUTE 'DROP INDEX public.idx_documents_user_id';";
  assert.equal(migrationSql.split(dropAnchor).length - 1, 1, 'fixture pause anchor must be exact');
  const gatedMigration = migrationSql.replace(dropAnchor,
    `    PERFORM pg_catalog.pg_advisory_xact_lock(1040, 1);\n${dropAnchor}`);
  const renameGate = session('document-index-rename-gate', { role: 'postgres' });
  renameGate.send("SELECT pg_advisory_xact_lock(1040,1); SELECT 'rename-gate-held';");
  await renameGate.wait('rename-gate-held');
  const guardedCleanup = session('document-index-rename-cleanup', { role: 'postgres' });
  guardedCleanup.send(gatedMigration);
  await blocked('document-index-rename-cleanup');
  sql(`ALTER INDEX public.idx_documents_user_id RENAME TO idx_documents_user_id_original;
    ALTER INDEX public.idx_documents_user_id_decoy RENAME TO idx_documents_user_id`);
  await renameGate.finish(false);
  const guardedResult = await guardedCleanup.finish(false);
  assert.notEqual(guardedResult.status, 0);
  assert.match(guardedResult.stderr, /55000: document owner index names changed during guarded cleanup/);
  assert.equal(scalar(`SELECT json_agg(oid ORDER BY oid) FROM pg_catalog.pg_class
    WHERE relname IN ('documents_user_id_idx','idx_documents_user_id','idx_documents_user_id_original')`), originalOids,
  'rename swap rollback preserves every original index OID');

}, { name: 'document-owner-index' });

// withDisposablePostgres returns only after its owned server is stopped and its
// exact temporary directory is removed.
console.log('duplicate document owner index cleanup: 13/13 passed; cleanup complete');
