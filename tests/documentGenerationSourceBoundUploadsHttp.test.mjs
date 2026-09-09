import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const script=new URL('../scripts/test-document-generation-source-bound-uploads-http.mjs',import.meta.url);
test('source-bound upload HTTP harness uses actual cached Deno entry point and localhost only',()=>{
  const source=readFileSync(script,'utf8');
  for(const text of ['document-generation-upload/index.ts','document-generation-upload/deno.json',
    '--node-modules-dir=none','--cached-only','--no-lock','SURVEY_GENERATION_SOURCE_BOUND_UPLOADS_HTTP_INTEGRATION',
    'SURVEY_GENERATION_SOURCE_CAPTURE','SURVEY_GENERATION_STORAGE_CONTRACT',"fake.listen(0,'127.0.0.1'",'All local Deno children exited'])assert.ok(source.includes(text),text);
  assert.doesNotMatch(source,/dotenv|readFile.*\.env|npm install|--allow-scripts|\.\.\.process\.env/);
});
test('actual source-bound upload endpoint preserves exact source receipts across SDK requests',{
  skip:process.env.SURVEY_GENERATION_SOURCE_BOUND_UPLOADS_HTTP_INTEGRATION!=='1'&&'set SURVEY_GENERATION_SOURCE_BOUND_UPLOADS_HTTP_INTEGRATION=1 for local Deno/SDK proof',
},()=>{
  const result=spawnSync(process.execPath,[fileURLToPath(script)],{encoding:'utf8',timeout:90000});
  assert.equal(result.status,0,`${result.stdout}\n${result.stderr}\n${result.error?.message||''}`);
  assert.match(result.stdout,/local HTTP checks passed: 56/);
  assert.match(result.stdout,/All local Deno children exited and fake HTTP server closed/);
});
