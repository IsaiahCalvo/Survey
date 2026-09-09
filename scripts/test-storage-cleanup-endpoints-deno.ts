// Actual Edge handlers and pinned SDK; synthetic HTTP/SQL/provider boundary.
// No inherited secrets, real accounts, server, or external network permission.
import assert from 'node:assert/strict';
const actor='11111111-1111-4111-8111-111111111111',path=`${actor}/fixture.pdf`;
const config:Record<string,string>={SUPABASE_URL:'https://storage-cleanup.invalid',SUPABASE_SERVICE_ROLE_KEY:'fixture-service-key',SUPABASE_ANON_KEY:'fixture-anon-key',ARCHIVE_PURGE_CRON_SECRET:'fixture-cron-secret',STRIPE_SECRET_KEY:'sk_test_FixtureOnly',STRIPE_PRO_MONTHLY_PRICE_ID:'price_FixtureMonthly',STRIPE_PRO_ANNUAL_PRICE_ID:'price_FixtureAnnual',STRIPE_ENTERPRISE_PRICE_ID:'price_FixtureEnterprise'};
let handler:(req:Request)=>Promise<Response>;
Object.defineProperty(Deno.env,'get',{value:(name:string)=>config[name]});
Object.defineProperty(Deno,'serve',{value:(value:typeof handler)=>{handler=value;}});
let calls:string[]=[],queue=new Set<string>(),objects=new Set<string>(),retired=new Set<string>();
let fault='',shared=false,checks=0,claimCalls=0,scanCursor:string|null=null;
const providerScope={mode:'test',account:'acct_Fixture',api_version:'2026-02-25.clover'};
let billingClosing=false,customerId:string|null=null,operations=new Map<string,any>(),customers=new Map<string,any>(),providerCreates=0,providerBodies:URLSearchParams[]=[],recoveryValues:any[]=[],afterCustomerRead:(()=>void)|null=null;
let providerCustomerCreates=0,providerCustomers=new Map<string,any>(),everBound=new Set<string>();
let beforeCustomerRotate:(()=>void)|null=null,missingProviderCustomers=new Set<string>();
const billingState=()=>({closing:billingClosing,has_pending_operations:[...operations.values()].some(o=>o.state==='pending'),has_pending_customers:[...customers.values()].some(c=>!c.removed),current_customer_covered:!customerId||customers.get(JSON.stringify(providerScope)+customerId)?.removed===true,complete:billingClosing&&![...operations.values()].some(o=>o.state==='pending')&&![...customers.values()].some(c=>!c.removed)&&(!customerId||customers.get(JSON.stringify(providerScope)+customerId)?.removed===true)});
const registerCustomer=(id:string,scope=providerScope)=>{const key=JSON.stringify(scope)+id;if(!customers.has(key))customers.set(key,{customer_id:id,provider_scope:scope,removed:false});};
const reset=(problem='',referenced=false)=>{calls=[];queue=new Set([path]);objects=new Set([path]);retired=new Set();fault=problem;shared=referenced;claimCalls=0;scanCursor=null;billingClosing=false;customerId=null;operations=new Map();customers=new Map();providerCreates=0;providerBodies=[];recoveryValues=[];afterCustomerRead=null;providerCustomerCreates=0;providerCustomers=new Map();everBound=new Set();beforeCustomerRotate=null;missingProviderCustomers=new Set();};
const ok=(data:unknown)=>Response.json(data);
const fail=()=>Response.json({code:'fixture_failure',message:'Synthetic boundary failure',error:'Synthetic boundary failure',statusCode:'500'},{status:500});
globalThis.fetch=async(input:Request|URL|string,init?:RequestInit)=>{
 const url=new URL(input instanceof Request?input.url:String(input));
 const method=init?.method||(input instanceof Request?input.method:'GET');
 calls.push(`${method} ${url.pathname}`);
 if(url.origin==='https://api.stripe.com'){
   const headers=new Headers(init?.headers||(input instanceof Request?input.headers:undefined));assert.equal(headers.get('authorization'),'Bearer sk_test_FixtureOnly');assert.equal(headers.get('stripe-version'),providerScope.api_version);
   if(url.pathname==='/v1/account'){assert.equal(method,'GET');return ok({id:fault==='scope'?'not-an-account':'acct_Fixture',object:'account'});}
   if(method==='POST'){
     providerCreates++;const form=new URLSearchParams(String(init?.body||''));providerBodies.push(form);
     const id=headers.get('idempotency-key')?.replace('survey-billing:','');const op=operations.get(id!);assert.ok(op,'A durable exact operation must precede every provider POST');assert.equal(op.state,'pending');assert.deepEqual(op.provider_scope,providerScope);
     if(fault==='provider-post')return Response.json({error:{type:'api_error',message:'Synthetic lost response'}},{status:500});
     const metadata=Object.fromEntries([...form.entries()].filter(([key])=>key.startsWith('metadata[')).map(([key,value])=>[key.slice(9,-1),value]));
     if(url.pathname==='/v1/customers'){providerCustomerCreates++;const value={id:providerCustomerCreates===1?'cus_Created':`cus_Created${providerCustomerCreates}`,object:'customer',livemode:false,metadata};providerCustomers.set(value.id,value);return ok(value);}
     const portal=url.pathname==='/v1/billing_portal/sessions';assert.ok(portal||url.pathname==='/v1/checkout/sessions');
     return ok({id:portal?'bps_Fixture':'cs_test_Fixture',object:portal?'billing_portal.session':'checkout.session',customer:form.get('customer'),mode:'subscription',livemode:fault==='wrong-mode',url:fault==='bad-url'?'https://evil.invalid/':portal?'https://billing.stripe.com/p/session/fixture':'https://checkout.stripe.com/c/pay/fixture',metadata});
   }
   if(url.pathname==='/v1/customers/search')return ok({object:'search_result',data:recoveryValues,has_more:false});
   if(url.pathname==='/v1/checkout/sessions'||url.pathname==='/v1/events')return ok({object:'list',data:recoveryValues,has_more:false});
   if(url.pathname.startsWith('/v1/customers/')){
     const id=decodeURIComponent(url.pathname.slice('/v1/customers/'.length));
     if(method==='DELETE'){assert.equal(billingClosing,true,'Closing receipt must commit before provider DELETE');assert.ok([...customers.values()].some(c=>c.customer_id===id&&!c.removed));if(fault==='billing-delete')return fail();if(fault==='billing-404')return Response.json({error:{type:'invalid_request_error',code:'resource_missing',message:'Synthetic absence'}},{status:404});return ok({id:fault==='deleted-wrong-id'?'cus_Wrong':id,object:'customer',deleted:true});}
     assert.equal(method,'GET');afterCustomerRead?.();afterCustomerRead=null;
     if(fault==='candidate-404'||missingProviderCustomers.has(id))return Response.json({error:{type:'invalid_request_error',code:'resource_missing',message:'Synthetic absence'}},{status:404});
     return ok(providerCustomers.get(id)||{id,object:'customer',livemode:fault==='wrong-mode',...(fault==='saved-deleted'?{deleted:true}:{})});
   }
   throw Error(`Unexpected synthetic provider boundary ${method} ${url.pathname}`);
 }
 assert.equal(url.origin,config.SUPABASE_URL,'No external destination may be contacted');
 const body=typeof init?.body==='string'?JSON.parse(init.body):{};
 if(url.pathname==='/auth/v1/user')return fault==='auth'?Response.json({message:'not authenticated'},{status:401}):ok({id:actor,aud:'authenticated',email:'fixture@example.invalid'});
 if(url.pathname==='/rest/v1/user_subscriptions'){const headers=new Headers(init?.headers);return ok(headers.get('accept')?.includes('vnd.pgrst.object')?{stripe_customer_id:customerId}:[{stripe_customer_id:customerId}]);}
 if(url.pathname===`/auth/v1/admin/users/${actor}`){assert.equal(method,'DELETE');assert.equal(objects.size,0);assert.equal(billingState().complete,true);return ok({id:actor});}
 if(url.pathname==='/storage/v1/object/list/documents')throw Error('Account cleanup must not recursively load a Storage inventory');
 if(url.pathname==='/storage/v1/object/documents'){
   assert.equal(method,'DELETE');const paths=body.prefixes as string[];
   assert.ok(paths.every(p=>retired.has(p)),'Storage delete requires an earlier committed-retirement reply');
   if(fault==='remove')return fail();
   const removed=paths.filter(p=>objects.has(p));for(const p of paths)objects.delete(p);
   return ok(removed.map(name=>({name})));
 }
 if(url.pathname==='/rest/v1/archive_purge_runs'){assert.equal(method,'PATCH');return new Response(null,{status:204});}
 const rpc=url.pathname.split('/rest/v1/rpc/')[1];
 if(['begin_billing_operation','settle_billing_operation','read_billing_operation','scan_pending_billing_operations','advance_billing_operation_recovery_cursor','rotate_billing_customer','read_reusable_billing_customer','retire_reusable_billing_customer','begin_billing_account_closure','read_billing_account_closure','claim_billing_customer_cleanup','ack_billing_customer_cleanup'].includes(rpc)){
   assert.equal(body.p_user_id,actor);const headers=new Headers(init?.headers);assert.equal(headers.get('apikey'),'fixture-service-key');
   if(rpc==='read_billing_account_closure'){if(fault==='final-billing-pending'&&objects.size===0)return ok({...billingState(),has_pending_operations:true,complete:false});return ok(billingState());}
   if(rpc==='scan_pending_billing_operations')return ok({operations:[...operations.values()].filter(o=>o.state==='pending').slice(0,body.p_limit)});
   if(rpc==='read_billing_operation')return ok(operations.get(body.p_operation_id)||null);
   if(rpc==='advance_billing_operation_recovery_cursor'){const op=operations.get(body.p_operation_id);assert.ok(op);if(op.recovery_cursor!==body.p_expected_cursor)return ok({outcome:'stale'});op.recovery_cursor=body.p_next_cursor;return ok({outcome:'advanced'});}
   if(rpc==='begin_billing_operation'){
     if(billingClosing||fault==='admission-closing')return Response.json({code:'23514',message:'ACCOUNT_CLOSING'},{status:400});
     if(fault==='admission')return fail();
     if([...operations.values()].some(o=>o.state==='pending'&&o.kind===body.p_kind)
       ||(body.p_kind==='customer_create'&&[...operations.values()].some(o=>o.kind==='customer_create'&&o.state==='settled'&&o.result?.outcome==='succeeded'&&['available','untracked'].includes(o.customer_binding_state))))return Response.json({code:'40001',message:'BILLING_OPERATION_PENDING'},{status:400});
     const op={operation_id:body.p_operation_id,user_id:actor,kind:body.p_kind,provider_scope:body.p_provider_scope,request_spec:body.p_request_spec,expected_customer_id:body.p_expected_customer_id,state:'pending',result:null,admitted_at:new Date().toISOString(),recovery_cursor:null};operations.set(op.operation_id,op);if(op.expected_customer_id)registerCustomer(op.expected_customer_id,op.provider_scope);return ok({...op,outcome:'admitted'});
   }
   if(rpc==='settle_billing_operation'){
     const op=operations.get(body.p_operation_id);assert.ok(op);assert.equal(op.kind,body.p_kind);assert.deepEqual(op.provider_scope,body.p_provider_scope);assert.deepEqual(op.request_spec,body.p_request_spec);
     if(fault==='settle')return fail();if(fault==='late-close'&&op.kind!=='customer_create'){billingClosing=true;op.result={outcome:'customer_removed',customer_id:op.expected_customer_id,data:{}};}else op.result=body.p_result;
     op.state='settled';if(op.kind==='customer_create'&&op.result.outcome==='succeeded')op.customer_binding_state='available';if(op.result.customer_id&&op.result.outcome!=='customer_removed')registerCustomer(op.result.customer_id,op.provider_scope);return ok({...op,outcome:'settled'});
   }
   if(rpc==='read_reusable_billing_customer'){
     if(billingClosing)return ok({outcome:'closing',operation:null,customer_id:customerId});
     if(customerId)return ok({outcome:'bound',operation:null,customer_id:customerId});
     if([...operations.values()].some(o=>o.kind==='customer_create'&&o.state==='pending'))return ok({outcome:'review',operation:null,customer_id:null});
     const candidate=[...operations.values()].filter(o=>o.kind==='customer_create'&&o.state==='settled'&&o.result?.outcome==='succeeded'&&['available','untracked'].includes(o.customer_binding_state)).sort((a,b)=>a.operation_id.localeCompare(b.operation_id))[0];
     if(!candidate)return ok({outcome:'none',operation:null,customer_id:null});
     if(candidate.customer_binding_state==='untracked'||JSON.stringify(candidate.provider_scope)!==JSON.stringify(body.p_provider_scope)||everBound.has(candidate.result.customer_id)||customers.get(JSON.stringify(candidate.provider_scope)+candidate.result.customer_id)?.removed!==false)return ok({outcome:'review',operation:candidate,customer_id:null});
     return ok({outcome:'candidate',operation:candidate,customer_id:null});
   }
   if(rpc==='retire_reusable_billing_customer'){
     const op=operations.get(body.p_operation_id);assert.ok(op);assert.equal(op.user_id,actor);assert.deepEqual(op.provider_scope,body.p_provider_scope);assert.equal(op.result.customer_id,body.p_customer_id);
     if(billingClosing)return ok({outcome:'closing',customer_id:body.p_customer_id});
     if(customerId===body.p_customer_id||!['available','untracked','retired'].includes(op.customer_binding_state))return ok({outcome:'stale',customer_id:body.p_customer_id});
     const cleanup=customers.get(JSON.stringify(body.p_provider_scope)+body.p_customer_id);assert.ok(cleanup);cleanup.removed=true;
     op.customer_binding_state='retired';return ok({outcome:'retired',customer_id:body.p_customer_id});
   }
   if(rpc==='rotate_billing_customer'){
     const race=beforeCustomerRotate;beforeCustomerRotate=null;race?.();
     if(billingClosing||fault==='late-customer-close'){billingClosing=true;return ok({outcome:'closing',customer_id:customerId});}
     if(fault==='rotate-before')return fail();
     if(customerId!==body.p_expected_customer_id)return ok({outcome:'stale',customer_id:customerId});
     if(customerId)registerCustomer(customerId);const op=body.p_customer_operation_id?operations.get(body.p_customer_operation_id):null;
     if(op){assert.equal(op.kind,'customer_create');assert.equal(op.state,'settled');assert.equal(op.result.outcome,'succeeded');assert.equal(op.customer_binding_state,'available');assert.deepEqual(op.provider_scope,body.p_provider_scope);assert.equal(everBound.has(op.result.customer_id),false);op.customer_binding_state='bound';everBound.add(op.result.customer_id);}
     customerId=op?.result.customer_id||null;if(fault==='rotate-after')return fail();return ok({outcome:'applied',customer_id:customerId});
   }
   if(rpc==='begin_billing_account_closure'){billingClosing=true;assert.deepEqual(body.p_provider_scope,providerScope);if(customerId)registerCustomer(customerId);return ok(fault==='malformed-closure'?{closing:true,complete:true}:billingState());}
   if(rpc==='claim_billing_customer_cleanup')return ok({...billingState(),customers:[...customers.values()].filter(c=>!c.removed).slice(0,body.p_limit).map(({removed,...c})=>c)});
   if(rpc==='ack_billing_customer_cleanup'){
     const c=customers.get(JSON.stringify(body.p_provider_scope)+body.p_customer_id);assert.ok(c);c.removed=true;
     for(const op of operations.values())if(op.state==='pending'&&op.kind!=='customer_create'&&op.expected_customer_id===body.p_customer_id&&JSON.stringify(op.provider_scope)===JSON.stringify(body.p_provider_scope)){op.state='settled';op.result={outcome:'customer_removed',customer_id:c.customer_id,data:{}};}
     return ok({...billingState(),has_pending_customer_operations:false});
   }
 }
 if(rpc==='sweep_expired_archives')return ok({run_id:'33333333-3333-4333-8333-333333333333',projects_purged:0,documents_purged:0,templates_purged:0,orphaned_paths:[],batch_limit:50,failed:0,skipped:0});
 if(rpc==='expire_document_generation_uploads'){assert.equal(body.p_limit,100);return ok({canceled_operation_ids:[],skipped_operation_ids:[]});}
 if(rpc==='delete_account_owned_rows')return fault==='rows'?fail():ok({ok:true});
 if(rpc==='claim_account_storage_cleanup'){
   claimCalls++;assert.equal(body.target_user_id,actor);assert.equal(body.p_limit,100);
   if(fault==='account_list')return fail();
   if(fault==='list_null')return ok(null);
   if(fault==='list_missing_name')return ok({paths:[{}],has_remaining:true,cycle_complete:true});
   if(fault==='list_missing_id')return ok({paths:[path],cycle_complete:true});
   if(fault==='list_oversize')return ok({paths:Array(101).fill(path),has_remaining:true,cycle_complete:true});
   const raw=[...new Set([...objects,...queue])].filter(p=>scanCursor===null||p>scanCursor).sort().slice(0,100);
   const cycle=raw.length<100;scanCursor=cycle?null:raw.at(-1)!;
   return ok({paths:raw,has_remaining:objects.size>0||queue.size>0,cycle_complete:cycle});
 }
 if(rpc==='list_document_storage_cleanup')return fault==='list'?fail():ok({paths:[...queue]});
 if(rpc==='retire_document_storage_paths'){
   if(fault==='retire')return fail();
   if(shared)return ok({retired_paths:[],referenced_paths:body.p_paths});
   for(const p of body.p_paths){retired.add(p);queue.add(p);}return ok({retired_paths:body.p_paths,referenced_paths:[]});
 }
 if(rpc==='ack_document_storage_cleanup'){
   if(fault==='ack')return fail();
   const acknowledged=body.p_paths.filter((p:string)=>!objects.has(p));for(const p of acknowledged)queue.delete(p);
   return ok({acknowledged_paths:acknowledged,pending_paths:body.p_paths.filter((p:string)=>objects.has(p))});
 }
 throw Error(`Unexpected local boundary ${method} ${url.pathname}`);
};
await import('../supabase/functions/archive-purge-sweep/index.ts');
const sweep=handler!;
await import('../supabase/functions/delete-account/index.ts');
const account=handler!;
await import('../supabase/functions/create-checkout-session/index.ts');const checkout=handler!;
await import('../supabase/functions/create-portal-session/index.ts');const portal=handler!;
const request=(body:unknown,token='fixture-service-key')=>new Request('https://local-fixture.invalid',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)});
const check=async(name:string,work:()=>Promise<void>)=>{await work();checks++;console.log('PASS '+name);};
const called=(part:string)=>calls.some(call=>call.includes(part));
await check('unauthorized scheduled caller cannot touch cleanup',async()=>{reset();assert.equal((await sweep(request({},'user-token'))).status,401);assert.deepEqual(calls,[]);});
await check('dry run never claims or removes queued files',async()=>{reset();assert.equal((await sweep(request({dry_run:true}))).status,200);assert.equal(called('expire_document_generation_uploads'),false);assert.equal(called('list_document_storage_cleanup'),false);assert.equal(called('/storage/'),false);assert.equal(queue.size,1);});
await check('zero new purges still recover the durable cleanup backlog',async()=>{reset();const result=await (await sweep(request({}))).json();assert.equal(result.unlinked,1);assert.equal(queue.size,0);assert.equal(objects.size,0);const expiry=calls.findIndex(c=>c.includes('expire_document_generation_uploads'));assert.ok(expiry>=0&&expiry<calls.findIndex(c=>c.includes('list_document_storage_cleanup')));assert.ok(calls.findIndex(c=>c.includes('retire_document'))<calls.findIndex(c=>c.startsWith('DELETE /storage/')));});
await check('a reference appearing after queue selection keeps the PDF',async()=>{reset('',true);const result=await (await sweep(request({}))).json();assert.equal(result.unlinked,0);assert.equal(objects.size,1);assert.equal(called('/storage/'),false);});
for(const problem of ['retire','remove','list'])await check(`${problem} failure keeps scheduled cleanup pending`,async()=>{reset(problem);const result=await(await sweep(request({}))).json();assert.equal(result.unlinked,0);assert.ok(result.unlink_errors.length);assert.equal(queue.size,1);assert.equal(objects.size,1);if(problem!=='remove')assert.equal(called('/storage/'),false);});
await check('lost acknowledgement retries the same retired path, including absent metadata',async()=>{reset('ack');await sweep(request({}));assert.equal(objects.size,0);assert.equal(queue.size,1);fault='';const result=await(await sweep(request({}))).json();assert.equal(result.unlinked,1);assert.equal(queue.size,0);});
await check('account confirmation fails before any data access',async()=>{reset();assert.equal((await account(request({}))).status,400);assert.deepEqual(calls,[]);});
await check('account auth failure never deletes data',async()=>{reset('auth');assert.equal((await account(request({confirmation:'DELETE'}))).status,401);assert.equal(called('delete_account_owned_rows'),false);});
await check('account rows, safe storage cleanup, then auth deletion stay ordered',async()=>{reset();assert.equal((await account(request({confirmation:'DELETE'}))).status,200);const rows=calls.findIndex(c=>c.includes('delete_account_owned_rows')),retire=calls.findIndex(c=>c.includes('retire_document')),ack=calls.findIndex(c=>c.includes('ack_document_storage')),auth=calls.findIndex(c=>c.startsWith('DELETE /auth/'));assert.ok(rows>=0&&rows<retire&&retire<ack&&ack<auth);});
for(const problem of ['retire','remove'])await check(`${problem} failure prevents final account removal`,async()=>{reset(problem);const response=await account(request({confirmation:'DELETE'}));assert.equal(response.status,202);assert.equal((await response.json()).deleted,false);assert.equal(called('DELETE /auth/'),false);assert.equal(objects.size,1);});
await check('surviving shared reference prevents account storage/auth removal',async()=>{reset('',true);assert.equal((await account(request({confirmation:'DELETE'}))).status,202);assert.equal(objects.size,1);assert.equal(called('DELETE /auth/'),false);assert.equal(called('DELETE /storage/'),false);});
for(const problem of ['rows','account_list','list_null','list_missing_name','list_missing_id','list_oversize'])await check(`${problem} cannot be mistaken for completed account cleanup`,async()=>{reset(problem);assert.equal((await account(request({confirmation:'DELETE'}))).status,problem==='rows'?500:202);assert.equal(called('DELETE /auth/'),false);assert.equal(called('DELETE /storage/'),false);assert.equal(objects.size,1);if(problem==='rows')assert.equal(called('claim_account_storage_cleanup'),false);});
await check('nested exact raw names need no recursive inventory requests',async()=>{reset();objects=new Set([`${actor}/old folder/nested/drawing %?#.pdf`,path]);assert.equal((await account(request({confirmation:'DELETE'}))).status,200);assert.equal(objects.size,0);assert.equal(claimCalls,2);assert.ok(retired.has(`${actor}/old folder/nested/drawing %?#.pdf`));assert.equal(called('/storage/v1/object/list/'),false);});
await check('large account makes bounded progress and requires a fresh empty receipt on retry',async()=>{reset();queue.clear();objects=new Set(Array.from({length:201},(_,i)=>`${actor}/drawing-${String(i).padStart(3,'0')}.pdf`));const first=await account(request({confirmation:'DELETE'}));assert.equal(first.status,202);assert.deepEqual(await first.json(),{deleted:false,pending:true,code:'account-cleanup-pending',error:'Account cleanup is not finished. Retry deletion to continue; shared files may need review.'});assert.equal(claimCalls,3);assert.equal(called('DELETE /auth/'),false);assert.equal(objects.size,0);assert.equal(retired.size,201);assert.equal(calls.filter(c=>c.startsWith('DELETE /storage/')).length,3);assert.equal((await account(request({confirmation:'DELETE'}))).status,200);assert.equal(claimCalls,4);});
console.log(`PASS ${checks} actual Storage cleanup Edge endpoint checks; no external network requests`);
const storageChecks=checks;
const noUrl=async(response:Response)=>{const data=await response.json();assert.equal('url' in data,false);assert.equal(typeof data.error,'string');assert.equal(response.headers.get('access-control-allow-origin'),'*');return data;};
const seedPending=(kind='customer_create',customer:string|null=null)=>{
 const op={operation_id:crypto.randomUUID(),user_id:actor,kind,provider_scope:providerScope,request_spec:kind==='customer_create'?{email:'fixture@example.invalid'}:{customer},expected_customer_id:customer,state:'pending',result:null,admitted_at:new Date().toISOString(),recovery_cursor:null};operations.set(op.operation_id,op);if(customer)registerCustomer(customer);return op;
};
for(const [label,endpoint] of [['checkout',checkout],['portal',portal]] as const){
 await check(`${label} CORS preflight and unauthenticated requests never reach provider POST`,async()=>{reset();const options=await endpoint(new Request('https://local-fixture.invalid',{method:'OPTIONS'}));assert.equal(options.headers.get('access-control-allow-origin'),'*');assert.deepEqual(calls,[]);await noUrl(await endpoint(new Request('https://local-fixture.invalid',{method:'POST',body:'{}'})));assert.equal(providerCreates,0);reset('auth');await noUrl(await endpoint(request({})));assert.equal(providerCreates,0);});
 await check(`${label} exact known customer succeeds only after durable admission and settlement`,async()=>{reset();customerId='cus_Known';const response=await endpoint(request({returnUrl:'https://surveytool.app/settings?tab=billing#old'}));assert.equal(response.status,200);const data=await response.json();assert.match(data.url,label==='checkout'?/^https:\/\/checkout\.stripe\.com\//:/^https:\/\/billing\.stripe\.com\//);assert.equal(providerCreates,1);assert.equal(operations.size,1);const op=[...operations.values()][0];assert.equal(op.state,'settled');assert.equal(op.kind,label==='checkout'?'checkout_create':'portal_create');const form=providerBodies[0];assert.equal(form.get('customer'),'cus_Known');assert.equal(form.get(label==='checkout'?'success_url':'return_url'),label==='checkout'?'https://surveytool.app/settings?tab=billing&billing=success':'https://surveytool.app/settings?tab=billing');assert.ok(calls.indexOf('GET /v1/account')<calls.findIndex(c=>c.includes('begin_billing_operation')));});
 await check(`${label} closing account and raced admission deny every provider POST`,async()=>{reset();customerId='cus_Known';billingClosing=true;const data=await noUrl(await endpoint(request({})));assert.equal(data.code,'account-closing');assert.equal(providerCreates,0);reset('admission-closing');customerId='cus_Known';assert.equal((await noUrl(await endpoint(request({})))).code,'account-closing');assert.equal(providerCreates,0);});
 for(const problem of ['admission','provider-post','settle','wrong-mode','bad-url','scope'])await check(`${label} ${problem} returns an error without a URL or repeated provider POST`,async()=>{reset(problem);customerId='cus_Known';await noUrl(await endpoint(request({})));assert.ok(providerCreates<=1);if(['admission','wrong-mode','scope'].includes(problem))assert.equal(providerCreates,0);if(problem==='provider-post')assert.equal([...operations.values()][0].state,'pending');});
 await check(`${label} late customer deletion wins over a successful provider response`,async()=>{reset('late-close');customerId='cus_Known';assert.equal((await noUrl(await endpoint(request({})))).code,'account-closing');assert.equal(providerCreates,1);assert.equal([...operations.values()][0].result.outcome,'customer_removed');});
 await check(`${label} unknown creation remains pending and does not authorize a new POST`,async()=>{reset();customerId='cus_Known';seedPending();const data=await noUrl(await endpoint(request({})));assert.equal(data.pending,true);assert.equal(providerCreates,0);assert.equal([...operations.values()][0].state,'pending');assert.equal(called('GET /v1/customers/search'),true);});
}
await check('checkout creates and binds an owned customer before creating its session',async()=>{reset();const response=await checkout(request({billingPeriod:'annual',returnUrl:'https://evil.invalid/redirect'}));assert.equal(response.status,200);assert.ok((await response.json()).url);assert.equal(providerCreates,2);assert.deepEqual([...operations.values()].map(o=>o.kind),['customer_create','checkout_create']);assert.equal(customerId,'cus_Created');assert.ok(calls.findIndex(c=>c.includes('rotate_billing_customer'))<calls.findIndex(c=>c==='POST /v1/checkout/sessions'));assert.equal(providerBodies[1].get('line_items[0][price]'),'price_FixtureAnnual');assert.equal(providerBodies[1].get('success_url'),'https://surveytool.app/?billing=success');});
await check('late customer creation stays recorded but cannot bind or launch checkout after closure',async()=>{reset('late-customer-close');await noUrl(await checkout(request({})));assert.equal(providerCreates,1);assert.equal(customerId,null);const op=[...operations.values()][0];assert.equal(op.kind,'customer_create');assert.equal(op.state,'settled');assert.equal(op.result.customer_id,'cus_Created');assert.equal(customers.size,1);});
await check('deletion without a Stripe key fails for an unbound account before any lifecycle or data mutation',async()=>{reset();const secret=config.STRIPE_SECRET_KEY;delete config.STRIPE_SECRET_KEY;try{assert.equal((await account(request({confirmation:'DELETE'}))).status,503);assert.equal(called('begin_billing_account_closure'),false);assert.equal(called('delete_account_owned_rows'),false);assert.equal(called('DELETE /auth/'),false);}finally{config.STRIPE_SECRET_KEY=secret;}});
await check('account deletion cancels exact known pending checkout and portal before data and auth',async()=>{reset();customerId='cus_Known';seedPending('checkout_create',customerId);seedPending('portal_create',customerId);const response=await account(request({confirmation:'DELETE'}));assert.equal(response.status,200);assert.ok([...operations.values()].every(o=>o.result.outcome==='customer_removed'));assert.equal(providerCreates,0);const close=calls.findIndex(c=>c.includes('begin_billing_account_closure')),remove=calls.indexOf('DELETE /v1/customers/cus_Known'),ack=calls.findIndex(c=>c.includes('ack_billing_customer_cleanup')),rows=calls.findIndex(c=>c.includes('delete_account_owned_rows'));assert.ok(close<remove&&remove<ack&&ack<rows);});
await check('account deletion cleans known billing but keeps unknown customer creation pending',async()=>{reset();customerId='cus_Known';seedPending();const response=await account(request({confirmation:'DELETE'}));assert.equal(response.status,202);assert.equal((await response.json()).deleted,false);assert.equal(called('DELETE /v1/customers/cus_Known'),true);assert.equal(called('delete_account_owned_rows'),false);assert.equal(called('DELETE /auth/'),false);assert.equal(providerCreates,0);assert.equal([...operations.values()][0].state,'pending');});
await check('billing provider deletion failure prevents core Storage and auth removal',async()=>{reset('billing-delete');customerId='cus_Known';assert.equal((await account(request({confirmation:'DELETE'}))).status,202);assert.equal(called('delete_account_owned_rows'),false);assert.equal(called('DELETE /storage/'),false);assert.equal(called('DELETE /auth/'),false);assert.equal(customers.size,1);});
await check('wrong provider namespace never deletes or acknowledges a cleanup customer',async()=>{reset();registerCustomer('cus_Other',{...providerScope,mode:'live'});assert.equal((await account(request({confirmation:'DELETE'}))).status,202);assert.equal(called('DELETE /v1/customers/'),false);assert.equal(called('ack_billing_customer_cleanup'),false);assert.equal(called('DELETE /auth/'),false);});
await check('malformed billing completion cannot authorize data or auth deletion',async()=>{reset('malformed-closure');assert.equal((await account(request({confirmation:'DELETE'}))).status,202);assert.equal(called('delete_account_owned_rows'),false);assert.equal(called('DELETE /auth/'),false);});
await check('fresh pending billing receipt after Storage cleanup blocks final auth deletion',async()=>{reset('final-billing-pending');assert.equal((await account(request({confirmation:'DELETE'}))).status,202);assert.equal(objects.size,0);assert.equal(called('DELETE /auth/'),false);assert.ok(calls.findIndex(c=>c.includes('ack_document_storage_cleanup'))<calls.lastIndexOf('POST /rest/v1/rpc/read_billing_account_closure'));});
for(const problem of ['billing-404','deleted-wrong-id'])await check(`${problem} is not an exact customer deletion receipt`,async()=>{reset(problem);customerId='cus_Known';assert.equal((await account(request({confirmation:'DELETE'}))).status,202);assert.equal(called('ack_billing_customer_cleanup'),false);assert.equal(called('DELETE /auth/'),false);if(problem==='billing-404')assert.equal(called('GET /v1/customers/cus_Known'),true);});
const lostSession=async(endpoint:typeof handler,kind:'checkout'|'portal',status='open',age=0)=>{
 reset('provider-post');customerId='cus_Known';await noUrl(await endpoint(request({})));assert.equal(providerCreates,1);assert.equal(operations.size,1);
 const op=[...operations.values()][0];assert.equal(op.state,'pending');const form=providerBodies[0],metadata=Object.fromEntries([...form.entries()].filter(([key])=>key.startsWith('metadata[')).map(([key,value])=>[key.slice(9,-1),value]));
 if(age)op.admitted_at=new Date(Date.now()-(age+10)*1000).toISOString();
 const value={id:kind==='checkout'?'cs_test_Lost':'bps_Lost',object:kind==='checkout'?'checkout.session':'billing_portal.session',customer:'cus_Known',livemode:false,mode:'subscription',status,expires_at:Math.floor(Date.now()/1000)+300,url:kind==='checkout'?'https://checkout.stripe.com/c/pay/lost':'https://billing.stripe.com/p/session/lost',metadata};
 recoveryValues=kind==='checkout'?[value]:[{id:'evt_Lost',object:'event',type:'billing_portal.session.created',livemode:false,created:Math.floor(Date.now()/1000)-age,request:{idempotency_key:`survey-billing:${op.operation_id}`},data:{object:value}}];fault='';return {op,value};
};
for(const [kind,endpoint] of [['checkout',checkout],['portal',portal]] as const){
 await check(`${kind} lost POST recovers the first exact session URL without another provider POST`,async()=>{
   const {op,value}=await lostSession(endpoint,kind);const before=JSON.stringify(op.request_spec),response=await endpoint(request({}));assert.equal(response.status,200);assert.deepEqual(await response.json(),{url:value.url});assert.equal(providerCreates,1);assert.equal(operations.size,1);assert.equal(op.state,'settled');assert.equal(op.result.data.id,value.id);assert.equal(JSON.stringify(op.request_spec),before);assert.equal(called(kind==='checkout'?'GET /v1/checkout/sessions':'GET /v1/events'),true);
 });
 await check(`${kind} recovery settles the old result but never reuses it for a different frozen spec`,async()=>{
   const {op,value}=await lostSession(endpoint,kind);const response=await endpoint(request(kind==='checkout'?{billingPeriod:'annual'}:{returnUrl:'https://surveytool.app/changed'}));assert.equal(response.status,200);const data=await response.json();assert.notEqual(data.url,value.url);assert.equal(providerCreates,2);assert.equal(operations.size,2);assert.equal(op.state,'settled');assert.equal(op.result.data.url,value.url);
 });
}
for(const status of ['complete','expired'])await check(`${status} checkout is settled but cannot supply a reusable URL`,async()=>{const {op,value}=await lostSession(checkout,'checkout',status);const response=await checkout(request({}));assert.equal(response.status,200);assert.notEqual((await response.json()).url,value.url);assert.equal(op.state,'settled');assert.equal(providerCreates,2);});
await check('portal event older than sixty seconds settles its result but cannot supply a reusable URL',async()=>{const {op,value}=await lostSession(portal,'portal','open',90);const response=await portal(request({}));assert.equal(response.status,200);assert.notEqual((await response.json()).url,value.url);assert.equal(op.state,'settled');assert.equal(providerCreates,2);});
await check('open checkout with a past expiry settles but never supplies its old URL',async()=>{const {op,value}=await lostSession(checkout,'checkout');value.expires_at=Math.floor(Date.now()/1000)-1;const response=await checkout(request({}));assert.equal(response.status,200);assert.notEqual((await response.json()).url,value.url);assert.equal(op.state,'settled');assert.equal(providerCreates,2);});
for(const [kind,endpoint] of [['checkout',checkout],['portal',portal]] as const)await check(`${kind} expiry between recovery and URL selection prevents reuse`,async()=>{
 const originalNow=Date.now;let now=originalNow();Date.now=()=>now;
 try{const {op,value}=await lostSession(endpoint,kind);afterCustomerRead=()=>{assert.equal(op.state,'settled','Positive recovery precedes this delayed customer read');now+=360000;};const response=await endpoint(request({}));assert.equal(response.status,200);assert.notEqual((await response.json()).url,value.url);assert.equal(providerCreates,2);assert.equal(op.state,'settled');}finally{Date.now=originalNow;afterCustomerRead=null;}
});
const createUnboundCustomer=async()=>{
 reset('rotate-before');const data=await noUrl(await checkout(request({})));assert.equal(data.pending,true);
 assert.equal(providerCustomerCreates,1);assert.equal(customerId,null);assert.equal(called('POST /v1/checkout/sessions'),false);
 const op=[...operations.values()][0];assert.equal(op.kind,'customer_create');assert.equal(op.state,'settled');assert.equal(op.customer_binding_state,'available');
 return op;
};
await check('checkout retries a settled unbound customer without creating a second customer',async()=>{
 const op=await createUnboundCustomer();fault='';const response=await checkout(request({}));assert.equal(response.status,200);assert.ok((await response.json()).url);
 assert.equal(providerCustomerCreates,1);assert.equal(customerId,'cus_Created');assert.equal(op.customer_binding_state,'bound');
 assert.equal(providerCreates,2);assert.equal(providerBodies.at(-1)!.get('customer'),'cus_Created');
});
await check('repeated pre-commit binding failures retain one reusable customer through later success',async()=>{
 const op=await createUnboundCustomer();await noUrl(await checkout(request({})));assert.equal(providerCustomerCreates,1);assert.equal(providerCreates,1);assert.equal(op.customer_binding_state,'available');
 fault='';assert.ok((await(await checkout(request({}))).json()).url);assert.equal(providerCustomerCreates,1);assert.equal(customerId,'cus_Created');
});
await check('lost binding reply after commit retries against the same authoritative customer',async()=>{
 reset('rotate-after');assert.equal((await noUrl(await checkout(request({})))).pending,true);assert.equal(customerId,'cus_Created');assert.equal(providerCustomerCreates,1);
 const op=[...operations.values()][0];assert.equal(op.customer_binding_state,'bound');fault='';assert.ok((await(await checkout(request({}))).json()).url);
 assert.equal(providerCustomerCreates,1);assert.equal(providerCreates,2);assert.equal(providerBodies.at(-1)!.get('customer'),'cus_Created');
});
for(const reason of ['wrong-scope','untracked'])await check(`${reason} settled customer blocks fresh provider creation and requires review`,async()=>{
 const op=await createUnboundCustomer();if(reason==='wrong-scope')op.provider_scope={...providerScope,mode:'live'};else op.customer_binding_state='untracked';
 fault='';const before=providerCreates;const data=await noUrl(await checkout(request({})));assert.equal(data.pending,true);assert.equal(providerCreates,before);assert.equal(providerCustomerCreates,1);assert.equal(customerId,null);
});
await check('two checkout attempts reuse one settled customer and preserve the binding winner',async()=>{
 const op=await createUnboundCustomer();fault='';const responses=await Promise.all([checkout(request({})),checkout(request({}))]);const data=await Promise.all(responses.map(r=>r.json()));
 assert.ok(data.some(d=>typeof d.url==='string'));assert.equal(providerCustomerCreates,1);assert.equal(customerId,'cus_Created');assert.equal(op.customer_binding_state,'bound');
 assert.ok(providerBodies.filter(form=>form.has('customer')).every(form=>form.get('customer')==='cus_Created'));
 assert.ok((await(await checkout(request({}))).json()).url);assert.equal(providerCustomerCreates,1);
});
await check('a different authoritative binding winner is verified and used without creating a customer',async()=>{
 const op=await createUnboundCustomer();fault='';providerCustomers.set('cus_Winner',{id:'cus_Winner',object:'customer',livemode:false});
 afterCustomerRead=()=>{customerId='cus_Winner';registerCustomer(customerId);};const response=await checkout(request({}));assert.ok((await response.json()).url);
 assert.equal(customerId,'cus_Winner');assert.equal(providerCustomerCreates,1);assert.equal(op.customer_binding_state,'available');assert.equal(providerBodies.at(-1)!.get('customer'),'cus_Winner');assert.ok(called('GET /v1/customers/cus_Winner'));
});
await check('exact deleted candidate is retired before a replacement customer can be created',async()=>{
 const op=await createUnboundCustomer();fault='';providerCustomers.set('cus_Created',{id:'cus_Created',object:'customer',deleted:true});
 const response=await checkout(request({}));assert.ok((await response.json()).url);assert.equal(op.customer_binding_state,'retired');assert.equal(providerCustomerCreates,2);assert.equal(customerId,'cus_Created2');
 assert.ok(calls.findIndex(c=>c.includes('retire_reusable_billing_customer'))<calls.lastIndexOf('POST /v1/customers'));assert.equal(providerBodies.at(-1)!.get('customer'),'cus_Created2');
});
await check('candidate 404 is not retirement proof and retries keep the original customer',async()=>{
 const op=await createUnboundCustomer();fault='candidate-404';await noUrl(await checkout(request({})));assert.equal(called('retire_reusable_billing_customer'),false);assert.equal(providerCustomerCreates,1);assert.equal(providerCreates,1);assert.equal(op.customer_binding_state,'available');
 fault='';assert.ok((await(await checkout(request({}))).json()).url);assert.equal(providerCustomerCreates,1);assert.equal(customerId,'cus_Created');
});
await check('a wrong customer tombstone cannot retire the available customer or permit another create',async()=>{
 const op=await createUnboundCustomer();fault='';providerCustomers.set('cus_Created',{id:'cus_Foreign',object:'customer',deleted:true});await noUrl(await checkout(request({})));
 assert.equal(called('retire_reusable_billing_customer'),false);assert.equal(op.customer_binding_state,'available');assert.equal(providerCustomerCreates,1);assert.equal(providerCreates,1);
});
await check('closure during candidate verification blocks binding and all later provider POSTs',async()=>{
 const op=await createUnboundCustomer();fault='';afterCustomerRead=()=>{billingClosing=true;};assert.equal((await noUrl(await checkout(request({})))).code,'account-closing');
 assert.equal(customerId,null);assert.equal(op.customer_binding_state,'available');assert.equal(providerCustomerCreates,1);assert.equal(providerCreates,1);
});
await check('candidate retirement losing a concurrent binding race never starts a replacement create',async()=>{
 const op=await createUnboundCustomer();fault='';providerCustomers.set('cus_Created',{id:'cus_Created',object:'customer',deleted:true});afterCustomerRead=()=>{customerId='cus_Created';op.customer_binding_state='bound';};
 await noUrl(await checkout(request({})));assert.equal(op.customer_binding_state,'bound');assert.equal(providerCustomerCreates,1);assert.equal(providerCreates,1);assert.ok(called('retire_reusable_billing_customer'));
});
await check('a previously bound customer is not reused after its binding is cleared',async()=>{
 const op=await createUnboundCustomer();fault='';op.customer_binding_state='bound';everBound.add('cus_Created');
 assert.ok((await(await checkout(request({}))).json()).url);assert.equal(providerCustomerCreates,2);assert.equal(customerId,'cus_Created2');assert.equal(op.customer_binding_state,'bound');
});
await check('a permanent seen-binding fact defeats an apparently available customer receipt',async()=>{
 const op=await createUnboundCustomer();fault='';everBound.add('cus_Created');await noUrl(await checkout(request({})));
 assert.equal(providerCustomerCreates,1);assert.equal(providerCreates,1);assert.equal(op.customer_binding_state,'available');assert.equal(customerId,null);
});
for(const [label,endpoint] of [['checkout',checkout],['portal',portal]] as const)for(const marker of ['false','true',null,0])await check(`${label} malformed deleted marker ${JSON.stringify(marker)} never clears billing or creates`,async()=>{
 reset();customerId='cus_Known';providerCustomers.set(customerId,{id:customerId,object:'customer',livemode:false,deleted:marker});
 await noUrl(await endpoint(request({})));assert.equal(customerId,'cus_Known');assert.equal(providerCreates,0);assert.equal(operations.size,0);assert.equal(called('rotate_billing_customer'),false);assert.equal(called('retire_reusable_billing_customer'),false);
});
for(const route of ['legacy-clear','fresh-create'])for(const proof of ['live','wrong-mode','deleted','404'])await check(`${route} stale different winner ${proof} must be verified before checkout creation`,async()=>{
 reset();if(route==='legacy-clear'){customerId='cus_Legacy';providerCustomers.set(customerId,{id:customerId,object:'customer',deleted:true});}
 const winner='cus_Winner';providerCustomers.set(winner,{id:winner,object:'customer',livemode:proof==='wrong-mode',...(proof==='deleted'?{deleted:true}:{})});if(proof==='404')missingProviderCustomers.add(winner);
 beforeCustomerRotate=()=>{customerId=winner;registerCustomer(winner);everBound.add(winner);};
 const response=await checkout(request({}));assert.equal(customerId,winner);assert.ok(called('GET /v1/customers/cus_Winner'));assert.equal(providerCustomerCreates,route==='fresh-create'?1:0);
 if(proof==='live'){
   assert.equal(response.status,200);assert.ok((await response.json()).url);assert.equal(providerBodies.at(-1)!.get('customer'),winner);
   assert.ok(calls.indexOf('GET /v1/customers/cus_Winner')<calls.indexOf('POST /v1/checkout/sessions'));assert.equal(providerCreates,route==='fresh-create'?2:1);
 }else{
   await noUrl(response);assert.equal(called('POST /v1/checkout/sessions'),false);assert.equal(providerCreates,route==='fresh-create'?1:0);
 }
});
await check('reusable candidate malformed deletion marker cannot bind retire or start checkout',async()=>{
 const op=await createUnboundCustomer();fault='';providerCustomers.set('cus_Created',{...providerCustomers.get('cus_Created'),deleted:'false'});const rotations=calls.filter(c=>c.includes('rotate_billing_customer')).length;
 await noUrl(await checkout(request({})));assert.equal(customerId,null);assert.equal(op.customer_binding_state,'available');assert.equal(providerCreates,1);assert.equal(called('retire_reusable_billing_customer'),false);assert.equal(calls.filter(c=>c.includes('rotate_billing_customer')).length,rotations);
});
console.log(`PASS ${checks-storageChecks} actual billing Edge endpoint checks; pinned SDK synthetic HTTP only`);
