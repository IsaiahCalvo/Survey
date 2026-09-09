import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const source=readFileSync(new URL('../supabase/migrations/20260909093000_document_generation_source_bytes.sql',import.meta.url),'utf8');
test('source byte proofs are service-only complete-manifest attestations without publication',()=>{
 assert.match(source,/Source manifest differs/);assert.match(source,/Source object metadata changed/);
 assert.match(source,/assert_document_generation_upload_authority/);assert.match(source,/annotation_generation_scope/);
 assert.doesNotMatch(source,/UPDATE public.documents|INSERT INTO survey_private.annotation_generation_heads|TO authenticated;/);
 assert.match(source,/OWNER TO postgres/);assert.match(source,/FROM PUBLIC,anon,authenticated,service_role/);
});
test('proof leases have durable ABA protection and parent terminal disposal',()=>{
 assert.match(source,/interval '2 minutes'/);assert.match(source,/>=128/);
 assert.match(source,/generation_source_bytes_terminal AFTER UPDATE OF state/);assert.match(source,/Source verification claim already retired/);
});
test('actual isolated PostgreSQL source byte receipts preserve scope and race fences',{
 skip:process.env.SURVEY_POSTGRES_INTEGRATION!=='1'&&'set SURVEY_POSTGRES_INTEGRATION=1 for local PostgreSQL',
},()=>{
 const script=fileURLToPath(new URL('../scripts/test-document-generation-source-bytes-postgres.mjs',import.meta.url));
 const r=spawnSync(process.execPath,[script],{encoding:'utf8',timeout:180000,maxBuffer:4*1024*1024});
 assert.equal(r.status,0,`${r.stdout}\n${r.stderr}\n${r.error?.message||''}`);
 assert.match(r.stdout,/Document generation source byte PostgreSQL checks passed:/);
 assert.match(r.stdout,/Disposable local PostgreSQL stopped; exact temporary cluster removed/);
});
