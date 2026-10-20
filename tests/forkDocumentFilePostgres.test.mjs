// fork_document_file (supabase/migrations/20261013211724_fork_document_file.sql)
// run against a disposable LOCAL Postgres with Supabase-shaped stand-ins
// (roles, auth.uid / auth.role, storage.objects, the documents unique
// fingerprint index), on top of the file_path immutability trigger it amends
// (20260703020000). Skipped where no local Postgres binaries exist.
//
// What it proves:
//   * the owner moves a row onto `<owner>/<document id>.pdf` once that object
//     exists, and the fingerprint is stored;
//   * a plain client UPDATE of file_path is still refused - also right after
//     a fork in the same transaction (the flag does not leak);
//   * not the owner, no uploaded object, a path another row reads, or a
//     malformed fingerprint: refused, row unchanged;
//   * a fingerprint another document in the same project already has is
//     stored as NULL instead of failing.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const immutableSql = join(root, 'supabase/migrations/20260703020000_documents_file_path_immutable.sql');
const forkSql = join(root, 'supabase/migrations/20261013211724_fork_document_file.sql');
const rollbackSql = join(root, 'supabase/rollbacks/20261013_fork_document_file.down.sql');
const hasPostgres = ['initdb', 'pg_ctl', 'psql'].every((bin) => spawnSync('which', [bin]).status === 0);
const env = { ...process.env, LC_ALL: 'C', LANG: 'C' };
const OWNER = '11111111-1111-1111-1111-111111111111';
const STRANGER = '22222222-2222-2222-2222-222222222222';
const DOC_A = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const DOC_B = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
const DOC_C = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
const P1 = '00000000-0000-0000-0000-0000000000a1';
const P2 = '00000000-0000-0000-0000-0000000000a2';
const SHA0 = '0'.repeat(64);
const SHA1 = '1'.repeat(64);
const SHARED = `${OWNER}/${SHA0}.pdf`;
const OWN_A = `${OWNER}/${DOC_A}.pdf`;

