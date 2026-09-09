// Isolated installed PostgreSQL. Object metadata is NOT PDF-byte verification.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {withDisposablePostgres} from './helpers/disposablePostgres.mjs';
import {handleDocumentGenerationSource} from '../supabase/functions/document-generation-source/handler.js';
assert.equal(process.argv.length,2,'This local fixture accepts no arguments');
const target='20260909092000_document_generation_source_receipts.sql';
const migrationPath=n=>fileURLToPath(new URL(`../supabase/migrations/${n}`,import.meta.url));
const source=n=>readFileSync(migrationPath(n),'utf8');
const fn=(file,name)=>{const s=source(file),a=s.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`),b=s.indexOf('$$;',a);assert.ok(a>=0&&b>a);return s.slice(a,b+3);};
const id=n=>`92000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const owner=id(1),editor=id(2),viewer=id(3),other=id(4),project=id(5),version=id(9);
async function gateway(receipt){
  const input={action:'begin',source_id:receipt.source_id,document_id:receipt.document_id,generation_id:receipt.generation_id};
  const response=await handleDocumentGenerationSource(new Request('http://localhost/source',{
    method:'POST',headers:{Authorization:'Bearer synthetic-local-token'},body:JSON.stringify(input)}),{
    enabled:true,getUser:async()=>({id:receipt.actor_user_id}),begin:async(actor,request)=>{
      assert.equal(actor,receipt.actor_user_id);assert.deepEqual(request,input);return receipt;
    }});
  const body=await response.json();assert.equal(response.status,200,JSON.stringify(body));assert.deepEqual(body.source,receipt);
}
await withDisposablePostgres(async pg=>{
  const {sql,scalar,asRole,errorState,session,applyMigration,quote}=pg;
  const prior=readFileSync(new URL('./test-document-generation-upload-staging-postgres.mjs',import.meta.url),'utf8');
  const a=prior.indexOf('  const prior='),b=prior.indexOf('  const uploads=');assert.ok(a>=0&&b>a);
  new Function('sql','applyMigration','migrationPath','readFileSync','source','fn','owner','editor','viewer','other','project','assert',
    prior.slice(a,b).replaceAll('import.meta.url',JSON.stringify(new URL('./test-document-generation-upload-staging-postgres.mjs',import.meta.url).href)))
    (sql,applyMigration,migrationPath,readFileSync,source,fn,owner,editor,viewer,other,project,assert);
  // Exact tracked connector table DDL, without unrelated provider functions.
  for(const [file,tables] of [['20260625120000_kal309_excel_sync.sql',['excel_sync_head','excel_sync_state','excel_sync_ops','excel_sync_changesets','excel_sync_audit']],
    ['20260611120000_kal307_workbook_registrations.sql',['excel_workbook_registrations']]]) {
    for(const table of tables){const ddl=source(file).match(new RegExp(`CREATE TABLE IF NOT EXISTS public.${table} \\([\\s\\S]*?\\n\\);`))?.[0];assert.ok(ddl);sql(ddl);}
  }
  sql('ALTER TABLE excel_sync_state ALTER COLUMN marker_annotation_id TYPE text USING marker_annotation_id::text;ALTER TABLE excel_sync_ops ALTER COLUMN marker_annotation_id TYPE text USING marker_annotation_id::text;GRANT ALL ON excel_sync_head,excel_sync_state,excel_sync_ops,excel_sync_changesets,excel_sync_audit,excel_workbook_registrations TO service_role;');
  applyMigration(migrationPath('20260909080000_document_generation_upload_staging.sql'));
  applyMigration(migrationPath('20260909090000_annotation_generation_transport.sql'));
  applyMigration(migrationPath('20260522120000_kal48_document_revisions.sql'));
  applyMigration(migrationPath('20260522170000_kal48_inline_auth_checks.sql'));
  const excel=source('20260626150000_kal309_marker_id_text.sql'),excelStart=excel.indexOf('CREATE OR REPLACE FUNCTION public.kal309_fetch_since('),excelEnd=excel.indexOf('$function$;',excelStart);
  assert.ok(excelStart>=0&&excelEnd>excelStart);sql(excel.slice(excelStart,excelEnd+'$function$;'.length));
  applyMigration(migrationPath('20260909091000_document_generation_read_fences.sql'));
  const doc=n=>{const d=id(n);sql(`INSERT INTO documents(id,user_id,project_id,name,file_path,file_size) VALUES('${d}','${owner}','${project}','Source','${owner}/${n}.pdf',4);
    INSERT INTO storage.objects(bucket_id,name,version,metadata) VALUES('documents','${owner}/${n}.pdf','${version}','{"size":4}')`);return d;};
  const beginSql=(d,n,actor=owner,g=null)=>`SELECT public.begin_document_generation_source('${actor}','${d}','${id(n)}',${quote(g)})`;
  const begin=(d,n,actor=owner,g=null)=>JSON.parse(asRole(null,beginSql(d,n,actor,g),'service_role').stdout);
  const get=(n,actor=owner)=>JSON.parse(asRole(null,`SELECT public.get_document_generation_source('${actor}','${id(n)}')`,'service_role').stdout);
  const cancel=(n,actor=owner)=>JSON.parse(asRole(null,`SELECT public.cancel_document_generation_source('${actor}','${id(n)}')`,'service_role').stdout);
  const receipts='survey_private.document_generation_sources',bodies='survey_private.document_generation_source_bodies';
  const saved=n=>JSON.parse(scalar(`SELECT b.payload FROM ${bodies} b JOIN ${receipts} r USING(body_id) WHERE r.source_id='${id(n)}'`));
  const append=d=>asRole(owner,`SELECT * FROM public.append_annotation_update('${d}','writer',1,decode('0102','hex'))`);
  const op=(d,n,status='accepted')=>`INSERT INTO excel_sync_ops(id,document_id,template_id,scope_id,workbook_generation,excel_revision,op_id,marker_annotation_id,op_type,patch_payload,client_change_set_id,op_status)
    VALUES('${id(n)}','${d}','template','scope',1,1,'op','marker','apply','{"notes":"consumed"}','set','${status}')`;
  let count=0;const check=async(name,work)=>{await work();count++;console.log(`PASS ${name}`);sql(`SELECT survey_private.release_document_generation_source(source_id,'canceled') FROM ${receipts} WHERE state='captured'`);};
  applyMigration(migrationPath(target));
  await check('metadata-only receipt shape and exact replay survive migration replay',async()=>{
    const d=doc(100),r=begin(d,1000);assert.equal(r.source_byte_state,'unverified');assert.equal(r.state,'captured');assert.equal(r.wal_head,'0');
    assert.deepEqual(Object.keys(r).sort(),['actor_user_id','document_id','expires_at','generation_id','sidecar_objects','source_byte_state','source_id','source_object','source_sql_sha256','state','version','visible_capture','wal_head']);
    assert.equal(r.source_object.path,`${owner}/100.pdf`);assert.equal(r.source_object.version,version);assert.equal(r.source_object.byte_length,'4');
    assert.equal(r.visible_capture.scope,'sql-metadata-only');assert.equal(r.visible_capture.sources.active_generation,null);
    console.log('Fixture descriptor sample: '+JSON.stringify(r));
    applyMigration(migrationPath(target));assert.deepEqual(begin(d,1000),r);
    await gateway(r);
    console.log('Descriptor fields: '+Object.keys(r).sort().join(','));
  });
  await check('private tables and exact definer functions retain explicit postgres ownership',()=>{
    const functions=[...source(target).matchAll(/ALTER FUNCTION ([^;]+) OWNER TO postgres;/g)].map(x=>x[1]);
    assert.equal(functions.length,11);
    assert.equal(scalar(`SELECT count(*) FROM pg_proc WHERE oid IN (${functions.map(x=>`${quote(x)}::regprocedure`).join(',')}) AND proowner='postgres'::regrole`),'11');
    assert.equal(scalar(`SELECT count(*) FROM pg_class WHERE oid IN ('${receipts}'::regclass,'${bodies}'::regclass) AND relowner='postgres'::regrole`),'2');
    for(const table of [receipts,bodies])for(const role of ['anon','authenticated','service_role'])
      errorState(asRole(owner,`SELECT * FROM ${table}`,role,false),'42501');
  });
  await check('same ID never silently recaptures changed annotations or generation identity',()=>{
    const d=doc(101),r=begin(d,1001);append(d);assert.deepEqual(begin(d,1001),r);assert.equal(get(1001).wal_head,'0');
    assert.notEqual(begin(d,2001).source_sql_sha256,r.source_sql_sha256);
    errorState(asRole(null,beginSql(d,1001,owner,id(901)),'service_role',false),'23505');
    errorState(asRole(null,beginSql(d,1001,editor),'service_role',false),'42501');
  });
  await check('all owner-private survey and connector history retained but never exposed',()=>{
    const d=doc(102),t=id(6002),s=id(5002),foreign=id(5003);sql(`INSERT INTO templates(id,user_id) VALUES('${t}','${owner}');
      INSERT INTO survey_sessions(id,template_id,user_id,document_id) VALUES('${s}','${t}','${editor}','${d}'),('${foreign}','${t}','${other}','${d}');
      INSERT INTO survey_items(session_id,annotation_id,module_id,category_id,notes) VALUES('${s}','own','m','c','visible'),('${foreign}','secret','m','c','PRIVATE SURVEY');
      INSERT INTO excel_workbook_registrations(document_id,template_id,workbook_id,token_hash,token_expiry,registered_by) VALUES('${d}','template','book','PRIVATE TOKEN',now()+interval '1 day','${owner}');${op(d,7002)}`);
    const r=begin(d,1002,editor);assert.equal(r.visible_capture.sources.survey_sessions.length,1);assert.equal(r.visible_capture.sources.survey_items[0].notes,'visible');
    assert.equal(JSON.stringify(r).includes('PRIVATE'),false);assert.equal('connector_history' in r.visible_capture,false);
    const full=saved(1002);assert.equal(full.semantic.sources.survey_sessions.length,2);assert.equal(full.connector_history.registrations[0].token_hash,'PRIVATE TOKEN');
  });
  await check('identical document payload deduplicates across actors and nonce IDs',()=>{
    const d=doc(103),a=begin(d,1003),b=begin(d,2003,editor);assert.equal(a.source_sql_sha256,b.source_sql_sha256);
    assert.equal(scalar(`SELECT count(DISTINCT body_id) FROM ${receipts} WHERE document_id='${d}'`),'1');
    cancel(1003);assert.equal(get(2003,editor).state,'captured');cancel(2003,editor);
    assert.equal(scalar(`SELECT count(*) FROM ${bodies} WHERE document_id='${d}'`),'0');
  });
  await check('physical object metadata and sidecar presence change semantic hash without byte proof',()=>{
    const d=doc(104),a=begin(d,1004);sql(`UPDATE storage.objects SET version='${id(88)}' WHERE name='${owner}/104.pdf'`);
    const b=begin(d,2004);assert.notEqual(a.source_sql_sha256,b.source_sql_sha256);assert.equal(b.source_byte_state,'unverified');
    sql(`INSERT INTO storage.objects(bucket_id,name,version,metadata) VALUES('documents','${project}/${d}_data.json','${version}','{"size":7}')`);
    const c=begin(d,3004);assert.equal(c.sidecar_objects.length,1);assert.notEqual(c.source_sql_sha256,b.source_sql_sha256);
    assert.equal(get(1004).sidecar_objects.length,0);
  });
  await check('missing object and unknown active binding fail without receipts',()=>{
    const d=doc(105);sql(`UPDATE documents SET file_path='${owner}/missing.pdf' WHERE id='${d}'`);
    errorState(asRole(null,beginSql(d,1005),'service_role',false),'23514');
    sql(`INSERT INTO survey_private.annotation_generations VALUES('${d}','${id(9005)}',0,decode('01','hex'),1,now());INSERT INTO survey_private.annotation_generation_heads VALUES('${d}','${id(9005)}',0)`);
    errorState(asRole(null,beginSql(d,1005,owner,id(9005)),'service_role',false),'23514');
    assert.equal(scalar(`SELECT count(*) FROM ${receipts} WHERE document_id='${d}'`),'0');
  });
  await check('active generation captures matching PDF baseline checkpoint and only uncovered tail',async()=>{
    const d=doc(106),upload=JSON.parse(asRole(owner,`SELECT public.begin_document_generation_upload('${d}','${id(8006)}',repeat('a',64),4)`).stdout);
    asRole(null,`INSERT INTO storage.objects(bucket_id,name,version,metadata) VALUES('documents',${quote(upload.path)},'${version}','{"size":4}')`,'service_role');
    const claim=JSON.parse(asRole(null,`SELECT public.claim_document_generation_upload_verification('${owner}','${upload.operation_id}','${id(8106)}')`,'service_role').stdout);
    asRole(null,`SELECT public.record_document_generation_upload_verification('${owner}','${upload.operation_id}','${claim.object.id}','${version}',repeat('a',64),4,'${id(8106)}')`,'service_role');
    sql(`INSERT INTO survey_private.annotation_generations VALUES('${d}','${upload.generation_id}',0,decode('0102','hex'),1,now());INSERT INTO survey_private.annotation_generation_heads VALUES('${d}','${upload.generation_id}',0)`);
    asRole(owner,`SELECT public.append_annotation_update_v2('${d}','${upload.generation_id}','writer',1,decode('03','hex'));SELECT public.store_annotation_snapshot_v2('${d}','${upload.generation_id}',1,decode('010203','hex'),1,'snap',1,0,NULL,0);SELECT public.append_annotation_update_v2('${d}','${upload.generation_id}','writer',2,decode('04','hex'))`);
    const r=begin(d,1006,owner,upload.generation_id),g=r.visible_capture.sources.active_generation;
    assert.equal(r.source_object.path,upload.path);assert.equal(r.wal_head,'2');assert.equal(g.baseline.base_seq,'0');assert.equal(g.snapshot.at_seq,'1');assert.deepEqual(g.updates.map(x=>x.seq),['2']);
    assert.deepEqual(saved(1006).wal_history.generation.map(x=>x.seq),['1','2']);
    assert.equal('wal_history' in r.visible_capture,false);
    await gateway(r);
  });
  await check('service scope, locked documents and revoked editor never reveal stored bodies',()=>{
    const d=doc(107);for(const role of ['anon','authenticated']) errorState(asRole(owner,beginSql(d,1007),role,false),'42501');
    errorState(asRole(null,beginSql(d,1007,viewer),'service_role',false),'42501');
    begin(d,1007,editor);sql(`INSERT INTO document_collaborators VALUES('${d}','${editor}','viewer','active')`);
    errorState(asRole(null,`SELECT public.get_document_generation_source('${editor}','${id(1007)}')`,'service_role',false),'42501');
    assert.equal(cancel(1007,editor).visible_capture,null);
    sql(`UPDATE documents SET locked_at=now() WHERE id='${d}'`);errorState(asRole(null,beginSql(d,2007),'service_role',false),'42501');
  });
  await check('expiry drops all body links and returns only permanent small identity',()=>{
    const d=doc(108);begin(d,1008);begin(d,2008);sql(`UPDATE ${receipts} SET expires_at=clock_timestamp()-interval '1 second' WHERE document_id='${d}'`);
    assert.equal(get(1008).state,'expired');const result=JSON.parse(asRole(null,'SELECT public.expire_document_generation_sources(100)','service_role').stdout);assert.ok(result.expired_source_ids.includes(id(2008)));
    const r=get(2008);assert.equal(r.visible_capture,null);assert.equal(r.source_object,null);assert.deepEqual(r.sidecar_objects,[]);
    assert.equal(scalar(`SELECT count(*) FROM ${bodies} WHERE document_id='${d}'`),'0');assert.equal(begin(d,2008).state,'expired');
  });
  await check('document nonce cap rejects before new capture and cancellation frees capacity',()=>{
    const d=doc(109);for(let n=0;n<4;n++)begin(d,19009+n);errorState(asRole(null,beginSql(d,2009),'service_role',false),'54000');
    assert.equal(scalar(`SELECT count(*) FROM ${bodies} WHERE document_id='${d}'`),'1');cancel(19009);assert.equal(begin(d,2009).state,'captured');
  });
  await check('connector bookkeeping changes private history but not semantic compare',()=>{
    const d=doc(110);sql(`${op(d,7010)};INSERT INTO excel_sync_head VALUES('${d}','template',1,now())`);const a=begin(d,1010);
    sql(`UPDATE excel_sync_head SET updated_at=now()+interval '1 day' WHERE document_id='${d}';UPDATE excel_sync_ops SET created_at=now()+interval '1 day' WHERE document_id='${d}'`);
    const b=begin(d,2010);assert.equal(a.source_sql_sha256,b.source_sql_sha256);assert.equal(scalar(`SELECT count(DISTINCT body_id) FROM ${receipts} WHERE document_id='${d}'`),'2');
    sql(`UPDATE excel_sync_ops SET op_status='materialized' WHERE document_id='${d}'`);assert.notEqual(begin(d,3010).source_sql_sha256,b.source_sql_sha256);
  });
  await check('held source capture fences consumed writes but allows bookkeeping and other documents',async()=>{
    const d=doc(111),otherDoc=doc(112);sql(`${op(d,7011)};INSERT INTO excel_sync_head VALUES('${d}','template',1,now())`);
    const lock=session('source_capture',{role:'service_role'});lock.send(`${beginSql(d,1011)};SELECT 'ready';`);await lock.wait('ready');
    errorState(sql(`UPDATE excel_sync_ops SET patch_payload='{"different":true}' WHERE document_id='${d}'`,false),'40001');
    errorState(sql(`UPDATE excel_sync_head SET excel_revision=2 WHERE document_id='${d}'`,false),'40001');
    sql(`UPDATE excel_sync_ops SET created_at=now() WHERE document_id='${d}';UPDATE excel_sync_head SET updated_at=now() WHERE document_id='${d}'`);
    sql(op(otherDoc,7012));assert.equal((await lock.finish()).status,0);
  });
  await check('source capture rollback creates no receipt/body and restores caller actor',()=>{
    const d=doc(113);sql(`BEGIN;SET ROLE service_role;SET request.jwt.claim.sub='${other}';${beginSql(d,1013)};DO $$BEGIN IF auth.uid()<>'${other}' THEN RAISE EXCEPTION 'actor changed';END IF;END$$;ROLLBACK;`);
    assert.equal(scalar(`SELECT count(*) FROM ${receipts} WHERE document_id='${d}'`),'0');assert.equal(scalar(`SELECT count(*) FROM ${bodies} WHERE document_id='${d}'`),'0');
  });
  await check('source cap fails closed on oversized row and leaves no partial body',()=>{
    const d=doc(114);sql(`UPDATE documents SET annotations=jsonb_build_object('large',repeat('a',16777216)) WHERE id='${d}'`);
    errorState(asRole(null,beginSql(d,1014),'service_role',false),'54000');assert.equal(scalar(`SELECT count(*) FROM ${receipts} WHERE document_id='${d}'`),'0');
  });
  await check('document deletion releases bodies but preserves immutable request identity',()=>{
    const d=doc(115);begin(d,1015);sql(`DELETE FROM documents WHERE id='${d}'`);assert.equal(get(1015).state,'canceled');
    assert.equal(scalar(`SELECT count(*) FROM ${bodies} WHERE document_id='${d}'`),'0');errorState(asRole(null,beginSql(doc(116),1015),'service_role',false),'23505');
  });
  await check('actor nonce limit spans documents and counts expired bodies until disposal',()=>{
    const ds=[doc(120),doc(121),doc(122),doc(123),doc(124)];
    for(let i=0;i<16;i++)begin(ds[Math.floor(i/4)],22000+i);
    sql(`UPDATE ${receipts} SET expires_at=clock_timestamp()-interval '1 second' WHERE source_id='${id(22000)}'`);
    errorState(asRole(null,beginSql(ds[4],23000),'service_role',false),'54000');
    assert.equal(get(22000).state,'expired');assert.equal(begin(ds[4],23000).state,'captured');
  });
  await check('actor byte budget counts unique bodies and rejects excess without partial capture',()=>{
    const ds=[doc(130),doc(131),doc(132),doc(133),doc(134)];
    for(let i=0;i<ds.length;i++) {
      sql(`UPDATE documents SET annotations=jsonb_build_object('large',repeat('x',14*1024*1024)) WHERE id='${ds[i]}'`);
      // Project only the state so the intentionally large result does not cross
      // the local psql output cap. The production RPC retains its real body.
      const result=asRole(null,`${beginSql(ds[i],24000+i)}->>'state'`,'service_role',false);
      if(i<4){assert.equal(result.status,0,result.stderr);assert.equal(result.stdout,'captured');}
      else errorState(result,'54000');
    }
    assert.equal(scalar(`SELECT count(*) FROM ${receipts} WHERE source_id='${id(24004)}'`),'0');
    assert.equal(scalar(`SELECT count(*) FROM ${bodies} WHERE document_id='${ds[4]}'`),'0');
  });
  await check('expiry skips locked receipt and later disposes every body',async()=>{
    const d=doc(140);begin(d,25000);begin(d,25001);
    sql(`UPDATE ${receipts} SET expires_at=clock_timestamp()-interval '1 second' WHERE document_id='${d}'`);
    const lock=session('source_expiry',{role:'postgres'});lock.send(`SELECT source_id FROM ${receipts} WHERE source_id='${id(25000)}' FOR UPDATE;SELECT 'ready';`);await lock.wait('ready');
    const first=JSON.parse(asRole(null,'SELECT expire_document_generation_sources(100)','service_role').stdout);
    assert.deepEqual(first.expired_source_ids,[id(25001)]);assert.equal((await lock.finish()).status,0);
    const second=JSON.parse(asRole(null,'SELECT expire_document_generation_sources(100)','service_role').stdout);
    assert.deepEqual(second.expired_source_ids,[id(25000)]);assert.equal(scalar(`SELECT count(*) FROM ${bodies} WHERE document_id='${d}'`),'0');
  });
  await check('busy document batch backs off so later expired bodies progress',async()=>{
    const busy=doc(145),later=doc(146);begin(busy,25500);begin(busy,25501);begin(later,25502);
    sql(`UPDATE ${receipts} SET expires_at=clock_timestamp()-interval '2 minutes' WHERE document_id='${busy}';
      UPDATE ${receipts} SET expires_at=clock_timestamp()-interval '1 minute' WHERE document_id='${later}'`);
    const before=scalar(`SELECT survey_private.document_generation_source_descriptor('${id(25500)}')`);
    const lock=session('source_expiry_document',{role:'postgres'});
    lock.send(`SELECT pg_advisory_xact_lock(hashtextextended('${busy}',0));SELECT 'ready';`);await lock.wait('ready');
    const sweep=()=>JSON.parse(asRole(null,'SELECT expire_document_generation_sources(2)','service_role').stdout);
    const first=sweep();assert.deepEqual(first.expired_source_ids,[]);assert.deepEqual(first.skipped_source_ids,[id(25500),id(25501)]);
    const second=sweep();assert.deepEqual(second.expired_source_ids,[id(25502)]);assert.deepEqual(second.skipped_source_ids,[]);
    assert.equal(scalar(`SELECT survey_private.document_generation_source_descriptor('${id(25500)}')`),before);
    assert.equal(scalar(`SELECT count(*) FROM ${bodies} WHERE document_id='${later}'`),'0');
    assert.equal((await lock.finish()).status,0);
    assert.deepEqual(sweep().expired_source_ids,[],'backoff remains durable after lock release');
    // Advance only the private retry schedule; do not alter receipt identity,
    // expiry, body, or public hash and do not sleep a real thirty seconds.
    sql(`UPDATE ${receipts} SET next_expiry_attempt_at=clock_timestamp()-interval '1 second' WHERE document_id='${busy}'`);
    assert.deepEqual(sweep().expired_source_ids,[id(25500),id(25501)]);
    assert.equal(scalar(`SELECT count(*) FROM ${bodies} WHERE document_id='${busy}'`),'0');
  });
  await check('ordinary connector fetch survives installed read fences and no source route use',()=>{
    const d=doc(150);sql(op(d,26000));
    const rows=JSON.parse(asRole(owner,`SELECT jsonb_agg(to_jsonb(x)) FROM kal309_fetch_since('${d}','template',0) x`).stdout);
    assert.equal(rows.length,1);assert.equal(rows[0].marker_annotation_id,'marker');
    sql(`UPDATE excel_sync_ops SET patch_payload='{"notes":"updated"}' WHERE document_id='${d}'`);
    assert.equal(scalar(`SELECT patch_payload->>'notes' FROM excel_sync_ops WHERE document_id='${d}'`),'updated');
  });
  console.log(`Document generation source receipt PostgreSQL checks passed: ${count}`);
},{name:'generation-source'});
console.log('Disposable local PostgreSQL stopped; exact temporary cluster removed');
