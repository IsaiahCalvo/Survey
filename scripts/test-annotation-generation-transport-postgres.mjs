// Installed, isolated PostgreSQL only; no provider/account access.
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {withDisposablePostgres} from './helpers/disposablePostgres.mjs';
assert.equal(process.argv.length,2,'This local fixture accepts no arguments');
const target='20260909090000_annotation_generation_transport.sql';
const migrationPath=name=>fileURLToPath(new URL(`../supabase/migrations/${name}`,import.meta.url));
const source=name=>readFileSync(migrationPath(name),'utf8');
const fn=(file,name)=>{const s=source(file),a=s.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`),b=s.indexOf('$$;',a);assert.ok(a>=0&&b>a);return s.slice(a,b+3);};
const id=n=>`90000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const owner=id(1),editor=id(2),viewer=id(3),other=id(4),project=id(5);
await withDisposablePostgres(async pg=>{
  const {sql,scalar,asRole,errorState,session,applyMigration,quote}=pg;
  // Actual role helper/WAL/legacy/survey DDL and prior authority/revision fences.
  // Core documents/storage fixture RLS is intentionally synthetic and broad;
  // this file verifies all-role write fences, not the separate read migration.
  const bootstrap=readFileSync(new URL('./test-document-generation-upload-staging-postgres.mjs',import.meta.url),'utf8');
  const a=bootstrap.indexOf('  const prior='),b=bootstrap.indexOf('  const uploads=');assert.ok(a>=0&&b>a);
  new Function('sql','applyMigration','migrationPath','readFileSync','source','fn','owner','editor','viewer','other','project','assert',
    bootstrap.slice(a,b).replaceAll("new URL('./test-document-generation-storage-references-postgres.mjs',import.meta.url)",JSON.stringify(fileURLToPath(new URL('./test-document-generation-storage-references-postgres.mjs',import.meta.url)))))
    (sql,applyMigration,migrationPath,readFileSync,source,fn,owner,editor,viewer,other,project,assert);
  const doc=n=>{sql(`INSERT INTO documents(id,user_id,project_id,name,file_path,file_size) VALUES('${id(n)}','${owner}','${project}','fixture','${owner}/${n}.pdf',4)`);return id(n);};
  const gen=(d,n,base=0)=>{sql(`INSERT INTO survey_private.annotation_generations(document_id,generation_id,base_seq,baseline_snapshot,baseline_encoding_version)
    VALUES('${d}','${id(n)}',${base},decode('0102','hex'),1);
    ${scalar(`SELECT EXISTS(SELECT 1 FROM survey_private.annotation_generation_heads WHERE document_id='${d}')`)==='t'
      ?`UPDATE survey_private.annotation_generation_heads SET generation_id='${id(n)}',last_seq=${base} WHERE document_id='${d}'`
      :`INSERT INTO survey_private.annotation_generation_heads(document_id,generation_id,last_seq) VALUES('${d}','${id(n)}',${base})`};`);return id(n);};
  const append=(d,g,n=1,data='010203',writer='writer')=>`SELECT public.append_annotation_update_v2('${d}',${quote(g)},${quote(writer)},${n},decode('${data}','hex'))`;
  const snap=(d,g,n=1,epoch=1,base=0,baseWriter=null,baseEpoch=0,data='0304')=>`SELECT public.store_annotation_snapshot_v2('${d}',${quote(g)},${n},decode('${data}','hex'),1,'checkpoint',${epoch},${base===null?'NULL':base},${quote(baseWriter)},${baseEpoch})`;
  const read=(d,g)=>`SELECT public.read_annotation_snapshot_v2('${d}',${quote(g)})`;
  const page=(d,g,after=0,through=null,limit=1000)=>`SELECT public.read_annotation_updates_v2('${d}',${quote(g)},${after},${through??'NULL'},${limit})`;
  const run=(q,actor=owner)=>JSON.parse(asRole(actor,q).stdout);
  let checks=0;const check=async(name,work)=>{await work();checks++;console.log(`PASS ${name}`);};
  const d0=doc(99);asRole(owner,`SELECT * FROM public.append_annotation_update('${d0}','legacy',1,decode('01','hex'))`);
  console.log('PASS baseline legacy append accepts generation-less state');
  applyMigration(migrationPath(target));
  await check('migration replay preserves legacy rows and grants',()=>{
    const before=scalar(`SELECT row_to_json(u) FROM annotation_updates u WHERE document_id='${d0}'`);
    applyMigration(migrationPath(target));assert.equal(scalar(`SELECT row_to_json(u) FROM annotation_updates u WHERE document_id='${d0}'`),before);
    assert.equal(run(read(d0,null)).wal_head,'1');
    for(const role of ['anon','authenticated','service_role']) errorState(asRole(owner,'SELECT * FROM survey_private.annotation_generation_heads',role,false),'42501');
    errorState(asRole(owner,read(d0,null),'anon',false),'42501');
  });
  await check('NULL mode preserves actual append/read/snapshot and decimal receipts',()=>{
    const d=doc(100),r=run(append(d,null));assert.equal(r.seq,'1');assert.equal(r.client_seq,'1');assert.equal(r.is_current,true);assert.equal(r.current_generation_id,null);
    assert.equal(r.data_sha256,'039058c6f2c0cb492c533b0a4d14ef77cc0f78abccced5287d84a1a2011cfb81');
    assert.deepEqual(run(append(d,null)),r);assert.equal(run(page(d,null)).rows[0].data,'\\x010203');
    assert.equal(run(snap(d,null,1,1,null)).stored,true);assert.equal(run(read(d,null)).snapshot.at_seq,'1');
    assert.equal(run(`SELECT public.read_annotation_writer_sequence_v2('${d}',NULL,'writer')`).client_seq,'1');
    assert.equal(run(`SELECT public.read_annotation_writer_sequence_v2('${d}',NULL,'writer')`,editor).client_seq,'0');
  });
  await check('adopted baseline then append advances global frontier and writer scope',()=>{
    const d=doc(101);run(append(d,null));const g=gen(d,1001,1);const r=run(read(d,g));assert.equal(r.snapshot.at_seq,'1');assert.equal(r.snapshot.snapshot,'\\x0102');
    assert.equal(run(append(d,g)).seq,'2');assert.equal(run(append(d,g,1,'ff'),editor).seq,'3');
    assert.equal(run(`SELECT public.read_annotation_writer_sequence_v2('${d}','${g}','writer')`,editor).client_seq,'1');
    errorState(asRole(owner,append(d,g,1,'aa'),'authenticated',false),'23505');
    run(append(d,g,3));errorState(asRole(owner,append(d,g,2),'authenticated',false),'23505');
  });
  await check('generation mismatch is distinct with safe current generation detail',()=>{
    const d=doc(102),g=gen(d,1002);
    const wrong=asRole(owner,read(d,id(9999)),'authenticated',false);errorState(wrong,'SG002');assert.match(wrong.stderr,new RegExp(g));
    errorState(asRole(owner,read(d,null),'authenticated',false),'SG001');
    errorState(asRole(other,read(d,id(9999)),'authenticated',false),'42501');
    errorState(asRole(other,`SELECT * FROM public.append_annotation_update('${d}','stranger',1,decode('01','hex'))`,'authenticated',false),'42501');
    errorState(asRole(other,`SELECT public.store_annotation_snapshot('${d}',0,decode('01','hex'),1,'stranger',1,NULL,NULL,0)`,'authenticated',false),'42501');
    errorState(asRole(viewer,append(d,g),'authenticated',false),'42501');
    assert.equal(run(read(d,g),viewer).wal_head,'0');
  });
  await check('exact historical receipts survive replacement/revocation without current authority',()=>{
    const d=doc(103);const legacy=run(append(d,null,1,'01','old'),editor),g=gen(d,1003,1),receipt=run(append(d,g),editor);
    const next=gen(d,2003,2);sql(`INSERT INTO document_collaborators VALUES('${d}','${editor}','viewer','active')`);
    const old=run(append(d,g),editor);assert.equal(old.seq,receipt.seq);assert.equal(old.is_current,false);assert.equal(old.current_generation_id,next);
    const oldLegacy=run(append(d,null,1,'01','old'),editor);assert.equal(oldLegacy.seq,legacy.seq);assert.equal(oldLegacy.is_current,false);
    errorState(asRole(editor,append(d,g,2),'authenticated',false),'42501');
    errorState(asRole(owner,`SELECT * FROM public.append_annotation_update('${d}','old',1,decode('01','hex'))`,'authenticated',false),'SG001');
    errorState(asRole(owner,`SELECT public.store_annotation_snapshot('${d}',1,decode('01','hex'),1,'x',1,NULL,NULL,0)`,'authenticated',false),'SG001');
  });
  await check('snapshot full CAS and exact retry preserve current checkpoint',()=>{
    const d=doc(104),g=gen(d,1004);run(append(d,g));const first=run(snap(d,g));assert.equal(first.stored,true);assert.match(first.snapshot_sha256,/^[a-f0-9]{64}$/);
    run(append(d,g,2));assert.equal(run(snap(d,g)).stored,true);
    assert.equal(run(snap(d,g,2,2,0)).stored,false);
    assert.equal(run(snap(d,g,2,2,1,'checkpoint',1)).stored,true);
    assert.equal(run(read(d,g)).snapshot.writer_epoch,'2');
    gen(d,2004,2);errorState(asRole(owner,snap(d,g,2,2,1,'checkpoint',1),'authenticated',false),'SG002');
  });
  await check('generated checkpoints reject invalid writer/CAS counters before persistence',()=>{
    const d=doc(120),g=gen(d,1020);
    for(const writer of [null,'','x'.repeat(513)]) errorState(asRole(owner,`SELECT public.store_annotation_snapshot_v2('${d}','${g}',0,decode('01','hex'),1,${quote(writer)},1,0,NULL,0)`,'authenticated',false),'22023');
    for(const q of [snap(d,g,0,0),snap(d,g,0,-1),snap(d,g,0,1,-1),snap(d,g,0,1,0,'x'.repeat(513)),snap(d,g,0,1,0,null,-1)]) errorState(asRole(owner,q,'authenticated',false),'22023');
    assert.equal(scalar(`SELECT count(*) FROM survey_private.annotation_generation_snapshots WHERE document_id='${d}'`),'0');
    assert.equal(run(snap(d,g,0)).stored,true);
  });
  await check('bounded pages freeze frontier and include one whole oversized update',()=>{
    const d=doc(105),g=gen(d,1005);for(let n=1;n<=3;n++)run(append(d,g,n));
    const p=run(page(d,g,0,null,2));assert.equal(p.has_more,true);assert.equal(p.through_seq,'3');
    run(append(d,g,4));const p2=run(page(d,g,2,p.through_seq,2));assert.equal(p2.has_more,false);assert.deepEqual(p2.rows.map(r=>r.seq),['3']);
    const d2=doc(106),g2=gen(d2,1006);
    asRole(owner,`SELECT (public.append_annotation_update_v2('${d2}','${g2}','big',1,decode(repeat('ab',16777217),'hex'))->>'seq')`);
    run(append(d2,g2,1));
    assert.equal(asRole(owner,`SELECT length(r->'rows'->0->>'data') FROM (${page(d2,g2)} AS r) q`).stdout,String(2+16777217*2));
    assert.equal(asRole(owner,`SELECT jsonb_array_length(r->'rows')||':'||(r->>'has_more') FROM (${page(d2,g2)} AS r) q`).stdout,'1:true');
    assert.equal(run(page(d2,g2,1)).rows.length,1);
  });
  await check('large bigint frontiers remain exact across generations and receipts',()=>{
    const d=doc(107);
    // Seed a historical accepted legacy snapshot directly with existing guards
    // disabled only for this oversized numeric fixture setup.
    sql(`ALTER TABLE annotation_snapshots DISABLE TRIGGER USER;INSERT INTO annotation_snapshots(document_id,at_seq,snapshot,encoding_version,writer_epoch)
      VALUES('${d}',9007199254740993,decode('01','hex'),1,0);ALTER TABLE annotation_snapshots ENABLE TRIGGER USER`);
    const g=gen(d,1007,'9007199254740993'),r=run(append(d,g,'9007199254740993'));assert.equal(r.seq,'9007199254740994');assert.equal(r.client_seq,'9007199254740993');
    assert.equal(run(read(d,g)).wal_head,'9007199254740994');
  });
  await check('raw legacy mutations including service writes cannot change adopted state',()=>{
    const d=doc(108);const sid=id(5008),tid=id(6008);sql(`INSERT INTO templates(id,user_id) VALUES('${tid}','${owner}');INSERT INTO survey_sessions(id,template_id,user_id,document_id) VALUES('${sid}','${tid}','${owner}','${d}');
      INSERT INTO survey_items(session_id,annotation_id,module_id,category_id) VALUES('${sid}','a','m','c')`);
    run(append(d,null));gen(d,1008,1);
    for(const statement of [`DELETE FROM annotation_updates WHERE document_id='${d}'`,`UPDATE documents SET annotations='{"lost":true}' WHERE id='${d}'`,
      `UPDATE survey_sessions SET document_id=NULL WHERE id='${sid}'`,`DELETE FROM survey_sessions WHERE id='${sid}'`,
      `UPDATE survey_items SET name='bad' WHERE session_id='${sid}'`,`DELETE FROM survey_items WHERE session_id='${sid}'`,
      `INSERT INTO doc_yjs_state(document_id,state,state_vector) VALUES('${d}',decode('01','hex'),decode('01','hex'))`]) {
      errorState(asRole(owner,statement,'postgres',false),'SG001');
    }
    sql(`UPDATE documents SET name='still editable' WHERE id='${d}'`);
    errorState(sql(`DELETE FROM survey_private.annotation_generation_heads WHERE document_id='${d}'`,false),'42501');
    errorState(sql('TRUNCATE survey_private.annotation_generation_updates',false),'42501');
  });
  await check('document cascade removes private history and detaches survey with exact semantics',()=>{
    const d=doc(109),sid=id(5009),tid=id(6009);sql(`INSERT INTO templates(id,user_id) VALUES('${tid}','${owner}');INSERT INTO survey_sessions(id,template_id,user_id,document_id) VALUES('${sid}','${tid}','${owner}','${d}')`);
    const g=gen(d,1009);run(append(d,g));run(snap(d,g));sql(`DELETE FROM documents WHERE id='${d}'`);
    assert.equal(scalar(`SELECT document_id IS NULL FROM survey_sessions WHERE id='${sid}'`),'t');
    assert.equal(scalar(`SELECT count(*) FROM survey_private.annotation_generations WHERE document_id='${d}'`),'0');
  });
  await check('actual template cascade can remove frozen attached survey children',()=>{
    const d=doc(110),sid=id(5010),tid=id(6010);sql(`INSERT INTO templates(id,user_id) VALUES('${tid}','${owner}');INSERT INTO survey_sessions(id,template_id,user_id,document_id) VALUES('${sid}','${tid}','${owner}','${d}');
      INSERT INTO survey_items(session_id,annotation_id,module_id,category_id) VALUES('${sid}','a','m','c')`);gen(d,1010);sql(`DELETE FROM templates WHERE id='${tid}'`);
    assert.equal(scalar(`SELECT count(*) FROM survey_sessions WHERE id='${sid}'`),'0');
  });
  await check('accepted write fences role revoke and distinct documents progress',async()=>{
    const d=doc(111),g=gen(d,1011),d2=doc(112),g2=gen(d2,1012);
    const w=session('generation_writer',{role:'authenticated',actorId:editor});w.send(`${append(d,g)};SELECT 'ready';`);await w.wait('ready');
    errorState(sql(`UPDATE project_collaborators SET role='viewer' WHERE project_id='${project}' AND user_id='${editor}'`,false),'55P03');
    assert.equal(run(append(d2,g2)).seq,'1');assert.equal((await w.finish()).status,0);
    sql(`INSERT INTO document_collaborators VALUES('${d}','${editor}','viewer','active')`);errorState(asRole(editor,append(d,g,2),'authenticated',false),'42501');
  });
  await check('generation switch and legacy write serialize without partial acceptance',async()=>{
    const d=doc(113);const w=session('legacy_writer',{role:'authenticated',actorId:owner});w.send(`${append(d,null)};SELECT 'ready';`);await w.wait('ready');
    sql(`INSERT INTO survey_private.annotation_generations VALUES('${d}','${id(1013)}',1,decode('01','hex'),1,now())`);
    errorState(sql(`INSERT INTO survey_private.annotation_generation_heads VALUES('${d}','${id(1013)}',1)`,false),'40001');
    assert.equal((await w.finish()).status,0);sql(`INSERT INTO survey_private.annotation_generation_heads VALUES('${d}','${id(1013)}',1)`);
    errorState(asRole(owner,append(d,null,2),'authenticated',false),'SG001');
  });
  await check('stale repeatable-read cannot report a current receipt or accept writes',async()=>{
    const d=doc(114),g=gen(d,1014);run(append(d,g));const w=session('stale_generation',{role:'authenticated',actorId:owner,isolation:'REPEATABLE READ'});
    w.send(`${append(d,g)};`);errorState(await w.finish(),'25001');
  });
  await check('shared readers coexist while same-document writer retries',async()=>{
    const d=doc(115),g=gen(d,1015);const r=session('generation_reader',{role:'authenticated',actorId:viewer});
    r.send(`${read(d,g)};SELECT 'ready';`);await r.wait('ready');
    assert.equal(run(read(d,g),editor).wal_head,'0');errorState(asRole(owner,append(d,g),'authenticated',false),'40001');
    assert.equal((await r.finish()).status,0);assert.equal(run(append(d,g)).seq,'1');
  });
  await check('metadata-only wake hints track head/checkpoint and roll back atomically',async()=>{
    const d=doc(116),g=gen(d,1016);const signal=()=>JSON.parse(asRole(viewer,`SELECT row_to_json(s) FROM annotation_generation_signals s WHERE document_id='${d}'`).stdout);
    assert.deepEqual(Object.keys(signal()).sort(),['document_id','generation_id','last_seq','snapshot_writer_epoch','wake_revision']);assert.equal(signal().wake_revision,1);
    assert.equal(signal().snapshot_writer_epoch,0);
    run(append(d,g));assert.equal(signal().wake_revision,2);assert.equal(signal().last_seq,1);assert.equal(signal().snapshot_writer_epoch,0);
    run(snap(d,g));assert.equal(signal().wake_revision,3);assert.equal(signal().snapshot_writer_epoch,1);
    run(snap(d,g));assert.equal(signal().wake_revision,3);assert.equal(signal().snapshot_writer_epoch,1);
    const w=session('hint_rollback',{role:'authenticated',actorId:owner});w.send(`${append(d,g,2)};SELECT 'ready';`);await w.wait('ready');
    assert.equal((await w.finish(false)).status,0);assert.equal(signal().wake_revision,3);assert.equal(signal().snapshot_writer_epoch,1);
    const checkpoint=session('checkpoint_hint_rollback',{role:'authenticated',actorId:owner});
    checkpoint.send(`${snap(d,g,1,2,1,'checkpoint',1,'04')};SELECT 'ready';`);await checkpoint.wait('ready');
    assert.equal((await checkpoint.finish(false)).status,0);assert.equal(signal().snapshot_writer_epoch,1);assert.equal(signal().wake_revision,3);
    run(append(d,g,2));assert.equal(signal().snapshot_writer_epoch,1);assert.equal(signal().wake_revision,4);
    gen(d,2016,2);assert.equal(signal().generation_id,id(2016));assert.equal(signal().wake_revision,5);assert.equal(signal().snapshot_writer_epoch,0);
    assert.equal(run(snap(d,id(2016),2,7,2)).stored,true);assert.equal(signal().snapshot_writer_epoch,7);
    applyMigration(migrationPath(target));assert.equal(signal().snapshot_writer_epoch,7);assert.equal(signal().wake_revision,6);
    assert.equal(asRole(other,`SELECT * FROM annotation_generation_signals WHERE document_id='${d}'`).stdout,'');
    for(const role of ['anon','authenticated','service_role']) errorState(asRole(owner,`UPDATE annotation_generation_signals SET wake_revision=99 WHERE document_id='${d}'`,role,false),'42501');
    assert.equal(scalar(`SELECT count(*) FROM pg_publication_tables WHERE pubname='supabase_realtime' AND tablename='annotation_generation_signals'`),'1');
    sql(`DELETE FROM documents WHERE id='${d}'`);assert.equal(scalar(`SELECT count(*) FROM annotation_generation_signals WHERE document_id='${d}'`),'0');
  });
  await check('frozen legacy raw inserts and checkpoint writes fail for privileged callers too',()=>{
    const d=doc(117),g=gen(d,1017);
    for(const statement of [`INSERT INTO annotation_updates(document_id,client_id,client_seq,data) VALUES('${d}','raw',1,decode('01','hex'))`,
      `INSERT INTO annotation_snapshots(document_id,at_seq,snapshot,encoding_version,writer_epoch) VALUES('${d}',0,decode('01','hex'),1,1)`,
      `INSERT INTO document_annotations(document_id,user_id,annotation_id,page_number,bounds) VALUES('${d}','${owner}','raw',1,'{}')`]) {
      errorState(asRole(owner,statement,'postgres',false),'SG001');
    }
    errorState(sql(`UPDATE survey_private.annotation_generations SET baseline_snapshot=decode('ff','hex') WHERE document_id='${d}'`,false),'42501');
    run(append(d,g));errorState(sql(`UPDATE survey_private.annotation_generation_updates SET data=decode('ff','hex') WHERE document_id='${d}'`,false),'42501');
    errorState(sql(`DELETE FROM survey_private.annotation_generation_updates WHERE document_id='${d}'`,false),'42501');
  });
  await check('closed-over author deletion preserves surviving document and cleans real FK children',()=>{
    const author=id(7000),d=doc(118),tid=id(6018),sid=id(5018);sql(`INSERT INTO auth.users VALUES('${author}');
      INSERT INTO templates(id,user_id) VALUES('${tid}','${owner}');INSERT INTO survey_sessions(id,template_id,user_id,document_id) VALUES('${sid}','${tid}','${author}','${d}');
      INSERT INTO survey_items(session_id,annotation_id,module_id,category_id) VALUES('${sid}','a','m','c');
      INSERT INTO document_annotations(document_id,user_id,annotation_id,page_number,bounds) VALUES('${d}','${author}','a',1,'{}')`);
    const g=gen(d,1018);run(append(d,g));sql(`DELETE FROM auth.users WHERE id='${author}'`);
    assert.equal(scalar(`SELECT count(*) FROM documents WHERE id='${d}'`),'1');assert.equal(scalar(`SELECT count(*) FROM survey_sessions WHERE id='${sid}'`),'0');
  });
  console.log(`Annotation generation transport PostgreSQL checks passed: ${checks}`);
},{name:'annotation-generation'});
console.log('Disposable local PostgreSQL stopped; exact temporary cluster removed');
