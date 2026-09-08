import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const migration=new URL('../supabase/migrations/20260909070000_document_generation_storage_references.sql',import.meta.url);
const script=fileURLToPath(new URL('../scripts/test-document-generation-storage-references-postgres.mjs',import.meta.url));
const source=readFileSync(migration,'utf8');
const sql=source.replace(/--[^\n]*/g,'');
const functionSource=(text,name)=>{
  const start=text.indexOf(`CREATE OR REPLACE FUNCTION ${name}(`),end=text.indexOf('$$;',start);
  assert.ok(start>=0&&end>start,name);return text.slice(start,end+3);
};

test('generation references are private, generated-hash immutable rows with parent cascade and no activation API',()=>{
  assert.match(sql,/^\s*BEGIN;/);assert.match(sql,/COMMIT;\s*$/);
  assert.match(sql,/document_id uuid NOT NULL REFERENCES public\.documents\(id\) ON DELETE CASCADE/);
  assert.match(sql,/path_hash bytea GENERATED ALWAYS AS \(survey_private\.document_storage_path_hash\(path\)\) STORED/);
  assert.match(sql,/PRIMARY KEY\(document_id,generation_id,path_hash\)/);
  assert.match(sql,/REVOKE ALL ON survey_private\.document_generation_storage_references FROM PUBLIC,anon,authenticated,service_role/);
  assert.match(sql,/FOR SHARE NOWAIT/);assert.match(sql,/assert_account_open\(permanent_owner\)/);
  assert.match(sql,/TG_OP='UPDATE'[\s\S]*?immutable; release by deletion/);
  assert.match(sql,/queue_document_storage_cleanup\(OLD\.path\)/);
  assert.doesNotMatch(sql,/GRANT|REFERENCES storage\.objects|UPDATE public\.documents|CREATE OR REPLACE FUNCTION public\.(reserve|release|activate)/);
});

test('all prior cleanup functions differ only in their complete-reference predicates',()=>{
  const retirement=readFileSync(new URL('../supabase/migrations/20260908220000_document_storage_retirement.sql',import.meta.url),'utf8');
  const scan=readFileSync(new URL('../supabase/migrations/20260909000000_account_storage_cleanup_scan.sql',import.meta.url),'utf8');
  for(const [old,names] of [[retirement,['survey_private.guard_document_storage_object','public.retire_document_storage_paths',
    'public.list_document_storage_cleanup','public.ack_document_storage_cleanup']],[scan,['public.claim_account_storage_cleanup']]]) {
    for(const name of names) {
      const expected=functionSource(old,name)
        .replaceAll('EXISTS(SELECT 1 FROM public.documents WHERE file_path=selected_path)','survey_private.document_storage_path_is_referenced(selected_path)')
        .replaceAll('EXISTS(SELECT 1 FROM public.documents d WHERE d.file_path=c.path)','survey_private.document_storage_path_is_referenced(c.path)')
        .replaceAll('EXISTS(SELECT 1 FROM public.documents d WHERE d.file_path=r.path COLLATE "default")','survey_private.document_storage_path_is_referenced(r.path COLLATE "default")');
      assert.equal(functionSource(source,name),expected,name);
    }
  }
  assert.match(sql,/r\.path_hash=survey_private\.document_storage_path_hash\(p_path\) AND r\.path=p_path/);
});

test('generation reference integration uses an isolated installed-Postgres helper and tracked guards',()=>{
  const text=readFileSync(script,'utf8');
  assert.match(text,/withDisposablePostgres/);assert.match(text,/assert\.equal\(process\.argv\.length,2/);
  for(const file of ['20260908161000_storage_quota_guard.sql','20260908220000_document_storage_retirement.sql',
    '20260908230000_account_storage_closing.sql','20260909000000_account_storage_cleanup_scan.sql']) assert.ok(text.includes(file));
  assert.doesNotMatch(text,/SUPABASE_SERVICE_ROLE_KEY|DATABASE_URL|npm install|brew install/);
});

test('actual PostgreSQL generation references protect all cleanup routes and serialize reserve/release races',{
  skip:process.env.SURVEY_POSTGRES_INTEGRATION!=='1'&&'set SURVEY_POSTGRES_INTEGRATION=1 for disposable local PostgreSQL verification',
},()=>{
  const result=spawnSync(process.execPath,[script],{encoding:'utf8',timeout:120000});
  assert.equal(result.status,0,`${result.stdout}\n${result.stderr}\n${result.error?.message||''}`);
  assert.match(result.stdout,/Document generation storage reference PostgreSQL checks passed:/);
  assert.match(result.stdout,/Disposable local PostgreSQL stopped; exact temporary cluster removed/);
});
