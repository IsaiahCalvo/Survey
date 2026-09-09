const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{64}$/;
const uuid = v => typeof v === 'string' && UUID.test(v);
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const failure = (code = 'DOCUMENT_DOWNLOAD_PROTOCOL') => Object.assign(
  new Error('The complete PDF download was not confirmed. Your saved work was kept.'), { code });
const check = (v, code) => { if (!v) throw failure(code); };
const allowed = new Set(['DOCUMENT_DOWNLOAD_INPUT', 'DOCUMENT_DOWNLOAD_PROTOCOL', 'DOCUMENT_DOWNLOAD_LIMIT',
  'DOCUMENT_DOWNLOAD_ABORTED', 'DOCUMENT_DOWNLOAD_ACTOR_CHANGED', 'DOCUMENT_DOWNLOAD_BYTES',
  '42501', '40001', '55P03', '23514', 'SG001', 'SG002']);
function cancel(stream) { try { void stream?.cancel().catch(() => {}); } catch { /* already locked or closed */ } }
function size(v) {
  check(typeof v === 'string' && /^[1-9][0-9]{0,18}$/.test(v), 'DOCUMENT_DOWNLOAD_INPUT');
  const n = BigInt(v); check(n <= 9223372036854775807n, 'DOCUMENT_DOWNLOAD_INPUT'); return n;
}

/** Download adapter for createDocumentGenerationReader. Configuration owns the
 * trusted Supabase origin; a document cannot choose a URL. The reader owns the
 * final content hash and generation check. This adapter bounds bytes, rejects
 * incomplete HTTP bodies, and never treats status200 alone as acceptance.
 * No cache, signed URL, legacy Storage fallback, or automatic retry.
 */
