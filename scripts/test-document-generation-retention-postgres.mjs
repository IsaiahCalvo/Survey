// Owned local PostgreSQL only. Synthetic byte receipts test SQL lifetime rules,
// not a hosted provider or publication. No connection/credential inputs.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {withDisposablePostgres} from './helpers/disposablePostgres.mjs';
assert.equal(process.argv.length,2,'No connection arguments accepted');
const target='20260909097000_document_generation_retention.sql';
const migrationPath=n=>fileURLToPath(new URL(`../supabase/migrations/${n}`,import.meta.url));
const source=n=>readFileSync(migrationPath(n),'utf8');
const fn=(file,name)=>{const s=source(file),a=s.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`),b=s.indexOf('$$;',a);assert.ok(a>=0&&b>a);return s.slice(a,b+3);};
const id=n=>`97000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const owner=id(1),editor=id(2),viewer=id(3),other=id(4),project=id(5),version=id(9);
const sha=x=>createHash('sha256').update(x).digest('hex');
const pdf=Buffer.from('%PDF'),sidecar=Buffer.from('{}'),candidate=Buffer.from('%PDF-next');
await withDisposablePostgres(async pg=>{
  const {sql,scalar,asRole,errorState,session,applyMigration,quote}=pg;
  const prior=readFileSync(new URL('./test-document-generation-source-receipts-postgres.mjs',import.meta.url),'utf8');
  const a=prior.indexOf('  const prior='),b=prior.indexOf('  const doc=');assert.ok(a>=0&&b>a);
  new Function('sql','applyMigration','migrationPath','readFileSync','source','fn','owner','editor','viewer','other','project','assert',
    prior.slice(a,b).replaceAll("'import.meta.url'","'__KEEP_IMPORT_META__'")
      .replaceAll('import.meta.url',JSON.stringify(new URL('./test-document-generation-source-receipts-postgres.mjs',import.meta.url).href))
      .replaceAll('__KEEP_IMPORT_META__','import.meta.url'))
    (sql,applyMigration,migrationPath,readFileSync,source,fn,owner,editor,viewer,other,project,assert);
  for(const f of ['20260909092000_document_generation_source_receipts.sql','20260909093000_document_generation_source_bytes.sql',
    '20260909094000_document_generation_source_bound_uploads.sql','20260909095000_document_generation_source_archives.sql',
    '20260909096000_document_generation_transform_source.sql'])applyMigration(migrationPath(f));
  // A previous internal-only synthetic head has no durable asset. Migration
  // must roll back rather than pretend its expiring stage is permanent.
  sql(`INSERT INTO documents(id,user_id,name) VALUES('${id(20)}','${owner}','Unbound old head');
    INSERT INTO survey_private.annotation_generations(document_id,generation_id,base_seq,baseline_snapshot,baseline_encoding_version)
      VALUES('${id(20)}','${id(21)}',0,decode('0000','hex'),1);
    INSERT INTO survey_private.annotation_generation_heads VALUES('${id(20)}','${id(21)}',0)`);
  errorState(sql(source(target),false),'23514');
  assert.equal(scalar("SELECT to_regclass('survey_private.document_generation_bundles') IS NULL"),'t');
  assert.equal(scalar(`SELECT count(*) FROM survey_private.annotation_generation_heads WHERE document_id='${id(20)}'`),'1');
  sql(`DELETE FROM documents WHERE id='${id(20)}'`);
  applyMigration(migrationPath(target));
  const bundles='survey_private.document_generation_bundles',assets='survey_private.document_generation_assets';
  const bodies='survey_private.document_generation_source_bodies',sources='survey_private.document_generation_sources';
  const uploads='survey_private.document_generation_uploads',refs='survey_private.document_generation_storage_references';
  let serial=100,count=0;const fresh=()=>id(serial++),docs=new Set();
  const call=(name,args)=>`SELECT public.${name}(${args.map(quote).join(',')})`;
  const service=(name,args)=>JSON.parse(asRole(null,call(name,args),'service_role').stdout);
  const setup=({actor=owner,sidecarPresent=true}={})=>{
    const d=fresh(),s=fresh(),path=`${owner}/${d}.pdf`,jsonPath=`${project}/${d}_data.json`;docs.add(d);
    sql(`INSERT INTO documents(id,user_id,project_id,name,file_path,file_size) VALUES('${d}','${owner}','${project}','Retention',${quote(path)},4);
      INSERT INTO storage.objects(bucket_id,name,version,metadata) VALUES('documents',${quote(path)},'${version}','{"size":4}')`);
    if(sidecarPresent)sql(`INSERT INTO storage.objects(bucket_id,name,version,metadata) VALUES('documents',${quote(jsonPath)},'${version}','{"size":2}')`);
    const capture=service('begin_document_generation_source',[actor,d,s,null]);
    const claim=fresh(),proof=service('claim_document_generation_source_bytes',[actor,s,claim]);
    const objects=proof.objects.map(o=>({...o,content_sha256:sha(o.kind==='pdf'?pdf:sidecar)}));
    service('record_document_generation_source_bytes',[actor,s,claim,JSON.stringify(objects)]);
    const body=service('read_document_generation_transform_source',[actor,s]);
    return {actor,d,s,path,jsonPath,capture,body,objects};
  };
  const verify=u=>{
    asRole(null,`INSERT INTO storage.objects(bucket_id,name,version,metadata) VALUES('documents',${quote(u.path)},'${version}',jsonb_build_object('size',${u.byte_length}))`,'service_role');
    const c=fresh(),proof=service('claim_document_generation_upload_verification',[u.actor_user_id,u.operation_id,c]);
    service('record_document_generation_upload_verification',[u.actor_user_id,u.operation_id,proof.object.id,proof.object.version,u.content_sha256,u.byte_length,c]);
    return u;
  };
  const prepare=(x,{verifyCandidate=true}={})=>{
    let u=JSON.parse(asRole(x.actor,call('begin_document_generation_upload_v2',[x.s,fresh(),'candidate-pdf',sha(candidate),String(candidate.length)])).stdout);
    if(verifyCandidate)u=verify(u);
    const archives=x.objects.map(o=>verify(JSON.parse(asRole(x.actor,call('begin_document_generation_source_archive',[x.s,fresh(),o.id])).stdout)));
    return {...x,u,archives};
  };
  const retainSql=(x,{actor=x.actor,s=x.s,op=x.u.operation_id,archiveIds=x.archives.map(a=>a.operation_id)}={})=>
    `SELECT survey_private.retain_document_generation_bundle('${actor}','${s}','${op}',ARRAY[${archiveIds.map(quote).join(',')}]::uuid[])`;
  const retain=x=>JSON.parse(scalar(retainSql(x)));
  const check=async(name,work)=>{
    await work();count++;console.log(`PASS ${name}`);
    for(const d of docs)sql(`DELETE FROM public.documents WHERE id='${d}'`);docs.clear();
  };
  await check('private retention has no direct application or service grant',()=>{
    const x=prepare(setup());
    for(const role of ['anon','authenticated','service_role']){
      errorState(asRole(owner,retainSql(x),role,false),'42501');
      for(const table of [bundles,assets,bodies])errorState(asRole(owner,`SELECT * FROM ${table}`,role,false),'42501');
    }
    assert.equal(scalar(`SELECT count(*) FROM ${bundles}`),'0');
  });
  await check('exact candidate and complete archives bind once without publishing or copying the source body',()=>{
    const x=prepare(setup()),before=scalar(`SELECT count(*) FROM ${bodies}`);
    errorState(sql(`UPDATE ${uploads} SET retained_at=clock_timestamp() WHERE operation_id='${x.u.operation_id}'`,false),'23514');
    const r=retain(x);
    assert.deepEqual(retain(x),r);assert.equal(scalar(`SELECT count(*) FROM ${bodies}`),before);
    assert.equal(scalar(`SELECT count(*) FROM ${uploads} u JOIN ${assets} a USING(operation_id) JOIN ${bundles} b ON b.candidate_operation_id=a.candidate_operation_id
      WHERE u.document_id='${x.d}' AND u.retained_at=b.retained_at`),'3');
    errorState(sql(`UPDATE ${uploads} SET retained_at=NULL WHERE operation_id='${x.u.operation_id}'`,false),'23514');
    assert.equal(scalar(`SELECT count(*) FROM ${assets} WHERE document_id='${x.d}'`),'3');
    assert.equal(scalar(`SELECT count(*) FROM ${refs} WHERE document_id='${x.d}'`),'3');
    const paths=[x.u,...x.archives].map(u=>u.path);
    const retirement=JSON.parse(asRole(null,`SELECT public.retire_document_storage_paths(ARRAY[${paths.map(quote).join(',')}]::text[])`,'service_role').stdout);
    assert.deepEqual([...retirement.referenced_paths].sort(),[...paths].sort());assert.deepEqual(retirement.retired_paths,[]);
    assert.equal(scalar(`SELECT file_path FROM documents WHERE id='${x.d}'`),x.path);
    assert.equal(scalar(`SELECT count(*) FROM survey_private.annotation_generation_heads WHERE document_id='${x.d}'`),'0');
    assert.deepEqual(JSON.parse(scalar(`SELECT b.payload FROM ${bodies} b JOIN ${bundles} r ON r.body_id=b.body_id WHERE r.document_id='${x.d}'`)),x.body.payload);
    assert.deepEqual(JSON.parse(scalar(`SELECT source_bytes FROM ${bundles} WHERE document_id='${x.d}'`)),x.body.source_bytes);
  });
  await check('omitted duplicate extra and cross-source members roll back the whole bundle',()=>{
    const x=prepare(setup()),otherSource=setup();
    for(const archiveIds of [[],[x.archives[0].operation_id],[x.archives[0].operation_id,x.archives[0].operation_id],
      [...x.archives.map(a=>a.operation_id),x.u.operation_id],[fresh(),x.archives[1].operation_id]]){
      assert.notEqual(sql(retainSql(x,{archiveIds}),false).status,0);
      assert.equal(scalar(`SELECT count(*) FROM ${bundles} WHERE document_id='${x.d}'`),'0');
    }
    assert.notEqual(sql(retainSql(x,{s:otherSource.s}),false).status,0);
    assert.notEqual(sql(retainSql(x,{actor:viewer}),false).status,0);
    retain(x);
    assert.notEqual(sql(retainSql(x,{archiveIds:[x.archives[0].operation_id]}),false).status,0);
  });
  await check('source expiry cannot collect a retained body or its assets and exact replay stays stable',()=>{
    const x=prepare(setup()),r=retain(x),bodyId=scalar(`SELECT body_id FROM ${bundles} WHERE document_id='${x.d}'`);
    sql(`UPDATE ${sources} SET expires_at=clock_timestamp()-interval '1 second' WHERE source_id='${x.s}'`);
    assert.equal(service('get_document_generation_source_bytes',[x.actor,x.s]).state,'expired');
    assert.equal(scalar(`SELECT count(*) FROM ${bodies} WHERE body_id='${bodyId}'`),'1');assert.deepEqual(retain(x),r);
    // Simulate the passage of two hours only in this owned fixture. Keep both
    // product immutability guards enabled outside this exact transaction.
    sql(`BEGIN;ALTER TABLE ${uploads} DISABLE TRIGGER a_retained_generation_upload_guard;
      ALTER TABLE ${uploads} DISABLE TRIGGER generation_upload_source_binding_guard;
      UPDATE ${uploads} SET expires_at=clock_timestamp()-interval '1 second' WHERE document_id='${x.d}';
      ALTER TABLE ${uploads} ENABLE TRIGGER generation_upload_source_binding_guard;
      ALTER TABLE ${uploads} ENABLE TRIGGER a_retained_generation_upload_guard;COMMIT`);
    service('expire_document_generation_uploads',[100]);
    assert.equal(scalar(`SELECT count(*) FROM ${refs} WHERE document_id='${x.d}'`),'3');
    for(const u of [x.u,...x.archives]){
      assert.notEqual(sql(`SELECT survey_private.cancel_document_generation_upload('${u.operation_id}')`,false).status,0);
      assert.notEqual(sql(`DELETE FROM ${refs} WHERE path=${quote(u.path)}`,false).status,0);
    }
    sql(`DELETE FROM documents WHERE id='${x.d}'`);docs.delete(x.d);
    assert.equal(scalar(`SELECT count(*) FROM ${bundles} WHERE document_id='${x.d}'`),'0');
    assert.equal(scalar(`SELECT count(*) FROM ${assets} WHERE document_id='${x.d}'`),'0');
    assert.equal(scalar(`SELECT count(*) FROM ${bodies} WHERE body_id='${bodyId}'`),'0');
    assert.equal(scalar(`SELECT count(*) FROM ${refs} WHERE document_id='${x.d}'`),'0');
    for(const u of [x.u,...x.archives]){
      assert.equal(scalar(`SELECT state FROM ${uploads} WHERE operation_id='${u.operation_id}'`),'canceled');
      assert.equal(scalar(`SELECT count(*) FROM survey_private.document_storage_cleanup WHERE path=${quote(u.path)}`),'1');
      assert.equal(scalar(`SELECT survey_private.document_storage_path_is_referenced(${quote(u.path)})`),'f');
    }
  });
  await check('retention compares the complete live SQL state before binding',()=>{
    const x=prepare(setup());
    sql(`UPDATE documents SET name='Concurrent edit' WHERE id='${x.d}'`);
    assert.notEqual(sql(retainSql(x),false).status,0);
    assert.equal(scalar(`SELECT count(*) FROM ${bundles} WHERE document_id='${x.d}'`),'0');
  });
  await check('unverified and canceled candidates cannot acquire permanent references',()=>{
    const x=prepare(setup(),{verifyCandidate:false});
    assert.notEqual(sql(retainSql(x),false).status,0);
    assert.equal(scalar(`SELECT count(*) FROM ${bundles} WHERE document_id='${x.d}'`),'0');
    verify(x.u);sql(`SELECT survey_private.cancel_document_generation_upload('${x.u.operation_id}')`);
    assert.notEqual(sql(retainSql(x),false).status,0);
    assert.equal(scalar(`SELECT count(*) FROM ${bundles} WHERE document_id='${x.d}'`),'0');
  });
  await check('retained records and source content cannot be changed or truncated',()=>{
    const x=prepare(setup());retain(x);
    for(const statement of [
      `UPDATE ${bundles} SET body_sha256=repeat('0',64) WHERE document_id='${x.d}'`,
      `UPDATE ${assets} SET content_sha256=repeat('0',64) WHERE document_id='${x.d}'`,
      `DELETE FROM ${assets} WHERE document_id='${x.d}'`,
      `DELETE FROM ${bundles} WHERE document_id='${x.d}'`,
      `UPDATE ${bodies} SET payload='{}' WHERE body_id=(SELECT body_id FROM ${bundles} WHERE document_id='${x.d}')`,
      `TRUNCATE ${bundles} CASCADE`,`TRUNCATE ${assets} CASCADE`,`TRUNCATE ${bodies} CASCADE`,
    ])assert.notEqual(sql(statement,false).status,0,statement);
  });
  await check('absent sidecar sources require just their exact PDF archive',()=>{
    const x=prepare(setup({sidecarPresent:false}));retain(x);
    assert.equal(scalar(`SELECT count(*) FROM ${assets} WHERE document_id='${x.d}'`),'2');
  });
  await check('retained history leaves the four-stage document cap free but does not remove it',()=>{
    const x=setup();retain(prepare(x));retain(prepare(x));
    assert.equal(scalar(`SELECT count(*) FROM ${assets} WHERE document_id='${x.d}'`),'6');
    assert.equal(scalar(`SELECT count(DISTINCT body_id) FROM ${bundles} WHERE document_id='${x.d}'`),'1');
    for(let i=0;i<4;i++)asRole(x.actor,call('begin_document_generation_upload_v2',[x.s,fresh(),'candidate-pdf',sha(candidate),String(candidate.length)]));
    errorState(asRole(x.actor,call('begin_document_generation_upload_v2',[x.s,fresh(),'candidate-pdf',sha(candidate),String(candidate.length)]),'authenticated',false),'54000');
  });
  await check('more than sixteen retained assets do not consume the legacy actor staging cap',()=>{
    for(let i=0;i<6;i++)retain(prepare(setup()));
    assert.equal(scalar(`SELECT count(*) FROM ${assets}`),'18');
    const x=setup();
    const r=JSON.parse(asRole(owner,call('begin_document_generation_upload',[x.d,fresh(),sha(candidate),String(candidate.length)])).stdout);
    assert.equal(r.state,'reserved');
  });
  await check('pending indexes omit retained history while document cleanup keeps an indexed lookup',()=>{
    for(let i=0;i<6;i++)retain(prepare(setup()));
    for(const name of ['document_generation_upload_actor_pending_idx','document_generation_upload_expiry_idx','document_generation_upload_document_pending_idx']){
      const predicate=scalar(`SELECT pg_get_expr(indpred,indrelid) FROM pg_index WHERE indexrelid='survey_private.${name}'::regclass`);
      assert.match(predicate,/retained_at IS NULL/);
    }
    assert.doesNotMatch(scalar("SELECT pg_get_expr(indpred,indrelid) FROM pg_index WHERE indexrelid='survey_private.document_generation_upload_document_idx'::regclass"),/retained_at/);
    sql(`BEGIN;ALTER TABLE ${uploads} DISABLE TRIGGER a_retained_generation_upload_guard;
      ALTER TABLE ${uploads} DISABLE TRIGGER generation_upload_source_binding_guard;
      UPDATE ${uploads} SET expires_at=clock_timestamp()-interval '1 day' WHERE retained_at IS NOT NULL;
      ALTER TABLE ${uploads} ENABLE TRIGGER generation_upload_source_binding_guard;
      ALTER TABLE ${uploads} ENABLE TRIGGER a_retained_generation_upload_guard;COMMIT`);
    sql(`VACUUM(ANALYZE) ${uploads}`);
    // Force index eligibility on this deliberately small fixture, not a claim
    // about a production planner's cost choice. No expired history is scanned.
    const [explain]=JSON.parse(scalar(`SET enable_seqscan=off;EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON)
      SELECT operation_id FROM ${uploads} WHERE state<>'canceled' AND retained_at IS NULL AND expires_at<=now()
      ORDER BY expires_at,operation_id LIMIT 100`));
    const nodes=[],visit=n=>{nodes.push(n);for(const p of n.Plans||[])visit(p);};visit(explain.Plan);
    const scans=nodes.filter(n=>n['Index Name']);
    assert.ok(scans.length>0,JSON.stringify(nodes));
    // PostgreSQL may choose any of the empty pending-only indexes. Requiring
    // one name would mistake an equally bounded plan for a regression.
    for(const scan of scans){
      assert.ok(['document_generation_upload_actor_pending_idx','document_generation_upload_expiry_idx','document_generation_upload_document_pending_idx'].includes(scan['Index Name']),JSON.stringify(scan));
      assert.equal(scan['Actual Rows'],0);assert.equal(scan['Rows Removed by Filter']||0,0);assert.equal(scan['Heap Fetches']||0,0);
    }
    assert.ok(!nodes.some(n=>/Join/.test(n['Node Type'])));
    assert.deepEqual(service('expire_document_generation_uploads',[100]).canceled_operation_ids,[]);
  });
  await check('retained history stays charged by the real aggregate Storage quota guard',()=>{
    const x=prepare(setup());retain(x);
    const used=Number(scalar(`SELECT coalesce(sum((metadata->>'size')::bigint),0) FROM storage.objects WHERE bucket_id='documents' AND name LIKE '${owner}/%'`));
    sql(`CREATE OR REPLACE FUNCTION public.get_storage_limit(uuid) RETURNS bigint LANGUAGE sql AS $$ SELECT ${used+3}::bigint $$`);
    try{
      // Per-file admission succeeds, but allocating four more bytes would put
      // the owner's stored objects one byte over their aggregate test limit.
      const u=JSON.parse(asRole(owner,call('begin_document_generation_upload_v2',[x.s,fresh(),'candidate-pdf',sha(pdf),String(pdf.length)])).stdout);
      errorState(asRole(null,`INSERT INTO storage.objects(bucket_id,name,version,metadata) VALUES('documents',${quote(u.path)},'${version}','{"size":4}')`,'service_role',false),'42501');
      assert.equal(scalar(`SELECT count(*) FROM storage.objects WHERE bucket_id='documents' AND name=${quote(u.path)}`),'0');
      assert.equal(scalar(`SELECT count(*) FROM ${assets} WHERE document_id='${x.d}'`),'3');
      assert.equal(Number(scalar(`SELECT coalesce(sum((metadata->>'size')::bigint),0) FROM storage.objects WHERE bucket_id='documents' AND name LIKE '${owner}/%'`)),used);
    }finally{sql('CREATE OR REPLACE FUNCTION public.get_storage_limit(uuid) RETURNS bigint LANGUAGE sql AS $$ SELECT 1000000000::bigint $$');}
  });
  await check('active PDF and new source verification survive original editor closure and source expiry',()=>{
    const x=prepare(setup({actor:editor}));retain(x);
    sql(`INSERT INTO survey_private.annotation_generations(document_id,generation_id,base_seq,baseline_snapshot,baseline_encoding_version)
      VALUES('${x.d}','${x.u.generation_id}',0,decode('0000','hex'),1);
      INSERT INTO survey_private.annotation_generation_heads VALUES('${x.d}','${x.u.generation_id}',0)`);
    service('cancel_document_generation_source',[editor,x.s]);
    sql(`UPDATE survey_private.account_write_guards SET closing=true WHERE user_id='${editor}'`);
    try{
      assert.notEqual(sql(retainSql(x),false).status,0,'closed editor cannot reread its receipt');
      const active=JSON.parse(scalar(`SELECT survey_private.document_generation_active_pdf('${x.d}','${x.u.generation_id}','${owner}')`));
      assert.equal(active.path,x.u.path);assert.equal(active.content_sha256,sha(candidate));
      assert.equal(active.byte_length,String(candidate.length));
      errorState(sql(`SELECT survey_private.document_generation_active_pdf('${x.d}','${x.archives[0].generation_id}','${owner}')`,false),'23514');
      const s=fresh(),c=fresh(),captured=service('begin_document_generation_source',[owner,x.d,s,x.u.generation_id]);
      assert.equal(captured.source_object.path,x.u.path);
      const proof=service('claim_document_generation_source_bytes',[owner,s,c]);
      const objects=proof.objects.map(o=>({...o,content_sha256:sha(o.kind==='pdf'?candidate:sidecar)}));
      const wrong=structuredClone(objects);wrong[0].content_sha256=sha(pdf);
      errorState(asRole(null,call('record_document_generation_source_bytes',[owner,s,c,JSON.stringify(wrong)]),'service_role',false),'23514');
      assert.equal(service('record_document_generation_source_bytes',[owner,s,c,JSON.stringify(objects)]).state,'verified');
      const freshBody=service('read_document_generation_transform_source',[owner,s]);
      assert.equal(freshBody.payload.semantic.source_object.path,x.u.path);
      assert.equal(freshBody.payload.semantic.generation_id,x.u.generation_id);
      applyMigration(migrationPath(target));
    }finally{sql(`UPDATE survey_private.account_write_guards SET closing=false WHERE user_id='${editor}'`);}
  });
  await check('retention rollback leaves no pin and other transactions cannot cancel its held assets',async()=>{
    const x=prepare(setup()),held=session('retention_transaction',{role:'postgres'});
    held.send(`${retainSql(x)};SELECT 'ready';`);await held.wait('ready');
    assert.equal(scalar(`SELECT count(*) FROM ${bundles} WHERE document_id='${x.d}'`),'0');
    errorState(sql(`SELECT survey_private.cancel_document_generation_upload('${x.u.operation_id}')`,false),'55P03');
    errorState(sql(`SET lock_timeout='100ms';DELETE FROM documents WHERE id='${x.d}'`,false),'55P03');
    assert.equal((await held.finish(false)).status,0);
    assert.equal(scalar(`SELECT count(*) FROM ${bundles} WHERE document_id='${x.d}'`),'0');
    assert.equal(scalar(`SELECT count(*) FROM ${assets} WHERE document_id='${x.d}'`),'0');
    retain(x);
  });
  await check('lease expiry during the last asset insert rolls back the complete retention',()=>{
    const x=prepare(setup());
    sql(`CREATE SEQUENCE survey_private.retention_fixture_insert_count;
      CREATE FUNCTION survey_private.retention_fixture_delay() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
        IF nextval('survey_private.retention_fixture_insert_count')=3 THEN PERFORM pg_sleep(2.2);END IF;RETURN NEW;END;$$;
      CREATE TRIGGER retention_fixture_delay AFTER INSERT ON ${assets} FOR EACH ROW EXECUTE FUNCTION survey_private.retention_fixture_delay();
      BEGIN;ALTER TABLE ${uploads} DISABLE TRIGGER generation_upload_source_binding_guard;
      UPDATE ${sources} SET expires_at=clock_timestamp()+interval '2 seconds' WHERE source_id='${x.s}';
      UPDATE ${uploads} SET expires_at=(SELECT expires_at FROM ${sources} WHERE source_id='${x.s}') WHERE document_id='${x.d}';
      ALTER TABLE ${uploads} ENABLE TRIGGER generation_upload_source_binding_guard;COMMIT`);
    try{
      errorState(sql(retainSql(x),false),'23514');
      assert.equal(scalar('SELECT last_value FROM survey_private.retention_fixture_insert_count'),'3','all assets reached the delayed final insert');
      assert.equal(scalar(`SELECT count(*) FROM ${bundles} WHERE document_id='${x.d}'`),'0');
      assert.equal(scalar(`SELECT count(*) FROM ${assets} WHERE document_id='${x.d}'`),'0');
      assert.equal(scalar(`SELECT count(*) FROM ${refs} WHERE document_id='${x.d}'`),'3','ordinary staging references remain for cleanup');
    }finally{sql(`DROP TRIGGER retention_fixture_delay ON ${assets};DROP FUNCTION survey_private.retention_fixture_delay();DROP SEQUENCE survey_private.retention_fixture_insert_count`);}
  });
  await check('held source upload and body locks reject competing retention without partial rows',async()=>{
    for(const target of ['source','upload','body']){
      const x=prepare(setup()),held=session(`retention_${target}`,{role:'postgres'});
      const statement=target==='source'?`SELECT source_id FROM ${sources} WHERE source_id='${x.s}' FOR UPDATE`
        :target==='upload'?`SELECT operation_id FROM ${uploads} WHERE operation_id='${x.u.operation_id}' FOR UPDATE`
          :`SELECT body_id FROM ${bodies} WHERE body_id=(SELECT body_id FROM ${sources} WHERE source_id='${x.s}') FOR UPDATE`;
      held.send(`${statement};SELECT 'ready';`);await held.wait('ready');
      errorState(sql(retainSql(x),false),'55P03');
      assert.equal(scalar(`SELECT count(*) FROM ${bundles} WHERE document_id='${x.d}'`),'0');
      assert.equal((await held.finish()).status,0);retain(x);
    }
  });
  applyMigration(migrationPath(target));
  console.log(`Document generation retention PostgreSQL checks passed: ${count}`);
},{name:'generation-retention'});
console.log('Disposable local PostgreSQL stopped; exact temporary cluster removed');
