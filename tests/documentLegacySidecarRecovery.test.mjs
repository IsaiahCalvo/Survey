import test from 'node:test';
import assert from 'node:assert/strict';
import { createDocumentLegacyAdoptionArchiveRecovery,
  createDocumentLegacySidecarRecovery } from '../src/services/documentLegacySidecarRecovery.js';

const id = n => `ab000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const actor = id(1), documentId = id(2), generation = id(3), sourceGeneration = id(4);
const raw = JSON.stringify({ version:1,entities:[{ id:'old-private-choice' }],zoomLevel:1.25 });

function harness() {
  const callbacks = new Set(), calls = [], fetches = [];
  let current = true, sessionActor = actor;
  const archive = { kind:'sidecar',bucket_id:'documents',path:'retained/private.bin',id:id(5),version:id(6),
    byte_length:String(Buffer.byteLength(raw)),content_sha256:'a'.repeat(64),
    source_object:{ bucket_id:'documents',path:`project/${documentId}_data.json`,id:id(7),version:id(8),
      byte_length:String(Buffer.byteLength(raw)) } };
  const receipt = { version:1,actor_user_id:actor,document_id:documentId,generation_id:generation,
    source_generation_id:sourceGeneration,archive };
  const client = {
    auth:{
      getSession:async () => ({ data:{ session:{ user:{ id:sessionActor },access_token:'test-token' } } }),
      onAuthStateChange(callback) { callbacks.add(callback); return { data:{ subscription:{
        unsubscribe:() => callbacks.delete(callback),
      } } }; },
    },
    rpc(name, params) {
      const call = { name,params,header:null,signal:null }; calls.push(call);
      return { setHeader(key, value) { call.header = [key,value]; return this; },
        abortSignal(signal) { call.signal = signal; return Promise.resolve({ data:structuredClone(receipt) }); } };
    },
  };
  const fetch = async (url, options) => {
    fetches.push({ url,options });
    return new Response(raw, { status:200,headers:{ 'Content-Type':'application/json',
      'Content-Length':String(Buffer.byteLength(raw)),'Cache-Control':'private, no-store' } });
  };
  const recovery = createDocumentLegacySidecarRecovery({ client,actorUserId:actor,
    isCurrent:scope => current && scope.actorUserId === actor,fetch,
    supabaseUrl:'https://example.supabase.co/',publicKey:'public-test-key' });
  return { recovery,receipt,calls,fetches,callbacks,
    setCurrent:value => { current = value; },setSessionActor:value => { sessionActor = value; } };
}

test('owner export proves the exact archive then returns owned JSON without exposing its path', async () => {
  const h = harness();
  const result = await h.recovery.download({ documentId,pdfGenerationId:generation });
  assert.deepEqual(Object.keys(result).sort(),
    ['version','actorUserId','documentId','pdfGenerationId','blob'].sort());
  assert.equal(await result.blob.text(), raw);
  assert.equal(result.blob.type, 'application/json');
  assert.equal(h.calls.length, 1);
  assert.deepEqual(h.calls[0].params, { p_document_id:documentId,p_generation_id:generation });
  assert.deepEqual(h.calls[0].header, ['Authorization','Bearer test-token']);
  assert.equal(h.fetches.length, 1);
  assert.deepEqual(JSON.parse(h.fetches[0].options.body), {
    action:'legacy-sidecar-recovery',document_id:documentId,generation_id:generation,
  });
  assert.equal(h.fetches[0].options.credentials, 'omit');
  assert.equal(h.fetches[0].options.cache, 'no-store');
  assert.equal(h.callbacks.size, 0);
});

test('wrong owner, stale view, abort, or malformed proof surfaces no bytes', async () => {
  for (const mode of ['owner','stale','abort','proof']) {
    const h = harness();
    let signal;
    if (mode === 'owner') h.setSessionActor(id(90));
    if (mode === 'stale') h.setCurrent(false);
    if (mode === 'abort') { const controller = new AbortController(); controller.abort(); signal = controller.signal; }
    if (mode === 'proof') h.receipt.archive.source_object.path = 'project/wrong_data.json';
    await assert.rejects(h.recovery.download({ documentId,pdfGenerationId:generation,signal }), error =>
      /^LEGACY_SIDECAR_RECOVERY_|42501/.test(error.code));
    assert.equal(h.fetches.length, 0);
    assert.equal(h.callbacks.size, 0);
  }
});

test('actor retirement while the archive request is pending returns no raw JSON', async () => {
  const h = harness();
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  h.recovery = createDocumentLegacySidecarRecovery({ actorUserId:actor,
    isCurrent:() => true,supabaseUrl:'https://example.supabase.co/',publicKey:'key',
    fetch:async () => { await pending; return new Response(raw, { status:200,
      headers:{ 'Content-Type':'application/json','Content-Length':String(Buffer.byteLength(raw)),
        'Cache-Control':'no-store' } }); },
    client:{ auth:{ getSession:async () => ({ data:{ session:{ user:{ id:actor },access_token:'token' } } }),
      onAuthStateChange(callback) { h.callback = callback; return { data:{ subscription:{ unsubscribe() {} } } }; } },
      rpc() { return { setHeader() { return this; },abortSignal() { return Promise.resolve({ data:h.receipt }); } }; } },
  });
  const result = h.recovery.download({ documentId,pdfGenerationId:generation });
  while (!h.callback) await new Promise(resolve => setImmediate(resolve));
  h.callback('SIGNED_OUT', null); release();
  await assert.rejects(result, { code:'LEGACY_SIDECAR_RECOVERY_ACTOR_CHANGED' });
});

test('a cacheable download response never reaches Save As', async () => {
  const h = harness();
  const recovery = createDocumentLegacySidecarRecovery({ actorUserId:actor,
    isCurrent:() => true,supabaseUrl:'https://example.supabase.co/',publicKey:'key',
    fetch:async () => new Response(raw, { status:200,headers:{
      'Content-Type':'application/json','Content-Length':String(Buffer.byteLength(raw)),
      'Cache-Control':'private, max-age=60',
    } }),client:{ auth:{
      getSession:async () => ({ data:{ session:{ user:{ id:actor },access_token:'token' } } }),
      onAuthStateChange() { return { data:{ subscription:{ unsubscribe() {} } } }; },
    },rpc() { return { setHeader() { return this; },abortSignal() {
      return Promise.resolve({ data:h.receipt });
    } }; } } });
  await assert.rejects(recovery.download({ documentId,pdfGenerationId:generation }),
    { code:'LEGACY_SIDECAR_RECOVERY_PROTOCOL' });
});

test('legacy-origin status lists PDF and optional JSON, then download verifies exact bytes', async () => {
  const pdf = new Uint8Array([37,80,68,70,45,49,46,55,10]);
  const sidecar = new TextEncoder().encode(raw);
  const sha = async bytes => Buffer.from(await crypto.subtle.digest('SHA-256', bytes)).toString('hex');
  const adoptionOperationId = id(11);
  const objects = [{ kind:'pdf',byte_length:String(pdf.byteLength),
    content_sha256:await sha(pdf) },{ kind:'sidecar',byte_length:String(sidecar.byteLength),
    content_sha256:await sha(sidecar) }];
  const requests = [];
  const client = { auth:{
    getSession:async () => ({ data:{ session:{ user:{ id:actor },access_token:'token' } } }),
    onAuthStateChange() { return { data:{ subscription:{ unsubscribe() {} } } }; },
  } };
  const fetch = async (url, options) => {
    const body = JSON.parse(options.body); requests.push(body);
    if (body.action === 'legacy-adoption-archive-status') return new Response(JSON.stringify({
      version:2,state:'available',document_id:documentId,generation_id:generation,
      adoption_operation_id:adoptionOperationId,objects,
    }), { status:200,headers:{ 'Content-Type':'application/json','Cache-Control':'no-store' } });
    const bytes = body.kind === 'pdf' ? pdf : sidecar;
    return new Response(bytes, { status:200,headers:{
      'Content-Type':body.kind === 'pdf' ? 'application/pdf' : 'application/json',
      'Content-Length':String(bytes.byteLength),'Cache-Control':'no-store',
    } });
  };
  const recovery = createDocumentLegacyAdoptionArchiveRecovery({ client,actorUserId:actor,
    isCurrent:scope => scope.actorUserId === actor,fetch,
    supabaseUrl:'https://example.supabase.co/',publicKey:'key' });
  const status = await recovery.status({ documentId,pdfGenerationId:generation });
  assert.deepEqual(status.objects.map(item => item.kind), ['pdf','sidecar']);
  assert.equal(JSON.stringify(status).includes('path'), false);
  const result = await recovery.download({ documentId,pdfGenerationId:generation,
    adoptionOperationId,kind:'sidecar' });
  assert.equal(await result.blob.text(), raw);
  assert.deepEqual(requests, [
    { action:'legacy-adoption-archive-status',document_id:documentId,generation_id:generation },
    { action:'legacy-adoption-archive-status',document_id:documentId,generation_id:generation },
    { action:'legacy-adoption-archive-download',document_id:documentId,generation_id:generation,
      adoption_operation_id:adoptionOperationId,kind:'sidecar' },
  ]);
});

test('PDF-only legacy-origin status cannot request a sidecar and a bad hash exposes no blob', async () => {
  const pdf = new Uint8Array([37,80,68,70,45,49,46,55,10]);
  const adoptionOperationId = id(12), requests = [];
  const status = { version:2,state:'available',document_id:documentId,generation_id:generation,
    adoption_operation_id:adoptionOperationId,objects:[{ kind:'pdf',
      byte_length:String(pdf.byteLength),content_sha256:'a'.repeat(64) }] };
  const recovery = createDocumentLegacyAdoptionArchiveRecovery({ actorUserId:actor,
    isCurrent:() => true,supabaseUrl:'https://example.supabase.co/',publicKey:'key',
    client:{ auth:{ getSession:async () => ({ data:{ session:{ user:{ id:actor },access_token:'token' } } }),
      onAuthStateChange() { return { data:{ subscription:{ unsubscribe() {} } } }; } } },
    fetch:async (url, options) => {
      const body = JSON.parse(options.body); requests.push(body);
      if (body.action.endsWith('status')) return new Response(JSON.stringify(status), { status:200,
        headers:{ 'Content-Type':'application/json','Cache-Control':'no-store' } });
      return new Response(pdf, { status:200,headers:{ 'Content-Type':'application/pdf',
        'Content-Length':String(pdf.byteLength),'Cache-Control':'no-store' } });
    } });
  const found = await recovery.status({ documentId,pdfGenerationId:generation });
  assert.deepEqual(found.objects.map(item => item.kind), ['pdf']);
  await assert.rejects(recovery.download({ documentId,pdfGenerationId:generation,
    adoptionOperationId,kind:'sidecar' }), { code:'LEGACY_SIDECAR_RECOVERY_PROTOCOL' });
  assert.equal(requests.some(request => request.action.endsWith('download')), false);
  await assert.rejects(recovery.download({ documentId,pdfGenerationId:generation,
    adoptionOperationId,kind:'pdf' }), { code:'LEGACY_SIDECAR_RECOVERY_PROTOCOL' });
});
