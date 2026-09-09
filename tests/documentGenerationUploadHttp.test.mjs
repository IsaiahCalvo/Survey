import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const script=new URL('../scripts/test-document-generation-upload-http.mjs',import.meta.url);
test('generation HTTP fixture pins actual entry point, cached SDK, local transport and explicit opt-in',()=>{
  const source=readFileSync(script,'utf8');
  for(const text of ['document-generation-upload/index.ts','document-generation-upload/deno.json',
    '--node-modules-dir=none','--cached-only','--no-lock','SURVEY_GENERATION_HTTP_INTEGRATION',
    "fake.listen(0,'127.0.0.1'",'All local Deno children exited']) assert.ok(source.includes(text),text);
  assert.doesNotMatch(source,/dotenv|readFile.*\.env|npm install|--allow-scripts|\.\.\.process\.env/);
});
test('actual Deno entry point and real SDK use only fake localhost auth, RPC and streamed Storage',{
  skip:process.env.SURVEY_GENERATION_HTTP_INTEGRATION!=='1' && 'set SURVEY_GENERATION_HTTP_INTEGRATION=1 for local Deno/SDK HTTP proof',
},()=>{
  const result=spawnSync(process.execPath,[fileURLToPath(script)],{encoding:'utf8',timeout:90000});
  assert.equal(result.status,0,`${result.stdout}\n${result.stderr}\n${result.error?.message||''}`);
  assert.match(result.stdout,/local HTTP checks passed: 14/);
  assert.match(result.stdout,/All local Deno children exited and fake HTTP server closed/);
});
