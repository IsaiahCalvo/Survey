// Disposable local PostgreSQL, real Yjs/PDF transform, synthetic Storage
// metadata/byte receipts. No hosted provider, account, or connection inputs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import * as Y from 'yjs';
import { PDFDocument } from 'pdf-lib';
import { withDisposablePostgres } from './helpers/disposablePostgres.mjs';
import { syncByPageToDoc, syncSurveyMarkersToDoc } from '../src/services/annotationDocStore.js';
import { mapSurveyMarkerRowToLocalAnnotation } from '../src/services/documentSurveyMarkerMapper.js';
import { transformDocumentGenerationSource } from '../src/services/documentGenerationTransform.js';
import { mutatePdfPagesWithIdentity } from '../src/utils/pdfPageMutation.js';
assert.equal(process.argv.length, 2);
const target = '20260909098000_document_generation_publication.sql';
const migrationPath = name => fileURLToPath(new URL(`../supabase/migrations/${name}`, import.meta.url));
const source = name => readFileSync(migrationPath(name), 'utf8');
const fn = (file, name) => { const s = source(file), a = s.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`), b = s.indexOf('$$;', a); assert.ok(a >= 0 && b > a); return s.slice(a, b + 3); };
const id = n => `98000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const owner = id(1), editor = id(2), viewer = id(3), other = id(4), project = id(5), version = id(9);
const sha = v => createHash('sha256').update(v).digest('hex'), b64 = v => Buffer.from(v).toString('base64');
const pdfDoc = await PDFDocument.create(); for (let i = 0; i < 3; i++) pdfDoc.addPage([612, 792]);
const originalPdf = await pdfDoc.save();
await withDisposablePostgres(async pg => {
  const { sql, scalar, asRole, errorState, session, applyMigration, quote } = pg;
  const prior = readFileSync(new URL('./test-document-generation-source-receipts-postgres.mjs', import.meta.url), 'utf8');
  const a = prior.indexOf('  const prior='), b = prior.indexOf('  const doc='); assert.ok(a >= 0 && b > a);
  new Function('sql', 'applyMigration', 'migrationPath', 'readFileSync', 'source', 'fn', 'owner', 'editor', 'viewer', 'other', 'project', 'assert',
    prior.slice(a, b).replaceAll("'import.meta.url'", "'__KEEP_IMPORT_META__'")
      .replaceAll('import.meta.url', JSON.stringify(new URL('./test-document-generation-source-receipts-postgres.mjs', import.meta.url).href))
      .replaceAll('__KEEP_IMPORT_META__', 'import.meta.url'))
    (sql, applyMigration, migrationPath, readFileSync, source, fn, owner, editor, viewer, other, project, assert);
  for (const name of ['20260909092000_document_generation_source_receipts.sql', '20260909093000_document_generation_source_bytes.sql',
    '20260909094000_document_generation_source_bound_uploads.sql', '20260909095000_document_generation_source_archives.sql',
    '20260909096000_document_generation_transform_source.sql', '20260909097000_document_generation_retention.sql']) applyMigration(migrationPath(name));
  applyMigration(migrationPath('20260425121704_extend_document_annotations_for_all_types.sql'));
  const timestamp = source('20241230000002_create_document_annotations.sql');
  sql(timestamp.slice(timestamp.indexOf('CREATE OR REPLACE FUNCTION update_document_tables_updated_at()'), timestamp.indexOf('CREATE TRIGGER trigger_update_document_collaborators_updated_at')));
  sql(source('20260518000000_rename_ball_in_court_to_entity.sql').split('\n').filter(line => line.startsWith('ALTER TABLE document_annotations RENAME COLUMN')).join('\n'));
  applyMigration(migrationPath('20260518000001_survey_marker_widen_type_check.sql'));
  applyMigration(migrationPath('20260603130000_db_sync_annotations_changed_at.sql'));
  sql(`INSERT INTO templates(id,user_id) VALUES('${id(10)}','${owner}')`);
  applyMigration(migrationPath(target));
  let serial = 100, groups = 0;
  const fresh = () => id(serial++), bytea = v => `decode('${Buffer.from(v).toString('hex')}','hex')`;
  const call = (name, args) => `SELECT public.${name}(${args.map(quote).join(',')})`;
  const service = (name, args) => JSON.parse(asRole(null, call(name, args), 'service_role').stdout);
  const rows = (table, where) => JSON.parse(scalar(`SET TimeZone='UTC';SET bytea_output='hex';SELECT coalesce(jsonb_agg(to_jsonb(r) ORDER BY r.${table === 'doc_yjs_state' ? 'document_id' : 'id'}),'[]') FROM public.${table} r WHERE ${where}`));
  const seed = () => {
    const d = fresh(), path = `${owner}/${d}.pdf`, sid = fresh();
    sql(`INSERT INTO documents(id,user_id,project_id,name,file_path,file_size,page_count) VALUES('${d}','${owner}','${project}','Publication',${quote(path)},${originalPdf.length},3);
      INSERT INTO storage.objects(bucket_id,name,version,metadata) VALUES('documents',${quote(path)},'${version}',jsonb_build_object('size',${originalPdf.length}));
      INSERT INTO survey_sessions(id,template_id,user_id,document_id,is_active) VALUES('${sid}','${id(10)}','${other}','${d}',false);
      INSERT INTO survey_items(session_id,annotation_id,module_id,category_id,page_number,notes,excel_row_index) VALUES('${sid}','mark','module','category',2,'Private foreign note',9);`);
    const shape = { type: 'rect', pageNumber: 2, left: 10, top: 20, width: 30, height: 40, data: { id: 'mark', pageNumber: 2 }, meta: { authorId: owner } };
    sql(`INSERT INTO document_annotations(document_id,user_id,annotation_id,annotation_type,page_number,bounds,annotation_data) VALUES('${d}','${owner}','mark','square',2,'{"x":10,"y":20,"width":30,"height":40}',${quote(JSON.stringify({ fabricObject: shape, pageNumber: 2 }))});
      INSERT INTO document_annotations(document_id,user_id,annotation_id,annotation_type,page_number,bounds,name,version,last_modified_by,annotation_data)
        VALUES('${d}','${owner}','survey','survey-marker',2,'{"x":10,"y":20,"width":30,"height":40}','Shared marker',3,'${owner}','{"scope":"survey","pageNumber":2}')`);
    const markerRow = rows('document_annotations', `document_id='${d}'`).find(r => r.annotation_id === 'survey');
    const marker = mapSurveyMarkerRowToLocalAnnotation(markerRow); for (const key of Object.keys(marker)) if (marker[key] === undefined) delete marker[key];
    const modern = new Y.Doc(); syncByPageToDoc(modern, { 2: { objects: [shape] } }); syncSurveyMarkersToDoc(modern, { survey: marker });
    assert.equal(asRole(owner, `SELECT public.store_annotation_snapshot('${d}',0,${bytea(Y.encodeStateAsUpdate(modern))},1,'publisher-test',1,NULL,NULL,0)`).stdout, 't'); modern.destroy();
    const legacy = new Y.Doc(), record = new Y.Map(); record.set('id', 'mark'); record.set('type', 'rect'); record.set('pageNumber', 2);
    record.set('fabric', new Y.Map(Object.entries(shape))); record.set('meta', new Y.Map([['authorId', owner]])); legacy.getMap('annotations').set('mark', record);
    sql(`INSERT INTO doc_yjs_state(document_id,state,state_vector,through_seq) VALUES('${d}',${bytea(Y.encodeStateAsUpdate(legacy))},${bytea(Y.encodeStateVector(legacy))},0)`); legacy.destroy();
    return { d, path, sid, pdf: originalPdf, generation: null };
  };
  const prepare = async (x, operation = { type: 'move', from: 2, to: 1 }) => {
    const s = fresh(), actor = x.actor || owner;
    service('begin_document_generation_source', [actor, x.d, s, x.generation]);
    const claim = fresh(), proof = service('claim_document_generation_source_bytes', [actor, s, claim]);
    service('record_document_generation_source_bytes', [actor, s, claim, JSON.stringify(proof.objects.map(o => ({ ...o, content_sha256: sha(x.pdf) })))]);
    const envelope = service('read_document_generation_transform_source', [actor, s]);
    const mutation = await mutatePdfPagesWithIdentity(x.pdf, operation), nextPdf = mutation.bytes;
    const verify = u => {
      asRole(null, `INSERT INTO storage.objects(bucket_id,name,version,metadata) VALUES('documents',${quote(u.path)},'${version}',jsonb_build_object('size',${u.byte_length}))`, 'service_role');
      const claimId = fresh(), p = service('claim_document_generation_upload_verification', [actor, u.operation_id, claimId]);
      service('record_document_generation_upload_verification', [actor, u.operation_id, p.object.id, p.object.version, u.content_sha256, u.byte_length, claimId]); return u;
    };
    const u = verify(JSON.parse(asRole(actor, call('begin_document_generation_upload_v2', [s, fresh(), 'candidate-pdf', sha(nextPdf), String(nextPdf.length)])).stdout));
    const archives = proof.objects.map(o => verify(JSON.parse(asRole(actor, call('begin_document_generation_source_archive', [s, fresh(), o.id])).stdout)));
    const current = await PDFDocument.load(x.pdf);
    const result = await transformDocumentGenerationSource({ sourcePayload: envelope.payload, sidecars: [], operationId: u.operation_id, operation,
      pageCount: current.getPageCount(), pageSizes: current.getPages().map(p => p.getSize()), copiedWidgets: mutation.copiedWidgets });
    const c = result.legacyCheckpoint;
    const plan = { version: 1, operationId: result.operationId, source: result.source, operation, projection: result.projection,
      baseline_base64: b64(result.baselineUpdate), legacy: { documentId: c.documentId, encodingVersion: c.encodingVersion, throughSeq: c.throughSeq,
        state_base64: b64(c.state), state_vector_base64: b64(c.stateVector) } };
    return { ...x, actor, s, envelope, u, archives, result, plan, nextPdf };
  };
  const publishSql = (x, plan = x.plan) => `SELECT survey_private.publish_document_generation('${x.actor}','${x.s}','${x.u.operation_id}',ARRAY[${x.archives.map(a => quote(a.operation_id)).join(',')}]::uuid[],${quote(JSON.stringify(plan))}::jsonb)`;
  const publish = x => JSON.parse(scalar(publishSql(x)));
  const snapshot = x => scalar(`SET TimeZone='UTC';SET bytea_output='hex';SELECT jsonb_build_object('document',(SELECT to_jsonb(d) FROM documents d WHERE id='${x.d}'),
    'annotations',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM document_annotations r WHERE document_id='${x.d}'),
    'state',(SELECT to_jsonb(r) FROM doc_yjs_state r WHERE document_id='${x.d}'),
    'items',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM survey_items r WHERE session_id='${x.sid}'),
    'head',(SELECT to_jsonb(r) FROM survey_private.annotation_generation_heads r WHERE document_id='${x.d}'),
    'bundles',(SELECT count(*) FROM survey_private.document_generation_bundles WHERE document_id='${x.d}'))`);
  const check = async (label, work) => {
    await work(); groups++; console.log(`PASS ${label}`);
    // Each group owns fresh fixture documents. Release completed capture leases
    // between groups; retained bodies stay pinned by their real bundles.
    sql("SELECT survey_private.release_document_generation_source(source_id,'canceled') FROM survey_private.document_generation_sources WHERE state='captured'");
  };

  await check('publisher is not callable by application or service roles', async () => {
    const x = await prepare(seed());
    for (const role of ['anon', 'authenticated', 'service_role']) {
      errorState(asRole(owner, publishSql(x), role, false), '42501');
      for (const table of ['document_generation_publications', 'generation_publication_context', 'generation_publication_tickets'])
        errorState(asRole(owner, `SELECT * FROM survey_private.${table}`, role, false), '42501');
      errorState(asRole(owner, `SELECT survey_private.consume_generation_publication_row('${x.d}','public.document_annotations'::regclass,'UPDATE',NULL,NULL)`, role, false), '42501');
    }
    assert.equal(scalar(`SELECT count(*) FROM survey_private.annotation_generation_heads WHERE document_id='${x.d}'`), '0');
  });
  await check('first publication and second copy atomically preserve SQL, Yjs and foreign surveys', async () => {
    const x = await prepare(seed()), receipt = publish(x), after = snapshot(x);
    assert.deepEqual(publish(x), receipt); assert.equal(snapshot(x), after, 'retry does not rewrite timestamps or revisions');
    assert.equal(scalar(`SELECT generation_id FROM survey_private.annotation_generation_heads WHERE document_id='${x.d}'`), x.u.generation_id);
    assert.equal(scalar(`SELECT file_path FROM documents WHERE id='${x.d}'`), x.u.path);
    assert.equal(rows('document_annotations', `document_id='${x.d}'`).every(r => r.page_number === 1), true);
    const second = await prepare({ ...x, pdf: x.nextPdf, generation: x.u.generation_id }, { type: 'duplicate', page: 1 }); publish(second);
    assert.equal(rows('document_annotations', `document_id='${x.d}'`).length, 4);
    const items = rows('survey_items', `session_id='${x.sid}'`); assert.equal(items.length, 2);
    assert.equal(items.find(i => i.annotation_id === 'mark').excel_row_index, 9);
    assert.equal(items.find(i => i.annotation_id !== 'mark').excel_row_index, null);
    assert.ok(items.every(i => i.notes === 'Private foreign note'));
    const third = await prepare({ ...second, pdf: second.nextPdf, generation: second.u.generation_id }, { type: 'delete', page: 1 }); publish(third);
    assert.equal(rows('document_annotations', `document_id='${x.d}'`).length, 2);
    assert.equal(rows('survey_items', `session_id='${x.sid}'`).length, 1);
    assert.equal(scalar(`SELECT count(*) FROM survey_private.annotation_generations WHERE document_id='${x.d}'`), '3');
    const latest = snapshot(third); assert.deepEqual(publish(x), receipt); assert.equal(snapshot(third), latest, 'historical receipt never rewinds a later version');
    for (const role of ['authenticated', 'service_role']) errorState(asRole(owner, `UPDATE document_annotations SET page_number=3 WHERE document_id='${x.d}'`, role, false), 'SG001');
    errorState(asRole(null, `UPDATE survey_items SET page_number=3 WHERE session_id='${x.sid}'`, 'service_role', false), 'SG001');
    errorState(asRole(null, `UPDATE doc_yjs_state SET through_seq=999 WHERE document_id='${x.d}'`, 'service_role', false), 'SG001');
  });
  await check('stale SQL state rejects before any row, head or retention change', async () => {
    const x = await prepare(seed()); sql(`UPDATE survey_items SET notes='New collaborator edit' WHERE session_id='${x.sid}'`);
    const before = snapshot(x); errorState(sql(publishSql(x), false), '40001'); assert.equal(snapshot(x), before);
  });
  await check('failure after projection writes rolls the entire publication back', async () => {
    const x = await prepare(seed()), before = snapshot(x);
    sql(`CREATE FUNCTION public.publication_test_fail_head() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'Owned fixture fails at head';END;$$;
      CREATE TRIGGER z_publication_test_fail_head BEFORE INSERT OR UPDATE ON survey_private.annotation_generation_heads FOR EACH ROW EXECUTE FUNCTION public.publication_test_fail_head()`);
    try { const r = sql(publishSql(x), false); assert.notEqual(r.status, 0); assert.match(r.stderr, /Owned fixture fails at head/); }
    finally { sql('DROP TRIGGER z_publication_test_fail_head ON survey_private.annotation_generation_heads;DROP FUNCTION public.publication_test_fail_head()'); }
    assert.equal(snapshot(x), before); publish(x);
  });
  await check('held document write makes publication fail fast without partial state', async () => {
    const x = await prepare(seed()), before = snapshot(x), held = session('publication_doc_lock', { role: 'postgres' });
    held.send(`SELECT id FROM documents WHERE id='${x.d}' FOR UPDATE;SELECT 'held';`); await held.wait('held');
    const result = sql(publishSql(x), false); assert.notEqual(result.status, 0); assert.match(result.stderr, /55P03|40001/);
    assert.equal((await held.finish(false)).status, 0); assert.equal(snapshot(x), before); publish(x);
  });
  await check('retained assets alone do not bypass fresh source CAS', async () => {
    const x = await prepare(seed());
    sql(`SELECT survey_private.retain_document_generation_bundle('${x.actor}','${x.s}','${x.u.operation_id}',ARRAY[${x.archives.map(a => quote(a.operation_id)).join(',')}]::uuid[])`);
    sql(`UPDATE survey_items SET notes='Edit after retention' WHERE session_id='${x.sid}'`);
    const before = snapshot(x); errorState(sql(publishSql(x), false), '40001'); assert.equal(snapshot(x), before);
  });
  await check('wrong identities and unsupported lanes fail without partial publication', async () => {
    const x = await prepare(seed()), before = snapshot(x);
    for (const change of [
      p => { p.operationId = fresh(); }, p => { p.source.documentId = fresh(); }, p => { p.source.walHead = '99'; },
      p => { p.projection.document.user_id = other; }, p => { p.projection.surveySessions = []; },
      p => { p.projection.sidecars = [{ path: 'unbound', content: { version: 1 } }]; },
      p => { p.legacy.documentId = fresh(); }, p => { p.legacy.throughSeq = '-1'; },
      p => { p.projection.documentAnnotations[0].document_id = fresh(); },
      p => { p.projection.surveyItems[0].session_id = fresh(); },
    ]) {
      const plan = structuredClone(x.plan); change(plan); assert.notEqual(sql(publishSql(x, plan), false).status, 0); assert.equal(snapshot(x), before);
    }
    publish(x);
    const changed = structuredClone(x.plan); changed.projection.document.current_page = 3;
    assert.notEqual(sql(publishSql(x, changed), false).status, 0, 'same operation cannot accept changed plan');
  });
  await check('caller timezone and bytea settings cannot change exact row matching', async () => {
    const x = await prepare(seed());
    const result = sql(`SET TimeZone='Pacific/Honolulu';SET bytea_output='escape';${publishSql(x)}`);
    assert.equal(result.status, 0); assert.equal(scalar(`SELECT file_path FROM documents WHERE id='${x.d}'`), x.u.path);
    assert.deepEqual(publish(x), JSON.parse(result.stdout));
  });
  await check('role revocation denies a prepared publication and a previously successful receipt', async () => {
    const x = seed(); sql(`INSERT INTO document_collaborators(document_id,user_id,role,status) VALUES('${x.d}','${editor}','editor','active')`);
    const prepared = await prepare({ ...x, actor: editor });
    sql(`UPDATE document_collaborators SET role='viewer' WHERE document_id='${x.d}' AND user_id='${editor}'`);
    const before = snapshot(prepared); errorState(sql(publishSql(prepared), false), '42501'); assert.equal(snapshot(prepared), before);
    sql(`UPDATE document_collaborators SET role='editor' WHERE document_id='${x.d}' AND user_id='${editor}'`); publish(prepared);
    sql(`UPDATE document_collaborators SET role='viewer' WHERE document_id='${x.d}' AND user_id='${editor}'`);
    errorState(sql(publishSql(prepared), false), '42501');
  });
  await check('final document proof detects a trigger changing the planned page count', async () => {
    const x = await prepare(seed()), before = snapshot(x);
    sql(`CREATE FUNCTION public.publication_test_change_page() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN UPDATE public.documents SET page_count=999 WHERE id=NEW.id;RETURN NEW;END;$$;
      CREATE TRIGGER z_publication_test_change_page AFTER UPDATE OF file_path ON public.documents FOR EACH ROW WHEN(OLD.file_path IS DISTINCT FROM NEW.file_path) EXECUTE FUNCTION public.publication_test_change_page()`);
    try { assert.notEqual(sql(publishSql(x), false).status, 0); }
    finally { sql('DROP TRIGGER z_publication_test_change_page ON public.documents;DROP FUNCTION public.publication_test_change_page()'); }
    assert.equal(snapshot(x), before); publish(x);
  });
  await check('owner closing and non-read-committed transactions cannot publish', async () => {
    const x = await prepare(seed()), before = snapshot(x);
    const closed = sql(`BEGIN;UPDATE survey_private.account_write_guards SET closing=true WHERE user_id='${owner}';${publishSql(x)};COMMIT`, false);
    errorState(closed, '23514'); assert.equal(snapshot(x), before);
    errorState(sql(`BEGIN ISOLATION LEVEL REPEATABLE READ;${publishSql(x)};COMMIT`, false), '25001'); assert.equal(snapshot(x), before);
  });
  await check('published receipts are immutable and actual document deletion cleans its owned bindings', async () => {
    const x = await prepare(seed()); publish(x);
    errorState(sql(`UPDATE survey_private.document_generation_publications SET plan_sha256=repeat('0',64) WHERE operation_id='${x.u.operation_id}'`, false), '23514');
    errorState(sql(`DELETE FROM survey_private.document_generation_publications WHERE operation_id='${x.u.operation_id}'`, false), '23514');
    sql(`DELETE FROM documents WHERE id='${x.d}'`);
    assert.equal(scalar(`SELECT count(*) FROM survey_private.document_generation_publications WHERE document_id='${x.d}'`), '0');
    assert.equal(scalar(`SELECT count(*) FROM survey_private.document_generation_bundles WHERE document_id='${x.d}'`), '0');
    assert.equal(scalar('SELECT count(*) FROM survey_private.generation_publication_context'), '0');
    assert.equal(scalar('SELECT count(*) FROM survey_private.generation_publication_tickets'), '0');
  });
  await check('page-derived ID swaps retain annotation and survey row identities', async () => {
    const x = seed(), modern = new Y.Doc(), shapes = {};
    sql(`DELETE FROM document_annotations WHERE document_id='${x.d}';DELETE FROM survey_items WHERE session_id='${x.sid}';DELETE FROM doc_yjs_state WHERE document_id='${x.d}'`);
    for (const p of [1, 2]) {
      const annotationId = `form-field:${p}:shared-field`;
      const shape = { type: 'form-field', id: annotationId, pageNumber: p, fieldId: 'shared-field',
        data: { id: annotationId, type: 'form-field', pageNumber: p, fieldId: 'shared-field', value: 'kept' }, meta: { authorId: owner } };
      shapes[p] = { objects: [shape] };
      sql(`INSERT INTO document_annotations(document_id,user_id,annotation_id,annotation_type,page_number,bounds,annotation_data)
        VALUES('${x.d}','${owner}',${quote(annotationId)},'square',${p},'{"x":10,"y":20}',${quote(JSON.stringify({ fabricObject: shape, pageNumber: p }))});
        INSERT INTO survey_items(session_id,annotation_id,module_id,category_id,page_number,notes,excel_row_index)
        VALUES('${x.sid}',${quote(annotationId)},'module','category',${p},'Linked form item',${p + 5})`);
    }
    syncByPageToDoc(modern, shapes);
    assert.equal(asRole(owner, `SELECT public.store_annotation_snapshot('${x.d}',0,${bytea(Y.encodeStateAsUpdate(modern))},1,'publisher-test',2,0,'publisher-test',1)`).stdout, 't'); modern.destroy();
    const oldAnnotations = rows('document_annotations', `document_id='${x.d}'`), oldItems = rows('survey_items', `session_id='${x.sid}'`);
    for (const item of oldItems) sql(`INSERT INTO survey_sync_log(session_id,item_id,change_type,source,user_id) VALUES('${x.sid}','${item.id}','update','app','${other}')`);
    const historyBefore = rows('survey_sync_log', `session_id='${x.sid}'`);
    const prepared = await prepare(x, { type: 'move', from: 1, to: 2 }); publish(prepared);
    const newAnnotations = rows('document_annotations', `document_id='${x.d}'`), newItems = rows('survey_items', `session_id='${x.sid}'`);
    for (const [oldRows, newRows] of [[oldAnnotations, newAnnotations], [oldItems, newItems]]) for (const old of oldRows) {
      const current = newRows.find(r => r.id === old.id); assert.ok(current);
      assert.equal(current.page_number, 3 - old.page_number); assert.equal(current.annotation_id, `form-field:${3 - old.page_number}:shared-field`);
      if (old.user_id) assert.equal(current.user_id, old.user_id);
      if (old.notes) assert.equal(current.notes, old.notes);
    }
    assert.deepEqual(rows('survey_sync_log', `session_id='${x.sid}'`), historyBefore, 'rekeys never detach existing history foreign keys');
  });
  await check('authority query count stays bounded for larger set-based publications', async () => {
    const counts = [];
    for (const count of [100, 500]) {
      const x = seed();
      const values = Array.from({ length: count }, (_, i) => {
        const shape = { type: 'rect', pageNumber: 2, left: i, top: 1, width: 5, height: 5,
          data: { id: `scale-${i}`, pageNumber: 2 }, meta: { authorId: owner } };
        return `('${x.d}','${owner}','scale-${i}','square',2,'{"x":1,"y":1}',${quote(JSON.stringify({ fabricObject: shape, pageNumber: 2 }))})`;
      });
      sql(`INSERT INTO document_annotations(document_id,user_id,annotation_id,annotation_type,page_number,bounds,annotation_data) VALUES ${values.join(',')}`);
      const modern = new Y.Doc(), all = rows('document_annotations', `document_id='${x.d}'`), markers = {};
      syncByPageToDoc(modern, { 2: { objects: all.filter(r => r.annotation_type === 'square').map(r => r.annotation_data.fabricObject) } });
      for (const row of all.filter(r => r.annotation_type === 'survey-marker')) {
        const marker = mapSurveyMarkerRowToLocalAnnotation(row); for (const k of Object.keys(marker)) if (marker[k] === undefined) delete marker[k]; markers[row.annotation_id] = marker;
      }
      syncSurveyMarkersToDoc(modern, markers);
      assert.equal(asRole(owner, `SELECT public.store_annotation_snapshot('${x.d}',0,${bytea(Y.encodeStateAsUpdate(modern))},1,'publisher-test',2,0,'publisher-test',1)`).stdout, 't'); modern.destroy();
      const prepared = await prepare(x); sql('SELECT pg_stat_reset()');
      const started = performance.now(); sql(`SET track_functions='all';${publishSql(prepared)}`); const elapsed = Math.round(performance.now() - started);
      const calls = Number(scalar("SELECT coalesce(sum(s.calls),0) FROM pg_stat_user_functions s JOIN pg_proc p ON p.oid=s.funcid WHERE p.proname='assert_document_generation_upload_authority'"));
      assert.ok(calls > 0 && calls <= 20, `authority checks grew with rows: ${calls}`); counts.push(calls);
      assert.equal(rows('document_annotations', `document_id='${x.d}'`).length, count + 2);
      console.log(`MEASURE ${count + 2} rows: authority_calls=${calls}, publication_ms=${elapsed}`);
    }
    assert.equal(counts[0], counts[1], 'more rows must not multiply full permission queries');
  });
  await check('publication rolls back if its successor would exceed the full-source capture bound', async () => {
    const x = seed();
    asRole(owner, `INSERT INTO annotation_updates(document_id,client_id,client_seq,data)
      SELECT '${x.d}','capacity-fixture',n,decode('0000','hex') FROM generate_series(1,9994) n`);
    const at = scalar(`SELECT max(seq) FROM annotation_updates WHERE document_id='${x.d}'`);
    const bytes = Buffer.from(scalar(`SELECT encode(snapshot,'hex') FROM annotation_snapshots WHERE document_id='${x.d}'`), 'hex');
    assert.equal(asRole(owner, `SELECT public.store_annotation_snapshot('${x.d}',${at},${bytea(bytes)},1,'publisher-test',2,0,'publisher-test',1)`).stdout, 't');
    const prepared = await prepare(x, { type: 'duplicate', page: 2 }), before = snapshot(x);
    assert.equal(prepared.envelope.payload.wal_history.legacy.length, 9994);
    errorState(sql(publishSql(prepared), false), '54000'); assert.equal(snapshot(x), before);
    assert.equal(scalar(`SELECT count(*) FROM survey_private.document_generation_publications WHERE document_id='${x.d}'`), '0');
    assert.equal(scalar('SELECT count(*) FROM survey_private.generation_publication_context'), '0');
    assert.equal(scalar('SELECT count(*) FROM survey_private.generation_publication_tickets'), '0');
  });
  console.log(`Document generation publication PostgreSQL groups passed: ${groups}`);
}, { name: 'generation-publication', commandTimeoutMs: 60000 });
console.log('Disposable local PostgreSQL stopped; exact temporary cluster removed');
