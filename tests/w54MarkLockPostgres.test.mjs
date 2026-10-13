// w54 (2026-09-28) — RULED 2026-09-28 owner: open editing + lock.
// The proposed server rule (supabase/proposed/20260928_w54_mark_lock_open_editing.sql)
// run against a disposable LOCAL Postgres with Supabase-shaped stand-ins
// (roles, auth.uid, user_can_access_document, kal49 lock), exercising the
// four people who matter: the document OWNER, the mark's AUTHOR, another
// EDITOR, and a VIEWER. Skipped where no local Postgres binaries exist.
//
// What it proves on the Survey Marker mirror rows (public.document_annotations):
//   * open editing — any editor may update / delete anyone's UNLOCKED row;
//   * a viewer changes nothing;
//   * a LOCKED row: another editor cannot move / restyle / delete it or clear
//     the lock, but may still edit answers (not covered by the lock) and may
//     re-send it unchanged (the app's mirror sync);
//   * only the author or the owner may lock / unlock, and only as themselves;
//   * the author stamp is write-once for everyone but the owner.
// (The Yjs mark store cannot be checked by Postgres — see the SQL header.)
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const lockSql = join(root, 'supabase/proposed/20260928_w54_mark_lock_open_editing.sql');
const hasPostgres = ['initdb', 'pg_ctl', 'psql'].every((bin) => spawnSync('which', [bin]).status === 0);
const env = { ...process.env, LC_ALL: 'C', LANG: 'C' };
const OWNER = '11111111-1111-1111-1111-111111111111';
const AUTHOR = '22222222-2222-2222-2222-222222222222';
const EDITOR = '44444444-4444-4444-4444-444444444444';
const VIEWER = '33333333-3333-3333-3333-333333333333';
const DOC = 'dddddddd-dddd-dddd-dddd-dddddddddddd';

