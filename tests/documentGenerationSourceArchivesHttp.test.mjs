import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const script=new URL('../scripts/test-document-generation-source-archives-http.mjs',import.meta.url);
test('archive HTTP fixture executes actual cached Deno and SDK on localhost only',()=>{
 const source=readFileSync(script,'utf8');
 for(const text of ['document-generation-upload/index.ts','document-generation-upload/deno.json','--cached-only','--no-lock',
  '--node-modules-dir=none','SURVEY_GENERATION_SOURCE_ARCHIVES_HTTP_INTEGRATION','SURVEY_GENERATION_SOURCE_ARCHIVES',
  'SURVEY_GENERATION_SOURCE_CAPTURE','SURVEY_GENERATION_STORAGE_CONTRACT',"fake.listen(0,'127.0.0.1'",'All local Deno children exited'])assert.ok(source.includes(text),text);
 assert.doesNotMatch(source,/dotenv|readFile.*\.env|npm install|--allow-scripts|\.\.\.process\.env/);
});
test('actual archive endpoint preserves exact PDF and sidecar identity through all SDK phases',{
 skip:process.env.SURVEY_GENERATION_SOURCE_ARCHIVES_HTTP_INTEGRATION!=='1'&&'set SURVEY_GENERATION_SOURCE_ARCHIVES_HTTP_INTEGRATION=1 for local Deno/SDK proof',
},()=>{
 const r=spawnSync(process.execPath,[fileURLToPath(script)],{encoding:'utf8',timeout:90000,maxBuffer:4*1024*1024});
 assert.equal(r.status,0,`${r.stdout}\n${r.stderr}\n${r.error?.message||''}`);
 assert.match(r.stdout,/Document generation source archives local HTTP checks passed: \d+/);
 assert.match(r.stdout,/All local Deno children exited and fake HTTP server closed/);
});
