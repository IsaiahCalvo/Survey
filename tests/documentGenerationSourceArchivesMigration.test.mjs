import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const source=readFileSync(new URL('../supabase/migrations/20260909095000_document_generation_source_archives.sql',import.meta.url),'utf8');
test('archive staging derives a complete source member without caller hash path or size',()=>{
 assert.match(source,/p_source_id uuid,p_operation_id uuid,p_source_object_id uuid/);
 assert.match(source,/digest:=member->>'content_sha256';bytes:=\(member->>'byte_length'\)::bigint/);
 assert.match(source,/Archive source object identity is immutable/);
 assert.match(source,/'source_object',NULL/);assert.match(source,/\.bin'/);
 assert.doesNotMatch(source,/p_content_sha256|p_byte_length|UPDATE public.documents|INSERT INTO survey_private.annotation_generation_heads/);
});
test('source archive grants remain authenticated only and preserve pending lifecycle bounds',()=>{
 assert.match(source,/GRANT EXECUTE ON FUNCTION public.begin_document_generation_source_archive\(uuid,uuid,uuid\) TO authenticated/);
 assert.match(source,/FROM PUBLIC,anon,authenticated,service_role/);assert.match(source,/READ COMMITTED/);
 assert.match(source,/least\(source_expiry,clock_timestamp\(\)\+interval '2 hours'\)/);
});
test('actual PostgreSQL archives preserve source bytes identity legacy behavior and cleanup',{
 skip:process.env.SURVEY_POSTGRES_INTEGRATION!=='1'&&'set SURVEY_POSTGRES_INTEGRATION=1 for local PostgreSQL',
},()=>{
 const script=fileURLToPath(new URL('../scripts/test-document-generation-source-archives-postgres.mjs',import.meta.url));
 const r=spawnSync(process.execPath,[script],{encoding:'utf8',timeout:180000,maxBuffer:4*1024*1024});
 assert.equal(r.status,0,`${r.stdout}\n${r.stderr}\n${r.error?.message||''}`);
 assert.match(r.stdout,/Document generation source archive PostgreSQL checks passed:/);
 assert.match(r.stdout,/Disposable local PostgreSQL stopped; exact temporary cluster removed/);
});