test('fork_document_file moves only the owner\'s row onto its own uploaded object', { skip: !hasPostgres && 'no local Postgres' }, async (t) => {
  const temp = mkdtempSync(join(tmpdir(), 'survey-fork-doc-'));
  const data = join(temp, 'data');
  const socket = join(temp, 'socket');
  const port = 59000 + Math.floor(Math.random() * 3000);
  const psqlArgs = ['-h', socket, '-p', String(port), '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-Atq'];
  const run = (command, args) => {
    const result = spawnSync(command, args, { cwd: root, encoding: 'utf8', env });
    if (result.status !== 0) throw new Error(`${command} failed (${result.status})\n${result.stdout}\n${result.stderr}`);
    return String(result.stdout || '').trim();
  };
  const sql = (source) => run('psql', [...psqlArgs, '-c', source]);
  const sqlFile = (file) => run('psql', [...psqlArgs, '-f', file]);
  // Run as a signed-in user (role authenticated). Returns { ok, out, stderr }.
  const as = (userId, source) => {
    const result = spawnSync('psql', [...psqlArgs, '-c', `
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${userId}', false);
      SELECT set_config('request.jwt.claim.role', 'authenticated', false);
      ${source}`], { encoding: 'utf8', env });
    return { ok: result.status === 0, out: String(result.stdout || '').trim(), stderr: String(result.stderr || '') };
  };
  const row = (id) => JSON.parse(sql(`SELECT row_to_json(d) FROM (SELECT file_path, content_sha256 FROM public.documents WHERE id = '${id}') d`));
  const reset = () => sql(`
    DELETE FROM public.documents;
    DELETE FROM storage.objects;
    INSERT INTO public.documents (id, user_id, project_id, file_path, content_sha256) VALUES
      ('${DOC_A}', '${OWNER}', '${P1}', '${SHARED}', '${SHA0}'),
      ('${DOC_B}', '${OWNER}', '${P2}', '${SHARED}', '${SHA0}');
    INSERT INTO storage.objects (bucket_id, name) VALUES ('documents', '${SHARED}');`);

  run('mkdir', ['-p', socket]);
  run('initdb', ['-D', data, '--auth=trust', '--no-locale', '-E', 'UTF8']);
  const started = spawnSync('pg_ctl', ['-D', data, '-l', join(temp, 'pg.log'), '-o', `-F -p ${port} -k ${socket}`, '-w', 'start'], { encoding: 'utf8', timeout: 15000, env });
  if (started.status !== 0) {
    let log = '';
    try { log = readFileSync(join(temp, 'pg.log'), 'utf8'); } catch { /* none */ }
    t.skip(`local Postgres would not start here: ${(log || started.stderr).slice(-400)}`);
    rmSync(temp, { recursive: true, force: true });
    return;
  }
  t.after(() => {
    spawnSync('pg_ctl', ['-D', data, '-m', 'immediate', 'stop'], { stdio: 'ignore', env });
    rmSync(temp, { recursive: true, force: true });
  });

  sql(`
    CREATE ROLE authenticated;
    CREATE ROLE anon;
    CREATE SCHEMA auth;
    GRANT USAGE ON SCHEMA auth TO authenticated;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.role', true), '') $$;
    CREATE SCHEMA storage;
    CREATE TABLE storage.objects (bucket_id text NOT NULL, name text NOT NULL, PRIMARY KEY (bucket_id, name));
    CREATE TABLE public.documents (
      id uuid PRIMARY KEY, user_id uuid NOT NULL, project_id uuid,
      file_path text, content_sha256 text);
    CREATE UNIQUE INDEX documents_user_project_sha_uidx ON public.documents (
      user_id, COALESCE(project_id, '00000000-0000-0000-0000-000000000000'::uuid), content_sha256)
      WHERE content_sha256 IS NOT NULL;
    GRANT SELECT, UPDATE ON public.documents TO authenticated;`);
  sqlFile(immutableSql);
  sqlFile(forkSql);

  await t.test('a plain client update of file_path is still refused', () => {
    reset();
    const r = as(OWNER, `UPDATE public.documents SET file_path = '${OWN_A}' WHERE id = '${DOC_A}';`);
    assert.equal(r.ok, false);
    assert.match(r.stderr, /immutable/);
    assert.equal(row(DOC_A).file_path, SHARED);
  });

  await t.test('the owner forks once the own object exists; B keeps the shared object', () => {
    reset();
    sql(`INSERT INTO storage.objects (bucket_id, name) VALUES ('documents', '${OWN_A}')`);
    const r = as(OWNER, `SELECT file_path FROM public.fork_document_file('${DOC_A}', '${SHA1.toUpperCase()}');`);
    assert.equal(r.ok, true, r.stderr);
    assert.deepEqual(row(DOC_A), { file_path: OWN_A, content_sha256: SHA1 });
    assert.deepEqual(row(DOC_B), { file_path: SHARED, content_sha256: SHA0 });
  });

  await t.test('the flag does not outlive the fork: a direct update in the same transaction is refused', () => {
    reset();
    sql(`INSERT INTO storage.objects (bucket_id, name) VALUES ('documents', '${OWN_A}')`);
    const r = as(OWNER, `BEGIN;
      SELECT public.fork_document_file('${DOC_A}', NULL);
      UPDATE public.documents SET file_path = '${STRANGER}/victim.pdf' WHERE id = '${DOC_A}';
      COMMIT;`);
    assert.equal(r.ok, false);
    assert.match(r.stderr, /immutable/);
    assert.equal(row(DOC_A).file_path, SHARED, 'the whole transaction rolled back');
  });

  await t.test('refused: not the owner, no uploaded object, a path another row reads, a malformed fingerprint', () => {
    reset();
    sql(`INSERT INTO storage.objects (bucket_id, name) VALUES ('documents', '${STRANGER}/${DOC_A}.pdf')`);
    const stranger = as(STRANGER, `SELECT public.fork_document_file('${DOC_A}', NULL);`);
    assert.equal(stranger.ok, false);
    assert.match(stranger.stderr, /Document not found/);

    const noObject = as(OWNER, `SELECT public.fork_document_file('${DOC_A}', NULL);`);
    assert.equal(noObject.ok, false);
    assert.match(noObject.stderr, /Upload the document's own copy/);

    sql(`INSERT INTO storage.objects (bucket_id, name) VALUES ('documents', '${OWN_A}');
      INSERT INTO public.documents (id, user_id, project_id, file_path) VALUES ('${DOC_C}', '${OWNER}', NULL, '${OWN_A}')`);
    const taken = as(OWNER, `SELECT public.fork_document_file('${DOC_A}', NULL);`);
    assert.equal(taken.ok, false);
    assert.match(taken.stderr, /belongs to another document/);
    sql(`DELETE FROM public.documents WHERE id = '${DOC_C}'`);

    const badSha = as(OWNER, `SELECT public.fork_document_file('${DOC_A}', 'not-a-hash');`);
    assert.equal(badSha.ok, false);
    assert.match(badSha.stderr, /SHA-256/);
    assert.deepEqual(row(DOC_A), { file_path: SHARED, content_sha256: SHA0 });
  });

  await t.test('a fingerprint already used in the same project is stored as NULL', () => {
    reset();
    sql(`INSERT INTO storage.objects (bucket_id, name) VALUES ('documents', '${OWN_A}');
      INSERT INTO public.documents (id, user_id, project_id, file_path, content_sha256)
      VALUES ('${DOC_C}', '${OWNER}', '${P1}', '${OWNER}/${DOC_C}.pdf', '${SHA1}')`);
    const r = as(OWNER, `SELECT public.fork_document_file('${DOC_A}', '${SHA1}');`);
    assert.equal(r.ok, true, r.stderr);
    assert.deepEqual(row(DOC_A), { file_path: OWN_A, content_sha256: null });
  });

  await t.test('anon cannot call it', () => {
    const r = spawnSync('psql', [...psqlArgs, '-c', `SET ROLE anon; SELECT public.fork_document_file('${DOC_A}', NULL);`], { encoding: 'utf8', env });
    assert.notEqual(r.status, 0);
    assert.match(String(r.stderr), /permission denied/);
  });

  await t.test('the rollback drops the function and keeps file_path immutable', () => {
    sqlFile(rollbackSql);
    reset();
    assert.equal(sql(`SELECT count(*) FROM pg_proc WHERE proname = 'fork_document_file'`), '0');
    const r = as(OWNER, `UPDATE public.documents SET file_path = '${OWN_A}' WHERE id = '${DOC_A}';`);
    assert.equal(r.ok, false);
    assert.match(r.stderr, /immutable/);
  });
});