export function createDocumentGenerationDownload(deps) {
  check(object(deps), 'DOCUMENT_DOWNLOAD_INPUT');
  const { supabaseUrl, publicKey, getAccessToken, getActorUserId, fetch: fetcher = globalThis.fetch,
    allowLoopback = false, timeoutMs = 60000, maxBytes = 256 * 1024 * 1024 } = deps;
  check(typeof supabaseUrl === 'string' && typeof publicKey === 'string' && publicKey.length > 0 && publicKey.length <= 16384
    && !/[\r\n]/.test(publicKey) && [getAccessToken, getActorUserId, fetcher].every(f => typeof f === 'function')
    && Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 120000
    && Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= 1024 * 1024 * 1024, 'DOCUMENT_DOWNLOAD_INPUT');
  let url;
  try { url = new URL(supabaseUrl); } catch { throw failure('DOCUMENT_DOWNLOAD_INPUT'); }
  check(!url.username && !url.password && !url.search && !url.hash && url.pathname === '/'
    && (url.protocol === 'https:' || (allowLoopback === true && url.protocol === 'http:'
      && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))), 'DOCUMENT_DOWNLOAD_INPUT');
  const endpoint = new URL('/functions/v1/document-generation-download', url).href;
  return async (pdf, scope) => {
    check(object(pdf) && object(scope) && uuid(scope.actorUserId) && uuid(scope.documentId) && uuid(scope.pdfGenerationId)
      && Object.keys(pdf).sort().join('|') === 'bucket_id|byte_length|content_sha256|id|path|version'
      && pdf.bucket_id === 'documents' && uuid(pdf.id) && uuid(pdf.version) && typeof pdf.content_sha256 === 'string' && SHA.test(pdf.content_sha256)
      && typeof pdf.path === 'string' && pdf.path.length > 0 && pdf.path.length <= 2048
      && !/[\u0000-\u001f\u007f]/.test(pdf.path), 'DOCUMENT_DOWNLOAD_INPUT');
    const expected = size(pdf.byte_length); check(expected <= BigInt(maxBytes), 'DOCUMENT_DOWNLOAD_LIMIT');
    const { actorUserId, documentId, pdfGenerationId, signal } = scope;
    check(signal == null || (typeof signal.aborted === 'boolean' && typeof signal.addEventListener === 'function'
      && typeof signal.removeEventListener === 'function'), 'DOCUMENT_DOWNLOAD_INPUT');
    const body = JSON.stringify({ document_id: documentId, generation_id: pdfGenerationId, pdf: { ...pdf } });
    const controller = new AbortController(), abort = () => controller.abort();
    const deadline = performance.now() + timeoutMs, timer = setTimeout(abort, timeoutMs);
    signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
    const alive = () => {
      check(!controller.signal.aborted && performance.now() < deadline, 'DOCUMENT_DOWNLOAD_ABORTED');
      check(getActorUserId() === actorUserId, 'DOCUMENT_DOWNLOAD_ACTOR_CHANGED');
    };
    const call = (operation, dispose) => {
      alive();
      return new Promise((resolve, reject) => {
        let rejected = false;
        const onAbort = () => { rejected = true; reject(failure('DOCUMENT_DOWNLOAD_ABORTED')); };
        controller.signal.addEventListener('abort', onAbort, { once: true });
        Promise.resolve().then(() => { alive(); return operation(); }).then(value => {
          try { alive(); if (rejected) throw failure('DOCUMENT_DOWNLOAD_ABORTED'); resolve(value); }
          catch (e) { try { dispose?.(value); } catch { /* best-effort release */ } reject(e); }
        }, reject).finally(() => controller.signal.removeEventListener('abort', onAbort));
      });
    };
    let response, reader, complete = false;
    try {
      const token = await call(() => getAccessToken(actorUserId, controller.signal));
      check(typeof token === 'string' && token.length > 0 && token.length <= 16384 && !/\s/.test(token), 'DOCUMENT_DOWNLOAD_INPUT');
      response = await call(() => fetcher(endpoint, { method: 'POST',
        headers: { Authorization: `Bearer ${token}`, apikey: publicKey, 'Content-Type': 'application/json' },
        body, signal: controller.signal, redirect: 'error', credentials: 'omit', cache: 'no-store' }), r => cancel(r?.body));
      check(response && typeof response.status === 'number' && typeof response.headers?.get === 'function'
        && typeof response.body?.getReader === 'function');
      if (response.status !== 200) {
        // Do not echo server messages, URLs or SQL diagnostics. A bounded JSON
        // error may carry a known database code, never arbitrary text.
        reader = response.body.getReader(); const bytes = new Uint8Array(8192); let count = 0;
        for (;;) {
          const part = await call(() => reader.read()); if (part.done) break;
          check(part.value instanceof Uint8Array); check(count + part.value.length <= bytes.length);
          bytes.set(part.value, count); count += part.value.length;
        }
        let code;
        try { code = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, count)))?.error?.code; } catch { /* safe generic failure */ }
        throw failure(allowed.has(code) ? code : undefined);
      }
      check(response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() === 'application/pdf');
      const declared = response.headers.get('Content-Length');
      if (declared !== null) check(/^[0-9]+$/.test(declared) && BigInt(declared) === expected, 'DOCUMENT_DOWNLOAD_BYTES');
      reader = response.body.getReader(); const chunks = []; let count = 0n;
      const block = new Uint8Array(Math.min(65536, Number(expected))); let filled = 0;
      for (;;) {
        const part = await call(() => reader.read()); if (part.done) break;
        check(part.value instanceof Uint8Array); count += BigInt(part.value.length);
        check(count <= expected && count <= BigInt(maxBytes), 'DOCUMENT_DOWNLOAD_BYTES');
        // Coalesce into fixed-size owned blocks. Empty/tiny transport chunks
        // must not create an unbounded number of retained Blob/array entries.
        for (let offset = 0; offset < part.value.length;) {
          const length = Math.min(block.length - filled, part.value.length - offset);
          block.set(part.value.subarray(offset, offset + length), filled);
          offset += length; filled += length;
          if (filled === block.length) { chunks.push(new Blob([block])); filled = 0; }
        }
      }
      check(count === expected, 'DOCUMENT_DOWNLOAD_BYTES'); alive();
      if (filled) chunks.push(new Blob([block.subarray(0, filled)]));
      const blob = new Blob(chunks, { type: 'application/pdf' });
      check(BigInt(blob.size) === expected, 'DOCUMENT_DOWNLOAD_BYTES');
      alive();
      complete = true; return blob;
    } catch (caught) {
      throw failure(allowed.has(caught?.code) ? caught.code : undefined);
    } finally {
      controller.abort(); clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (reader) {
        if (!complete) { try { void reader.cancel().catch(() => {}); } catch { /* pending read */ } }
        try { reader.releaseLock(); } catch { /* pending read settles later */ }
      } else cancel(response?.body);
    }
  };
}
