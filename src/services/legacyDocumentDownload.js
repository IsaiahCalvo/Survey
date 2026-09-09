const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{64}$/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const failure = (code = 'DOCUMENT_OPEN_PROTOCOL') => Object.assign(
  new Error('The complete PDF could not be loaded. Your saved work was kept.'), { code });
const check = (value, code) => { if (!value) throw failure(code); };
const allowed = new Set(['DOCUMENT_OPEN_INPUT', 'DOCUMENT_OPEN_PROTOCOL', 'DOCUMENT_OPEN_LIMIT',
  'DOCUMENT_OPEN_ABORTED', 'DOCUMENT_OPEN_ACTOR_CHANGED', 'DOCUMENT_OPEN_BYTES']);
function cancel(stream) { try { void stream?.cancel().catch(() => {}); } catch { /* locked or already closed */ } }
function encodedPath(path) {
  check(typeof path === 'string' && path.length > 0 && path.length <= 2048
    && !/[\u0000-\u001f\u007f]/.test(path), 'DOCUMENT_OPEN_INPUT');
  try {
    const encoded = path.split('/').map(encodeURIComponent).join('/')
      .replace(/^\/+/, leading => encodeURIComponent(leading));
    const prefix = '/storage/v1/object/authenticated/documents/';
    const url = new URL(`https://object.invalid${prefix}${encoded}`);
    check(url.pathname.startsWith(prefix) && !url.search && !url.hash
      && decodeURIComponent(url.pathname.slice(prefix.length)) === path, 'DOCUMENT_OPEN_INPUT');
    return encoded;
  } catch { throw failure('DOCUMENT_OPEN_INPUT'); }
}

/** Legacy bytes only: descriptor must come from the orchestrator's fresh
 * authorized metadata SELECT, never a catalog row. No shared cache, signed URL,
 * automatic retry or fallback. The caller must recheck mode/metadata/access
 * after this returns. A missing hash gives only path/length checks: this does
 * NOT prove an immutable object version or detect every same-path overwrite.
 */