test('w54 mark lock + open editing on Survey Marker mirror rows (owner / author / other editor / viewer)', { skip: !hasPostgres && 'no local Postgres' }, async (t) => {
  const temp = mkdtempSync(join(tmpdir(), 'survey-w54-lock-'));
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
  // Run as an end user (RLS applies). Returns { ok, stderr }.
  const as = (userId, source) => {
    const result = spawnSync('psql', [...psqlArgs, '-c', `
      SET ROLE authenticated;
      SELECT set_config('request.jwt.claim.sub', '${userId}', false);
      ${source}`], { encoding: 'utf8', env });
    return { ok: result.status === 0, stderr: String(result.stderr || '') };
  };
  const row = (id) => {
    const out = sql(`SELECT row_to_json(r) FROM (SELECT page_number, bounds, color, checklist_responses,
      annotation_data FROM public.document_annotations WHERE annotation_id = '${id}') r`);
    return out ? JSON.parse(out) : null;
  };
  const insertRow = (id, writer, annotationData) => sql(`
    INSERT INTO public.document_annotations (document_id, user_id, annotation_id, page_number, bounds, color, annotation_data, last_modified_by)
    VALUES ('${DOC}', '${writer}', '${id}', 1, '{"x":5,"y":5}', '#ff0', '${JSON.stringify(annotationData)}', '${writer}')`);

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

  // Supabase-shaped stand-ins, then the table + the policies the live
  // database has today (20260522000000 kal49), then the proposal.
  sql(`
    CREATE ROLE authenticated;
    CREATE SCHEMA auth;
    GRANT USAGE ON SCHEMA auth TO authenticated;
    CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
      SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    CREATE TABLE public.documents (id uuid PRIMARY KEY, user_id uuid NOT NULL, locked_at timestamptz);
    CREATE TABLE public.document_annotations (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
      user_id uuid NOT NULL, annotation_id text NOT NULL, annotation_type text,
      page_number integer NOT NULL, bounds jsonb NOT NULL,
      category_id text, module_id text, name text, notes text,
      checklist_responses jsonb DEFAULT '{}', color text, opacity real,
      last_modified_by uuid, version integer DEFAULT 1,
      annotation_data jsonb NOT NULL DEFAULT '{}',
      UNIQUE (document_id, annotation_id));
    ALTER TABLE public.document_annotations ENABLE ROW LEVEL SECURITY;
    GRANT ALL ON public.document_annotations TO authenticated;
    GRANT SELECT ON public.documents TO authenticated;
    CREATE FUNCTION public.user_can_access_document(doc_id uuid, required_role text)
    RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
      SELECT CASE
        WHEN auth.uid() = '${OWNER}' THEN true
        WHEN auth.uid() IN ('${AUTHOR}', '${EDITOR}') THEN required_role IN ('viewer', 'editor')
        WHEN auth.uid() = '${VIEWER}' THEN required_role = 'viewer'
        ELSE false END $$;
    CREATE FUNCTION public.kal49_document_is_locked(doc_id uuid)
    RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER AS $$
      SELECT locked_at IS NOT NULL FROM public.documents WHERE id = doc_id $$;
    CREATE POLICY "select" ON public.document_annotations FOR SELECT
      USING (public.user_can_access_document(document_id, 'viewer'));
    CREATE POLICY "Users can insert own annotations on editable documents" ON public.document_annotations
      FOR INSERT WITH CHECK ((select auth.uid()) = user_id
        AND public.user_can_access_document(document_id, 'editor')
        AND NOT public.kal49_document_is_locked(document_id));
    CREATE POLICY "Users can update own annotations or owners can update any" ON public.document_annotations
      FOR UPDATE USING ((((select auth.uid()) = user_id AND public.user_can_access_document(document_id, 'editor'))
        OR public.user_can_access_document(document_id, 'owner')) AND NOT public.kal49_document_is_locked(document_id))
      WITH CHECK ((((select auth.uid()) = user_id AND public.user_can_access_document(document_id, 'editor'))
        OR public.user_can_access_document(document_id, 'owner')) AND NOT public.kal49_document_is_locked(document_id));
    CREATE POLICY "Users can delete own annotations or owners can delete any" ON public.document_annotations
      FOR DELETE USING ((((select auth.uid()) = user_id AND public.user_can_access_document(document_id, 'editor'))
        OR public.user_can_access_document(document_id, 'owner')) AND NOT public.kal49_document_is_locked(document_id));
    INSERT INTO public.documents VALUES ('${DOC}', '${OWNER}', NULL);
  `);
  run('psql', [...psqlArgs, '-f', lockSql]);
  run('psql', [...psqlArgs, '-f', lockSql]); // idempotent

  // Open editing: another editor moves, then deletes, the author's unlocked row.
  insertRow('free', AUTHOR, { authorId: AUTHOR });
  assert.equal(as(EDITOR, `UPDATE document_annotations SET user_id = '${EDITOR}', page_number = 3 WHERE annotation_id = 'free'`).ok, true);
  assert.equal(row('free').page_number, 3, 'another editor may move someone else\'s unlocked row');
  assert.equal(row('free').annotation_data.authorId, AUTHOR, 'the author stamp survives someone else\'s edit');
  as(VIEWER, `UPDATE document_annotations SET user_id = '${VIEWER}', page_number = 9 WHERE annotation_id = 'free'`);
  as(VIEWER, `DELETE FROM document_annotations WHERE annotation_id = 'free'`);
  assert.equal(row('free').page_number, 3, 'a viewer changes nothing');
  assert.equal(as(EDITOR, `DELETE FROM document_annotations WHERE annotation_id = 'free'`).ok, true);
  assert.equal(row('free'), null, 'another editor may delete someone else\'s unlocked row');

  // A row the author locked. Refused changes are KEPT OUT, never raised: the
  // app re-sends every marker in one upsert and one error would fail the batch.
  insertRow('locked', AUTHOR, { authorId: AUTHOR, lockedBy: AUTHOR });
  assert.equal(as(EDITOR, `UPDATE document_annotations SET user_id = '${EDITOR}', bounds = '{"x":9,"y":9}' WHERE annotation_id = 'locked'`).ok, true);
  assert.equal(row('locked').bounds.x, 5, 'another editor cannot move a locked row');
  as(EDITOR, `UPDATE document_annotations SET user_id = '${EDITOR}', color = '#000' WHERE annotation_id = 'locked'`);
  assert.equal(row('locked').color, '#ff0', 'another editor cannot restyle a locked row');
  as(EDITOR, `UPDATE document_annotations SET user_id = '${EDITOR}', checklist_responses = '{"q":"yes"}' WHERE annotation_id = 'locked'`);
  assert.equal(row('locked').checklist_responses.q, 'yes', 'answers are not covered by the lock');
  as(EDITOR, `UPDATE document_annotations SET user_id = '${EDITOR}', annotation_data = annotation_data - 'lockedBy' WHERE annotation_id = 'locked'`);
  assert.equal(row('locked').annotation_data.lockedBy, AUTHOR, 'another editor cannot unlock it');
  assert.equal(as(EDITOR, `DELETE FROM document_annotations WHERE annotation_id = 'locked'`).ok, true);
  assert.notEqual(row('locked'), null, 'another editor cannot delete it (the delete is skipped)');

  // The app's real write: one upsert of EVERY marker, from a screen whose copy
  // of the locked row is stale (no lock, old box). The batch succeeds, the
  // lock and box hold, the unlocked row in the same batch is written.
  insertRow('batch-free', AUTHOR, { authorId: AUTHOR });
  const upsert = as(EDITOR, `
    INSERT INTO document_annotations (document_id, user_id, annotation_id, page_number, bounds, color, annotation_data, last_modified_by)
    VALUES
      ('${DOC}', '${EDITOR}', 'locked', 2, '{"x":1,"y":1}', '#ff0', '{"authorId":"${AUTHOR}"}', '${EDITOR}'),
      ('${DOC}', '${EDITOR}', 'batch-free', 4, '{"x":2,"y":2}', '#ff0', '{"authorId":"${AUTHOR}"}', '${EDITOR}')
    ON CONFLICT (document_id, annotation_id) DO UPDATE SET
      user_id = EXCLUDED.user_id, page_number = EXCLUDED.page_number, bounds = EXCLUDED.bounds,
      annotation_data = EXCLUDED.annotation_data, last_modified_by = EXCLUDED.last_modified_by`);
  assert.equal(upsert.ok, true, `the batch upsert never fails on a locked row: ${upsert.stderr}`);
  assert.equal(row('locked').annotation_data.lockedBy, AUTHOR);
  assert.equal(row('locked').bounds.x, 5);
  assert.equal(row('locked').page_number, 1);
  assert.equal(row('batch-free').page_number, 4, 'the unlocked row in the same batch is written');

  // Locking is the author's or the owner's, and only as themselves.
  insertRow('mine', EDITOR, { authorId: EDITOR });
  as(AUTHOR, `UPDATE document_annotations SET user_id = '${AUTHOR}', annotation_data = annotation_data || '{"lockedBy":"${AUTHOR}"}' WHERE annotation_id = 'mine'`);
  assert.equal(row('mine').annotation_data.lockedBy, undefined, 'an editor cannot lock someone else\'s mark');
  as(EDITOR, `UPDATE document_annotations SET user_id = '${EDITOR}', annotation_data = annotation_data || '{"lockedBy":"${OWNER}"}' WHERE annotation_id = 'mine'`);
  assert.equal(row('mine').annotation_data.lockedBy, undefined, 'nobody locks in someone else\'s name');
  as(EDITOR, `UPDATE document_annotations SET user_id = '${EDITOR}', annotation_data = annotation_data || '{"lockedBy":"${EDITOR}"}' WHERE annotation_id = 'mine'`);
  assert.equal(row('mine').annotation_data.lockedBy, EDITOR, 'the author locks their own mark');
  as(OWNER, `UPDATE document_annotations SET user_id = '${OWNER}', annotation_data = annotation_data - 'lockedBy' WHERE annotation_id = 'mine'`);
  assert.equal(row('mine').annotation_data.lockedBy, undefined, 'the document owner unlocks anyone\'s mark');

  // A new row arriving locked in someone else's name loses the lock.
  as(EDITOR, `INSERT INTO document_annotations (document_id, user_id, annotation_id, page_number, bounds, annotation_data, last_modified_by)
    VALUES ('${DOC}', '${EDITOR}', 'forged', 1, '{}', '{"authorId":"${AUTHOR}","lockedBy":"${AUTHOR}"}', '${EDITOR}')`);
  assert.equal(row('forged').annotation_data.lockedBy, undefined);

  // The author and the owner may still move / delete a locked row.
  as(AUTHOR, `UPDATE document_annotations SET user_id = '${AUTHOR}', bounds = '{"x":7,"y":7}' WHERE annotation_id = 'locked'`);
  assert.equal(row('locked').bounds.x, 7);
  assert.equal(as(OWNER, `DELETE FROM document_annotations WHERE annotation_id = 'locked'`).ok, true);
  assert.equal(row('locked'), null);

  // Author stamp is write-once: nobody but the owner changes it, or adds one
  // to an older row that has none (so nobody claims a colleague's mark).
  insertRow('stamp', AUTHOR, { authorId: AUTHOR });
  as(EDITOR, `UPDATE document_annotations SET user_id = '${EDITOR}', annotation_data = annotation_data || '{"authorId":"${EDITOR}"}' WHERE annotation_id = 'stamp'`);
  assert.equal(row('stamp').annotation_data.authorId, AUTHOR);
  insertRow('old', OWNER, {});
  as(EDITOR, `UPDATE document_annotations SET user_id = '${EDITOR}', annotation_data = annotation_data || '{"authorId":"${EDITOR}"}' WHERE annotation_id = 'old'`);
  assert.equal(row('old').annotation_data.authorId, undefined);

  // A whole-document lock (kal49) still stops every write.
  sql(`UPDATE public.documents SET locked_at = now() WHERE id = '${DOC}'`);
  as(EDITOR, `UPDATE document_annotations SET user_id = '${EDITOR}', page_number = 8 WHERE annotation_id = 'stamp'`);
  assert.equal(row('stamp').page_number, 1);
  sql(`UPDATE public.documents SET locked_at = NULL WHERE id = '${DOC}'`);

  // Deleting the document (cascade) is never blocked by a lock.
  insertRow('locked-2', AUTHOR, { authorId: AUTHOR, lockedBy: AUTHOR });
  const dropDoc = as(OWNER, `DELETE FROM public.documents WHERE id = '${DOC}'`);
  // (the stand-in role has no DELETE grant on documents; run it as the owner's session via the superuser)
  if (!dropDoc.ok) sql(`SELECT set_config('request.jwt.claim.sub', '${OWNER}', false); DELETE FROM public.documents WHERE id = '${DOC}'`);
  assert.equal(row('locked-2'), null, 'a locked row goes with its document');
});
