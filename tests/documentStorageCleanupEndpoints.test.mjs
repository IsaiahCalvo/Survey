import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {homedir} from 'node:os';
const read=path=>readFileSync(new URL('../'+path,import.meta.url),'utf8');
test('scheduled and account cleanup use the shared checked protocol, never direct Storage removal',()=>{
 for(const path of ['supabase/functions/archive-purge-sweep/index.ts','supabase/functions/delete-account/index.ts']){
  const source=read(path);assert.match(source,/(?:document|account)StorageCleanup\.js/);assert.doesNotMatch(source,/\.remove\(/);assert.match(source,/'Access-Control-Allow-Origin': '\*'/);
 }
 const sweep=read('supabase/functions/archive-purge-sweep/index.ts');
 assert.match(sweep,/if \(!dryRun\) \{[\s\S]*drainDocumentStorageCleanup\(supabase, UNLINK_CHUNK\)/);
 assert.doesNotMatch(sweep,/\.in\('file_path', chunk\)/);
});
test('actual cleanup Edge handlers and pinned SDK pass offline endpoint checks',{
 skip:process.env.SURVEY_DENO_INTEGRATION!=='1',timeout:60000,
},()=>{
 const result=spawnSync('deno',['run','--allow-env','--no-config','--node-modules-dir=none','--no-lock','--cached-only','scripts/test-storage-cleanup-endpoints-deno.ts'],{
  cwd:resolve(import.meta.dirname,'..'),encoding:'utf8',timeout:45000,
  env:{PATH:process.env.PATH,DENO_DIR:process.env.DENO_DIR||(process.platform==='darwin'?resolve(homedir(),'Library/Caches/deno'):resolve(homedir(),'.cache/deno'))},
 });
 assert.equal(result.error,undefined);assert.equal(result.status,0,result.stderr+result.stdout);
 assert.match(result.stdout,/PASS 22 actual Storage cleanup Edge endpoint checks/);
 assert.match(result.stdout,/PASS 74 actual billing Edge endpoint checks; pinned SDK synthetic HTTP only/);
});
test('all billing endpoint SDKs bound each request to fifteen seconds and disable automatic retries',()=>{
 for(const name of ['create-checkout-session','create-portal-session','delete-account']){
  const source=read(`supabase/functions/${name}/index.ts`),constructors=[...source.matchAll(/new Stripe\([^,]+,\s*\{([\s\S]*?)\}\)/g)];
  assert.equal(constructors.length,1,name);assert.match(constructors[0][1],/timeout:\s*15000\b/,name);assert.match(constructors[0][1],/maxNetworkRetries:\s*0\b/,name);
 }
});
test('endpoint fixture loads real billing handlers and asserts durable admission before provider POST',()=>{
 const source=read('scripts/test-storage-cleanup-endpoints-deno.ts');
 for(const name of ['create-checkout-session','create-portal-session','delete-account'])assert.ok(source.includes(`../supabase/functions/${name}/index.ts`));
 assert.match(source,/A durable exact operation must precede every provider POST/);
 assert.match(source,/Closing receipt must commit before provider DELETE/);
 assert.match(source,/assert\.equal\(headers\.get\('stripe-version'\),providerScope\.api_version\)/);
 assert.match(source,/No external destination may be contacted/);
 assert.match(source,/late customer creation stays recorded/);assert.match(source,/fresh pending billing receipt after Storage cleanup/);
});
