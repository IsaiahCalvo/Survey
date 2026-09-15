import { createHash } from 'node:crypto';
import { encodeSourceObjectPath } from '../document-generation-source-bytes/handler.js';

const CORS = Object.freeze({ 'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS' });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{64}$/;
const PDF = ['bucket_id', 'path', 'id', 'version', 'byte_length', 'content_sha256'];
const PUBLICATION = ['operation_id', 'generation_id', 'published_at', 'wal_head'];
const LEGACY_RECEIPT = ['version', 'actor_user_id', 'document_id', 'generation_id', 'source_generation_id', 'archive'];
const LEGACY_ARCHIVE = ['kind', 'bucket_id', 'path', 'id', 'version', 'byte_length', 'content_sha256', 'source_object'];
const SOURCE_OBJECT = ['bucket_id', 'path', 'id', 'version', 'byte_length'];
const ADOPTION_RECEIPT = ['version','state','actor_user_id','document_id','generation_id','adoption_operation_id','objects'];
const ADOPTION_ARCHIVE = ['kind','bucket_id','path','id','version','byte_length','content_sha256','source_object'];
const ADOPTION_SOURCE = ['kind','bucket_id','path','id','version','byte_length','content_sha256','owner_id'];
const LEGACY_SIDECAR_MAX_BYTES = 16 * 1024 * 1024;
const fail = code => Object.assign(new Error(code), { code });
const check = (value, code = 'invalid_manifest') => { if (!value) throw fail(code); };
const uuid = value => typeof value === 'string' && UUID.test(value);
const size = value => typeof value === 'string' && /^[1-9][0-9]{0,18}$/.test(value)
  && BigInt(value) <= 9223372036854775807n;
