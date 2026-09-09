// Real isolated PostgreSQL, synthetic trusted verifier attestations only. This
// fixture does not claim that Storage metadata proves actual provider bytes.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {withDisposablePostgres} from './helpers/disposablePostgres.mjs';
import {handleDocumentGenerationSourceBytes} from '../supabase/functions/document-generation-source-bytes/handler.js';
assert.equal(process.argv.length,2,'This fixture accepts no connection arguments');
const target='20260909093000_document_generation_source_bytes.sql';
const migrationPath=n=>fileURLToPath(new URL(`../supabase/migrations/${n}`,import.meta.url));
const source=n=>readFileSync(migrationPath(n),'utf8');
const fn=(file,name)=>{const s=source(file),a=s.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`),b=s.indexOf('$$;',a);assert.ok(a>=0&&b>a);return s.slice(a,b+3);};
const id=n=>`93000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
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
 applyMigration(migrationPath(target));
 const parents='survey_private.document_generation_sources',proofs='survey_private.document_generation_source_bytes',claims='survey_private.document_generation_source_byte_claims';
 let index=100,count=0;
 const rpc=(name,args,required=true)=>asRole(null,`SELECT public.${name}(${args.map(quote).join(',')})`,'service_role',required);
 const value=(name,args)=>JSON.parse(rpc(name,args).stdout);
 const setup=({actor=owner,sidecar=false}={})=>{
  const n=index++,d=id(n),s=id(n+1000),path=`${owner}/${n}.pdf`;
  sql(`INSERT INTO documents(id,user_id,project_id,name,file_path,file_size) VALUES('${d}','${owner}','${project}','Bytes','${path}',4);
   INSERT INTO storage.objects(bucket_id,name,version,metadata) VALUES('documents','${path}','${version}','{"size":4}');`);
  if(sidecar)sql(`INSERT INTO storage.objects(bucket_id,name,version,metadata) VALUES('documents','${project}/${d}_data.json','${version}','{"size":2}')`);
  const capture=value('begin_document_generation_source',[actor,d,s,null]);return {d,s,path,actor,capture,c:id(n+2000)};
 };
 const get=x=>value('get_document_generation_source_bytes',[x.actor,x.s]);
 const claim=(x,c=x.c)=>value('claim_document_generation_source_bytes',[x.actor,x.s,c]);
 const manifest=r=>r.objects.map((o,i)=>({...o,content_sha256:String(i+1).repeat(64)}));
 const record=(x,objects,c=x.c,required=true)=>rpc('record_document_generation_source_bytes',[x.actor,x.s,c,JSON.stringify(objects)],required);
 const cancel=x=>value('cancel_document_generation_source',[x.actor,x.s]);
 const gateway=async(x,{fill=7,status=200}={})=>{
  let streams=0;
  const request=()=>new Request('http://localhost/source-bytes',{method:'POST',headers:{Authorization:'Bearer synthetic-local-token'},body:JSON.stringify({action:'verify',source_id:x.s})});
  const deps={enabled:true,getUser:async()=>({id:x.actor}),newId:()=>x.c,
   get:async(a,s)=>{assert.equal(a,x.actor);assert.equal(s,x.s);return get(x);},
   claim:async(a,s,c)=>{assert.equal(a,x.actor);assert.equal(s,x.s);return claim(x,c);},
   openStream:async o=>{streams++;return new Response(new Uint8Array(Number(o.byte_length)).fill(fill)).body;},
   record:async(a,s,c,objects)=>{assert.equal(a,x.actor);assert.equal(s,x.s);const result=record(x,objects,c,false);
    if(result.status!==0)throw Object.assign(new Error('Local SQL rejected receipt'),{code:result.stderr.match(/ERROR:\s+([A-Z0-9]{5}):/)?.[1]});return JSON.parse(result.stdout);},
   release:async(a,s,c)=>value('release_document_generation_source_bytes',[a,s,c])};
  const response=await handleDocumentGenerationSourceBytes(request(),deps),body=await response.json();assert.equal(response.status,status,JSON.stringify(body));
  if(status!==200){assert.equal(streams,get(x).objects.length,'all complete streams reached checked SQL');return body;}
  assert.deepEqual(body.attestation,get(x));assert.equal(streams,body.attestation.objects.length);
  const again=await handleDocumentGenerationSourceBytes(request(),deps);assert.equal(again.status,200);assert.deepEqual(await again.json(),body);
  assert.equal(streams,body.attestation.objects.length,'verified checked replay must not download again');
 };
 const check=async(name,work)=>{await work();count++;console.log(`PASS ${name}`);sql(`SELECT survey_private.release_document_generation_source(source_id,'canceled') FROM ${parents} WHERE state='captured'`);};
 await check('metadata alone remains unverified; full PDF and sidecar exact stream receipt survives replay',()=>{
  const x=setup({sidecar:true}),r=get(x);assert.equal(r.state,'unverified');assert.deepEqual(r.objects.map(o=>o.content_sha256),[null,null]);
  assert.deepEqual(r.objects.map(o=>o.kind),['pdf','sidecar']);const c=claim(x);assert.equal(c.state,'verifying');
  assert.equal(c.verification_claim_id,x.c);assert.ok(Date.parse(c.verification_claim_expires_at)<=Date.parse(c.expires_at));
  const bytes=manifest(c),saved=JSON.parse(record(x,bytes).stdout);assert.equal(saved.state,'verified');assert.deepEqual(saved.objects,bytes);
  assert.deepEqual(JSON.parse(record(x,bytes).stdout),saved);assert.deepEqual(get(x),saved);assert.deepEqual(claim(x),saved);
  assert.equal(value('get_document_generation_source',[x.actor,x.s]).source_byte_state,'unverified');
  applyMigration(migrationPath(target));assert.deepEqual(get(x),saved);
 });
 await check('missing extra reordered mismatched and malformed manifest cannot verify',()=>{
  const x=setup({sidecar:true}),m=manifest(claim(x));
  for(const bad of [m.slice(0,1),[...m,m[1]],[...m].reverse(),m.map((o,i)=>i?o:{...o,path:'other.pdf'}),m.map((o,i)=>i?o:{...o,byte_length:'5'}),m.map(o=>({...o,extra:true}))])
   errorState(record(x,bad,x.c,false),'23514');
  errorState(record(x,m.map(o=>({...o,content_sha256:null})),x.c,false),'22023');assert.equal(get(x).state,'verifying');
  JSON.parse(record(x,m).stdout);errorState(record(x,m.map(o=>({...o,content_sha256:'a'.repeat(64)})),x.c,false),'23505');
 });
 await check('metadata change during outside-SQL I/O invalidates record and checked get',()=>{
  const x=setup(),m=manifest(claim(x));sql(`UPDATE storage.objects SET version='${id(90)}' WHERE name='${x.path}'`);
  errorState(record(x,m,x.c,false),'23514');errorState(rpc('get_document_generation_source_bytes',[x.actor,x.s],false),'23514');
  assert.equal(scalar(`SELECT verified_at IS NULL FROM ${proofs} WHERE source_id='${x.s}'`),'t');
 });
 await check('previously absent sidecar must remain absent through record',()=>{
  const x=setup(),m=manifest(claim(x));sql(`INSERT INTO storage.objects(bucket_id,name,version,metadata) VALUES('documents','${project}/${x.d}_data.json','${version}','{"size":2}')`);
  errorState(record(x,m,x.c,false),'23514');
 });
 await check('source actor revoke and document lock block verification without discarding evidence',()=>{
  const x=setup({actor:editor}),m=manifest(claim(x));sql(`INSERT INTO document_collaborators VALUES('${x.d}','${editor}','viewer','active')`);
  errorState(record(x,m,x.c,false),'42501');assert.equal(scalar(`SELECT count(*) FROM ${proofs} WHERE source_id='${x.s}'`),'1');
  const y=setup(),ym=manifest(claim(y));sql(`UPDATE documents SET locked_at=now() WHERE id='${y.d}'`);errorState(record(y,ym,y.c,false),'42501');
 });
 await check('closed account and changed generation cannot accept old source proof',()=>{
  const x=setup(),m=manifest(claim(x));sql(`UPDATE survey_private.account_write_guards SET closing=true WHERE user_id='${owner}'`);
  errorState(record(x,m,x.c,false),'23514');sql(`UPDATE survey_private.account_write_guards SET closing=false WHERE user_id='${owner}'`);
  const y=setup(),ym=manifest(claim(y));sql(`INSERT INTO survey_private.annotation_generations VALUES('${y.d}','${id(888)}',0,decode('01','hex'),1,now());INSERT INTO survey_private.annotation_generation_heads VALUES('${y.d}','${id(888)}',0)`);
  errorState(record(y,ym,y.c,false),'SG001');
 });
 await check('expired and canceled sources remove proof claims but retain small terminal identity',()=>{
  for(const terminal of ['expired','canceled']){
   const x=setup(),m=manifest(claim(x));JSON.parse(record(x,m).stdout);
   if(terminal==='expired')sql(`UPDATE ${parents} SET expires_at=clock_timestamp()-interval '1 second' WHERE source_id='${x.s}'`);else cancel(x);
   const r=get(x);assert.equal(r.state,terminal);assert.deepEqual(r.objects,[]);assert.equal(r.verified_at,null);
   for(const t of [proofs,claims])assert.equal(scalar(`SELECT count(*) FROM ${t} WHERE source_id='${x.s}'`),'0');
   assert.equal(JSON.parse(record(x,m).stdout).state,terminal);
  }
 });
 await check('live claims single-flight; retired A cannot reappear after B',()=>{
  const x=setup(),first=claim(x),m=manifest(first),second=id(9000);assert.deepEqual(claim(x),first);
  errorState(rpc('claim_document_generation_source_bytes',[x.actor,x.s,second],false),'40001');
  assert.equal(value('release_document_generation_source_bytes',[x.actor,x.s,x.c]).released,true);
  claim(x,second);errorState(record(x,m,x.c,false),'40001');
  value('release_document_generation_source_bytes',[x.actor,x.s,second]);errorState(rpc('claim_document_generation_source_bytes',[x.actor,x.s,x.c],false),'40001');
  const third=id(9001);claim(x,third);JSON.parse(record(x,m,third).stdout);
  assert.equal(value('release_document_generation_source_bytes',[x.actor,x.s,third]).released,false);assert.equal(get(x).state,'verified');
 });
 await check('expired verifier claim can be replaced but not revived',()=>{
  const x=setup(),m=manifest(claim(x));sql(`UPDATE ${proofs} SET claim_expires_at=clock_timestamp()-interval '1 second' WHERE source_id='${x.s}'`);
  errorState(record(x,m,x.c,false),'40001');const next=id(9010);claim(x,next);errorState(record(x,m,x.c,false),'40001');assert.equal(JSON.parse(record(x,m,next).stdout).state,'verified');
 });
 await check('claim budget bounded and terminal cleanup removes used identities',()=>{
  const x=setup();sql(`INSERT INTO ${claims}(source_id,claim_id) SELECT '${x.s}',('93000000-1111-4000-8000-'||lpad(n::text,12,'0'))::uuid FROM generate_series(1,128) n`);
  errorState(rpc('claim_document_generation_source_bytes',[x.actor,x.s,x.c],false),'54000');cancel(x);
  assert.equal(scalar(`SELECT count(*) FROM ${claims} WHERE source_id='${x.s}'`),'0');
 });
 await check('unknown object versions or sizes fail closed before provider claim',()=>{
  for(const patch of ["version=NULL","version='opaque'","metadata='{}'","metadata='{\"size\":0}'"]){
   const x=setup();cancel(x);sql(`UPDATE storage.objects SET ${patch} WHERE name='${x.path}'`);
   x.s=id(index++ +3000);value('begin_document_generation_source',[x.actor,x.d,x.s,null]);
   errorState(rpc('claim_document_generation_source_bytes',[x.actor,x.s,x.c],false),'23514');
  }
 });
 await check('short checked SQL lock blocks metadata race while unrelated document progresses',async()=>{
  const x=setup(),y=setup(),lock=session('source_bytes_check',{role:'service_role'});
  lock.send(`SELECT get_document_generation_source_bytes('${x.actor}','${x.s}');SELECT 'ready';`);await lock.wait('ready');
  errorState(sql(`SET lock_timeout='100ms';UPDATE storage.objects SET version='${id(91)}' WHERE name='${x.path}'`,false),'55P03');
  assert.equal(claim(y).state,'verifying');assert.equal((await lock.finish()).status,0);
 });
 await check('service-only APIs and private ownership survive replay; forged JWT role insufficient',()=>{
  const x=setup();for(const role of ['anon','authenticated'])errorState(asRole(owner,`SET request.jwt.claim.role='service_role';SELECT get_document_generation_source_bytes('${owner}','${x.s}')`,role,false),'42501');
  errorState(rpc('get_document_generation_source_bytes',[other,x.s],false),'42501');
  for(const t of [proofs,claims])for(const role of ['anon','authenticated','service_role'])errorState(asRole(owner,`SELECT * FROM ${t}`,role,false),'42501');
  const functions=[...source(target).matchAll(/ALTER FUNCTION ([^;]+) OWNER TO postgres;/g)].map(x=>x[1]);assert.equal(functions.length,7);
  assert.equal(scalar(`SELECT count(*) FROM pg_proc WHERE oid IN (${functions.map(x=>`${quote(x)}::regprocedure`).join(',')}) AND proowner='postgres'::regrole`),'7');
 });
 await check('actual byte handler streams complete legacy PDF plus sidecar into exact SQL receipt',async()=>{
  await gateway(setup({sidecar:true}));
 });
 await check('actual byte handler verifies active generation binding with retained exact object',async()=>{
  const x=setup();cancel(x);
  const knownSha=createHash('sha256').update(new Uint8Array(4).fill(7)).digest('hex');
  const u=JSON.parse(asRole(owner,`SELECT begin_document_generation_upload('${x.d}','${id(9500)}','${knownSha}',4)`).stdout);
  asRole(null,`INSERT INTO storage.objects(bucket_id,name,version,metadata) VALUES('documents',${quote(u.path)},'${version}','{"size":4}')`,'service_role');
  const c=value('claim_document_generation_upload_verification',[owner,u.operation_id,id(9501)]);
  value('record_document_generation_upload_verification',[owner,u.operation_id,c.object.id,version,knownSha,'4',id(9501)]);
  sql(`INSERT INTO survey_private.annotation_generations VALUES('${x.d}','${u.generation_id}',0,decode('01','hex'),1,now());INSERT INTO survey_private.annotation_generation_heads VALUES('${x.d}','${u.generation_id}',0)`);
  x.s=id(9502);x.capture=value('begin_document_generation_source',[owner,x.d,x.s,u.generation_id]);
  assert.equal(get(x).objects[0].path,u.path);
  const denied=await gateway(x,{fill:8,status:409});assert.equal(denied.error.code,'23514');
  assert.equal(scalar(`SELECT objects IS NULL AND verified_at IS NULL FROM ${proofs} WHERE source_id='${x.s}'`),'t');
  await gateway(x);assert.equal(get(x).objects[0].content_sha256,knownSha);
  sql(`DELETE FROM survey_private.document_generation_storage_references WHERE document_id='${x.d}' AND generation_id='${u.generation_id}'`);
  errorState(rpc('get_document_generation_source_bytes',[x.actor,x.s],false),'23514');
 });
 console.log(`Document generation source byte PostgreSQL checks passed: ${count}`);
},{name:'generation-source-bytes'});
console.log('Disposable local PostgreSQL stopped; exact temporary cluster removed');
