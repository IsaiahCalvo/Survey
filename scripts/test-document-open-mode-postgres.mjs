// Disposable local PostgreSQL only. No hosted connection/account/credential
// inputs. Real authority, account, generation and read-fence migrations; private
// fixture head writes model adoption, not a public publication/deployment test.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { withDisposablePostgres } from './helpers/disposablePostgres.mjs';
assert.equal(process.argv.length, 2, 'This local fixture accepts no arguments');
const target = '20260909101000_document_open_mode.sql';
const migrationPath = name => fileURLToPath(new URL(`../supabase/migrations/${name}`, import.meta.url));
const source = name => readFileSync(migrationPath(name), 'utf8');
const fn = (file, name) => { const s = source(file), a = s.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`), b = s.indexOf('$$;', a);
  assert.ok(a >= 0 && b > a); return s.slice(a, b + 3); };
const id = n => `a0100000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1), editor = id(2), viewer = id(3), other = id(4), project = id(5);

await withDisposablePostgres(async pg => {
  const { sql, scalar, asRole, errorState, session, applyMigration, quote } = pg;
  // Reuse only the existing read-fence fixture bootstrap, with tracked document
  // and Storage SELECT policies instead of a permissive access test double.
  const prior = readFileSync(new URL('./test-document-generation-read-fences-postgres.mjs', import.meta.url), 'utf8');
  const a = prior.indexOf('  const prior ='), b = prior.indexOf('  const legacy =');
  assert.ok(a >= 0 && b > a);
  new Function('sql', 'applyMigration', 'migrationPath', 'readFileSync', 'source', 'fn', 'owner', 'editor', 'viewer', 'other', 'project', 'assert',
    prior.slice(a, b).replaceAll("'import.meta.url'", "'__KEEP_IMPORT_META__'")
      .replaceAll('import.meta.url', JSON.stringify(new URL('./test-document-generation-read-fences-postgres.mjs', import.meta.url).href))
      .replaceAll('__KEEP_IMPORT_META__', 'import.meta.url'))
    (sql, applyMigration, migrationPath, readFileSync, source, fn, owner, editor, viewer, other, project, assert);
  applyMigration(migrationPath('20260909090000_annotation_generation_transport.sql'));
  applyMigration(migrationPath('20260909091000_document_generation_read_fences.sql'));
  const invariantState = () => scalar(`SELECT jsonb_build_object(
    'policies',(SELECT jsonb_agg(to_jsonb(p) ORDER BY schemaname,tablename,policyname) FROM pg_policies p),
    'scope',pg_get_functiondef('survey_private.annotation_generation_scope(uuid,uuid,boolean)'::regprocedure),
    'membership',pg_get_functiondef('survey_private.guard_annotation_membership_change()'::regprocedure),
    'legacy',pg_get_functiondef('survey_private.assert_legacy_generation_content_read(uuid,boolean,boolean)'::regprocedure))`);
  const before = invariantState();
  applyMigration(migrationPath(target));
  let serial = 100, groups = 0;
  const fresh = () => id(serial++);
  const seed = (projectId = project) => { const d = fresh();
    sql(`INSERT INTO documents(id,user_id,project_id,name,file_path,file_size) VALUES('${d}','${owner}',${quote(projectId)},'PRIVATE NAME','${owner}/PRIVATE-PATH-${d}.pdf',4)`);
    return d; };
  const adoptionSql = (d, g = fresh()) => `INSERT INTO survey_private.annotation_generations(document_id,generation_id,base_seq,baseline_snapshot,baseline_encoding_version)
    VALUES('${d}','${g}',0,decode('50524956415445','hex'),1); INSERT INTO survey_private.annotation_generation_heads VALUES('${d}','${g}',0);`;
  const modeSql = d => `SELECT public.read_document_open_mode(${quote(d)})`;
  const mode = (d, actor = owner) => JSON.parse(asRole(actor, modeSql(d)).stdout);
  const exact = (d, actor, generation = null) => assert.deepEqual(mode(d, actor), {
    version: 1, actor_user_id: actor, document_id: d, mode: generation === null ? 'legacy' : 'checked', generation_id: generation });
  const check = async (label, work) => { await work(); groups++; console.log(`PASS ${label}`); };
  const finish = async s => { const r = await s.finish(); assert.equal(r.status, 0, r.stderr); };
  const hold = async (name, statement, actor = owner, role = 'authenticated') => {
    const s = session(name, { actorId: actor, role }); s.send(`${statement};SELECT 'held';`); await s.wait('held'); return s; };

  await check('mode API is authenticated-only and migration replay preserves every existing fence', () => {
    const d = seed(); exact(d, owner);
    applyMigration(migrationPath(target)); exact(d, owner);
    assert.equal(invariantState(), before);
    assert.equal(scalar(`SELECT prosecdef AND provolatile='v' AND proowner='postgres'::regrole
      AND 'search_path=""'=ANY(proconfig) FROM pg_proc WHERE oid='public.read_document_open_mode(uuid)'::regprocedure`), 't');
    for (const role of ['anon', 'service_role']) errorState(asRole(owner, modeSql(d), role, false), '42501');
    assert.equal(scalar(`SELECT count(*) FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a
      WHERE p.oid='public.read_document_open_mode(uuid)'::regprocedure AND a.grantee=0`), '0');
    for (const role of ['anon', 'authenticated', 'service_role'])
      errorState(asRole(owner, 'SELECT * FROM survey_private.annotation_generation_heads', role, false), '42501');
  });
  await check('legacy and head-only checked results contain exactly five safe keys', () => {
    const d = seed(), g = fresh();
    for (const actor of [owner, editor, viewer]) exact(d, actor);
    sql(adoptionSql(d, g));
    // No publication/asset receipt is seeded. Missing validation material can
    // never make an adopted document select the legacy content route.
    for (const actor of [owner, editor, viewer]) exact(d, actor, g);
    assert.equal(JSON.stringify(mode(d)).includes('PRIVATE'), false);
    errorState(sql(`DELETE FROM survey_private.annotation_generation_heads WHERE document_id='${d}'`, false), '42501');
  });
  await check('null actor, null or unknown document and outsiders share non-probing denial', () => {
    const d = seed(), adopted = seed(); sql(adoptionSql(adopted));
    for (const targetDoc of [null, fresh(), d, adopted]) errorState(asRole(other, modeSql(targetDoc), 'authenticated', false), '42501');
    errorState(asRole(null, modeSql(d), 'authenticated', false), '42501');
    errorState(asRole(owner, modeSql(null), 'authenticated', false), '42501');
    for (const isolation of ['REPEATABLE READ', 'SERIALIZABLE'])
      errorState(asRole(owner, `BEGIN ISOLATION LEVEL ${isolation};${modeSql(d)};COMMIT;`, 'authenticated', false), '25001');
  });
  await check('direct and inherited roles, inactive overrides and archived ownership keep current semantics', () => {
    const d = seed();
    sql(`INSERT INTO document_collaborators VALUES('${d}','${editor}','viewer','active')`); exact(d, editor);
    errorState(asRole(editor, `SELECT public.append_annotation_update_v2('${d}',NULL,'mode-test',1,decode('01','hex'))`, 'authenticated', false), '42501');
    sql(`UPDATE document_collaborators SET status='pending' WHERE document_id='${d}'`); exact(d, editor);
    const direct = seed(null);
    for (const role of ['viewer', 'editor', 'owner']) {
      sql(`INSERT INTO document_collaborators VALUES('${direct}','${other}','${role}','active') ON CONFLICT(document_id,user_id) DO UPDATE SET role=EXCLUDED.role`);
      exact(direct, other);
    }
    sql(`UPDATE document_collaborators SET status='pending' WHERE document_id='${direct}'`);
    errorState(asRole(other, modeSql(direct), 'authenticated', false), '42501');
    const p = fresh(); sql(`INSERT INTO projects(id,user_id,name) VALUES('${p}','${other}','Owned project')`);
    exact(seed(p), other);
    sql(`UPDATE documents SET user_archived_at=now() WHERE id='${d}'`); exact(d, owner);
    errorState(asRole(editor, modeSql(d), 'authenticated', false), '42501');
  });
  await check('healthy account and document tuples are not rewritten on repeat discovery', () => {
    const d = seed(); mode(d, editor);
    const rows = () => scalar(`SELECT jsonb_build_object('document',(SELECT jsonb_build_array(xmin::text,to_jsonb(d)) FROM documents d WHERE id='${d}'),
      'guards',(SELECT jsonb_agg(jsonb_build_array(xmin::text,to_jsonb(g)) ORDER BY user_id) FROM survey_private.account_write_guards g WHERE user_id IN('${owner}','${editor}')))`);
    const first = rows(); for (let n = 0; n < 3; n++) mode(d, editor); assert.equal(rows(), first);
  });
  await check('missing viewer guard is created once and actor or owner closing fails closed', () => {
    const d = seed(), actor = fresh(); sql(`INSERT INTO auth.users VALUES('${actor}');INSERT INTO document_collaborators VALUES('${d}','${actor}','viewer','active')`);
    assert.equal(scalar(`SELECT count(*) FROM survey_private.account_write_guards WHERE user_id='${actor}'`), '0');
    exact(d, actor);
    assert.equal(scalar(`SELECT count(*) FROM survey_private.account_write_guards WHERE user_id='${actor}'`), '1');
    for (const account of [actor, owner]) {
      sql(`UPDATE survey_private.account_write_guards SET closing=true WHERE user_id='${account}'`);
      errorState(asRole(actor, modeSql(d), 'authenticated', false), '23514');
      sql(`UPDATE survey_private.account_write_guards SET closing=false WHERE user_id='${account}'`);
    }
  });
  await check('readers coexist while adoption is rejected until their transaction ends', async () => {
    const d = seed(), g = fresh(), held = await hold('mode_reader', modeSql(d));
    exact(d, editor);
    errorState(sql(adoptionSql(d, g), false), '40001');
    await finish(held); sql(adoptionSql(d, g)); exact(d, owner, g);
  });
  await check('an uncommitted adoption rejects discovery and retry sees its exact committed head', async () => {
    const d = seed(), g = fresh(), held = await hold('mode_adopter', adoptionSql(d, g), owner, 'postgres');
    errorState(asRole(owner, modeSql(d), 'authenticated', false), '40001');
    await finish(held); exact(d, owner, g);
  });
  await check('generation replacement rejects concurrent discovery then returns only the new head', async () => {
    const d = seed(), first = fresh(), next = fresh(); sql(adoptionSql(d, first));
    sql(`INSERT INTO survey_private.annotation_generations VALUES('${d}','${next}',0,decode('01','hex'),1,now())`);
    const held = await hold('mode_generation_replace', `UPDATE survey_private.annotation_generation_heads SET generation_id='${next}' WHERE document_id='${d}'`, owner, 'postgres');
    errorState(asRole(owner, modeSql(d), 'authenticated', false), '40001');
    await finish(held); exact(d, owner, next);
  });
  await check('direct membership delete, role and status changes serialize in both transaction orders', async () => {
    const d = seed(null); sql(`INSERT INTO document_collaborators VALUES('${d}','${other}','editor','active')`);
    const held = await hold('mode_direct_reader', modeSql(d), other);
    for (const mutation of [`DELETE FROM document_collaborators WHERE document_id='${d}'`,
      `UPDATE document_collaborators SET role='viewer' WHERE document_id='${d}'`, `UPDATE document_collaborators SET status='pending' WHERE document_id='${d}'`])
      errorState(sql(mutation, false), '55P03');
    await finish(held);
    const revoke = await hold('mode_direct_revoke', `DELETE FROM document_collaborators WHERE document_id='${d}'`, owner, 'postgres');
    errorState(asRole(other, modeSql(d), 'authenticated', false), '55P03');
    await finish(revoke); errorState(asRole(other, modeSql(d), 'authenticated', false), '42501');
  });
  await check('inherited authority fences project revocation and absent direct override inserts', async () => {
    const d = seed(), held = await hold('mode_inherited_reader', modeSql(d), editor);
    errorState(sql(`UPDATE project_collaborators SET status='pending' WHERE project_id='${project}' AND user_id='${editor}'`, false), '55P03');
    errorState(sql(`INSERT INTO document_collaborators VALUES('${d}','${editor}','viewer','active')`, false), '55P03');
    await finish(held);
    const override = await hold('mode_override', `INSERT INTO document_collaborators VALUES('${d}','${editor}','viewer','active')`, owner, 'postgres');
    errorState(asRole(editor, modeSql(d), 'authenticated', false), '55P03');
    await finish(override); exact(d, editor);
    const inherited = seed(), revoke = await hold('mode_project_revoke', `UPDATE project_collaborators SET status='pending' WHERE project_id='${project}' AND user_id='${editor}'`, owner, 'postgres');
    errorState(asRole(editor, modeSql(inherited), 'authenticated', false), '55P03');
    await finish(revoke); errorState(asRole(editor, modeSql(inherited), 'authenticated', false), '42501');
    sql(`UPDATE project_collaborators SET status='active' WHERE project_id='${project}' AND user_id='${editor}'`);
  });
  await check('owners and direct readers avoid an unrelated project-row lock', async () => {
    const d = seed(); sql(`INSERT INTO document_collaborators VALUES('${d}','${editor}','viewer','active')`);
    const held = await hold('mode_project_metadata', `UPDATE projects SET name='Changed' WHERE id='${project}'`, owner, 'postgres');
    exact(d, owner); exact(d, editor);
    errorState(asRole(viewer, modeSql(d), 'authenticated', false), '55P03');
    await finish(held);
  });
  await check('account-closing and document scope changes serialize with discovery', async () => {
    const d = seed(), held = await hold('mode_account_reader', modeSql(d), editor);
    for (const account of [owner, editor]) errorState(sql(`SET lock_timeout='100ms';UPDATE survey_private.account_write_guards SET closing=true WHERE user_id='${account}'`, false), '55P03');
    for (const mutation of [`UPDATE documents SET user_archived_at=now() WHERE id='${d}'`, `UPDATE documents SET project_id=NULL WHERE id='${d}'`])
      errorState(sql(`SET lock_timeout='100ms';${mutation}`, false), '55P03');
    await finish(held);
    const closing = await hold('mode_closing', `UPDATE survey_private.account_write_guards SET closing=true WHERE user_id='${editor}'`, owner, 'postgres');
    errorState(asRole(editor, modeSql(d), 'authenticated', false), '55P03');
    await finish(closing); errorState(asRole(editor, modeSql(d), 'authenticated', false), '23514');
    sql(`UPDATE survey_private.account_write_guards SET closing=false WHERE user_id='${editor}'`);
  });
  await check('a prior legacy observation grants no later content or writer fallback after adoption', () => {
    const d = seed(), g = fresh(); exact(d, owner);
    sql(adoptionSql(d, g)); exact(d, owner, g);
    for (const q of [`SELECT * FROM documents WHERE id='${d}'`, `SELECT public.read_annotation_snapshot_v2('${d}',NULL)`,
      `SELECT public.append_annotation_update_v2('${d}',NULL,'late-legacy',1,decode('01','hex'))`,
      `SELECT * FROM public.append_annotation_update('${d}','late-old-client',1,decode('01','hex'))`])
      errorState(asRole(owner, q, 'authenticated', false), 'SG001');
    assert.equal(scalar(`SELECT count(*) FROM annotation_updates WHERE document_id='${d}'`), '0');
  });
  console.log(`Document open mode PostgreSQL groups passed: ${groups}`);
}, { name: 'document-open-mode', commandTimeoutMs: 60000 });
console.log('Disposable local PostgreSQL stopped; exact temporary cluster removed');