const sequence = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,18})$/.test(value)
  && BigInt(value) <= 9223372036854775807n;
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
const same = (a, b, keys) => keys.every(key => a[key] === b[key]);
const pick = (value, keys) => Object.fromEntries(keys.map(key => [key, value[key]]));
const streamError = () => new Error('Document download did not complete verification.');
const ERRORS = Object.freeze({
  invalid_request: [400, 'Invalid document download request.'],
  unauthorized: [401, 'Sign in again before downloading.'],
  unavailable: [503, 'Checked generation downloads are not enabled.'],
  download_timeout: [503, 'The checked download did not finish in time.'],
  download_canceled: [503, 'The checked download was interrupted.'],
  invalid_manifest: [502, 'The server did not confirm this document generation.'],
  invalid_object: [502, 'The complete document stream is not available.'],
  descriptor_mismatch: [409, 'The current PDF differs from the requested PDF.'],
  byte_mismatch: [409, 'The document bytes did not match this generation.'],
  size_limit: [413, 'This document exceeds the checked download limit.'],
  download_failed: [502, 'The checked download could not be completed.'],
  '42501': [403, 'This document download is not permitted.'],
  '40001': [409, 'This document is busy or changed. Load it before retrying.'],
  '55P03': [409, 'This document is busy. Retry after it is available.'],
  '23514': [409, 'This document generation is no longer available.'],
  '54000': [413, 'This document exceeds the checked download limit.'],
  SG001: [409, 'The document generation changed. Load the current document.'],
  SG002: [409, 'The document generation changed. Load the current document.'],
});
const json = (status, body) => new Response(JSON.stringify(body), { status,
  headers: { ...CORS, 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
function pdfDescriptor(pdf, code) {
  check(exactKeys(pdf, PDF) && pdf.bucket_id === 'documents' && typeof pdf.path === 'string'
    && pdf.path.length > 0 && pdf.path.length <= 2048 && !/[\u0000-\u001f\u007f]/.test(pdf.path)
    && uuid(pdf.id) && uuid(pdf.version)
    && size(pdf.byte_length) && typeof pdf.content_sha256 === 'string' && SHA.test(pdf.content_sha256), code);
  try { encodeSourceObjectPath(pdf.path); } catch { throw fail(code); }
  return pdf;
}
function manifest(value, actor, body) {
  check(value?.version === 1 && value.actor_user_id === actor && value.document_id === body.document_id
    && value.generation_id === body.generation_id);
  const pdf = pdfDescriptor(value.pdf, 'invalid_manifest');
  check(value.document?.id === body.document_id && value.document.file_path === pdf.path
    && value.document.file_size === pdf.byte_length);
  const publication = value.publication;
  check(publication && uuid(publication.operation_id) && publication.generation_id === body.generation_id
    && typeof publication.published_at === 'string' && Number.isFinite(Date.parse(publication.published_at))
    && sequence(publication.wal_head));
  // Copy checked identities. A dependency retaining/mutating its own result
  // cannot alter the values to which this response is bound.
  return { pdf: Object.freeze(pick(pdf, PDF)), publication: Object.freeze(pick(publication, PUBLICATION)) };
}
function legacySidecarReceipt(value, actor, body) {
  check(exactKeys(value, LEGACY_RECEIPT) && value.version === 1
    && value.actor_user_id === actor && value.document_id === body.document_id
    && value.generation_id === body.generation_id && uuid(value.source_generation_id));
  const archive = value.archive;
  check(exactKeys(archive, LEGACY_ARCHIVE) && archive.kind === 'sidecar'
    && archive.bucket_id === 'documents' && typeof archive.path === 'string'
    && archive.path.length > 0 && archive.path.length <= 2048
    && !/[\u0000-\u001f\u007f]/.test(archive.path) && uuid(archive.id) && uuid(archive.version)
    && size(archive.byte_length) && typeof archive.content_sha256 === 'string'
    && SHA.test(archive.content_sha256));
  try { encodeSourceObjectPath(archive.path); } catch { throw fail('invalid_manifest'); }
  const source = archive.source_object;
  check(exactKeys(source, SOURCE_OBJECT) && source.bucket_id === 'documents'
    && typeof source.path === 'string' && source.path.length > 0 && source.path.length <= 2048
    && !/[\u0000-\u001f\u007f]/.test(source.path) && uuid(source.id) && uuid(source.version)
    && size(source.byte_length));
  try { encodeSourceObjectPath(source.path); } catch { throw fail('invalid_manifest'); }
  return Object.freeze({
    version: 1,
    actor_user_id: value.actor_user_id,
    document_id: value.document_id,
    generation_id: value.generation_id,
    source_generation_id: value.source_generation_id,
    archive: Object.freeze({ ...pick(archive, LEGACY_ARCHIVE), source_object: Object.freeze(pick(source, SOURCE_OBJECT)) }),
  });
}
function sameLegacySidecarReceipt(a, b) {
  return same(a, b, LEGACY_RECEIPT.filter(key => key !== 'archive'))
    && same(a.archive, b.archive, LEGACY_ARCHIVE.filter(key => key !== 'source_object'))
    && same(a.archive.source_object, b.archive.source_object, SOURCE_OBJECT);
}
function legacyAdoptionReceipt(value, actor, body) {
  check(exactKeys(value, ADOPTION_RECEIPT) && value.version === 1 && value.state === 'available'
    && value.actor_user_id === actor && value.document_id === body.document_id
    && value.generation_id === body.generation_id && uuid(value.adoption_operation_id)
    && Array.isArray(value.objects) && [1, 2].includes(value.objects.length));
  const objects = value.objects.map((archive, index) => {
    const kind = index === 0 ? 'pdf' : 'sidecar';
    check(exactKeys(archive, ADOPTION_ARCHIVE) && archive.kind === kind
      && archive.bucket_id === 'documents' && typeof archive.path === 'string'
      && archive.path.length > 0 && archive.path.length <= 2048
      && !/[\u0000-\u001f\u007f]/.test(archive.path) && uuid(archive.id) && uuid(archive.version)
      && size(archive.byte_length) && SHA.test(archive.content_sha256));
    try { encodeSourceObjectPath(archive.path); } catch { throw fail('invalid_manifest'); }
    const source = archive.source_object;
    check(exactKeys(source, ADOPTION_SOURCE) && source.kind === kind && source.bucket_id === 'documents'
      && typeof source.path === 'string' && source.path.length > 0 && source.path.length <= 2048
      && !/[\u0000-\u001f\u007f]/.test(source.path) && uuid(source.id) && uuid(source.version)
      && size(source.byte_length) && SHA.test(source.content_sha256) && uuid(source.owner_id)
      && source.byte_length === archive.byte_length && source.content_sha256 === archive.content_sha256);
    try { encodeSourceObjectPath(source.path); } catch { throw fail('invalid_manifest'); }
    return Object.freeze({ ...pick(archive, ADOPTION_ARCHIVE),
      source_object: Object.freeze(pick(source, ADOPTION_SOURCE)) });
  });
  if (Object.hasOwn(body, 'adoption_operation_id')) check(body.adoption_operation_id === value.adoption_operation_id);
  return Object.freeze({ version:1,state:'available',actor_user_id:actor,document_id:value.document_id,
    generation_id:value.generation_id,adoption_operation_id:value.adoption_operation_id,
    objects:Object.freeze(objects) });
}
function sameLegacyAdoptionReceipt(a,b) {
  return same(a,b,ADOPTION_RECEIPT.filter(key=>key!=='objects')) && a.objects.length===b.objects.length
    && a.objects.every((item,index)=>same(item,b.objects[index],ADOPTION_ARCHIVE.filter(key=>key!=='source_object'))
      && same(item.source_object,b.objects[index].source_object,ADOPTION_SOURCE));
}
const publicLegacyAdoptionReceipt = receipt => ({ version:2,state:'available',document_id:receipt.document_id,
  generation_id:receipt.generation_id,adoption_operation_id:receipt.adoption_operation_id,
  objects:receipt.objects.map(({kind,byte_length,content_sha256})=>({kind,byte_length,content_sha256})) });
function discardReader(reader) {
  if (!reader) return;
  try { void Promise.resolve(reader.cancel()).catch(() => {}); } catch { /* already ended */ }
  try { reader.releaseLock(); } catch { /* provider does not permit release */ }
}
function discardStream(stream) {
  try { void Promise.resolve(stream?.cancel()).catch(() => {}); } catch { /* already ended */ }
}
async function input(request, call) {
  const reader = request.body?.getReader();
  check(reader, 'invalid_request');
  const bytes = new Uint8Array(16384); let length = 0;
  try {
    for (;;) {
      const { value, done } = await call(() => reader.read());
      if (done) break;
      check(value instanceof Uint8Array, 'invalid_request');
      check(length + value.byteLength <= bytes.byteLength, 'invalid_request');
      bytes.set(value, length); length += value.byteLength;
    }
  } finally { discardReader(reader); }
  let body;
  try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, length))); }
  catch { throw fail('invalid_request'); }
  if (exactKeys(body, ['action', 'document_id', 'generation_id'])) {
    check(['legacy-sidecar-recovery','legacy-adoption-archive-status'].includes(body.action) && uuid(body.document_id)
      && uuid(body.generation_id), 'invalid_request');
    return body;
  }
  if (exactKeys(body,['action','document_id','generation_id','adoption_operation_id','kind'])) {
    check(body.action==='legacy-adoption-archive-download' && uuid(body.document_id)
      && uuid(body.generation_id) && uuid(body.adoption_operation_id)
      && ['pdf','sidecar'].includes(body.kind),'invalid_request');return body;
  }
  check(exactKeys(body, ['document_id', 'generation_id', 'pdf'])
    && uuid(body.document_id) && uuid(body.generation_id), 'invalid_request');
  pdfDescriptor(body.pdf, 'invalid_request');
  return body;
}

