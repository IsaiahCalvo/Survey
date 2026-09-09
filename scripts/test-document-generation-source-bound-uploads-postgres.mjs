// Real disposable PostgreSQL and tracked source/byte/staging migrations. The
// fixture simulates trusted complete-stream hashes, not provider byte delivery.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {withDisposablePostgres} from './helpers/disposablePostgres.mjs';
import {handleDocumentGenerationUpload} from '../supabase/functions/document-generation-upload/handler.js';
assert.equal(process.argv.length,2,'No connection arguments accepted');
const target='20260909094000_document_generation_source_bound_uploads.sql';
const migrationPath=n=>fileURLToPath(new URL(`../supabase/migrations/${n}`,import.meta.url));
const source=n=>readFileSync(migrationPath(n),'utf8');
const fn=(file,name)=>{const s=source(file),a=s.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`),b=s.indexOf('$$;',a);assert.ok(a>=0&&b>a);return s.slice(a,b+3);};
const id=n=>`94000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const owner=id(1),editor=id(2),viewer=id(3),other=id(4),project=id(5),version=id(9);
await withDisposablePostgres(async pg=>{
 const {sql,scalar,asRole,errorState,session,applyMigration,quote}=pg;
 const prior=readFileSync(new URL('./test-document-generation-source-receipts-postgres.mjs',import.meta.url),'utf8');
 const a=prior.indexOf('  const prior='),b=prior.indexOf('  const doc=');assert.ok(a>=0&&b>a);
 new Function('sql','applyMigration','migrationPath','readFileSync','source','fn','owner','editor','viewer','other','project','assert',
  prior.slice(a,b).replaceAll("'import.meta.url'","'__KEEP_IMPORT_META__'")
   .replaceAll('import.meta.url',JSON.stringify(new URL('./test-document-generation-source-receipts-postgres.mjs',import.meta.url).href))
   .replaceAll('__KEEP_IMPORT_META__','import.meta.url'))
  (sql,applyMigration,migrationPath,readFileSync,source,fn,owner,editor,viewer,other,project,assert);
 applyMigration(migrationPath('20260909092000_document_generation_source_receipts.sql'));
 applyMigration(migrationPath('20260909093000_document_generation_source_bytes.sql'));
 applyMigration(migrationPath(target));
 const uploads='survey_private.document_generation_uploads',parents='survey_private.document_generation_sources',refs='survey_private.document_generation_storage_references';
 let index=100,nonce=10000,count=0;
 const fresh=()=>id(nonce++);
 const call=(name,args)=>`SELECT public.${name}(${args.map(quote).join(',')})`;
 const service=(name,args,required=true)=>asRole(null,call(name,args),'service_role',required);
 const value=(name,args)=>JSON.parse(service(name,args).stdout);
 const setup=({actor=owner,sidecar=false,verified=true}={})=>{
  const n=index++,d=id(n),s=fresh(),path=`${owner}/${n}.pdf`,c=fresh();
  sql(`INSERT INTO documents(id,user_id,project_id,name,file_path,file_size) VALUES('${d}','${owner}','${project}','Bound','${path}',4);
   INSERT INTO storage.objects(bucket_id,name,version,metadata) VALUES('documents','${path}','${version}','{"size":4}');`);
  if(sidecar)sql(`INSERT INTO storage.objects(bucket_id,name,version,metadata) VALUES('documents','${project}/${d}_data.json','${version}','{"size":2}')`);
  const capture=value('begin_document_generation_source',[actor,d,s,null]);
  const x={d,s,path,actor,c,capture};
  if(verified)verify(x);
  return x;
 };
 const verify=x=>{
  const r=value('claim_document_generation_source_bytes',[x.actor,x.s,x.c]);
  const objects=r.objects.map((o,i)=>({...o,content_sha256:String(i+1).repeat(64)}));
  x.proof=value('record_document_generation_source_bytes',[x.actor,x.s,x.c,JSON.stringify(objects)]);return x.proof;
 };
 const beginSql=(x,op,purpose='candidate-pdf',hash='a'.repeat(64),size=4)=>call('begin_document_generation_upload_v2',[x.s,op,purpose,hash,size]);
 const begin=(x,{op=fresh(),purpose='candidate-pdf',hash='a'.repeat(64),size=4}={})=>JSON.parse(asRole(x.actor,beginSql(x,op,purpose,hash,size)).stdout);
 const get=u=>JSON.parse(asRole(u.actor_user_id,call('get_document_generation_upload',[u.operation_id])).stdout);
 const put=u=>asRole(null,`INSERT INTO storage.objects(bucket_id,name,version,metadata) VALUES('documents',${quote(u.path)},'${version}',jsonb_build_object('size',${u.byte_length}))`,'service_role');
 const claim=(u,c=fresh(),required=true)=>service('claim_document_generation_upload_verification',[u.actor_user_id,u.operation_id,c],required);
 const record=(u,c,object,required=true)=>service('record_document_generation_upload_verification',[u.actor_user_id,u.operation_id,object.id,object.version,u.content_sha256,u.byte_length,c],required);
 const reject=(u,c,object,required=true)=>service('reject_document_generation_upload_verification',[u.actor_user_id,u.operation_id,c,object.id,object.version,'b'.repeat(64),u.byte_length],required);
 const cancel=u=>JSON.parse(asRole(u.actor_user_id,call('cancel_document_generation_upload',[u.operation_id])).stdout);
 const unavailable=(r,u,state=u.upload_state)=>{
  assert.equal(r.version,2);assert.equal(r.state,'source-unavailable');assert.equal(r.upload_state,state);
  for(const key of ['object','verified_at','rejection'])assert.equal(r[key],null);
  for(const key of ['source_id','purpose','expected_source_generation_id','operation_id','document_id','actor_user_id','owner_user_id','generation_id','source_sql_sha256','path','content_sha256','byte_length','expires_at'])assert.deepEqual(r[key],u[key]);
  assert.equal('verification_claim_id' in r,false);assert.equal('visible_capture' in r,false);
 };
 const check=async(name,work)=>{
  await work();count++;console.log(`PASS ${name}`);
  sql(`SELECT survey_private.cancel_document_generation_upload(operation_id) FROM ${uploads} WHERE state<>'canceled';
   SELECT survey_private.release_document_generation_source(source_id,'canceled') FROM ${parents} WHERE state='captured'`);
 };
 await check('requires complete source attestation including every captured sidecar',()=>{
  const x=setup({sidecar:true,verified:false}),op=fresh();errorState(asRole(owner,beginSql(x,op),'authenticated',false),'23514');
  const c=value('claim_document_generation_source_bytes',[owner,x.s,x.c]);
  errorState(service('record_document_generation_source_bytes',[owner,x.s,x.c,JSON.stringify(c.objects.slice(0,1).map(o=>({...o,content_sha256:'1'.repeat(64)})))],false),'23514');
  assert.equal(scalar(`SELECT count(*) FROM ${uploads} WHERE operation_id='${op}'`),'0');
  verify(x);assert.equal(begin(x,{op}).state,'reserved');
 });
 await check('prior and candidate are separate immutable staged objects with the same frozen source',()=>{
  const x=setup({sidecar:true}),prior=begin(x,{purpose:'prior-pdf',hash:'1'.repeat(64)}),candidate=begin(x);
  assert.equal(prior.version,2);assert.equal(prior.source_id,x.s);assert.equal(prior.expected_source_generation_id,null);
  assert.equal(prior.source_sql_sha256,x.capture.source_sql_sha256);assert.equal(prior.owner_user_id,owner);
  assert.notEqual(prior.path,candidate.path);assert.notEqual(prior.generation_id,candidate.generation_id);
  assert.ok(Date.parse(prior.expires_at)<=Date.parse(x.capture.expires_at));
  assert.equal(scalar(`SELECT count(*) FROM ${refs} WHERE document_id='${x.d}'`),'2');
  assert.equal(scalar(`SELECT file_path FROM documents WHERE id='${x.d}'`),x.path);
  assert.equal(scalar(`SELECT count(*) FROM survey_private.annotation_generation_heads WHERE document_id='${x.d}'`),'0');
  asRole(owner,`SELECT append_annotation_update('${x.d}','changed-after-capture',1,decode('01','hex'))`);
  assert.deepEqual(begin(x,{op:prior.operation_id,purpose:'prior-pdf',hash:'1'.repeat(64)}),prior);
  assert.equal(begin(x).source_sql_sha256,x.capture.source_sql_sha256);
  applyMigration(migrationPath(target));assert.deepEqual(get(prior),prior);
 });
 await check('prior hash and length are exact; input validation and owner quota remain intact',()=>{
  const x=setup();for(const [purpose,hash,size,code] of [['prior-pdf','a'.repeat(64),4,'23514'],['prior-pdf','1'.repeat(64),5,'23514'],['wrong','a'.repeat(64),4,'22023'],['candidate-pdf','A'.repeat(64),4,'22023'],['candidate-pdf','a'.repeat(64),0,'22023'],[null,'a'.repeat(64),4,'22023']])
   errorState(asRole(owner,beginSql(x,fresh(),purpose,hash,size),'authenticated',false),code);
  const limit=BigInt(scalar(`SELECT get_storage_limit('${owner}')`));assert.ok(limit>=0n);
  errorState(asRole(owner,beginSql(x,fresh(),'candidate-pdf','a'.repeat(64),String(limit+1n)),'authenticated',false),'42501');
  assert.equal(scalar(`SELECT count(*) FROM ${uploads} WHERE document_id='${x.d}'`),'0');
  assert.ok(limit>300000000n);assert.equal(begin(x,{size:'300000000'}).byte_length,'300000000');
 });
 await check('operation retries cannot switch actor source purpose bytes or old and new protocols',()=>{
  const x=setup(),y=setup(),u=begin(x);
  for(const statement of [beginSql(y,u.operation_id),beginSql(x,u.operation_id,'prior-pdf'),beginSql(x,u.operation_id,'candidate-pdf','b'.repeat(64)),beginSql(x,u.operation_id,'candidate-pdf','a'.repeat(64),5),call('begin_document_generation_upload',[x.d,u.operation_id,u.content_sha256,4])])
   errorState(asRole(owner,statement,'authenticated',false),'22023');
  errorState(asRole(editor,beginSql(x,u.operation_id),'authenticated',false),'42501');
  const legacy=JSON.parse(asRole(owner,call('begin_document_generation_upload',[x.d,fresh(),'c'.repeat(64),4])).stdout);
  assert.equal(legacy.version,1);errorState(asRole(owner,beginSql(x,legacy.operation_id,'candidate-pdf','c'.repeat(64)),'authenticated',false),'22023');
  assert.deepEqual(get(legacy),legacy);
 });
 await check('unbound legacy upload verification rejection and cancellation keep their v1 receipts',()=>{
  const x=setup();
  for(const terminal of ['verified','rejected']){
   const u=JSON.parse(asRole(owner,call('begin_document_generation_upload',[x.d,fresh(),'a'.repeat(64),4])).stdout);
   put(u);const c=fresh(),r=JSON.parse(claim(u,c).stdout);
   const receipt=JSON.parse((terminal==='verified'?record(u,c,r.object):reject(u,c,r.object)).stdout);
   assert.equal(receipt.version,1);assert.equal(receipt.state,terminal);assert.equal('source_id' in receipt,false);
   assert.deepEqual(get(u),receipt);assert.deepEqual(JSON.parse(claim(u,c).stdout),receipt);
   assert.equal(cancel(u).state,'canceled');assert.equal(get(u).version,1);
  }
 });
 await check('existing Storage claim record and replay work for source-bound verified receipts',()=>{
  const x=setup(),u=begin(x);put(u);const c=fresh(),claimed=JSON.parse(claim(u,c).stdout);
  assert.equal(claimed.version,2);assert.equal(claimed.verification_claim_id,c);
  const verified=JSON.parse(record(u,c,claimed.object).stdout);assert.equal(verified.state,'verified');assert.equal(verified.upload_state,'verified');
  assert.deepEqual(JSON.parse(record(u,c,claimed.object).stdout),verified);assert.deepEqual(JSON.parse(claim(u,fresh()).stdout),verified);
  assert.deepEqual(get(u),verified);assert.deepEqual(begin(x,{op:u.operation_id}),verified);
 });
 await check('already generated sources retain the exact expected generation without adopting either staged copy',()=>{
  const x=setup();value('cancel_document_generation_source',[owner,x.s]);
  const active=JSON.parse(asRole(owner,call('begin_document_generation_upload',[x.d,fresh(),'1'.repeat(64),4])).stdout);
  put(active);const ac=fresh(),ar=JSON.parse(claim(active,ac).stdout);record(active,ac,ar.object);
  sql(`INSERT INTO survey_private.annotation_generations VALUES('${x.d}','${active.generation_id}',0,decode('01','hex'),1,now());
   INSERT INTO survey_private.annotation_generation_heads VALUES('${x.d}','${active.generation_id}',0)`);
  x.s=fresh();x.c=fresh();x.capture=value('begin_document_generation_source',[owner,x.d,x.s,active.generation_id]);verify(x);
  const u=begin(x,{purpose:'prior-pdf',hash:'1'.repeat(64)});
  assert.equal(u.expected_source_generation_id,active.generation_id);assert.equal(u.source_sql_sha256,x.capture.source_sql_sha256);
  assert.notEqual(u.generation_id,active.generation_id);
  assert.equal(scalar(`SELECT generation_id FROM survey_private.annotation_generation_heads WHERE document_id='${x.d}'`),active.generation_id);
  assert.equal(scalar(`SELECT file_path FROM documents WHERE id='${x.d}'`),x.path);
 });
 await check('source metadata change blocks old privileged replay and leaves recovery bytes intact',()=>{
  for(const terminal of ['reserved','verified','rejected']){
   const x=setup(),u=begin(x);put(u);const c=fresh(),r=JSON.parse(claim(u,c).stdout);
   if(terminal==='verified')record(u,c,r.object);if(terminal==='rejected')reject(u,c,r.object);
   sql(`UPDATE storage.objects SET version='${fresh()}' WHERE name='${x.path}'`);
   unavailable(get(u),u,terminal);unavailable(begin(x,{op:u.operation_id}),u,terminal);
   errorState(claim(u,c,false),'23514');errorState(record(u,c,r.object,false),'23514');errorState(reject(u,c,r.object,false),'23514');
   const released=value('release_document_generation_upload_verification',[owner,u.operation_id,c]);unavailable(released,u,terminal);
   assert.equal(scalar(`SELECT count(*) FROM storage.objects WHERE name=${quote(u.path)}`),'1');
   assert.equal(scalar(`SELECT count(*) FROM ${refs} WHERE path=${quote(u.path)}`),'1');
  }
 });
 await check('source canceled expired revoked or locked is recovery-only while cancellation remains safe',()=>{
  for(const cause of ['canceled','expired','revoked','locked','sidecar','account','generation']){
   const x=setup({actor:editor}),u=begin(x);put(u);const c=fresh(),r=JSON.parse(claim(u,c).stdout);
   if(cause==='canceled')value('cancel_document_generation_source',[editor,x.s]);
   if(cause==='expired')sql(`UPDATE ${parents} SET expires_at=clock_timestamp()-interval '1 second' WHERE source_id='${x.s}'`);
   if(cause==='revoked')sql(`INSERT INTO document_collaborators VALUES('${x.d}','${editor}','viewer','active')`);
   if(cause==='locked')sql(`UPDATE documents SET locked_at=now() WHERE id='${x.d}'`);
   if(cause==='sidecar')sql(`INSERT INTO storage.objects(bucket_id,name,version,metadata) VALUES('documents','${project}/${x.d}_data.json','${version}','{"size":2}')`);
   if(cause==='account')sql(`UPDATE survey_private.account_write_guards SET closing=true WHERE user_id='${editor}'`);
   if(cause==='generation')sql(`INSERT INTO survey_private.annotation_generations VALUES('${x.d}','${fresh()}',0,decode('01','hex'),1,now());INSERT INTO survey_private.annotation_generation_heads SELECT document_id,generation_id,0 FROM survey_private.annotation_generations WHERE document_id='${x.d}'`);
   unavailable(get(u),u);unavailable(begin(x,{op:u.operation_id}),u);
   assert.notEqual(claim(u,c,false).status,0);assert.notEqual(record(u,c,r.object,false).status,0);
   const canceled=cancel(u);assert.equal(canceled.state,'canceled');assert.equal(canceled.upload_state,'canceled');assert.equal(canceled.object,null);
   assert.equal(canceled.source_id,x.s);assert.deepEqual(get(u),canceled);
   assert.equal(scalar(`SELECT count(*) FROM ${refs} WHERE path=${quote(u.path)}`),'0');
   if(cause==='account')sql(`UPDATE survey_private.account_write_guards SET closing=false WHERE user_id='${editor}'`);
  }
 });
 await check('source-bound identity cannot be changed by a privileged writer',()=>{
  const x=setup(),u=begin(x);
  for(const patch of [`source_id=NULL,purpose=NULL`,`source_id='${fresh()}'`,`purpose='prior-pdf'`,`expected_source_generation_id='${fresh()}'`,`operation_id='${fresh()}'`,`actor_user_id='${editor}'`,`owner_user_id='${editor}'`,`document_id='${fresh()}'`,`generation_id='${fresh()}'`,"content_sha256=repeat('b',64)","source_sql_sha256=repeat('b',64)",'byte_length=5',"path=path||'x'","expires_at=expires_at+interval '1 second'","created_at=created_at-interval '1 second'"])
   errorState(sql(`UPDATE ${uploads} SET ${patch} WHERE operation_id='${u.operation_id}'`,false),'23514');
  cancel(u);errorState(sql(`UPDATE ${uploads} SET state='reserved' WHERE operation_id='${u.operation_id}'`,false),'23514');
 });
 await check('same-state proof mutations are checked and terminal upload states cannot resume',()=>{
  for(const terminal of ['verified','rejected']){
   const x=setup(),u=begin(x);put(u);const c=fresh(),r=JSON.parse(claim(u,c).stdout);
   if(terminal==='verified')record(u,c,r.object);else reject(u,c,r.object);
   errorState(sql(`UPDATE ${uploads} SET state='reserved' WHERE operation_id='${u.operation_id}'`,false),'23514');
   value('cancel_document_generation_source',[owner,x.s]);
   const patches=terminal==='verified'?["verified_at=verified_at+interval '1 second'",`verified_object_version='${fresh()}'`]:["observed_sha256=repeat('c',64)","rejected_at=rejected_at+interval '1 second'",`rejected_object_version='${fresh()}'`];
   for(const patch of [...patches,`verification_object_version='${fresh()}'`])errorState(sql(`UPDATE ${uploads} SET ${patch} WHERE operation_id='${u.operation_id}'`,false),'23514');
   assert.equal(cancel(u).state,'canceled');
  }
 });
 await check('repeated or already expired lease release remains safe after source loss without renewing authority',()=>{
  for(const alreadyExpired of [false,true]){
   const x=setup(),u=begin(x);put(u);const c=fresh();JSON.parse(claim(u,c).stdout);
   if(alreadyExpired)sql(`UPDATE ${uploads} SET verification_claim_expires_at=clock_timestamp()-interval '1 second' WHERE operation_id='${u.operation_id}'`);
   value('cancel_document_generation_source',[owner,x.s]);
   for(let retry=0;retry<2;retry++){
    const released=value('release_document_generation_upload_verification',[owner,u.operation_id,c]);unavailable(released,u);
    assert.equal(scalar(`SELECT verification_claim_id='${c}' AND verification_claim_expires_at<=clock_timestamp() FROM ${uploads} WHERE operation_id='${u.operation_id}'`),'t');
   }
   errorState(sql(`UPDATE ${uploads} SET verification_claim_expires_at=clock_timestamp()+interval '1 minute' WHERE operation_id='${u.operation_id}'`,false),'23514');
   assert.equal(scalar(`SELECT count(*) FROM storage.objects WHERE name=${quote(u.path)}`),'1');
  }
 });
 await check('source unavailable prevents a new Storage object and never grants unsafe old-route fallback',()=>{
  const x=setup(),u=begin(x);value('cancel_document_generation_source',[owner,x.s]);
  errorState(asRole(null,`INSERT INTO storage.objects(bucket_id,name,version,metadata) VALUES('documents',${quote(u.path)},'${version}','{"size":4}')`,'service_role',false),'23514');
  errorState(asRole(owner,call('begin_document_generation_upload',[x.d,u.operation_id,u.content_sha256,4]),'authenticated',false),'22023');
  assert.equal(scalar(`SELECT count(*) FROM storage.objects WHERE name=${quote(u.path)}`),'0');
 });
 await check('source and operation contention are bounded; source busy yields only recovery receipt',async()=>{
  const x=setup(),u=begin(x),y=setup();
  const held=session('bound_source_hold',{role:'postgres'});held.send(`SELECT source_id FROM ${parents} WHERE source_id='${x.s}' FOR UPDATE;SELECT 'ready';`);await held.wait('ready');
  unavailable(get(u),u);unavailable(begin(x,{op:u.operation_id}),u);
  errorState(asRole(owner,beginSql(x,fresh()),'authenticated',false),'55P03');assert.equal(begin(y).state,'reserved');
  assert.equal((await held.finish()).status,0);
  const op=fresh(),pending=session('bound_operation_hold',{actorId:owner,role:'authenticated'});pending.send(`${beginSql(x,op)};SELECT 'ready';`);await pending.wait('ready');
  errorState(asRole(owner,beginSql(x,op),'authenticated',false),'55P03');
  errorState(service('cancel_document_generation_source',[owner,x.s],false),'55P03');
  assert.equal((await pending.finish(false)).status,0);assert.equal(scalar(`SELECT count(*) FROM ${uploads} WHERE operation_id='${op}'`),'0');
  assert.equal(begin(x,{op}).state,'reserved');
 });
 await check('READ COMMITTED and actual roles are required without widening legacy ACLs',()=>{
  const x=setup();for(const role of ['anon','service_role'])errorState(asRole(owner,beginSql(x,fresh()),role,false),'42501');
  errorState(asRole(null,beginSql(x,fresh()),'authenticated',false),'42501');
  errorState(asRole(viewer,beginSql(x,fresh()),'authenticated',false),'42501');
  errorState(asRole(owner,`BEGIN ISOLATION LEVEL REPEATABLE READ;${beginSql(x,fresh())};COMMIT`,'authenticated',false),'25001');
  const u=begin(x);for(const role of ['anon','authenticated','service_role'])errorState(asRole(owner,`SELECT * FROM ${uploads}`,role,false),'42501');
  errorState(asRole(owner,call('claim_document_generation_upload_verification',[owner,u.operation_id,fresh()]),'authenticated',false),'42501');
  assert.equal(scalar(`SELECT provolatile FROM pg_proc WHERE oid='survey_private.document_generation_upload_descriptor(uuid)'::regprocedure`),'v');
 });
 await check('bound expiry never exceeds its source; verified expiry queues cleanup and retains identity',()=>{
  const x=setup();sql(`UPDATE ${parents} SET expires_at=clock_timestamp()+interval '3 seconds' WHERE source_id='${x.s}'`);
  const u=begin(x);assert.equal(scalar(`SELECT u.expires_at=s.expires_at FROM ${uploads} u JOIN ${parents} s ON s.source_id=u.source_id WHERE u.operation_id='${u.operation_id}'`),'t');
  put(u);const c=fresh(),r=JSON.parse(claim(u,c).stdout);record(u,c,r.object);
  sql('SELECT pg_sleep(3.1)');unavailable(get(u),u,'verified');errorState(record(u,c,r.object,false),'23514');
  const expired=value('expire_document_generation_uploads',[100]);assert.ok(expired.canceled_operation_ids.includes(u.operation_id));
  assert.equal(get(u).state,'canceled');assert.equal(scalar(`SELECT count(*) FROM ${refs} WHERE path=${quote(u.path)}`),'0');
  assert.equal(scalar(`SELECT count(*) FROM storage.objects WHERE name=${quote(u.path)}`),'1');
 });
 await check('per-document pending bound reservations stay capped and rollback creates no orphan reference',()=>{
  const x=setup();for(let n=0;n<4;n++)begin(x);
  errorState(asRole(owner,beginSql(x,fresh()),'authenticated',false),'54000');
  assert.equal(scalar(`SELECT count(*) FROM ${uploads} WHERE document_id='${x.d}'`),'4');
  assert.equal(scalar(`SELECT count(*) FROM ${refs} WHERE document_id='${x.d}'`),'4');
 });
 await check('parent document cascade cancels bound uploads without requiring the deleted source',()=>{
  const x=setup(),u=begin(x);put(u);sql(`DELETE FROM documents WHERE id='${x.d}'`);
  const r=get(u);assert.equal(r.state,'canceled');assert.equal(r.source_id,x.s);assert.equal(r.object,null);
  assert.equal(scalar(`SELECT count(*) FROM ${refs} WHERE path=${quote(u.path)}`),'0');
 });
 await check('actual handler and SQL bridge preserve v2 identity through byte proof lost reply and recovery',async()=>{
  for(const {loseRecordReply=false,sourceRace=null} of [{},{loseRecordReply:true},{sourceRace:'claim'},{sourceRace:'record'}]){
   const x=setup({sidecar:true}),op=fresh(),bytes=new Uint8Array([37,80,68,70]);
   const hash=createHash('sha256').update(bytes).digest('hex'),calls=[],sqlErrors=[];
   let mintCount=0,streamCount=0,recordCount=0,readCount=0,releaseCount=0,prepared;
   const decodeResult=result=>{
    if(result.status!==0){const code=result.stderr.match(/ERROR:\s+([A-Z0-9]{5}):/)?.[1];sqlErrors.push(code);
     throw Object.assign(new Error('Local SQL rejected the operation'),{code});}
    return JSON.parse(result.stdout);
   };
   const serviceReceipt=(name,args)=>decodeResult(service(name,args,false));
   const deps={enabled:true,sourceBoundEnabled:true,timeoutMs:10000,newId:fresh,
    getUser:async token=>{assert.equal(token,'synthetic-local-bridge');return {id:x.actor};},
    begin:async()=>assert.fail('Bound input must not use the legacy begin RPC'),
    beginV2:async(token,input)=>{
     calls.push('beginV2');assert.equal(token,'synthetic-local-bridge');
     prepared=decodeResult(asRole(x.actor,call('begin_document_generation_upload_v2',[input.source_id,input.operation_id,input.purpose,input.content_sha256,input.byte_length]),'authenticated',false));
     return prepared;
    },
    get:async(token,operation)=>{calls.push('get');assert.equal(token,'synthetic-local-bridge');assert.equal(operation,op);
     return decodeResult(asRole(x.actor,call('get_document_generation_upload',[operation]),'authenticated',false));},
    mint:async path=>{calls.push('mint');mintCount++;assert.equal(path,prepared.path);
     assert.equal(scalar(`SELECT count(*) FROM ${uploads} WHERE operation_id='${op}'`),'1','SQL reservation commits before mint');
     return {path,token:'synthetic-upload-intent',signedUrl:'https://storage.invalid/never-requested'};},
    claim:async(actor,operation,c)=>{calls.push('claim');assert.equal(actor,x.actor);assert.equal(operation,op);
     if(sourceRace==='claim')value('cancel_document_generation_source',[x.actor,x.s]);
     return serviceReceipt('claim_document_generation_upload_verification',[actor,operation,c]);},
    openStream:async path=>{calls.push('openStream');streamCount++;assert.equal(path,prepared.path);let offset=0;
     return new ReadableStream({pull(controller){readCount++;if(offset===bytes.length){controller.close();return;}
      controller.enqueue(bytes.slice(offset,++offset));}});},
    record:async(actor,operation,c,objectId,objectVersion,contentHash,byteLength)=>{
     calls.push('record');recordCount++;assert.equal(contentHash,hash);assert.equal(byteLength,String(bytes.length));
     if(sourceRace==='record')value('cancel_document_generation_source',[x.actor,x.s]);
     const receipt=serviceReceipt('record_document_generation_upload_verification',[actor,operation,objectId,objectVersion,contentHash,byteLength,c]);
     if(loseRecordReply)throw new Error('Simulated lost committed record reply');return receipt;
    },
    reject:async()=>assert.fail('Matching complete bytes must not be rejected'),
    release:async(actor,operation,c)=>{releaseCount++;return serviceReceipt('release_document_generation_upload_verification',[actor,operation,c]);},
    cancel:async(token,operation)=>decodeResult(asRole(x.actor,call('cancel_document_generation_upload',[operation]),'authenticated',false)),
   };
   const run=async action=>{
    const body={action,operation_id:op,...(action==='begin'?{source_id:x.s,purpose:'candidate-pdf',content_sha256:hash,byte_length:String(bytes.length)}:{})};
    const response=await handleDocumentGenerationUpload(new Request('http://localhost/fixture-upload',{
     method:'POST',headers:{Authorization:'Bearer synthetic-local-bridge'},body:JSON.stringify(body)}),deps);
    return {status:response.status,body:await response.json()};
   };
   const begun=await run('begin');assert.equal(begun.status,200,JSON.stringify(begun.body));
   assert.deepEqual(calls,['beginV2','mint','get']);assert.equal(begun.body.operation.version,2);
   assert.equal(begun.body.operation.source_id,x.s);assert.equal(begun.body.operation.purpose,'candidate-pdf');
   assert.equal(begun.body.operation.source_sql_sha256,x.capture.source_sql_sha256);assert.equal(streamCount,0);
   put(prepared);const confirmed=await run('verify');
   if(sourceRace){
    assert.deepEqual(sqlErrors,['23514'],'Actual source helper must reject the mid-phase SQL mutation');
    assert.equal(confirmed.status,409,JSON.stringify(confirmed.body));
    assert.ok(confirmed.body.operation,`Missing same-operation recovery after source changed at ${sourceRace}: ${JSON.stringify(confirmed.body)}`);
    unavailable(confirmed.body.operation,prepared,'reserved');assert.equal(confirmed.body.error.code,'source_unavailable');
    const recovery=await run('get');assert.equal(recovery.status,200);unavailable(recovery.body.operation,prepared,'reserved');
    assert.equal(streamCount,sourceRace==='claim'?0:1);assert.equal(recordCount,sourceRace==='claim'?0:1);
    assert.equal(mintCount,1);assert.equal(releaseCount,0);
    const retry=await run('verify');assert.equal(retry.status,409);unavailable(retry.body.operation,prepared,'reserved');
    assert.equal(streamCount,sourceRace==='claim'?0:1);
    assert.equal(scalar(`SELECT state FROM ${uploads} WHERE operation_id='${op}'`),'reserved');
    assert.equal(scalar(`SELECT count(*) FROM storage.objects WHERE name=${quote(prepared.path)}`),'1');
    continue;
   }
   assert.equal(confirmed.status,loseRecordReply?502:200,JSON.stringify(confirmed.body));
   if(!loseRecordReply){assert.equal(confirmed.body.operation.state,'verified');assert.equal(confirmed.body.operation.upload_state,'verified');}
   const retry=await run('verify');assert.equal(retry.status,200,JSON.stringify(retry.body));assert.equal(retry.body.operation.state,'verified');
   assert.equal(streamCount,1);assert.equal(recordCount,1);assert.equal(readCount,bytes.length+1);assert.equal(releaseCount,0);
   assert.equal('verification_claim_id' in retry.body.operation,false);
   value('cancel_document_generation_source',[x.actor,x.s]);
   const recovery=await run('get');assert.equal(recovery.status,200,JSON.stringify(recovery.body));unavailable(recovery.body.operation,prepared,'verified');
   for(const action of ['verify','begin']){
    const denied=await run(action);assert.equal(denied.status,409,JSON.stringify(denied.body));assert.equal(denied.body.error.code,'source_unavailable');
    unavailable(denied.body.operation,prepared,'verified');assert.equal('upload' in denied.body,false);
   }
   assert.equal(streamCount,1);assert.equal(recordCount,1);assert.equal(mintCount,1);assert.equal(releaseCount,0);
   assert.equal(scalar(`SELECT count(*) FROM storage.objects WHERE name=${quote(prepared.path)}`),'1');
   assert.equal(scalar(`SELECT count(*) FROM ${refs} WHERE path=${quote(prepared.path)}`),'1');
   assert.equal(scalar(`SELECT file_path FROM documents WHERE id='${x.d}'`),x.path);
   assert.equal(scalar(`SELECT count(*) FROM survey_private.annotation_generation_heads WHERE document_id='${x.d}'`),'0');
  }
 });
 console.log(`Document generation source-bound PostgreSQL checks passed: ${count}`);
},{name:'generation-source-bound'});
console.log('Disposable local PostgreSQL stopped; exact temporary cluster removed');
