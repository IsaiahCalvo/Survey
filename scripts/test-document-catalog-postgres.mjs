// Local, disposable PostgreSQL only. Never reads credentials or a remote URL.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { withDisposablePostgres } from './helpers/disposablePostgres.mjs';
assert.equal(process.argv.length, 2, 'This fixture accepts no arguments');
const target = '20260909102000_document_catalog.sql';
const migrationPath = name => fileURLToPath(new URL(`../supabase/migrations/${name}`, import.meta.url));
const source = name => readFileSync(migrationPath(name), 'utf8');
const fn = (file, name) => { const s = source(file), a = s.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`), b = s.indexOf('$$;', a); assert.ok(a >= 0 && b > a); return s.slice(a, b + 3); };
const id = n => `a0200000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1), editor = id(2), viewer = id(3), other = id(4), project = id(5);

await withDisposablePostgres(async pg => {
  const { sql, scalar, asRole, errorState, session, applyMigration, quote } = pg;
  // Reuse only the installed read-fence fixture's bootstrap, with the real
  // access helpers and policies. Do not replace authority with a test stub.
  const prior = readFileSync(new URL('./test-document-generation-read-fences-postgres.mjs', import.meta.url), 'utf8');
  const a = prior.indexOf('  const prior ='), b = prior.indexOf('  const legacy =');
  assert.ok(a >= 0 && b > a);
  const bootstrap = prior.slice(a, b)
      .replaceAll("new URL('./test-document-generation-upload-staging-postgres.mjs', import.meta.url).href", JSON.stringify(new URL('./test-document-generation-upload-staging-postgres.mjs', import.meta.url).href))
      .replaceAll("new URL('./test-document-generation-upload-staging-postgres.mjs', import.meta.url)", JSON.stringify(fileURLToPath(new URL('./test-document-generation-upload-staging-postgres.mjs', import.meta.url))));
  new Function('sql', 'applyMigration', 'migrationPath', 'readFileSync', 'source', 'fn', 'owner', 'editor', 'viewer', 'other', 'project', 'assert', bootstrap)
    (sql, applyMigration, migrationPath, readFileSync, source, fn, owner, editor, viewer, other, project, assert);
  sql('ALTER TABLE documents ADD COLUMN created_at timestamptz DEFAULT now()');
  applyMigration(migrationPath('20260909090000_annotation_generation_transport.sql'));
  applyMigration(migrationPath('20260909091000_document_generation_read_fences.sql'));
  const beforeFence = scalar("SELECT pg_get_expr(polqual,polrelid) FROM pg_policy WHERE polname='generation_legacy_read_fence' AND polrelid='documents'::regclass");
  applyMigration(migrationPath(target));
  let checks = 0;
  const check = async (label, run) => { await run(); checks++; console.log(`PASS ${label}`); };
  const call = (after = null, limit = 100, projectId = null) => `SELECT public.list_document_catalog(${quote(after)},${limit ?? 'NULL'},${quote(projectId)})`;
  const list = (actor = owner, after = null, limit = 100, projectId = null) => JSON.parse(asRole(actor, call(after, limit, projectId)).stdout);
  const ids = result => result.rows.map(row => row.id);
  const doc = (n, actor = owner, p = null, extra = '') => {
    sql(`INSERT INTO documents(id,user_id,project_id,name,file_path,file_size,page_count) VALUES('${id(n)}','${actor}',${quote(p)},'Document ${n}','${actor}/secret-${n}.pdf',9007199254740993,3);${extra}`);
    return id(n);
  };
  const legacy = doc(10), adopted = doc(11), shared = doc(12, owner, project), privateDoc = doc(13, other);
  sql(`INSERT INTO survey_private.annotation_generations(document_id,generation_id,base_seq,baseline_snapshot,baseline_encoding_version)
    VALUES('${adopted}','${id(99)}',0,'\\x0102',1);
    INSERT INTO survey_private.annotation_generation_heads VALUES('${adopted}','${id(99)}',0);
    INSERT INTO document_collaborators VALUES('${legacy}','${viewer}','viewer','active');`);

  await check('mixed legacy/adopted catalog excludes content while full-row fence remains', () => {
    errorState(asRole(owner, 'SELECT * FROM documents', 'authenticated', false), 'SG001');
    const result = list(); assert.deepEqual(ids(result), [legacy, adopted, shared]);
    assert.equal(result.actor_user_id, owner); assert.equal(result.version, 1);
    assert.equal(result.rows[0].file_size, '9007199254740993');
    assert.deepEqual(Object.keys(result.rows[0]).sort(), ['id','user_id','project_id','name','name_truncated','file_size','page_count','created_at','updated_at','locked_at'].sort());
    assert.doesNotMatch(JSON.stringify(result), /secret-|snapshot|annotations|generation_id|file_path/);
    assert.equal(scalar("SELECT pg_get_expr(polqual,polrelid) FROM pg_policy WHERE polname='generation_legacy_read_fence' AND polrelid='documents'::regclass"), beforeFence);
  });
  await check('direct, inherited and project-owner membership paths retain real precedence', () => {
    assert.deepEqual(ids(list(viewer)), [legacy, shared]);
    assert.deepEqual(ids(list(editor)), [shared]);
    const child = doc(14, other, project);
    assert.ok(ids(list(owner)).includes(child), 'project owner sees another permanent owner document');
    sql(`INSERT INTO document_collaborators VALUES('${shared}','${editor}','viewer','active')`);
    assert.ok(ids(list(editor)).includes(shared), 'direct viewer still can list');
    sql(`UPDATE document_collaborators SET role='invalid' WHERE document_id='${shared}' AND user_id='${editor}'`);
    assert.equal(ids(list(editor)).includes(shared), false, 'invalid direct role must not inherit editor');
    sql(`DELETE FROM document_collaborators WHERE document_id='${shared}' AND user_id='${editor}'`);
  });
  await check('archived and inactive memberships are omitted without exposing unknown project IDs', () => {
    doc(15, owner, null, `UPDATE documents SET archived=true WHERE id='${id(15)}'`);
    doc(16, owner, null, `UPDATE documents SET user_archived_at=now() WHERE id='${id(16)}'`);
    sql(`INSERT INTO document_collaborators VALUES('${adopted}','${viewer}','viewer','pending')`);
    assert.equal(ids(list(viewer)).includes(adopted), false);
    assert.equal(ids(list()).includes(id(15)), false); assert.equal(ids(list()).includes(id(16)), false);
    assert.deepEqual(ids(list(viewer, null, 100, project)), [shared, id(14)]);
    assert.deepEqual(ids(list(viewer, null, 100, id(999))), []);
  });
  await check('keyset pages deduplicate overlapping grants and keep exact boundaries', () => {
    sql(`INSERT INTO document_collaborators VALUES('${shared}','${owner}','viewer','active')`);
    const all = ids(list()); let after = null; const seen = [];
    do { const page = list(owner, after, 1); seen.push(...ids(page)); after = page.next_cursor;
      assert.equal(page.has_more, after !== null); if (after) assert.equal(after, page.rows.at(-1).id);
    } while (after);
    assert.deepEqual(seen, all); assert.equal(new Set(seen).size, seen.length);
    assert.deepEqual(ids(list(owner, id(99999), 1)), []);
    assert.equal(list(owner, null, all.length).has_more, false);
  });
  await check('names and row counts are bounded while large byte sizes remain decimal strings', () => {
    sql(`UPDATE documents SET name=repeat('😀',1000000) WHERE id='${legacy}'`);
    const row = list().rows.find(row => row.id === legacy);
    assert.equal([...row.name].length, 1024); assert.equal(row.name_truncated, true);
    assert.ok(Buffer.byteLength(JSON.stringify(row))<8192,'a TOASTed title must not become an unbounded row response');
    for (const value of [0,-1,201,null]) errorState(asRole(owner, call(null,value), 'authenticated', false), '22023');
    assert.equal(list(owner,null,200).rows.length, 4);
  });
  await check('anonymous, missing actors and service role cannot call this catalog', () => {
    for (const role of ['anon','service_role']) errorState(asRole(owner,call(),role,false),'42501');
    for (const actor of [null,id(8888)]) errorState(asRole(actor,call(),'authenticated',false),'42501');
    assert.deepEqual(ids(list(other)), [privateDoc,id(14)]);
  });
  await check('catalog performs no guard writes and respects committed account closure', () => {
    const before = scalar('SELECT jsonb_agg(to_jsonb(g)||jsonb_build_object(\'xmin\',xmin::text) ORDER BY user_id) FROM survey_private.account_write_guards g');
    list(); list(viewer);
    assert.equal(scalar('SELECT jsonb_agg(to_jsonb(g)||jsonb_build_object(\'xmin\',xmin::text) ORDER BY user_id) FROM survey_private.account_write_guards g'),before);
    sql(`UPDATE survey_private.account_write_guards SET closing=true WHERE user_id='${other}'`);
    assert.equal(ids(list()).includes(id(14)),false);
    errorState(asRole(other,call(),'authenticated',false),'23514');
    sql(`UPDATE survey_private.account_write_guards SET closing=false WHERE user_id='${other}'`);
  });
  await check('list reads do not block membership changes; next statement sees revocation', async () => {
    const held = session('catalog_reader', {role:'authenticated',actorId:viewer});
    held.send(`${call()};SELECT 'catalog_ready';`); await held.wait('catalog_ready');
    sql(`DELETE FROM document_collaborators WHERE document_id='${legacy}' AND user_id='${viewer}'`);
    assert.equal(ids(list(viewer)).includes(legacy),false);
    await held.finish();
  });
  await check('repeated migration preserves rows, exact grants and content fences', () => {
    const before = list(); applyMigration(migrationPath(target)); assert.deepEqual(list(),before);
    assert.equal(scalar("SELECT prosecdef AND provolatile='s' AND proowner='postgres'::regrole FROM pg_proc WHERE oid='public.list_document_catalog(uuid,integer,uuid)'::regprocedure"),'t');
    assert.equal(scalar("SELECT has_function_privilege('authenticated','public.list_document_catalog(uuid,integer,uuid)','EXECUTE')"),'t');
    assert.equal(scalar("SELECT has_function_privilege('anon','public.list_document_catalog(uuid,integer,uuid)','EXECUTE')"),'f');
    errorState(asRole(owner,'SELECT * FROM documents','authenticated',false),'SG001');
  });
  await check('large mixed library uses indexed keysets and bounded pages without content reads', () => {
    sql(`INSERT INTO documents(id,user_id,project_id,name,file_path,file_size,page_count)
      SELECT ('a0200000-0000-4000-8000-'||lpad(n::text,12,'0'))::uuid,
       CASE WHEN n<1600 THEN '${owner}'::uuid ELSE '${other}'::uuid END,
       CASE WHEN n<1600 THEN '${project}'::uuid ELSE NULL END,
       'Large library',CASE WHEN n<1600 THEN '${owner}' ELSE '${other}' END||'/'||n||'.pdf',1,1
      FROM generate_series(1000,6999) n;
      INSERT INTO document_collaborators SELECT id,'${owner}','viewer','active' FROM documents WHERE id>='${id(1000)}' AND id<'${id(1600)}';
      INSERT INTO project_collaborators VALUES('${project}','${owner}','viewer','active');
      ANALYZE documents; ANALYZE document_collaborators; ANALYZE project_collaborators; ANALYZE projects;`);
    const page = list(owner,id(1299),200);
    assert.equal(page.rows.length,200); assert.equal(page.has_more,true); assert.equal(page.next_cursor,id(1499));
    const last = list(owner,page.next_cursor,200);
    assert.equal(last.rows.length,100); assert.equal(last.has_more,false);
    // EXPLAIN the exact inner SQL (same postgres definer and actor) so the
    // function-call wrapper cannot conceal a full scan from this check.
    const body = source(target);
    const start = body.indexOf(' WITH visible AS'), end = body.indexOf(' RETURN jsonb_build_object',start);
    assert.ok(start>=0 && end>start);
    const query = body.slice(start,end).replace('INTO rows,more,cursor_id','')
      .replaceAll('p_after_id',`'${id(1299)}'::uuid`).replaceAll('p_project_id','NULL::uuid')
      .replaceAll('p_limit','200').replace(/\bactor\b/g,`'${owner}'::uuid`);
    const plan = JSON.parse(asRole(owner,`EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) ${query}`,'postgres').stdout);
    const encoded = JSON.stringify(plan);
    assert.match(encoded,/documents_library_owner_cursor_idx/);
    assert.doesNotMatch(query,/file_path|baseline_snapshot|annotations|annotation_generation/);
    const nodes=[]; const walk=node=>{nodes.push(node);for(const child of node.Plans||[])walk(child);};walk(plan[0].Plan);
    const scans=nodes.filter(node=>node['Relation Name']==='documents');
    console.log(`EXPLAIN catalog ${JSON.stringify({milliseconds:plan[0]['Execution Time'],scans:scans.map(n=>({type:n['Node Type'],index:n['Index Name'],rows:n['Actual Rows'],loops:n['Actual Loops'],removed:n['Rows Removed by Filter']}))})}`);
    assert.ok(nodes.filter(n=>n['Node Type']==='Limit').every(n=>n['Actual Rows']<=201));
    assert.ok(scans.every(n=>n['Node Type']!=='Seq Scan'),'bounded metadata lookup must not rescan every document');
    assert.ok(scans.every(n=>(n['Rows Removed by Filter']||0)===0),'project branches must seek their allowed project rather than discard unrelated documents');
    assert.ok(Buffer.byteLength(JSON.stringify(page))<1024*1024);
  });
  console.log(`PASS ${checks} document catalog PostgreSQL checks`);
}, {name:'document-catalog'});
console.log('Disposable local PostgreSQL stopped; exact temporary cluster removed');