/** Read-only, disabled by default. A 200 is NOT proof: the final byte and EOF
 * are withheld until the complete SHA-256 and a second authorized SQL read
 * confirm the same current PDF/publication. Callers must read/hash all bytes.
 * No payload aggregation, signed URL, or metadata-only checksum acceptance. */
export async function handleDocumentGenerationDownload(request, deps = {}) {
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
  if (request.method !== 'POST') return json(405, { error: { code: 'method_not_allowed' } });
  const controller = new AbortController();
  const signal = controller.signal;
  const timeoutMs = Number.isFinite(deps.timeoutMs) ? Math.max(1, Math.min(110000, deps.timeoutMs)) : 110000;
  const maxBytes = Number.isSafeInteger(deps.maxBytes) && deps.maxBytes > 0
    ? Math.min(268435456, deps.maxBytes) : 268435456;
  const deadline = performance.now() + timeoutMs;
  let finished = false, stopped = null, providerReader = null, hash = null, output = null;
  let rejectStop;
  const stopPromise = new Promise((_, reject) => { rejectStop = reject; });
  // A cancellation can arrive while nobody is waiting on a dependency.
  void stopPromise.catch(() => {});
  const cleanup = () => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    request.signal.removeEventListener('abort', onAbort);
    const reader = providerReader; providerReader = null; discardReader(reader);
    const digest = hash; hash = null; digest?.destroy();
  };
  const stop = code => {
    if (finished) return;
    stopped = fail(code);
    controller.abort();
    rejectStop(stopped);
    if (output) { try { output.error(streamError()); } catch { /* consumer already canceled */ } }
    cleanup();
  };
  const alive = () => {
    if (!finished && performance.now() >= deadline) stop('download_timeout');
    if (stopped) throw stopped;
    check(!finished, 'download_canceled');
  };
  const call = async operation => {
    alive();
    const value = await Promise.race([Promise.resolve().then(() => { alive(); return operation(); }), stopPromise]);
    alive();
    return value;
  };
  const onAbort = () => stop('download_canceled');
  const timer = setTimeout(() => stop('download_timeout'), timeoutMs);
  request.signal.addEventListener('abort', onAbort, { once: true });
  if (request.signal.aborted) onAbort();
  try {
    alive();
    check(deps.enabled === true, 'unavailable');
    const token = request.headers.get('Authorization')?.match(/^Bearer ([^\s]+)$/i)?.[1];
    check(token && token.length <= 16384, 'unauthorized');
    const actor = (await call(() => deps.getUser(token, signal)))?.id;
    check(uuid(actor), 'unauthorized');
    const body = await input(request, call);
    if (body.action === 'legacy-adoption-archive-status') {
      const receipt = legacyAdoptionReceipt(await call(() => deps.readLegacyAdoption(
        token, actor, body.document_id, body.generation_id, signal)), actor, body);
      cleanup();return json(200,publicLegacyAdoptionReceipt(receipt));
    }
    if (body.action === 'legacy-adoption-archive-download') {
      const initial = legacyAdoptionReceipt(await call(() => deps.readLegacyAdoption(
        token, actor, body.document_id, body.generation_id, signal)), actor, body);
      const archive = initial.objects.find(value=>value.kind===body.kind);
      check(archive,'invalid_request');
      const expected=BigInt(archive.byte_length),limit=body.kind==='pdf'?BigInt(maxBytes):BigInt(LEGACY_SIDECAR_MAX_BYTES);
      check(expected<=limit,'size_limit');
      await call(async()=>{const stream=await deps.openStream(archive,signal);try{alive();}catch(error){discardStream(stream);throw error;}
        check(typeof stream?.getReader==='function','invalid_object');providerReader=stream.getReader();});
      hash=createHash('sha256');const chunks=[];let count=0;
      for(;;){const {value,done}=await call(()=>providerReader.read());if(done)break;check(value instanceof Uint8Array,'invalid_object');
        if(value.byteLength===0)continue;check(BigInt(count+value.byteLength)<=expected,'byte_mismatch');const chunk=new Uint8Array(value);
        chunks.push(chunk);count+=chunk.byteLength;hash.update(chunk);}
      check(BigInt(count)===expected&&hash.digest('hex')===archive.content_sha256,'byte_mismatch');
      const bytes=new Uint8Array(count);let offset=0;for(const chunk of chunks){bytes.set(chunk,offset);offset+=chunk.byteLength;}
      if(body.kind==='sidecar')try{JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes));}catch{throw fail('invalid_object');}
      const final=legacyAdoptionReceipt(await call(()=>deps.readLegacyAdoption(
        token,actor,body.document_id,body.generation_id,signal)),actor,body);
      check(sameLegacyAdoptionReceipt(initial,final),'descriptor_mismatch');alive();cleanup();
      return new Response(bytes,{status:200,headers:{...CORS,'Content-Type':body.kind==='pdf'?'application/pdf':'application/json',
        'Cache-Control':'private, no-store, no-transform','X-Content-Type-Options':'nosniff'}});
    }
    if (body.action === 'legacy-sidecar-recovery') {
      const initial = legacySidecarReceipt(await call(() => deps.readLegacySidecar(
        token, body.document_id, body.generation_id, signal)), actor, body);
      const expected = BigInt(initial.archive.byte_length);
      check(expected <= BigInt(LEGACY_SIDECAR_MAX_BYTES), 'size_limit');
      await call(async () => {
        const stream = await deps.openStream(initial.archive, signal);
        try { alive(); } catch (error) { discardStream(stream); throw error; }
        check(typeof stream?.getReader === 'function', 'invalid_object');
        providerReader = stream.getReader();
      });
      hash = createHash('sha256');
      const chunks = [];
      let count = 0;
      for (;;) {
        const { value, done } = await call(() => providerReader.read());
        if (done) break;
        check(value instanceof Uint8Array, 'invalid_object');
        if (value.byteLength === 0) continue;
        check(count + value.byteLength <= Number(expected), 'byte_mismatch');
        const chunk = new Uint8Array(value);
        chunks.push(chunk);
        count += chunk.byteLength;
        hash.update(chunk);
      }
      check(BigInt(count) === expected && hash.digest('hex') === initial.archive.content_sha256, 'byte_mismatch');
      const bytes = new Uint8Array(count);
      let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
      try { JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
      catch { throw fail('invalid_object'); }
      const final = legacySidecarReceipt(await call(() => deps.readLegacySidecar(
        token, body.document_id, body.generation_id, signal)), actor, body);
      check(sameLegacySidecarReceipt(initial, final), 'descriptor_mismatch');
      alive();
      cleanup();
      return new Response(bytes, { status: 200, headers: { ...CORS, 'Content-Type': 'application/json',
        'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
    }
    const initial = manifest(await call(() => deps.readOpen(token, body.document_id, body.generation_id, signal)), actor, body);
    check(same(body.pdf, initial.pdf, PDF), 'descriptor_mismatch');
    const expected = BigInt(initial.pdf.byte_length);
    check(expected <= BigInt(maxBytes), 'size_limit');
    await call(async () => {
      const stream = await deps.openStream(initial.pdf, signal);
      // The provider may ignore AbortSignal and resolve after our deadline.
      // Its late stream still belongs to us and must not remain open.
      try { alive(); } catch (error) { discardStream(stream); throw error; }
      check(typeof stream?.getReader === 'function', 'invalid_object');
      providerReader = stream.getReader();
    });
    hash = createHash('sha256');
    let count = 0n, lastByte = null;
    const stream = new ReadableStream({
      start(streamController) { output = streamController; },
      async pull(streamController) {
        try {
          for (;;) {
            alive();
            const { value, done } = await call(() => providerReader.read());
            if (done) {
              check(count === expected && lastByte !== null, 'byte_mismatch');
              check(hash.digest('hex') === initial.pdf.content_sha256, 'byte_mismatch');
              const final = manifest(await call(() => deps.readOpen(token, body.document_id, body.generation_id, signal)), actor, body);
              check(same(initial.pdf, final.pdf, PDF) && same(initial.publication, final.publication, PUBLICATION), 'descriptor_mismatch');
              alive();
              streamController.enqueue(Uint8Array.of(lastByte));
              streamController.close();
              cleanup();
              return;
            }
            check(value instanceof Uint8Array, 'invalid_object');
            count += BigInt(value.byteLength);
            check(count <= expected && count <= BigInt(maxBytes), 'byte_mismatch');
            if (value.byteLength === 0) continue;
            // Hash and send the same owned bytes. A provider may reuse its
            // input buffer after read() resolves (Buffer.slice is not a copy).
            const chunk = new Uint8Array(value);
            hash.update(chunk);
            if (count === expected) {
              lastByte = chunk[chunk.byteLength - 1];
              if (chunk.byteLength === 1) continue;
              streamController.enqueue(chunk.subarray(0, chunk.byteLength - 1));
            } else {
              streamController.enqueue(chunk);
            }
            return;
          }
        } catch {
          stop('download_failed');
        }
      },
      cancel() { stop('download_canceled'); },
    }, { highWaterMark: 0 });
    return new Response(stream, { status: 200, headers: { ...CORS, 'Content-Type': 'application/pdf',
      'Cache-Control': 'private, no-store, no-transform', 'X-Content-Type-Options': 'nosniff' } });
  } catch (error) {
    const code = Object.hasOwn(ERRORS, error?.code) ? error.code : 'download_failed';
    const [status, message] = ERRORS[code];
    // Abort remaining provider work even on an ordinary pre-response error.
    stop(code);
    return json(status, { error: { code, message } });
  }
}