export function createLegacyDocumentDownload(deps) {
  check(object(deps), 'DOCUMENT_OPEN_INPUT');
  const { supabaseUrl, publicKey, getAccessToken, getActorUserId, fetch: fetcher = globalThis.fetch,
    allowLoopback = false, timeoutMs = 60000, maxBytes = 256 * 1024 * 1024 } = deps;
  check(typeof supabaseUrl === 'string' && typeof publicKey === 'string' && publicKey.length > 0
    && publicKey.length <= 16384 && !/[\s\u0000-\u001f\u007f]/.test(publicKey)
    && [getAccessToken, getActorUserId, fetcher].every(value => typeof value === 'function')
    && Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 120000
    && Number.isSafeInteger(maxBytes) && maxBytes > 0 && maxBytes <= 1024 * 1024 * 1024, 'DOCUMENT_OPEN_INPUT');
  let base;
  try { base = new URL(supabaseUrl); } catch { throw failure('DOCUMENT_OPEN_INPUT'); }
  check((supabaseUrl === base.origin || supabaseUrl === `${base.origin}/`)
    && !base.username && !base.password && !base.search && !base.hash && base.pathname === '/'
    && (base.protocol === 'https:' || (allowLoopback === true && base.protocol === 'http:'
      && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))), 'DOCUMENT_OPEN_INPUT');
  return async (descriptor, scope) => {
    check(object(descriptor) && object(scope) && typeof scope.actorUserId === 'string' && UUID.test(scope.actorUserId)
      && typeof scope.documentId === 'string' && UUID.test(scope.documentId)
      && Object.keys(descriptor).every(key => ['path', 'byte_length', 'content_sha256'].includes(key)), 'DOCUMENT_OPEN_INPUT');
    const { path, byte_length: byteLength, content_sha256: expectedHash = null } = descriptor;
    const encoded = encodedPath(path);
    check(typeof byteLength === 'string' && /^[1-9][0-9]{0,18}$/.test(byteLength)
      && BigInt(byteLength) <= 9223372036854775807n
      && (expectedHash === null || (typeof expectedHash === 'string' && SHA.test(expectedHash))), 'DOCUMENT_OPEN_INPUT');
    const expected = BigInt(byteLength); check(expected <= BigInt(maxBytes), 'DOCUMENT_OPEN_LIMIT');
    const { actorUserId, signal } = scope;
    check(signal == null || (typeof signal.aborted === 'boolean' && typeof signal.addEventListener === 'function'
      && typeof signal.removeEventListener === 'function'), 'DOCUMENT_OPEN_INPUT');
    const controller = new AbortController(), abort = () => controller.abort();
    const deadline = performance.now() + timeoutMs, timer = setTimeout(abort, timeoutMs);
    const alive = () => {
      check(!controller.signal.aborted && performance.now() < deadline, 'DOCUMENT_OPEN_ABORTED');
      check(getActorUserId() === actorUserId, 'DOCUMENT_OPEN_ACTOR_CHANGED');
    };
    const call = (operation, dispose) => {
      alive();
      return new Promise((resolve, reject) => {
        let settled = false;
        const finish = (callback, value) => {
          if (settled) return;
          settled = true; controller.signal.removeEventListener('abort', onAbort); callback(value);
        };
        const onAbort = () => finish(reject, failure('DOCUMENT_OPEN_ABORTED'));
        controller.signal.addEventListener('abort', onAbort, { once: true });
        Promise.resolve().then(() => { alive(); return operation(); }).then(value => {
          try {
            alive(); check(!settled, 'DOCUMENT_OPEN_ABORTED'); finish(resolve, value);
          } catch (error) {
            try { dispose?.(value); } catch { /* release late results without blocking */ }
            finish(reject, error);
          }
        }, error => finish(reject, error));
      });
    };
    let response, reader, complete = false;
    try {
      signal?.addEventListener('abort', abort, { once: true }); if (signal?.aborted) abort();
      const token = await call(() => getAccessToken(actorUserId, controller.signal));
      check(typeof token === 'string' && token.length > 0 && token.length <= 16384
        && !/[\s\u0000-\u001f\u007f]/.test(token), 'DOCUMENT_OPEN_INPUT');
      const url = new URL(`/storage/v1/object/authenticated/documents/${encoded}`, base);
      url.searchParams.set('cacheNonce', globalThis.crypto.randomUUID());
      response = await call(() => fetcher(url.href, { method: 'GET',
        headers: { Authorization: `Bearer ${token}`, apikey: publicKey, 'Cache-Control': 'no-cache' },
        signal: controller.signal, redirect: 'error', credentials: 'omit', cache: 'no-store' }), value => cancel(value?.body));
      // Error bodies need not be read at all. Provider diagnostics never reach
      // logs or callers, and an enormous error body cannot consume our budget.
      check(response?.status === 200 && !response.redirected && typeof response.headers?.get === 'function'
        && typeof response.body?.getReader === 'function');
      const type = response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase();
      // Old uploads may have the generic Storage MIME type. pdf.js still owns
      // PDF parsing; accepting a Blob is not proof that its syntax is valid PDF.
      check(type === 'application/pdf' || type === 'application/octet-stream');
      const declared = response.headers.get('Content-Length');
      if (declared !== null) check(/^[0-9]{1,19}$/.test(declared) && BigInt(declared) === expected, 'DOCUMENT_OPEN_BYTES');
      reader = response.body.getReader();
      const chunks = [], block = new Uint8Array(Math.min(65536, Number(expected))); let filled = 0, count = 0n;
      for (;;) {
        const part = await call(() => reader.read()); if (part.done) break;
        check(part.value instanceof Uint8Array);
        count += BigInt(part.value.byteLength); check(count <= expected, 'DOCUMENT_OPEN_BYTES');
        for (let offset = 0; offset < part.value.length;) {
          const length = Math.min(block.length - filled, part.value.length - offset);
          block.set(part.value.subarray(offset, offset + length), filled); filled += length; offset += length;
          if (filled === block.length) { chunks.push(new Blob([block])); filled = 0; alive(); }
        }
      }
      check(count === expected, 'DOCUMENT_OPEN_BYTES'); alive();
      if (filled) chunks.push(new Blob([block.subarray(0, filled)]));
      const blob = new Blob(chunks, { type: 'application/pdf' });
      check(BigInt(blob.size) === expected, 'DOCUMENT_OPEN_BYTES'); alive();
      if (expectedHash !== null) {
        check(typeof globalThis.crypto?.subtle?.digest === 'function');
        const bytes = await call(() => Blob.prototype.arrayBuffer.call(blob));
        const digest = await call(() => globalThis.crypto.subtle.digest('SHA-256', bytes));
        const actualHash = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
        check(actualHash === expectedHash, 'DOCUMENT_OPEN_BYTES');
      }
      alive(); complete = true; return blob;
    } catch (error) {
      throw failure(allowed.has(error?.code) ? error.code : undefined);
    } finally {
      controller.abort(); clearTimeout(timer); signal?.removeEventListener('abort', abort);
      if (reader) {
        if (!complete) { try { void reader.cancel().catch(() => {}); } catch { /* pending read */ } }
        try { reader.releaseLock(); } catch { /* pending read settles later */ }
      } else cancel(response?.body);
    }
  };
}
