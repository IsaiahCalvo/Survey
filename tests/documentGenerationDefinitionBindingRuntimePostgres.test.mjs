// Disposable local PostgreSQL only. This derives its database setup from the
// full checked-publication fixture, then calls the real V5 -> V4 -> V3 stack.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = fileURLToPath(new URL('../', import.meta.url));
const fixturePath = fileURLToPath(new URL(
  '../scripts/test-checked-legacy-sidecar-retirement-postgres.mjs', import.meta.url));
const runtimePath = `${repoRoot}scripts/.document-generation-definition-v5-${process.pid}.mjs`;

const run = (command, args) => new Promise(resolve => {
  const child = spawn(command, args, { cwd: repoRoot, env: process.env });
  let stdout = '', stderr = '';
  child.stdout.on('data', chunk => { stdout += chunk; });
  child.stderr.on('data', chunk => { stderr += chunk; });
  child.on('close', status => resolve({ status, stdout, stderr }));
});

test('real generation publication stays bound to its accepted definition revision',
  { timeout: 240_000 }, async () => {
    let source = readFileSync(fixturePath, 'utf8');
    const migrationNeedle = " applyMigration(migrationPath('20260915100000_checked_legacy_sidecar_retirement.sql'));";
    assert.ok(source.includes(migrationNeedle));
    source = source.replace(migrationNeedle, `${migrationNeedle}
 sql(\`ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS template_id uuid,
   ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false,
   ADD COLUMN IF NOT EXISTS user_archived_at timestamptz,
   ADD COLUMN IF NOT EXISTS locked_at timestamptz;
  ALTER TABLE public.templates ADD COLUMN IF NOT EXISTS config jsonb NOT NULL DEFAULT '{}'::jsonb,
   ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
   ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false,
   ADD COLUMN IF NOT EXISTS user_archived_at timestamptz\`);
 applyMigration(migrationPath('20260909106000_document_survey_definition.sql'));
 applyMigration(migrationPath('20260915102000_document_definition_revisions.sql'));
 applyMigration(migrationPath('20260915103000_document_generation_definition_binding.sql'));`);
    source = source.replace('sourceModel=x.generation?target:1;',
      'sourceModel=x.sourceModel??(x.generation?target:1);');
    assert.ok(source.includes('sourceModel=x.sourceModel??(x.generation?target:1);'));

    const insertionNeedle = '  const base=seed();';
    assert.ok(source.includes(insertionNeedle));
    source = source.replace(insertionNeedle, `
  const definitionConfig=(label)=>({
   modules:[{id:'module-runtime',name:label,categories:[{id:'category-runtime',name:'Checks',checklist:[{id:'check-runtime',text:label}]}]}],
   entities:[{id:'entity-runtime',name:label,color:'#112233',opacity:0.35,borderColor:null,borderOpacity:null,matchFill:false}],
  });
  const definitionHead=d=>JSON.parse(asRole(owner,
   \`SELECT public.read_document_definition_revision('\${d}',NULL)\`).stdout);
  const adoptDefinition=(d,label)=>{
   const t=fresh();
   sql(\`INSERT INTO templates(id,user_id,config,updated_at) VALUES('\${t}','\${owner}',\${quote(JSON.stringify(definitionConfig(label)))}::jsonb,clock_timestamp())\`);
   const survey=run(owner,\`SELECT public.preview_document_survey_definition_adoption('\${d}','\${t}')\`);
   const entity=run(owner,\`SELECT public.preview_document_entity_catalog_adoption('\${d}','\${t}')\`);
   run(owner,\`SELECT public.adopt_document_survey_definition('\${d}','\${t}',\${quote(survey.source.templateUpdatedAt)}::timestamptz,\${quote(survey.source.structureSha256)},'\${fresh()}',repeat('a',64))\`);
   run(owner,\`SELECT public.adopt_document_entity_catalog('\${d}','\${t}',\${quote(entity.source.templateUpdatedAt)}::timestamptz,\${quote(entity.source.entitiesSha256)},'\${fresh()}',repeat('b',64))\`);
   return definitionHead(d);
  };
  const upgradeDefinition=(d,label)=>{
   const t=fresh();
   sql(\`INSERT INTO templates(id,user_id,config,updated_at) VALUES('\${t}','\${owner}',\${quote(JSON.stringify(definitionConfig(label)))}::jsonb,clock_timestamp()+interval '1 second')\`);
   const op=fresh(),review=run(owner,\`SELECT public.preview_document_definition_revision_upgrade('\${d}','\${t}','\${t}','[]'::jsonb,'\${op}')\`);
   return run(owner,\`SELECT public.apply_reviewed_document_definition_revision('\${d}',\${review.current.definitionRevision},\${quote(review.current.definitionDigest)},'\${review.surveyDefinition.source.templateId}',\${quote(review.surveyDefinition.source.templateUpdatedAt)}::timestamptz,\${quote(review.surveyDefinition.source.structureSha256)},'\${review.entityCatalog.source.templateId}',\${quote(review.entityCatalog.source.templateUpdatedAt)}::timestamptz,\${quote(review.entityCatalog.source.entitiesSha256)},'[]'::jsonb,'\${op}',\${quote(review.review.requestSha256)})\`);
  };
  const v5BaseArgs=x=>\`'\${x.actor}','\${x.sourceId}','\${x.candidate.operation_id}',ARRAY[\${archiveIds(x).map(quote).join(',')}]::uuid[],\${quote(x.plan.source.generationId)},\${quote(x.plan.source.walHead)}::bigint,\${quote(JSON.stringify(x.plan.operation))}::jsonb\`;
  const v5Tuple=h=>\`\${h.definitionRevision}::bigint,\${quote(h.definitionDigest)}\`;
  const readV5=(x,h,required=true)=>sql(\`SET request.jwt.claim.sub=\${quote(x.actor)};SELECT survey_private.read_document_generation_replacement_v5('\${x.actor}','\${x.d}','\${x.sourceId}','\${x.candidate.operation_id}',ARRAY[\${archiveIds(x).map(quote).join(',')}]::uuid[],\${quote(x.plan.source.generationId)},\${quote(x.plan.source.walHead)}::bigint,\${quote(JSON.stringify(x.plan.operation))}::jsonb,\${v5Tuple(h)})\`,required);
  const prepareV5=(x,h,required=true)=>sql(\`SET request.jwt.claim.sub=\${quote(x.actor)};SELECT survey_private.prepare_document_generation_replacement_v5(\${v5BaseArgs(x)},\${quote(JSON.stringify(x.plan))}::jsonb,\${v5Tuple(h)})\`,required);
  const publishV5Sql=(x,h)=>\`SET request.jwt.claim.sub=\${quote(x.actor)};SELECT survey_private.publish_document_generation_v5('\${x.actor}','\${x.sourceId}','\${x.candidate.operation_id}',ARRAY[\${archiveIds(x).map(quote).join(',')}]::uuid[],\${quote(JSON.stringify(x.plan))}::jsonb,\${h.definitionRevision}::bigint,\${quote(h.definitionDigest)})\`;
  const publishV5=(x,h,required=true)=>sql(publishV5Sql(x,h),required);
  const noPublication=x=>{
   assert.equal(scalar(\`SELECT count(*) FROM survey_private.document_generation_publications WHERE operation_id='\${x.candidate.operation_id}'\`),'0');
   assert.equal(scalar(\`SELECT count(*) FROM survey_private.annotation_generations WHERE document_id='\${x.d}' AND generation_id='\${x.candidate.generation_id}'\`),'0');
  };
  const makeModel1Base=async()=>{
   const initial=await stage(seed(),{actor:owner,target:1});
   const initialPrepare=\`SELECT survey_private.prepare_document_generation_replacement('\${initial.actor}','\${initial.sourceId}','\${initial.candidate.operation_id}',ARRAY[\${archiveIds(initial).map(quote).join(',')}]::uuid[],\${quote(initial.plan.source.generationId)},\${quote(initial.plan.source.walHead)}::bigint,\${quote(JSON.stringify(initial.plan.operation))}::jsonb,\${quote(JSON.stringify(initial.plan))}::jsonb)\`;
   assert.equal(JSON.parse(scalar(initialPrepare)).state,'prepared');
   const receipt=JSON.parse(scalar(publishSql(initial)));assert.equal(receipt.generation_id,initial.candidate.generation_id);
   return {...initial,pdf:initial.nextPdf,generation:initial.candidate.generation_id,sourceModel:1};
  };

  await check('v5 cold read returns missing before source capture or upload work',()=>{
   const base=seed(),generation=gen(base.d,serial++,1),head=adoptDefinition(base.d,'cold head');
   const cold={...base,actor:owner,sourceId:fresh(),candidate:{operation_id:fresh()},offeredArchiveIds:[fresh()],
    plan:{source:{generationId:generation,walHead:'0'},operation:{type:'move',from:2,to:1}}};
   const receipt=JSON.parse(readV5(cold,head).stdout);
   assert.equal(receipt.state,'missing');assert.equal(receipt.version,5);
  });

  await check('v5 rejects a source whose document has no accepted definition head without an orphan',async()=>{
   const base=await makeModel1Base();
   const x=await stage(base,{actor:owner,target:2,retirement:true});
   errorState(prepareV5(x,{definitionRevision:1,definitionDigest:'0'.repeat(64)},false),'40001');
   assert.equal(scalar(\`SELECT count(*) FROM survey_private.document_generation_replacement_definition_bindings WHERE candidate_operation_id='\${x.candidate.operation_id}'\`),'0');
   assert.equal(scalar(\`SELECT count(*) FROM survey_private.document_generation_replacement_requests WHERE candidate_operation_id='\${x.candidate.operation_id}'\`),'0');
   noPublication(x);
  });

  const firstBase=await makeModel1Base();
  const firstHead=adoptDefinition(firstBase.d,'accepted one');
  const first=await stage(firstBase,{actor:owner,target:2,retirement:true});
  await check('v5 reads, prepares and publishes through real v4 and v3 from source model 1',()=>{
   const preparedV5=JSON.parse(prepareV5(first,firstHead).stdout);assert.equal(preparedV5.state,'prepared');assert.equal(preparedV5.version,5);
   const reread=JSON.parse(readV5(first,firstHead).stdout);assert.equal(reread.state,'prepared');assert.equal(reread.version,5);
   const publishedV5=JSON.parse(publishV5(first,firstHead).stdout);assert.equal(publishedV5.operation_id,first.candidate.operation_id);assert.equal(publishedV5.version,5);
   assert.equal(publishedV5.content_model_version,2);assert.equal(publishedV5.definition_revision,String(firstHead.definitionRevision));
  });
  const firstReceipt=JSON.parse(publishV5(first,firstHead).stdout);
  const advancedHead=upgradeDefinition(first.d,'accepted two');
  await check('an exact successful publish replays its old tuple after the head advances but tuple drift rejects',()=>{
   assert.deepEqual(JSON.parse(publishV5(first,firstHead).stdout),firstReceipt);
   errorState(publishV5(first,advancedHead,false),'23505');
  });

  const secondBase={...first,pdf:first.nextPdf,generation:first.candidate.generation_id,sourceModel:2};
  const second=await stage(secondBase,{actor:owner,target:2,retirement:true});
  await check('v5 publishes a real source-model-2 successor',()=>{
   assert.equal(second.envelope.content_model_version,2);
   assert.equal(JSON.parse(prepareV5(second,advancedHead).stdout).state,'prepared');
   const receipt=JSON.parse(publishV5(second,advancedHead).stdout);
   assert.equal(receipt.operation_id,second.candidate.operation_id);assert.equal(receipt.content_model_version,2);
  });

  await check('a head change after prepare blocks publication and leaves the generation unchanged',async()=>{
   const base=await makeModel1Base();
   const head=adoptDefinition(base.d,'before prepare'),x=await stage(base,{actor:owner,target:2,retirement:true});
   assert.equal(JSON.parse(prepareV5(x,head).stdout).state,'prepared');
   upgradeDefinition(base.d,'after prepare');
   const priorGeneration=scalar(\`SELECT generation_id FROM survey_private.annotation_generation_heads WHERE document_id='\${base.d}'\`);
   errorState(publishV5(x,head,false),'40001');
   assert.equal(scalar(\`SELECT generation_id FROM survey_private.annotation_generation_heads WHERE document_id='\${base.d}'\`),priorGeneration);
   noPublication(x);
  });

  await check('a failed real prepare rolls back both the request and definition binding',async()=>{
   const base=await makeModel1Base();
   const head=adoptDefinition(base.d,'rollback'),x=await stage(base,{actor:owner,target:2,retirement:true});
   const bad={...x,plan:{...x.plan,documentId:fresh()}};
   assert.notEqual(prepareV5(bad,head,false).status,0);
   assert.equal(scalar(\`SELECT count(*) FROM survey_private.document_generation_replacement_definition_bindings WHERE candidate_operation_id='\${x.candidate.operation_id}'\`),'0');
   assert.equal(scalar(\`SELECT count(*) FROM survey_private.document_generation_replacement_requests WHERE candidate_operation_id='\${x.candidate.operation_id}'\`),'0');
   noPublication(x);
  });

  await check('definition apply and publication in separate sessions finish without deadlock',async()=>{
   const base=await makeModel1Base();
   const head=adoptDefinition(base.d,'race one'),x=await stage(base,{actor:owner,target:2,retirement:true});
   assert.equal(JSON.parse(prepareV5(x,head).stdout).state,'prepared');
   const t=fresh();sql(\`INSERT INTO templates(id,user_id,config,updated_at) VALUES('\${t}','\${owner}',\${quote(JSON.stringify(definitionConfig('race two')))}::jsonb,clock_timestamp()+interval '2 second')\`);
   const op=fresh(),review=run(owner,\`SELECT public.preview_document_definition_revision_upgrade('\${base.d}','\${t}','\${t}','[]'::jsonb,'\${op}')\`);
   const applyStatement=\`SET request.jwt.claim.sub='\${owner}';SELECT public.apply_reviewed_document_definition_revision('\${base.d}',\${review.current.definitionRevision},\${quote(review.current.definitionDigest)},'\${review.surveyDefinition.source.templateId}',\${quote(review.surveyDefinition.source.templateUpdatedAt)}::timestamptz,\${quote(review.surveyDefinition.source.structureSha256)},'\${review.entityCatalog.source.templateId}',\${quote(review.entityCatalog.source.templateUpdatedAt)}::timestamptz,\${quote(review.entityCatalog.source.entitiesSha256)},'[]'::jsonb,'\${op}',\${quote(review.review.requestSha256)});SELECT 'RACE_APPLY_DONE';\`;
   const publishing=session('definition-bound-publish',{role:'postgres'}),
    applying=session('definition-apply-race',{role:'postgres'});
   publishing.send(publishV5Sql(x,head)+\`;SELECT 'RACE_PUBLISH_DONE';\`);
   await publishing.wait('RACE_PUBLISH_DONE');
   applying.send(applyStatement);
   await blocked('definition-apply-race');
   const publishResult=await publishing.finish();
   await applying.wait('RACE_APPLY_DONE');
   const applyResult=await applying.finish();
   assert.equal(/40P01|deadlock detected/.test(publishResult.stderr+applyResult.stderr),false);
   assert.ok(publishResult.status===0&&applyResult.status===0,
    \`publish status \${publishResult.status}: \${publishResult.stderr}; apply status \${applyResult.status}: \${applyResult.stderr}\`);
   assert.equal(scalar(\`SELECT count(*) FROM survey_private.document_generation_publications p
    JOIN survey_private.document_generation_publication_definition_bindings b
      ON b.operation_id=p.operation_id AND b.document_id=p.document_id AND b.generation_id=p.generation_id
    WHERE p.operation_id='\${x.candidate.operation_id}' AND p.document_id='\${base.d}'
      AND p.generation_id='\${x.candidate.generation_id}' AND b.definition_revision=\${head.definitionRevision}
      AND b.definition_digest=\${quote(head.definitionDigest)}\`),'1');
   assert.equal(scalar(\`SELECT generation_id FROM survey_private.annotation_generation_heads WHERE document_id='\${base.d}'\`),x.candidate.generation_id);
   const finalHead=definitionHead(base.d);
   assert.equal(finalHead.definitionRevision,head.definitionRevision+1);
   assert.notEqual(finalHead.definitionDigest,head.definitionDigest);
  });

  return;
${insertionNeedle}`);

    writeFileSync(runtimePath, source);
    try {
      const result = await run(process.execPath, [runtimePath]);
      assert.equal(result.status, 0, `runtime fixture failed\nSTDOUT:\n${result.stdout}\nSTDERR:\n${result.stderr}`);
      assert.match(result.stdout, /PASS v5 reads, prepares and publishes through real v4 and v3 from source model 1/);
      assert.match(result.stdout, /PASS v5 publishes a real source-model-2 successor/);
      assert.match(result.stdout, /PASS definition apply and publication in separate sessions finish without deadlock/);
    } finally {
      try { unlinkSync(runtimePath); } catch {}
    }
  });
