// Disposable local PostgreSQL, real Yjs/PDF transform, synthetic Storage
// metadata/byte receipts. No hosted provider, account, or connection inputs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { gzipSync } from 'node:zlib';
import { createServer } from 'node:http';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import * as Y from 'yjs';
import { PDFDocument } from 'pdf-lib';
import { withDisposablePostgres } from './helpers/disposablePostgres.mjs';
import { syncByPageToDoc, syncSurveyMarkersToDoc } from '../src/services/annotationDocStore.js';
import { mapSurveyMarkerRowToLocalAnnotation } from '../src/services/documentSurveyMarkerMapper.js';
import { transformDocumentGenerationSource } from '../src/services/documentGenerationTransform.js';
import { mutatePdfPagesWithIdentity } from '../src/utils/pdfPageMutation.js';
import { createDocumentGenerationReader } from '../src/services/documentGenerationReader.js';
import { createDocumentGenerationDownload } from '../src/services/documentGenerationDownload.js';
import { handleDocumentGenerationDownload } from '../supabase/functions/document-generation-download/handler.js';
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
// Exact owned loopback server only. Provider/SQL adapters are supplied by the
// local fixture; no hosted URL, account or credentials can enter this bridge.
async function withDownloadHttp(handler, dependencies, work) {
  const sockets = new Set(), requests = new Set(), errors = [];
  const server = createServer((incoming, outgoing) => {
    const abort = new AbortController();
    incoming.on('aborted', () => abort.abort());
    outgoing.on('close', () => { if (!outgoing.writableEnded) abort.abort(); });
    const task = (async () => {
      const request = new Request(`http://127.0.0.1:${server.address().port}${incoming.url}`, {
        method: incoming.method, headers: incoming.headers, signal: abort.signal,
        ...(incoming.method === 'GET' || incoming.method === 'HEAD' ? {} : { body: Readable.toWeb(incoming), duplex: 'half' }),
      });
      const response = await handler(request, dependencies);
      outgoing.writeHead(response.status, Object.fromEntries(response.headers));
      if (response.body) await pipeline(Readable.fromWeb(response.body), outgoing, { signal: abort.signal });
      else outgoing.end();
    })();
    requests.add(task);
    task.then(() => requests.delete(task), error => {
      requests.delete(task); errors.push(error?.code || error?.name || 'stream-error');
      if (!outgoing.headersSent) { outgoing.writeHead(500); outgoing.end('Owned fixture stream failed'); }
      else outgoing.destroy();
    });
  });
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  try { return await work({ url: `http://127.0.0.1:${server.address().port}`, sockets, requests, errors }); }
  finally {
    const closed = new Promise(resolve => server.close(resolve));
    for (const socket of sockets) socket.destroy();
    await Promise.allSettled([...requests]); await closed;
    assert.equal(server.listening, false); assert.equal(requests.size, 0);
  }
}
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
  applyMigration(migrationPath('20260909099000_document_generation_open.sql'));
  // Use the current shipped role implementation, including archive policy and
  // direct-role precedence. The inherited fixture otherwise has no role RPC.
  const roleDefinition = fn('20260802000000_kal426_user_archive_foundation.sql', 'get_my_document_role');
  sql(roleDefinition);
  applyMigration(migrationPath('20260909100000_document_generation_collaboration.sql'));
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
  assert.equal(groups, 15, 'Preserve all original publication groups');
  const readFixture = await prepare(seed()); publish(readFixture);
  sql(`INSERT INTO document_collaborators(document_id,user_id,role,status) VALUES
    ('${readFixture.d}','${viewer}','viewer','active'),('${readFixture.d}','${editor}','editor','active')`);
  const openSql = (x, { generation = null, includeSnapshot = true } = {}) =>
    `SELECT public.read_document_generation_open('${x.d}',${quote(generation)},${includeSnapshot === null ? 'NULL' : includeSnapshot})`;
  const open = (x, actor = owner, options) => JSON.parse(asRole(actor, openSql(x, options)).stdout);
  const readAs = actor => `SET LOCAL ROLE authenticated;SELECT set_config('request.jwt.claim.sub','${actor}',true);`;
  await check('checked open grants only authenticated and returns exact current public fields', async () => {
    for (const role of ['anon', 'service_role']) errorState(asRole(owner, openSql(readFixture), role, false), '42501');
    assert.equal(scalar("SELECT count(*) FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a WHERE p.oid='public.read_document_generation_open(uuid,uuid,boolean)'::regprocedure AND a.grantee=0"), '0');
    for (const actor of [owner, editor, viewer]) {
      const result = open(readFixture, actor), exact = JSON.parse(asRole(actor, `SELECT public.read_annotation_snapshot_v2('${readFixture.d}','${readFixture.u.generation_id}')`).stdout);
      assert.deepEqual(Object.keys(result).sort(), ['version','actor_user_id','document_id','generation_id','document','publication','pdf','annotations'].sort());
      assert.equal(result.actor_user_id, actor); assert.equal(result.generation_id, readFixture.u.generation_id);
      assert.equal(result.document.file_path, readFixture.u.path); assert.equal(result.document.file_size, String(readFixture.nextPdf.length));
      assert.deepEqual(result.annotations, { ...exact, snapshot_sha256: sha(Buffer.from(exact.snapshot.snapshot.slice(2), 'hex')) });
      assert.deepEqual(Object.keys(result.publication).sort(), ['operation_id','generation_id','published_at','wal_head'].sort());
      assert.deepEqual(Object.keys(result.pdf).sort(), ['bucket_id','path','id','version','byte_length','content_sha256'].sort());
      assert.equal(result.pdf.content_sha256, sha(readFixture.nextPdf)); assert.equal(result.pdf.byte_length, String(readFixture.nextPdf.length));
      assert.ok(!JSON.stringify(result).includes('Private foreign note')); assert.ok(!('source_id' in result.publication));
      const doc = new Y.Doc(); Y.applyUpdate(doc, Buffer.from(exact.snapshot.snapshot.slice(2), 'hex'));
      assert.ok(!JSON.stringify(doc.toJSON()).includes('Private foreign note')); doc.destroy();
    }
    applyMigration(migrationPath('20260909099000_document_generation_open.sql'));
    assert.deepEqual(open(readFixture, viewer), open(readFixture, viewer, { generation: readFixture.u.generation_id }));
  });
  await check('checked open preserves inherited and direct access routes', async () => {
    const x = await prepare(seed()); publish(x);
    assert.equal(scalar(`SELECT role FROM project_collaborators WHERE project_id='${project}' AND user_id='${viewer}'`), 'viewer');
    try {
      assert.equal(open(x, viewer).actor_user_id, viewer);
      sql(`INSERT INTO document_collaborators(document_id,user_id,role,status) VALUES('${x.d}','${viewer}','viewer','active')`);
      assert.equal(open(x, viewer).generation_id, x.u.generation_id);
      sql(`DELETE FROM document_collaborators WHERE document_id='${x.d}' AND user_id='${viewer}'`);
      sql(`DELETE FROM project_collaborators WHERE project_id='${project}' AND user_id='${viewer}'`);
      errorState(asRole(viewer, openSql(x), 'authenticated', false), '42501');
    } finally { sql(`DELETE FROM project_collaborators WHERE project_id='${project}' AND user_id='${viewer}'`); }
  });
  await check('checked open refuses outsiders missing legacy stale and invalid snapshot modes', async () => {
    errorState(asRole(other, openSql(readFixture), 'authenticated', false), '42501');
    errorState(asRole(owner, openSql({ d: fresh() }), 'authenticated', false), '42501');
    const legacy = seed(); errorState(asRole(owner, openSql(legacy), 'authenticated', false), 'SG001');
    errorState(asRole(owner, openSql(readFixture, { generation: fresh() }), 'authenticated', false), 'SG002');
    errorState(asRole(owner, openSql(readFixture, { includeSnapshot: null }), 'authenticated', false), '22023');
    errorState(sql(`BEGIN ISOLATION LEVEL REPEATABLE READ;${readAs(owner)}${openSql(readFixture)};COMMIT`, false), '25001');
  });
  await check('both open modes fence actor and owner account closure', async () => {
    for (const account of [owner, viewer]) for (const includeSnapshot of [true, false]) {
      errorState(sql(`BEGIN;UPDATE survey_private.account_write_guards SET closing=true WHERE user_id='${account}';
        ${readAs(viewer)}${openSql(readFixture, { includeSnapshot })};COMMIT`, false), '23514');
      assert.equal(open(readFixture, viewer, { includeSnapshot }).actor_user_id, viewer);
    }
  });
  await check('first viewer guard creation serializes with real account closure in both orders', async () => {
    const first = fresh(), second = fresh();
    for (const actor of [first, second]) {
      sql(`INSERT INTO auth.users(id) VALUES('${actor}');INSERT INTO document_collaborators(document_id,user_id,role,status)
        VALUES('${readFixture.d}','${actor}','viewer','active')`);
      assert.equal(scalar(`SELECT count(*) FROM survey_private.account_write_guards WHERE user_id='${actor}'`), '0');
    }
    const closing = session('open_new_viewer_close', { role: 'service_role' });
    closing.send(`SELECT public.delete_account_owned_rows('${first}');SELECT 'closing-held';`); await closing.wait('closing-held');
    errorState(asRole(first, openSql(readFixture), 'authenticated', false), '55P03');
    assert.equal((await closing.finish()).status, 0);
    errorState(asRole(first, openSql(readFixture, { includeSnapshot: false }), 'authenticated', false), '23514');
    const reading = session('open_new_viewer_read', { role: 'authenticated', actorId: second });
    reading.send(`${openSql(readFixture, { includeSnapshot: false })};SELECT 'first-read-held';`); await reading.wait('first-read-held');
    errorState(asRole(null, `SELECT public.delete_account_owned_rows('${second}')`, 'service_role', false), '55P03');
    assert.equal((await reading.finish()).status, 0);
    assert.equal(scalar(`SELECT closing FROM survey_private.account_write_guards WHERE user_id='${second}'`), 'f');
    asRole(null, `SELECT public.delete_account_owned_rows('${second}')`, 'service_role');
    errorState(asRole(second, openSql(readFixture), 'authenticated', false), '23514');
    assert.equal(open(readFixture, owner).document_id, readFixture.d, 'Closing viewers cannot delete the owner document');
  });
  await check('user-archived adopted documents remain owner-only', async () => {
    const x = await prepare(seed()); publish(x);
    sql(`INSERT INTO document_collaborators(document_id,user_id,role,status) VALUES('${x.d}','${viewer}','viewer','active'),('${x.d}','${editor}','editor','active');
      UPDATE documents SET user_archived_at=now() WHERE id='${x.d}'`);
    for (const includeSnapshot of [true, false]) {
      assert.equal(open(x, owner, { includeSnapshot }).document_id, x.d);
      for (const actor of [viewer, editor]) errorState(asRole(actor, openSql(x, { includeSnapshot }), 'authenticated', false), '42501');
    }
  });
  await check('open requires publication receipt and exact current PDF metadata', async () => {
    const x = await prepare(seed());
    sql(`SELECT survey_private.retain_document_generation_bundle('${x.actor}','${x.s}','${x.u.operation_id}',ARRAY[${x.archives.map(a => quote(a.operation_id)).join(',')}]::uuid[]);
      INSERT INTO survey_private.annotation_generations(document_id,generation_id,base_seq,baseline_snapshot,baseline_encoding_version)
       VALUES('${x.d}','${x.u.generation_id}',0,${bytea(x.result.baselineUpdate)},1);
      INSERT INTO survey_private.annotation_generation_heads VALUES('${x.d}','${x.u.generation_id}',0)`);
    for (const includeSnapshot of [true, false]) {
      errorState(asRole(owner, openSql(x, { includeSnapshot }), 'authenticated', false), '23514');
      errorState(sql(`BEGIN;UPDATE documents SET file_size=file_size+1 WHERE id='${readFixture.d}';${readAs(viewer)}${openSql(readFixture, { includeSnapshot })};COMMIT`, false), '23514');
    }
    // The actual role-independent storage guard already blocks changed object
    // versions before the reader. No disabled guard or fake successful write.
    errorState(sql(`UPDATE storage.objects SET version='${fresh()}' WHERE bucket_id='documents' AND name=${quote(readFixture.u.path)}`, false), '23514');
    assert.equal(open(readFixture, viewer).pdf.version, version);
  });
  await check('repeated opens do not update path guards or amplify account writes', async () => {
    open(readFixture, viewer); // One-time initialization of a never-writing viewer guard.
    const state = () => scalar(`SELECT jsonb_build_object('paths',(SELECT jsonb_agg(to_jsonb(g) ORDER BY encode(path_hash,'hex')) FROM survey_private.document_storage_path_guards g),
      'accounts',(SELECT jsonb_agg(to_jsonb(g) ORDER BY user_id) FROM survey_private.account_write_guards g))`);
    const before = state(); sql('SELECT pg_stat_reset()');
    sql(`SET track_functions='all';BEGIN;${readAs(viewer)}${Array.from({ length: 12 }, (_, n) => openSql(readFixture, { includeSnapshot: n % 2 === 0 })).join(';')};COMMIT`);
    assert.equal(state(), before);
    const writes = Number(scalar("SELECT coalesce(sum(n_tup_ins+n_tup_upd+n_tup_del),0) FROM pg_stat_user_tables WHERE schemaname='survey_private' AND relname IN('document_storage_path_guards','account_write_guards')"));
    assert.equal(writes, 0, 'Warm checked opens perform no account/path row writes');
    assert.equal(Number(scalar("SELECT coalesce(sum(s.calls),0) FROM pg_stat_user_functions s JOIN pg_proc p ON p.oid=s.funcid WHERE p.proname='read_annotation_snapshot_v2'")), 6);
  });
  await check('confirmation avoids checkpoint byte work including an oversized new snapshot', async () => {
    const x = await prepare(seed()); publish(x);
    sql(`INSERT INTO survey_private.annotation_generation_snapshots(document_id,generation_id,at_seq,snapshot,encoding_version,writer_id,writer_epoch)
      VALUES('${x.d}','${x.u.generation_id}',0,convert_to(repeat('x',67108865),'UTF8'),1,'owned-capacity',1)`);
    errorState(asRole(owner, openSql(x), 'authenticated', false), '54000');
    sql('SELECT pg_stat_reset()');
    const result = JSON.parse(sql(`SET track_functions='all';BEGIN;${readAs(owner)}${openSql(x, { includeSnapshot: false })};COMMIT`).stdout.split('\n').at(-1));
    assert.equal(result.annotations.snapshot, null); assert.equal(result.annotations.snapshot_sha256, null);
    assert.equal(result.pdf.path, x.u.path); assert.ok(JSON.stringify(result).length < 10000);
    assert.equal(Number(scalar("SELECT coalesce(sum(s.calls),0) FROM pg_stat_user_functions s JOIN pg_proc p ON p.oid=s.funcid WHERE p.proname='read_annotation_snapshot_v2'")), 0);
    sql(`UPDATE survey_private.annotation_generation_snapshots SET snapshot=decode('0000','hex'),at_seq=1 WHERE document_id='${x.d}'`);
    errorState(asRole(owner, openSql(x), 'authenticated', false), '23514', 'Snapshot cannot run ahead of accepted WAL');
    const below = seed();
    asRole(owner, `SELECT public.append_annotation_update('${below.d}','open-floor',1,decode('0000','hex'))`);
    const prepared = await prepare(below); publish(prepared);
    assert.ok(BigInt(prepared.result.source.walHead) > 0n);
    sql(`INSERT INTO survey_private.annotation_generation_snapshots(document_id,generation_id,at_seq,snapshot,encoding_version,writer_id,writer_epoch)
      VALUES('${prepared.d}','${prepared.u.generation_id}',0,decode('0000','hex'),1,'owned-before-base',1)`);
    errorState(asRole(owner, openSql(prepared), 'authenticated', false), '23514', 'Snapshot cannot precede the publication baseline');
  });
  await check('shared opens coexist and fence both publication and membership revocation', async () => {
    const x = await prepare(seed()); publish(x);
    sql(`INSERT INTO document_collaborators(document_id,user_id,role,status) VALUES('${x.d}','${viewer}','viewer','active')`);
    const held = session('open_reader', { role: 'authenticated', actorId: viewer });
    held.send(`${openSql(x, { includeSnapshot: false })};SELECT 'reader-held';`); await held.wait('reader-held');
    assert.equal(open(x, viewer).generation_id, x.u.generation_id, 'Two readers share the document lock');
    errorState(sql(`UPDATE document_collaborators SET role='editor' WHERE document_id='${x.d}' AND user_id='${viewer}'`, false), '55P03');
    const changed = sql(`SELECT pg_try_advisory_xact_lock(hashtextextended('${x.d}',0))`); assert.equal(changed.stdout, 'f');
    assert.equal((await held.finish(false)).status, 0);
    const revoke = session('open_revoke', { role: 'postgres' });
    revoke.send(`DELETE FROM document_collaborators WHERE document_id='${x.d}' AND user_id='${viewer}';SELECT 'revoke-held';`); await revoke.wait('revoke-held');
    errorState(asRole(viewer, openSql(x), 'authenticated', false), '55P03');
    assert.equal((await revoke.finish()).status, 0);
    errorState(asRole(viewer, openSql(x), 'authenticated', false), '42501');
    const storage = session('open_path', { role: 'postgres' });
    storage.send(`SELECT path_hash FROM survey_private.document_storage_path_guards WHERE path_hash=survey_private.document_storage_path_hash(${quote(x.u.path)}) FOR UPDATE;SELECT 'path-held';`); await storage.wait('path-held');
    errorState(asRole(owner, openSql(x), 'authenticated', false), '55P03');
    assert.equal((await storage.finish(false)).status, 0);
  });
  await check('actual checked reader combines SQL snapshot and tail with exact verified PDF bytes', async () => {
    const x = await prepare(seed()); publish(x);
    sql(`INSERT INTO document_collaborators(document_id,user_id,role,status) VALUES('${x.d}','${viewer}','viewer','active')`);
    const tail = new Y.Doc(); tail.getMap('annoMeta').set('ownedReaderTail', 'accepted after publication');
    const tailBytes = Y.encodeStateAsUpdate(tail); tail.destroy();
    const accepted = JSON.parse(asRole(owner, `SELECT public.append_annotation_update_v2('${x.d}','${x.u.generation_id}','owned-open-tail',1,${bytea(tailBytes)})`).stdout);
    const requests = [], reader = createDocumentGenerationReader({
      getActorUserId: () => viewer,
      request: async (name, params, scope) => {
        assert.equal(scope.actorUserId, viewer); requests.push({ name, params });
        assert.ok(['read_document_generation_open','read_annotation_updates_v2'].includes(name));
        const args = Object.entries(params).map(([k, v]) => `${k}=>${typeof v === 'boolean' ? v : quote(v)}`).join(',');
        return { data: JSON.parse(asRole(viewer, `SELECT public.${name}(${args})`).stdout), error: null };
      },
      download: async (descriptor, scope) => {
        assert.equal(descriptor.path, x.u.path); assert.equal(scope.actorUserId, viewer); return new Blob([x.nextPdf]);
      },
    });
    const result = await reader.open({ documentId: x.d, actorUserId: viewer });
    assert.equal(result.pdfGenerationId, x.u.generation_id); assert.equal(result.throughSeq, String(accepted.seq));
    assert.deepEqual(Buffer.from(await result.pdfBlob.arrayBuffer()), Buffer.from(x.nextPdf));
    const expected = new Y.Doc(), actual = new Y.Doc(); Y.applyUpdate(expected, x.result.baselineUpdate); Y.applyUpdate(expected, tailBytes); Y.applyUpdate(actual, result.annotationUpdate);
    for (const name of ['annotations','surveyMarkers','annoMeta','deletedPdfAnnotations']) { expected.getMap(name); actual.getMap(name); }
    assert.deepEqual(actual.toJSON(), expected.toJSON()); expected.destroy(); actual.destroy();
    assert.equal(requests[0].params.p_include_snapshot, true); assert.equal(requests.at(-1).params.p_include_snapshot, false);
    assert.equal(requests.at(-1).params.p_generation_id, x.u.generation_id);
    // Actual encoding_version=2 means gzip-compressed Yjs v1, not Yjs v2.
    const compressed = gzipSync(result.annotationUpdate);
    const checkpoint = JSON.parse(asRole(owner, `SELECT public.store_annotation_snapshot_v2('${x.d}','${x.u.generation_id}',${accepted.seq},
      ${bytea(compressed)},2,'owned-open-gzip',1,${x.result.source.walHead},NULL,0)`).stdout);
    assert.equal(checkpoint.stored, true);
    const gzipOpen = open(x, viewer); assert.equal(gzipOpen.annotations.snapshot.encoding_version, 2);
    assert.equal(gzipOpen.annotations.snapshot_sha256, sha(compressed));
    const gzipResult = await reader.open({ documentId: x.d, actorUserId: viewer, pdfGenerationId: x.u.generation_id });
    const restored = new Y.Doc(), baseline = new Y.Doc(); Y.applyUpdate(restored, gzipResult.annotationUpdate); Y.applyUpdate(baseline, result.annotationUpdate);
    for (const name of ['annotations','surveyMarkers','annoMeta','deletedPdfAnnotations']) { restored.getMap(name); baseline.getMap(name); }
    assert.deepEqual(restored.toJSON(), baseline.toJSON()); restored.destroy(); baseline.destroy();
    assert.deepEqual(Buffer.from(await gzipResult.pdfBlob.arrayBuffer()), Buffer.from(x.nextPdf));
  });
  assert.equal(groups, 26, 'Preserve all original publication and open groups');
  const until = async (predicate, label, timeout = 4000) => {
    const deadline = performance.now() + timeout;
    while (!predicate()) { assert.ok(performance.now() < deadline, label); await new Promise(resolve => setTimeout(resolve, 10)); }
  };
  const httpFixture = async () => {
    const x = await prepare(seed()); publish(x);
    sql(`INSERT INTO document_collaborators(document_id,user_id,role,status) VALUES('${x.d}','${viewer}','viewer','active')`);
    return x;
  };
  const fixtureToken = 'owned-loopback-viewer-token', otherToken = 'owned-loopback-other-token';
  const httpRead = (actor, d, g) => {
    const result = asRole(actor, `SELECT public.read_document_generation_open('${d}',${quote(g)},false)`, 'authenticated', false);
    if (result.status !== 0) throw Object.assign(new Error('Owned SQL read failed'), { code: result.stderr.match(/ERROR:\s+([A-Z0-9]{5}):/)?.[1] });
    return JSON.parse(result.stdout);
  };
  async function runHttp(x, options, work) {
    const metrics = { http: 0, sql: 0, opened: 0, clientBytes: 0, providerBytes: 0, providerCancels: 0, providerAborted: false, statuses: [], rpc: [] };
    let actor = viewer;
    const bytes = Uint8Array.from(options.bytes || x.nextPdf);
    const dependencies = {
      enabled: true, timeoutMs: 8000,
      getUser: async token => token === fixtureToken ? { id: viewer } : token === otherToken ? { id: other } : null,
      readOpen: async (token, documentId, generationId, signal) => {
        assert.equal(signal.aborted, false); metrics.sql++;
        return httpRead(token === fixtureToken ? viewer : other, documentId, generationId);
      },
      openStream: (pdf, signal) => {
        assert.equal(pdf.path, x.u.path); assert.equal(pdf.content_sha256, sha(x.nextPdf)); metrics.opened++;
        let stage = 0, wake;
        signal.addEventListener('abort', () => { metrics.providerAborted = true; wake?.(); }, { once: true });
        return new ReadableStream({
          async pull(controller) {
            if (stage === 0) { stage++; const chunk = bytes.slice(0, 32); metrics.providerBytes += chunk.length; controller.enqueue(chunk); return; }
            if (stage === 1) {
              stage++;
              if (options.afterPartial || options.slow) await until(() => metrics.clientBytes >= 32, 'HTTP client must receive a partial body');
              await options.afterPartial?.();
              if (options.slow) await new Promise(resolve => { wake = resolve; if (signal.aborted) resolve(); });
              if (signal.aborted) return;
              const chunk = bytes.slice(32); metrics.providerBytes += chunk.length; controller.enqueue(chunk); return;
            }
            controller.close();
          },
          cancel() { metrics.providerCancels++; wake?.(); },
        }, { highWaterMark: 0 });
      },
    };
    await withDownloadHttp(handleDocumentGenerationDownload, dependencies, async ({ url, sockets, requests, errors }) => {
      const transport = createDocumentGenerationDownload({ supabaseUrl: url, publicKey: 'owned-public-fixture-key', allowLoopback: true,
        timeoutMs: 6000, getActorUserId: () => actor, getAccessToken: requestedActor => { assert.equal(requestedActor, viewer); return options.token || fixtureToken; },
        fetch: async (address, init) => {
          assert.equal(address, `${url}/functions/v1/document-generation-download`); assert.equal(init.redirect, 'error');
          assert.equal(init.headers.apikey, 'owned-public-fixture-key'); assert.equal(init.headers.Authorization, `Bearer ${options.token || fixtureToken}`);
          const body = JSON.parse(init.body); assert.deepEqual(Object.keys(body).sort(), ['document_id','generation_id','pdf']);
          assert.equal(body.document_id, x.d); assert.equal(body.generation_id, x.u.generation_id); metrics.http++;
          const response = await fetch(address, init); metrics.statuses.push(response.status);
          // Observe bytes only as the real download client pulls them. This
          // transform preserves streaming/backpressure and forwards cancellation.
          const observed = response.body.pipeThrough(new TransformStream({ transform(chunk, controller) { metrics.clientBytes += chunk.length; controller.enqueue(chunk); } }));
          return new Response(observed, { status: response.status, headers: response.headers });
        },
      });
      const reader = createDocumentGenerationReader({ getActorUserId: () => actor, timeoutMs: 7000, download: transport,
        request: async (name, params, scope) => {
          assert.equal(scope.actorUserId, viewer); metrics.rpc.push({ name, params });
          assert.ok(['read_document_generation_open','read_annotation_updates_v2'].includes(name));
          const args = Object.entries(params).map(([k, v]) => `${k}=>${typeof v === 'boolean' ? v : quote(v)}`).join(',');
          const result = asRole(viewer, `SELECT public.${name}(${args})`, 'authenticated', false);
          return result.status === 0 ? { data: JSON.parse(result.stdout), error: null }
            : { data: null, error: { code: result.stderr.match(/ERROR:\s+([A-Z0-9]{5}):/)?.[1] } };
        },
      });
      await work({ reader, transport, metrics, changeActor: value => { actor = value; }, sockets, requests, errors });
    });
    return metrics;
  }
  await check('loopback HTTP handler download client and SQL reader return complete exact PDF and Yjs', async () => {
    const x = await httpFixture();
    const tail = new Y.Doc(); tail.getMap('annoMeta').set('ownedHttpTail', 'kept across full HTTP download'); const update = Y.encodeStateAsUpdate(tail); tail.destroy();
    const accepted = JSON.parse(asRole(owner, `SELECT public.append_annotation_update_v2('${x.d}','${x.u.generation_id}','owned-http-tail',1,${bytea(update)})`).stdout);
    await runHttp(x, {}, async ({ reader, metrics }) => {
      const result = await reader.open({ documentId: x.d, actorUserId: viewer });
      assert.deepEqual(Buffer.from(await result.pdfBlob.arrayBuffer()), Buffer.from(x.nextPdf)); assert.equal(result.throughSeq, String(accepted.seq));
      const actual = new Y.Doc(), expected = new Y.Doc(); Y.applyUpdate(actual, result.annotationUpdate); Y.applyUpdate(expected, x.result.baselineUpdate); Y.applyUpdate(expected, update);
      for (const name of ['annotations','surveyMarkers','annoMeta','deletedPdfAnnotations']) { actual.getMap(name); expected.getMap(name); }
      assert.deepEqual(actual.toJSON(), expected.toJSON()); actual.destroy(); expected.destroy();
      assert.deepEqual(metrics.statuses, [200]); assert.equal(metrics.clientBytes, x.nextPdf.length); assert.equal(metrics.sql, 2);
      assert.equal(metrics.rpc[0].params.p_include_snapshot, true); assert.equal(metrics.rpc.at(-1).params.p_include_snapshot, false);
    });
  });
  await check('HTTP200 cannot accept wrong hash truncated or excessive provider bytes', async () => {
    const x = await httpFixture(), before = snapshot(x);
    const wrong = Uint8Array.from(x.nextPdf); wrong[40] ^= 1;
    for (const bytes of [wrong, x.nextPdf.slice(0, -7), Uint8Array.from([...x.nextPdf, 1])]) {
      const oldSaved = new Blob([originalPdf]); let installed = oldSaved;
      // Force the bad suffix to arrive only after HTTP200/partial bytes reached
      // the client; do not let socket scheduling turn this into a headers-only
      // connection failure and weaken the complete-body acceptance oracle.
      await runHttp(x, { bytes, afterPartial: () => {} }, async ({ reader, metrics }) => {
        await assert.rejects(reader.open({ documentId: x.d, actorUserId: viewer }).then(value => { installed = value.pdfBlob; }), /could not be verified/);
        assert.equal(installed, oldSaved); assert.deepEqual(Buffer.from(await installed.arrayBuffer()), Buffer.from(originalPdf));
        assert.deepEqual(metrics.statuses, [200]); assert.ok(metrics.clientBytes < x.nextPdf.length); assert.equal(metrics.sql, 1);
      });
      assert.equal(snapshot(x), before, 'Failed downloads do not alter saved SQL state or retention');
    }
  });
  await check('partial HTTP download followed by real revocation or publication never installs stale bytes', async () => {
    for (const mode of ['revoke', 'generation']) {
      const x = await httpFixture();
      const next = mode === 'generation' ? await prepare({ ...x, pdf: x.nextPdf, generation: x.u.generation_id }, { type: 'duplicate', page: 1 }) : null;
      const oldSaved = new Blob([originalPdf]); let installed = oldSaved;
      await runHttp(x, { afterPartial: () => {
        if (mode === 'revoke') sql(`DELETE FROM document_collaborators WHERE document_id='${x.d}' AND user_id='${viewer}'`);
        else publish(next);
      } }, async ({ reader, metrics }) => {
        await assert.rejects(reader.open({ documentId: x.d, actorUserId: viewer }).then(value => { installed = value.pdfBlob; }));
        assert.equal(installed, oldSaved); assert.deepEqual(Buffer.from(await installed.arrayBuffer()), Buffer.from(originalPdf));
        assert.deepEqual(metrics.statuses, [200]); assert.ok(metrics.clientBytes >= 32 && metrics.clientBytes < x.nextPdf.length); assert.equal(metrics.sql, 2);
      });
      if (next) assert.equal(scalar(`SELECT generation_id FROM survey_private.annotation_generation_heads WHERE document_id='${x.d}'`), next.u.generation_id);
    }
  });
  await check('download rejects mismatched current actor and unauthorized bearer identity', async () => {
    const x = await httpFixture(), pdf = open(x, viewer).pdf;
    await runHttp(x, {}, async ({ transport, changeActor, metrics }) => {
      changeActor(other);
      await assert.rejects(transport(pdf, { actorUserId: viewer, documentId: x.d, pdfGenerationId: x.u.generation_id }), error => error.code === 'DOCUMENT_DOWNLOAD_ACTOR_CHANGED');
      assert.equal(metrics.http, 0); assert.equal(metrics.opened, 0);
    });
    await runHttp(x, { token: otherToken }, async ({ reader, metrics }) => {
      await assert.rejects(reader.open({ documentId: x.d, actorUserId: viewer }), error => error.code === '42501');
      assert.deepEqual(metrics.statuses, [403]); assert.equal(metrics.opened, 0);
    });
  });
  await check('canceling a slow real HTTP download closes the owned upstream stream and keeps saved bytes', async () => {
    const x = await httpFixture(), before = snapshot(x), abort = new AbortController(), oldSaved = new Blob([originalPdf]); let installed = oldSaved;
    await runHttp(x, { slow: true }, async ({ reader, metrics }) => {
      const pending = reader.open({ documentId: x.d, actorUserId: viewer, signal: abort.signal }).then(value => { installed = value.pdfBlob; return { value }; }, error => ({ error }));
      await until(() => metrics.clientBytes >= 32, 'Slow HTTP body must have reached the client'); abort.abort();
      const outcome = await pending; assert.ok(outcome.error); assert.equal(installed, oldSaved);
      await until(() => metrics.providerAborted && metrics.providerCancels > 0, 'Owned provider must observe HTTP cancellation');
      assert.deepEqual(metrics.statuses, [200]); assert.equal(metrics.clientBytes, 32);
    });
    assert.equal(snapshot(x), before);
  });
  assert.equal(groups, 31, 'Preserve all publication, open and HTTP groups');
  const collaborationSql = (x, generation = x.u?.generation_id) =>
    `SELECT public.read_document_generation_collaboration('${x.d}',${quote(generation)})`;
  const collaboration = (x, actor = owner) => JSON.parse(asRole(actor, collaborationSql(x)).stdout);
  await check('collaboration read has exact bounded fields and authenticated-only grants', async () => {
    const x = await prepare(seed()); publish(x);
    sql(`INSERT INTO document_collaborators(document_id,user_id,role,status) VALUES
      ('${x.d}','${editor}','editor','active'),('${x.d}','${viewer}','viewer','active')`);
    for (const role of ['anon', 'service_role']) errorState(asRole(owner, collaborationSql(x), role, false), '42501');
    const signature = 'public.read_document_generation_collaboration(uuid,uuid)';
    assert.equal(scalar(`SELECT count(*) FROM pg_proc p CROSS JOIN LATERAL aclexplode(p.proacl) a
      WHERE p.oid='${signature}'::regprocedure AND a.grantee=0`), '0');
    assert.equal(scalar(`SELECT prosecdef AND provolatile='v' AND proowner='postgres'::regrole
      FROM pg_proc WHERE oid='${signature}'::regprocedure`), 't');
    for (const [actor, role] of [[owner, 'owner'], [editor, 'editor'], [viewer, 'viewer']]) {
      const result = collaboration(x, actor), expected = open(x, actor, { includeSnapshot: false });
      assert.deepEqual(Object.keys(result).sort(), ['version','actor_user_id','document_id','generation_id','pdf','publication','role'].sort());
      assert.deepEqual(result, { version: 1, actor_user_id: actor, document_id: x.d,
        generation_id: x.u.generation_id, pdf: expected.pdf, publication: expected.publication, role });
      assert.ok(!JSON.stringify(result).includes('Private foreign note'));
      assert.ok(JSON.stringify(result).length < 2048);
    }
    const before = collaboration(x);
    applyMigration(migrationPath('20260909100000_document_generation_collaboration.sql'));
    assert.deepEqual(collaboration(x), before, 'Replay retains the same checked contract');
  });
  await check('collaboration role follows direct precedence inherited roles and project ownership', async () => {
    const x = await prepare(seed()); publish(x);
    assert.equal(collaboration(x, editor).role, 'editor', 'Inherited project editor');
    sql(`INSERT INTO document_collaborators(document_id,user_id,role,status) VALUES('${x.d}','${editor}','viewer','active')`);
    assert.equal(collaboration(x, editor).role, 'viewer', 'Direct viewer overrides inherited editor');
    sql(`UPDATE document_collaborators SET role='owner' WHERE document_id='${x.d}' AND user_id='${editor}'`);
    assert.equal(collaboration(x, editor).role, 'owner', 'Promoted direct owner');
    sql(`UPDATE document_collaborators SET status='pending' WHERE document_id='${x.d}' AND user_id='${editor}'`);
    assert.equal(collaboration(x, editor).role, 'editor', 'Inactive direct role does not override project role');
    sql(`INSERT INTO project_collaborators(project_id,user_id,role,status) VALUES('${project}','${viewer}','viewer','active')`);
    try {
      assert.equal(collaboration(x, viewer).role, 'viewer');
      sql(`UPDATE project_collaborators SET role='owner' WHERE project_id='${project}' AND user_id='${viewer}'`);
      assert.equal(collaboration(x, viewer).role, 'owner', 'Promoted project owner');
    } finally { sql(`DELETE FROM project_collaborators WHERE project_id='${project}' AND user_id='${viewer}'`); }
    const p = fresh();
    sql(`INSERT INTO projects(id,user_id,name) VALUES('${p}','${other}','Owned collaborator fixture');
      UPDATE documents SET project_id='${p}' WHERE id='${x.d}'`);
    assert.equal(collaboration(x, other).role, 'owner', 'Permanent project owner inherits access');
  });
  await check('collaboration denies missing wrong archived and unknown authority without fallback', async () => {
    const x = await prepare(seed()); publish(x);
    errorState(asRole(owner, collaborationSql(x, null), 'authenticated', false), '22023');
    errorState(asRole(owner, collaborationSql(x, fresh()), 'authenticated', false), 'SG002');
    errorState(asRole(other, collaborationSql(x), 'authenticated', false), '42501');
    errorState(asRole(null, collaborationSql(x), 'authenticated', false), '42501');
    errorState(asRole(owner, collaborationSql({ d: fresh(), u: x.u }), 'authenticated', false), '42501');
    const legacy = seed();
    errorState(asRole(owner, collaborationSql(legacy, fresh()), 'authenticated', false), 'SG002');
    sql(`UPDATE documents SET user_archived_at=now() WHERE id='${x.d}'`);
    assert.equal(collaboration(x).role, 'owner');
    errorState(asRole(editor, collaborationSql(x), 'authenticated', false), '42501');
    sql(`UPDATE documents SET user_archived_at=NULL WHERE id='${x.d}'`);
    try {
      for (const result of ['NULL', "'unexpected-role'"]) {
        sql(`CREATE OR REPLACE FUNCTION public.get_my_document_role(doc_id uuid) RETURNS text
          LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$SELECT ${result}::text$$`);
        errorState(asRole(owner, collaborationSql(x), 'authenticated', false), '42501');
      }
    } finally { sql(roleDefinition); }
  });
  await check('collaboration does not read or hash the annotation checkpoint', async () => {
    const x = await prepare(seed()); publish(x);
    // A deliberately invalid checkpoint rejects a full open, while the role/
    // immutable-PDF proof remains independent of the potentially large bytes.
    sql(`INSERT INTO survey_private.annotation_generation_snapshots(document_id,generation_id,at_seq,snapshot,encoding_version,writer_id,writer_epoch)
      VALUES('${x.d}','${x.u.generation_id}',0,decode('','hex'),1,'owned-empty-checkpoint',1)`);
    errorState(asRole(owner, openSql(x), 'authenticated', false), '54000');
    assert.equal(collaboration(x).role, 'owner');
  });
  await check('collaboration fences account closure and rejects old transaction snapshots', async () => {
    const x = await prepare(seed()); publish(x);
    for (const actor of [owner, editor]) {
      collaboration(x, actor); // Ensure the exact existing guard is present.
      errorState(sql(`BEGIN;UPDATE survey_private.account_write_guards SET closing=true WHERE user_id='${actor}';
        ${readAs(editor)}${collaborationSql(x)};COMMIT`, false), '23514');
    }
    errorState(sql(`BEGIN ISOLATION LEVEL REPEATABLE READ;${readAs(owner)}${collaborationSql(x)};COMMIT`, false), '25001');
    const held = session('collaboration_account', { role: 'authenticated', actorId: editor });
    held.send(`${collaborationSql(x)};SELECT 'account-held';`); await held.wait('account-held');
    for (const actor of [owner, editor]) errorState(asRole(null, `SELECT public.delete_account_owned_rows('${actor}')`, 'service_role', false), '55P03');
    assert.equal((await held.finish(false)).status, 0);
  });
  await check('collaboration direct-role changes are fenced in both transaction orders', async () => {
    const x = await prepare(seed()); publish(x);
    sql(`INSERT INTO document_collaborators(document_id,user_id,role,status) VALUES('${x.d}','${viewer}','editor','active')`);
    const held = session('collaboration_direct', { role: 'authenticated', actorId: viewer });
    held.send(`${collaborationSql(x)};SELECT 'direct-held';`); await held.wait('direct-held');
    assert.equal(collaboration(x, viewer).role, 'editor', 'Readers can coexist');
    for (const mutation of ["SET role='viewer'", "SET status='pending'"])
      errorState(sql(`UPDATE document_collaborators ${mutation} WHERE document_id='${x.d}' AND user_id='${viewer}'`, false), '55P03');
    errorState(sql(`DELETE FROM document_collaborators WHERE document_id='${x.d}' AND user_id='${viewer}'`, false), '55P03');
    assert.equal((await held.finish(false)).status, 0);
    const change = session('collaboration_direct_change', { role: 'postgres' });
    change.send(`UPDATE document_collaborators SET role='viewer' WHERE document_id='${x.d}' AND user_id='${viewer}';SELECT 'change-held';`);
    await change.wait('change-held');
    errorState(asRole(viewer, collaborationSql(x), 'authenticated', false), '55P03');
    assert.equal((await change.finish()).status, 0);
    assert.equal(collaboration(x, viewer).role, 'viewer');
    sql(`DELETE FROM document_collaborators WHERE document_id='${x.d}' AND user_id='${viewer}'`);
    errorState(asRole(viewer, collaborationSql(x), 'authenticated', false), '42501');
  });
  await check('collaboration inherited-role locks fence project changes and absent direct overrides', async () => {
    const x = await prepare(seed()); publish(x);
    const held = session('collaboration_inherited', { role: 'authenticated', actorId: editor });
    held.send(`${collaborationSql(x)};SELECT 'inherited-held';`); await held.wait('inherited-held');
    errorState(sql(`UPDATE project_collaborators SET role='viewer' WHERE project_id='${project}' AND user_id='${editor}'`, false), '55P03');
    errorState(sql(`DELETE FROM project_collaborators WHERE project_id='${project}' AND user_id='${editor}'`, false), '55P03');
    errorState(sql(`INSERT INTO document_collaborators(document_id,user_id,role,status) VALUES('${x.d}','${editor}','viewer','active')`, false), '55P03');
    assert.equal((await held.finish(false)).status, 0);
    const change = session('collaboration_inherited_change', { role: 'postgres' });
    change.send(`UPDATE project_collaborators SET role='viewer' WHERE project_id='${project}' AND user_id='${editor}';SELECT 'project-change-held';`);
    await change.wait('project-change-held');
    errorState(asRole(editor, collaborationSql(x), 'authenticated', false), '55P03');
    assert.equal((await change.finish()).status, 0);
    assert.equal(collaboration(x, editor).role, 'viewer');
    sql(`UPDATE project_collaborators SET role='editor' WHERE project_id='${project}' AND user_id='${editor}'`);
    const insert = session('collaboration_override_insert', { role: 'postgres' });
    insert.send(`INSERT INTO document_collaborators(document_id,user_id,role,status) VALUES('${x.d}','${editor}','viewer','active');SELECT 'override-held';`);
    await insert.wait('override-held');
    errorState(asRole(editor, collaborationSql(x), 'authenticated', false), '55P03');
    assert.equal((await insert.finish()).status, 0);
    assert.equal(collaboration(x, editor).role, 'viewer');
  });
  await check('collaboration proof and publication serialize and reject the previous generation', async () => {
    const x = await prepare(seed()); publish(x);
    const next = await prepare({ ...x, pdf: x.nextPdf, generation: x.u.generation_id }, { type: 'duplicate', page: 1 });
    const held = session('collaboration_publication', { role: 'authenticated', actorId: owner });
    held.send(`${collaborationSql(x)};SELECT 'publication-reader-held';`); await held.wait('publication-reader-held');
    errorState(sql(publishSql(next), false), '40001');
    assert.equal(collaboration(x).generation_id, x.u.generation_id);
    assert.equal((await held.finish(false)).status, 0);
    const writer = session('collaboration_publisher', { role: 'postgres' });
    writer.send(`${publishSql(next)};SELECT 'publisher-held';`); await writer.wait('publisher-held');
    errorState(asRole(owner, collaborationSql(x), 'authenticated', false), '40001');
    assert.equal((await writer.finish()).status, 0);
    errorState(asRole(owner, collaborationSql(x), 'authenticated', false), 'SG002');
    const result = collaboration(next);
    assert.equal(result.generation_id, next.u.generation_id); assert.equal(result.pdf.path, next.u.path);
    assert.equal(result.publication.operation_id, next.u.operation_id); assert.equal(result.role, 'owner');
  });
  assert.equal(groups, 39);
  console.log(`Document generation publication PostgreSQL groups passed: ${groups}`);
}, { name: 'generation-publication', commandTimeoutMs: 60000 });
console.log('Disposable local PostgreSQL stopped; exact temporary cluster removed');
