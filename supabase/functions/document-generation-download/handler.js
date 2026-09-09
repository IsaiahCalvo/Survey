import { createHash } from 'node:crypto';
import { encodeSourceObjectPath } from '../document-generation-source-bytes/handler.js';

const CORS = Object.freeze({ 'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
  'Access-Control-Allow-Methods': 'POST, OPTIONS' });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{64}$/;
const PDF = ['bucket_id', 'path', 'id', 'version', 'byte_length', 'content_sha256'];
const PUBLICATION = ['operation_id', 'generation_id', 'published_at', 'wal_head'];
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
  check(exactKeys(body, ['document_id', 'generation_id', 'pdf']) && uuid(body.document_id)
    && uuid(body.generation_id), 'invalid_request');
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
