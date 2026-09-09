import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const source=readFileSync(new URL('../supabase/migrations/20260909094000_document_generation_source_bound_uploads.sql',import.meta.url),'utf8');
test('bound staging uses the original fully verified source without a fresh capture or publication',()=>{
 assert.match(source,/assert_document_generation_source_bytes\(actor,p_source_id\)/);
 assert.match(source,/Prior PDF differs from the verified source/);
 assert.match(source,/source_sql_sha256',u.source_sql_sha256/);
 assert.doesNotMatch(source,/capture_document_publication_sources\(|UPDATE public.documents|INSERT INTO survey_private.annotation_generation_heads/);
 assert.match(source,/least\(source_expiry,clock_timestamp\(\)\+interval '2 hours'\)/);
});
test('terminal recovery preserves immutable identity but no stale proof or private capability',()=>{
 assert.match(source,/'state','source-unavailable'/);assert.match(source,/'upload_state',u.state/);
 assert.match(source,/'object',NULL,'verified_at',NULL,'rejection',NULL/);
 assert.match(source,/Source-bound upload identity is immutable/);
 assert.match(source,/Use the source-bound upload route/);
 assert.match(source,/RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER/);
});
test('actual PostgreSQL source-bound staging keeps legacy behavior and fails closed across races',{
 skip:process.env.SURVEY_POSTGRES_INTEGRATION!=='1'&&'set SURVEY_POSTGRES_INTEGRATION=1 for local PostgreSQL',
},()=>{
 const script=fileURLToPath(new URL('../scripts/test-document-generation-source-bound-uploads-postgres.mjs',import.meta.url));
 const r=spawnSync(process.execPath,[script],{encoding:'utf8',timeout:180000,maxBuffer:4*1024*1024});
 assert.equal(r.status,0,`${r.stdout}\n${r.stderr}\n${r.error?.message||''}`);
 assert.match(r.stdout,/Document generation source-bound PostgreSQL checks passed:/);
 assert.match(r.stdout,/Disposable local PostgreSQL stopped; exact temporary cluster removed/);
});
