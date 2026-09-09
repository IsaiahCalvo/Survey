// Actual disposable PostgreSQL. Trusted source hashes are synthetic fixtures;
// the handler bridge separately hashes every byte of each owned archive stream.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {withDisposablePostgres} from './helpers/disposablePostgres.mjs';
import {handleDocumentGenerationUpload} from '../supabase/functions/document-generation-upload/handler.js';
assert.equal(process.argv.length,2,'No connection arguments accepted');
const target='20260909095000_document_generation_source_archives.sql';
const migrationPath=n=>fileURLToPath(new URL(`../supabase/migrations/${n}`,import.meta.url));
const source=n=>readFileSync(migrationPath(n),'utf8');
const fn=(file,name)=>{const s=source(file),a=s.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`),b=s.indexOf('$$;',a);assert.ok(a>=0&&b>a);return s.slice(a,b+3);};
const id=n=>`95000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const owner=id(1),editor=id(2),viewer=id(3),other=id(4),project=id(5),version=id(9);
const pdf=new TextEncoder().encode('%PDF'),sidecar=new TextEncoder().encode('{}');
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
await withDisposablePostgres(async pg=>{
 const {sql,scalar,asRole,errorState,session,applyMigration,quote}=pg;
 const prior=readFileSync(new URL('./test-document-generation-source-receipts-postgres.mjs',import.meta.url),'utf8');
 const a=prior.indexOf('  const prior='),b=prior.indexOf('  const doc=');assert.ok(a>=0&&b>a);
 new Function('sql','applyMigration','migrationPath','readFileSync','source','fn','owner','editor','viewer','other','project','assert',
  prior.slice(a,b).replaceAll("'import.meta.url'","'__KEEP_IMPORT_META__'")
   .replaceAll('import.meta.url',JSON.stringify(new URL('./test-document-generation-source-receipts-postgres.mjs',import.meta.url).href))
   .replaceAll('__KEEP_IMPORT_META__','import.meta.url'))
  (sql,applyMigration,migrationPath,readFileSync,source,fn,owner,editor,viewer,other,project,assert);
 for(const file of ['20260909092000_document_generation_source_receipts.sql','20260909093000_document_generation_source_bytes.sql',
  '20260909094000_document_generation_source_bound_uploads.sql',target])applyMigration(migrationPath(file));
 const uploads='survey_private.document_generation_uploads',parents='survey_private.document_generation_sources',refs='survey_private.document_generation_storage_references';
 let index=100,nonce=10000,count=0;const fresh=()=>id(nonce++);
 const call=(name,args)=>`SELECT public.${name}(${args.map(quote).join(',')})`;
 const service=(name,args,required=true)=>asRole(null,call(name,args),'service_role',required);
 const value=(name,args)=>JSON.parse(service(name,args).stdout);
 const setup=({actor=owner,verified=true}={})=>{
  const n=index++,d=id(n),s=fresh(),path=`${owner}/${n}.pdf`,jsonPath=`${project}/${d}_data.json`,c=fresh();
  sql(`INSERT INTO documents(id,user_id,project_id,name,file_path,file_size) VALUES('${d}','${owner}','${project}','Archive','${path}',4);
   INSERT INTO storage.objects(bucket_id,name,version,metadata) VALUES('documents','${path}','${version}','{"size":4}'),('documents','${jsonPath}','${version}','{"size":2}')`);
  const capture=value('begin_document_generation_source',[actor,d,s,null]);
  const claim=value('claim_document_generation_source_bytes',[actor,s,c]);
  const objects=claim.objects.map(o=>({...o,content_sha256:sha(o.kind==='pdf'?pdf:sidecar)}));
  if(verified)value('record_document_generation_source_bytes',[actor,s,c,JSON.stringify(objects)]);
  return {actor,d,s,path,jsonPath,c,capture,objects};
 };
 const beginSql=(x,object=x.objects[1],op=fresh())=>call('begin_document_generation_source_archive',[x.s,op,object.id]);
 const begin=(x,object=x.objects[1],op=fresh())=>JSON.parse(asRole(x.actor,beginSql(x,object,op)).stdout);
 const get=u=>JSON.parse(asRole(u.actor_user_id,call('get_document_generation_upload',[u.operation_id])).stdout);
 const put=u=>asRole(null,`INSERT INTO storage.objects(bucket_id,name,version,metadata) VALUES('documents',${quote(u.path)},'${version}',jsonb_build_object('size',${u.byte_length}))`,'service_role');
 const claim=(u,c=fresh())=>value('claim_document_generation_upload_verification',[u.actor_user_id,u.operation_id,c]);
 const record=(u,c,o,required=true)=>service('record_document_generation_upload_verification',[u.actor_user_id,u.operation_id,o.id,o.version,u.content_sha256,u.byte_length,c],required);
 const cancel=u=>JSON.parse(asRole(u.actor_user_id,call('cancel_document_generation_upload',[u.operation_id])).stdout);
 const recovery=(r,u,state=u.upload_state)=>{
  assert.equal(r.version,3);assert.equal(r.state,'source-unavailable');assert.equal(r.upload_state,state);
  for(const key of ['source_object','object','verified_at','rejection'])assert.equal(r[key],null,key);
  for(const key of ['source_id','purpose','expected_source_generation_id','archived_source_object_id','operation_id','document_id','actor_user_id','owner_user_id','generation_id','source_sql_sha256','path','content_sha256','byte_length','expires_at'])assert.deepEqual(r[key],u[key],key);
 };
 const check=async(name,work)=>{await work();count++;console.log(`PASS ${name}`);
  sql(`SELECT survey_private.cancel_document_generation_upload(operation_id) FROM ${uploads} WHERE state<>'canceled';
   SELECT survey_private.release_document_generation_source(source_id,'canceled') FROM ${parents} WHERE state='captured'`);};
 await check('PDF and sidecar archives derive exact bytes and immutable provenance from the verified source',()=>{
  const x=setup();for(const object of x.objects){const u=begin(x,object);
   assert.equal(u.version,3);assert.equal(u.purpose,'source-object-archive');assert.equal(u.archived_source_object_id,object.id);
   assert.deepEqual(u.source_object,object);assert.deepEqual(Object.keys(u.source_object).sort(),['bucket_id','byte_length','content_sha256','id','kind','path','version']);
   assert.equal(u.content_sha256,object.content_sha256);assert.equal(u.byte_length,object.byte_length);assert.equal(u.source_sql_sha256,x.capture.source_sql_sha256);
   assert.equal(u.expected_source_generation_id,null);assert.equal(u.path,`${owner}/_generations/${x.d}/${u.generation_id}/${u.operation_id}.bin`);
   assert.ok(Date.parse(u.expires_at)<=Date.parse(x.capture.expires_at));assert.deepEqual(get(u),u);
  }
  assert.equal(scalar(`SELECT count(*) FROM ${refs} WHERE document_id='${x.d}'`),'2');
  assert.equal(scalar(`SELECT file_path FROM documents WHERE id='${x.d}'`),x.path);
  assert.equal(scalar(`SELECT count(*) FROM survey_private.annotation_generation_heads WHERE document_id='${x.d}'`),'0');
 });
 await check('v3 get checks the full source once then projects the frozen member under the retained locks',async()=>{
  const x=setup(),u=begin(x);
  sql(`CREATE SEQUENCE survey_private.archive_fixture_source_checks;
   ALTER FUNCTION survey_private.assert_document_generation_source_bytes(uuid,uuid) RENAME TO archive_fixture_real_source_check;
   CREATE FUNCTION survey_private.assert_document_generation_source_bytes(a uuid,s uuid) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$ BEGIN
    PERFORM nextval('survey_private.archive_fixture_source_checks');RETURN survey_private.archive_fixture_real_source_check(a,s);END;$$;
   REVOKE ALL ON FUNCTION survey_private.assert_document_generation_source_bytes(uuid,uuid) FROM PUBLIC,anon,authenticated,service_role;`);
  assert.deepEqual(get(u),u);assert.equal(scalar('SELECT last_value FROM survey_private.archive_fixture_source_checks'),'1');
  const held=session('archive_descriptor_locks',{role:'authenticated',actorId:owner});
  held.send(`SELECT public.get_document_generation_upload('${u.operation_id}');SELECT 'ready';`);await held.wait('ready');
  errorState(service('cancel_document_generation_source',[owner,x.s],false),'55P03');
  errorState(service('release_document_generation_source_bytes',[owner,x.s,x.c],false),'55P03');
  errorState(sql(`SET lock_timeout='100ms';UPDATE storage.objects SET version='${fresh()}' WHERE name=${quote(x.jsonPath)}`,false),'55P03');
  assert.equal((await held.finish()).status,0);
  sql(`DROP FUNCTION survey_private.assert_document_generation_source_bytes(uuid,uuid);
   ALTER FUNCTION survey_private.archive_fixture_real_source_check(uuid,uuid) RENAME TO assert_document_generation_source_bytes;
   DROP SEQUENCE survey_private.archive_fixture_source_checks;`);
 });
 await check('unverified incomplete foreign or unknown source members cannot reserve anything',()=>{
  const x=setup({verified:false}),op=fresh();errorState(asRole(owner,beginSql(x,x.objects[1],op),'authenticated',false),'23514');
  errorState(service('record_document_generation_source_bytes',[owner,x.s,x.c,JSON.stringify(x.objects.slice(0,1))],false),'23514');
  const y=setup(),z=setup();errorState(asRole(owner,beginSql(y,z.objects[1],op),'authenticated',false),'23514');
  errorState(asRole(owner,beginSql(y,{id:fresh()},op),'authenticated',false),'23514');
  errorState(asRole(editor,beginSql(y,y.objects[0],op),'authenticated',false),'42501');
  assert.equal(scalar(`SELECT count(*) FROM ${uploads} WHERE operation_id='${op}'`),'0');
 });
 await check('exact archive retry never rebinds or recaptures and cannot enter v1 or v2 begin',()=>{
  const x=setup(),u=begin(x),y=setup();asRole(owner,`SELECT append_annotation_update('${x.d}','later',1,decode('01','hex'))`);
  assert.deepEqual(begin(x,x.objects[1],u.operation_id),u);
  for(const statement of [beginSql(x,x.objects[0],u.operation_id),beginSql(y,y.objects[1],u.operation_id),
   call('begin_document_generation_upload',[x.d,u.operation_id,u.content_sha256,u.byte_length]),
   call('begin_document_generation_upload_v2',[x.s,u.operation_id,'candidate-pdf',u.content_sha256,u.byte_length])])
   errorState(asRole(owner,statement,'authenticated',false),'22023');
  errorState(asRole(editor,beginSql(x,x.objects[1],u.operation_id),'authenticated',false),'42501');
 });
 await check('an already generated source archives its actual PDF object with the exact expected generation',()=>{
  const x=setup();value('cancel_document_generation_source',[owner,x.s]);
  const active=JSON.parse(asRole(owner,call('begin_document_generation_upload',[x.d,fresh(),sha(pdf),4])).stdout);
  put(active);const ac=fresh(),ar=claim(active,ac);record(active,ac,ar.object);
  sql(`INSERT INTO survey_private.annotation_generations VALUES('${x.d}','${active.generation_id}',0,decode('01','hex'),1,now());
   INSERT INTO survey_private.annotation_generation_heads VALUES('${x.d}','${active.generation_id}',0)`);
  x.s=fresh();x.c=fresh();x.capture=value('begin_document_generation_source',[owner,x.d,x.s,active.generation_id]);
  const sourceClaim=value('claim_document_generation_source_bytes',[owner,x.s,x.c]);
  x.objects=sourceClaim.objects.map(o=>({...o,content_sha256:sha(o.kind==='pdf'?pdf:sidecar)}));
  value('record_document_generation_source_bytes',[owner,x.s,x.c,JSON.stringify(x.objects)]);
  const u=begin(x,x.objects[0]);assert.equal(u.source_object.path,active.path);assert.equal(u.archived_source_object_id,ar.object.id);
  assert.equal(u.expected_source_generation_id,active.generation_id);assert.notEqual(u.generation_id,active.generation_id);
  assert.equal(scalar(`SELECT generation_id FROM survey_private.annotation_generation_heads WHERE document_id='${x.d}'`),active.generation_id);
 });
 await check('unchanged v1 and v2 contracts survive new migration and replay',()=>{
  const x=setup();const v1=JSON.parse(asRole(owner,call('begin_document_generation_upload',[x.d,fresh(),'a'.repeat(64),4])).stdout);
  const v2=JSON.parse(asRole(owner,call('begin_document_generation_upload_v2',[x.s,fresh(),'prior-pdf',sha(pdf),4])).stdout);
  assert.equal(v1.version,1);assert.equal(v2.version,2);for(const u of [v1,v2]){
   assert.equal('archived_source_object_id' in u,false);assert.equal('source_object' in u,false);
   errorState(asRole(owner,beginSql(x,x.objects[0],u.operation_id),'authenticated',false),'22023');
   put(u);const c=fresh(),r=claim(u,c);const done=JSON.parse(record(u,c,r.object).stdout);assert.equal(done.state,'verified');assert.equal(done.version,u.version);
  }
  const v3=begin(x);applyMigration(migrationPath(target));assert.deepEqual(get(v3),v3);
 });
 await check('exact immutable bin object verifies and hash mismatch keeps terminal evidence',()=>{
  for(const rejected of [false,true]){
   const x=setup(),u=begin(x);put(u);const c=fresh(),r=claim(u,c);assert.equal(r.version,3);assert.deepEqual(r.source_object,x.objects[1]);
   const args=[owner,u.operation_id,c,r.object.id,r.object.version,'b'.repeat(64),u.byte_length];
   const done=rejected?value('reject_document_generation_upload_verification',args):JSON.parse(record(u,c,r.object).stdout);
   assert.equal(done.state,rejected?'rejected':'verified');assert.equal(done.version,3);assert.deepEqual(done.source_object,x.objects[1]);
   assert.deepEqual(get(u),done);assert.deepEqual(claim(u,c),done);
   if(rejected)assert.deepEqual(value('reject_document_generation_upload_verification',args),done);else assert.deepEqual(JSON.parse(record(u,c,r.object).stdout),done);
   errorState(asRole(null,`UPDATE storage.objects SET version='${fresh()}' WHERE name=${quote(u.path)}`,'service_role',false),'23514');
  }
 });
 await check('source and archive identities cannot be altered or attached through privileged old fields',()=>{
  const x=setup(),u=begin(x);for(const patch of ['archived_source_object_id=NULL',`archived_source_object_id='${x.objects[0].id}'`,"purpose='candidate-pdf'",'purpose=NULL',"content_sha256=repeat('b',64)",'byte_length=4',"path=path||'.pdf'",`source_id='${fresh()}'`,`expected_source_generation_id='${fresh()}'`])
   errorState(sql(`UPDATE ${uploads} SET ${patch} WHERE operation_id='${u.operation_id}'`,false),'23514');
  const old=JSON.parse(asRole(owner,call('begin_document_generation_upload',[x.d,fresh(),'a'.repeat(64),4])).stdout);
  errorState(sql(`UPDATE ${uploads} SET archived_source_object_id='${x.objects[0].id}' WHERE operation_id='${old.operation_id}'`,false),'23514');
 });
 await check('source mutation or terminal loss never leaks stale source proof and never destroys staged bytes',()=>{
  for(const cause of ['sidecar','pdf','cancel','expiry','revoke','account','generation']){
   const x=setup({actor:editor}),u=begin(x);put(u);const c=fresh(),r=claim(u,c);record(u,c,r.object);
   if(cause==='sidecar'||cause==='pdf')sql(`UPDATE storage.objects SET version='${fresh()}' WHERE name=${quote(cause==='sidecar'?x.jsonPath:x.path)}`);
   if(cause==='cancel')value('cancel_document_generation_source',[editor,x.s]);
   if(cause==='expiry')sql(`UPDATE ${parents} SET expires_at=clock_timestamp()-interval '1 second' WHERE source_id='${x.s}'`);
   if(cause==='revoke')sql(`INSERT INTO document_collaborators VALUES('${x.d}','${editor}','viewer','active')`);
   if(cause==='account')sql(`UPDATE survey_private.account_write_guards SET closing=true WHERE user_id='${editor}'`);
   if(cause==='generation')sql(`INSERT INTO survey_private.annotation_generations VALUES('${x.d}','${fresh()}',0,decode('01','hex'),1,now());INSERT INTO survey_private.annotation_generation_heads SELECT document_id,generation_id,0 FROM survey_private.annotation_generations WHERE document_id='${x.d}'`);
   recovery(get(u),u,'verified');recovery(begin(x,x.objects[1],u.operation_id),u,'verified');
   assert.notEqual(record(u,c,r.object,false).status,0);assert.notEqual(service('claim_document_generation_upload_verification',[editor,u.operation_id,c],false).status,0);
   assert.equal(scalar(`SELECT count(*) FROM storage.objects WHERE name=${quote(u.path)}`),'1');
   const canceled=cancel(u);assert.equal(canceled.version,3);assert.equal(canceled.state,'canceled');assert.equal(canceled.source_object,null);assert.equal(canceled.archived_source_object_id,u.archived_source_object_id);
   if(cause==='account')sql(`UPDATE survey_private.account_write_guards SET closing=false WHERE user_id='${editor}'`);
  }
 });
 await check('archive source loss before upload blocks Storage insert and expired claim release still works',()=>{
  const x=setup(),u=begin(x),v=begin(x,x.objects[0]);put(v);const c=fresh();claim(v,c);
  value('cancel_document_generation_source',[owner,x.s]);
  errorState(asRole(null,`INSERT INTO storage.objects(bucket_id,name,version,metadata) VALUES('documents',${quote(u.path)},'${version}','{"size":2}')`,'service_role',false),'23514');
  for(let n=0;n<2;n++)recovery(value('release_document_generation_upload_verification',[owner,v.operation_id,c]),v);
  assert.equal(scalar(`SELECT verification_claim_expires_at<=clock_timestamp() FROM ${uploads} WHERE operation_id='${v.operation_id}'`),'t');
 });
 await check('source and operation locks bound races and rollback leaves no orphan bin reference',async()=>{
  const x=setup(),u=begin(x),y=setup();const held=session('archive_source_hold',{role:'postgres'});
  held.send(`SELECT source_id FROM ${parents} WHERE source_id='${x.s}' FOR UPDATE;SELECT 'ready';`);await held.wait('ready');
  recovery(get(u),u);errorState(asRole(owner,beginSql(x),'authenticated',false),'55P03');assert.equal(begin(y).version,3);assert.equal((await held.finish()).status,0);
  const op=fresh(),pending=session('archive_operation_hold',{role:'authenticated',actorId:owner});pending.send(`${beginSql(x,x.objects[0],op)};SELECT 'ready';`);await pending.wait('ready');
  errorState(asRole(owner,beginSql(x,x.objects[0],op),'authenticated',false),'55P03');errorState(service('cancel_document_generation_source',[owner,x.s],false),'55P03');
  assert.equal((await pending.finish(false)).status,0);assert.equal(scalar(`SELECT count(*) FROM ${uploads} WHERE operation_id='${op}'`),'0');
  assert.equal(begin(x,x.objects[0],op).version,3);
 });
 await check('same staging caps and permanent owner quota apply to derived archive sizes',()=>{
  const x=setup({actor:editor});for(let n=0;n<4;n++)begin(x);
  errorState(asRole(editor,beginSql(x),'authenticated',false),'54000');
  assert.equal(scalar(`SELECT count(*) FROM ${refs} WHERE document_id='${x.d}'`),'4');
  const y=setup();sql(`CREATE OR REPLACE FUNCTION get_storage_limit(uuid) RETURNS bigint LANGUAGE sql AS $$ SELECT 1::bigint $$`);
  errorState(asRole(owner,beginSql(y),'authenticated',false),'42501');
  sql(`CREATE OR REPLACE FUNCTION get_storage_limit(uuid) RETURNS bigint LANGUAGE sql AS $$ SELECT 1000000000::bigint $$`);
 });
 await check('private grants and READ COMMITTED remain mandatory; no source membership oracle for another actor',()=>{
  const x=setup();for(const role of ['anon','service_role'])errorState(asRole(owner,beginSql(x),role,false),'42501');
  errorState(asRole(null,beginSql(x),'authenticated',false),'42501');errorState(asRole(other,beginSql(x),'authenticated',false),'42501');
  errorState(asRole(owner,`BEGIN ISOLATION LEVEL REPEATABLE READ;${beginSql(x)};COMMIT`,'authenticated',false),'25001');
  errorState(asRole(owner,call('begin_document_generation_source_archive',[x.s,fresh(),null]),'authenticated',false),'22023');
  for(const role of ['anon','authenticated','service_role'])errorState(asRole(owner,`SELECT * FROM ${uploads}`,role,false),'42501');
 });
 await check('document cascade and expiry use the existing cleanup queue for bin archives',()=>{
  const x=setup(),u=begin(x);put(u);sql(`DELETE FROM documents WHERE id='${x.d}'`);assert.equal(get(u).state,'canceled');
  assert.equal(scalar(`SELECT count(*) FROM ${refs} WHERE path=${quote(u.path)}`),'0');
  assert.equal(scalar(`SELECT count(*) FROM survey_private.document_storage_cleanup WHERE path=${quote(u.path)}`),'1');
  const y=setup();sql(`UPDATE ${parents} SET expires_at=clock_timestamp()+interval '3 seconds' WHERE source_id='${y.s}'`);const v=begin(y);
  sql('SELECT pg_sleep(3.1)');const expired=value('expire_document_generation_uploads',[100]);assert.ok(expired.canceled_operation_ids.includes(v.operation_id));
  assert.equal(get(v).source_object,null);assert.equal(get(v).archived_source_object_id,v.archived_source_object_id);
 });
 await check('actual SQL to handler archive bridge hashes PDF and JSON members once and keeps expired recovery identity',async()=>{
  for(const kind of ['pdf','sidecar'])for(const loseReply of [false,true]){
   const x=setup(),member=x.objects.find(o=>o.kind===kind),op=fresh(),bytes=kind==='pdf'?pdf:sidecar;
   let u,streams=0,reads=0,records=0,mints=0,releases=0;const phases=[];
   const decoded=r=>{if(r.status!==0)throw Object.assign(new Error('Local SQL rejected archive'),{code:r.stderr.match(/ERROR:\s+([A-Z0-9]{5}):/)?.[1]});return JSON.parse(r.stdout);};
   const rpc=(name,args)=>decoded(service(name,args,false));
   const deps={enabled:true,sourceBoundEnabled:true,archiveEnabled:true,timeoutMs:10000,newId:fresh,
    getUser:async token=>{assert.equal(token,'owned-local-archive');return {id:owner};},
    begin:async()=>assert.fail('Archive must not use v1'),beginV2:async()=>assert.fail('Archive must not use v2'),
    beginArchive:async(token,input)=>{phases.push('beginArchive');assert.equal(token,'owned-local-archive');
     assert.deepEqual(Object.keys(input).sort(),['action','operation_id','source_id','source_object_id']);
     u=decoded(asRole(owner,call('begin_document_generation_source_archive',[input.source_id,input.operation_id,input.source_object_id]),'authenticated',false));return u;},
    get:async(token,operation)=>{phases.push('get');assert.equal(operation,op);return decoded(asRole(owner,call('get_document_generation_upload',[operation]),'authenticated',false));},
    mint:async path=>{phases.push('mint');mints++;assert.equal(path,u.path);assert.ok(path.endsWith('.bin'));
     assert.equal(scalar(`SELECT count(*) FROM ${refs} WHERE path=${quote(path)}`),'1');
     return {path,token:'synthetic-intent',signedUrl:'https://storage.invalid/no-network'};},
    claim:async(actor,operation,c)=>{phases.push('claim');return rpc('claim_document_generation_upload_verification',[actor,operation,c]);},
    openStream:async path=>{phases.push('openStream');streams++;assert.equal(path,u.path);let offset=0;
     return new ReadableStream({pull(controller){reads++;if(offset===bytes.length){controller.close();return;}controller.enqueue(bytes.slice(offset,++offset));}});},
    record:async(actor,operation,c,objectId,objectVersion,hash,size)=>{phases.push('record');records++;
     assert.equal(hash,member.content_sha256);assert.equal(size,member.byte_length);
     const result=rpc('record_document_generation_upload_verification',[actor,operation,objectId,objectVersion,hash,size,c]);
     if(loseReply)throw new Error('Simulated lost committed archive reply');return result;},
    reject:async()=>assert.fail('Exact source bytes must not be rejected'),
    release:async(actor,operation,c)=>{releases++;return rpc('release_document_generation_upload_verification',[actor,operation,c]);},
    cancel:async(token,operation)=>decoded(asRole(owner,call('cancel_document_generation_upload',[operation]),'authenticated',false)),
   };
   const run=async action=>{
    const input={action,operation_id:op,...(action==='begin-archive'?{source_id:x.s,source_object_id:member.id}:{})};
    const response=await handleDocumentGenerationUpload(new Request('http://localhost/owned-archive',{
     method:'POST',headers:{Authorization:'Bearer owned-local-archive'},body:JSON.stringify(input)}),deps);
    return {status:response.status,body:await response.json()};
   };
   const begun=await run('begin-archive');assert.equal(begun.status,200,JSON.stringify(begun.body));
   assert.deepEqual(phases,['beginArchive','mint','get']);assert.deepEqual(begun.body.operation.source_object,member);assert.equal(begun.body.operation.version,3);
   put(u);const first=await run('verify');assert.equal(first.status,loseReply?502:200,JSON.stringify(first.body));
   const repeated=await run('verify');assert.equal(repeated.status,200,JSON.stringify(repeated.body));assert.equal(repeated.body.operation.state,'verified');
   assert.deepEqual(repeated.body.operation.source_object,member);assert.equal(streams,1);assert.equal(records,1);assert.equal(reads,bytes.length+1);assert.equal(releases,0);
   assert.equal('verification_claim_id' in repeated.body.operation,false);
   const stable=u;sql(`UPDATE ${parents} SET expires_at=clock_timestamp()-interval '1 second' WHERE source_id='${x.s}'`);
   const expired=await run('get');assert.equal(expired.status,200);recovery(expired.body.operation,stable,'verified');
   for(const action of ['begin-archive','verify']){const denied=await run(action);assert.equal(denied.status,409,JSON.stringify(denied.body));
    assert.equal(denied.body.error.code,'source_unavailable');recovery(denied.body.operation,stable,'verified');assert.equal('upload' in denied.body,false);}
   assert.equal(mints,1);assert.equal(streams,1);assert.equal(records,1);assert.equal(releases,0);
   assert.equal(scalar(`SELECT count(*) FROM storage.objects WHERE name=${quote(stable.path)}`),'1');
   assert.equal(scalar(`SELECT count(*) FROM ${refs} WHERE path=${quote(stable.path)}`),'1');
   const canceled=await run('cancel');assert.equal(canceled.status,200);assert.equal(canceled.body.operation.state,'canceled');
   assert.equal(canceled.body.operation.source_object,null);assert.equal(canceled.body.operation.archived_source_object_id,member.id);
  }
 });
 console.log(`Document generation source archive PostgreSQL checks passed: ${count}`);
},{name:'generation-source-archives'});
console.log('Disposable local PostgreSQL stopped; exact temporary cluster removed');
