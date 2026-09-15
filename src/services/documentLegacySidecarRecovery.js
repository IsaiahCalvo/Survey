const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const SHA = /^[0-9a-f]{64}$/;
const MAX_BYTES = 16 * 1024 * 1024;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const exact = (value, keys) => object(value)
  && Object.keys(value).sort().join('|') === [...keys].sort().join('|');
const uuid = value => typeof value === 'string' && UUID.test(value);
const failure = (code = 'LEGACY_SIDECAR_RECOVERY_PROTOCOL') => Object.assign(new Error(
  code === '42501'
    ? 'Only the current document owner can export this legacy data.'
    : 'The legacy data archive could not be verified. No data was changed.'), { code });
const check = (value, code) => { if (!value) throw failure(code); };
const safeCodes = new Set(['42501', '40001', '55P03', '23514',
  'LEGACY_SIDECAR_RECOVERY_INPUT', 'LEGACY_SIDECAR_RECOVERY_PROTOCOL',
  'LEGACY_SIDECAR_RECOVERY_ABORTED', 'LEGACY_SIDECAR_RECOVERY_ACTOR_CHANGED',
  'LEGACY_SIDECAR_RECOVERY_LIMIT']);

function receipt(value, scope) {
  check(exact(value, ['version', 'actor_user_id', 'document_id', 'generation_id',
    'source_generation_id', 'archive']));
  const archive = value.archive;
  check(value.version === 1 && value.actor_user_id === scope.actorUserId
    && value.document_id === scope.documentId && value.generation_id === scope.pdfGenerationId
    && uuid(value.source_generation_id)
    && exact(archive, ['kind', 'bucket_id', 'path', 'id', 'version', 'byte_length',
      'content_sha256', 'source_object'])
    && archive.kind === 'sidecar' && archive.bucket_id === 'documents'
    && uuid(archive.id) && uuid(archive.version) && SHA.test(archive.content_sha256)
    && typeof archive.path === 'string' && archive.path.length > 0 && archive.path.length <= 2048
    && !/[\u0000-\u001f\u007f]/.test(archive.path)
    && typeof archive.byte_length === 'string' && /^[1-9][0-9]{0,18}$/.test(archive.byte_length)
    && BigInt(archive.byte_length) <= BigInt(MAX_BYTES)
    && exact(archive.source_object, ['bucket_id', 'path', 'id', 'version', 'byte_length'])
    && archive.source_object.bucket_id === 'documents'
    && typeof archive.source_object.path === 'string'
    && archive.source_object.path.length > 0 && archive.source_object.path.length <= 2048
    && !/[\u0000-\u001f\u007f]/.test(archive.source_object.path)
    && archive.source_object.path.endsWith(`/${scope.documentId}_data.json`)
    && uuid(archive.source_object.id) && uuid(archive.source_object.version)
    && archive.source_object.path !== archive.path
    && archive.source_object.id !== archive.id
    && archive.source_object.version !== archive.version
    && archive.source_object.byte_length === archive.byte_length);
  return Object.freeze({ byteLength:archive.byte_length,contentSha256:archive.content_sha256 });
}

/** Owner-only export of the exact retained legacy JSON. The public result has
 * no Storage path or retained-object identity and is never an import token. */
export function createDocumentLegacySidecarRecovery({ client, actorUserId, isCurrent,
  supabaseUrl, publicKey, fetch:fetcher = globalThis.fetch, allowLoopback = false,
  timeoutMs = 60_000 } = {}) {
  check(uuid(actorUserId) && typeof isCurrent === 'function'
    && typeof client?.auth?.getSession === 'function'
    && typeof client?.auth?.onAuthStateChange === 'function'
    && typeof client?.rpc === 'function' && typeof fetcher === 'function'
    && typeof supabaseUrl === 'string' && typeof publicKey === 'string'
    && publicKey.length > 0 && publicKey.length <= 16_384
    && Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 120_000,
  'LEGACY_SIDECAR_RECOVERY_INPUT');
  let origin;
  try { origin = new URL(supabaseUrl); } catch { throw failure('LEGACY_SIDECAR_RECOVERY_INPUT'); }
  check(!origin.username && !origin.password && !origin.search && !origin.hash && origin.pathname === '/'
    && (origin.protocol === 'https:' || (allowLoopback && origin.protocol === 'http:'
      && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname))),
  'LEGACY_SIDECAR_RECOVERY_INPUT');
  const endpoint = new URL('/functions/v1/document-generation-download', origin).href;
  return Object.freeze({ async download({ documentId, pdfGenerationId, signal } = {}) {
    check(uuid(documentId) && uuid(pdfGenerationId)
      && (signal == null || (typeof signal.aborted === 'boolean'
        && typeof signal.addEventListener === 'function'
        && typeof signal.removeEventListener === 'function')),
    'LEGACY_SIDECAR_RECOVERY_INPUT');
    const scope = { actorUserId,documentId,pdfGenerationId };
    const controller = new AbortController();
    let reason, subscription;
    const abort = code => { reason ||= failure(code); controller.abort(); };
    const externalAbort = () => abort('LEGACY_SIDECAR_RECOVERY_ABORTED');
    signal?.addEventListener('abort', externalAbort, { once:true });
    if (signal?.aborted) externalAbort();
    const timer = setTimeout(() => abort('LEGACY_SIDECAR_RECOVERY_ABORTED'), timeoutMs);
    const alive = () => {
      if (reason) throw reason;
      check(!controller.signal.aborted, 'LEGACY_SIDECAR_RECOVERY_ABORTED');
      let current = false;
      try { current = isCurrent(scope) === true; } catch { /* fail closed */ }
      check(current, 'LEGACY_SIDECAR_RECOVERY_ACTOR_CHANGED');
    };
    const wait = operation => new Promise((resolve, reject) => {
      try { alive(); } catch (error) { reject(error); return; }
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return; settled = true;
        controller.signal.removeEventListener('abort', onAbort); callback(value);
      };
      const onAbort = () => finish(reject, reason || failure('LEGACY_SIDECAR_RECOVERY_ABORTED'));
      controller.signal.addEventListener('abort', onAbort, { once:true });
      Promise.resolve().then(() => { alive(); return operation(); }).then(value => {
        try { alive(); finish(resolve, value); } catch (error) { finish(reject, error); }
      }, error => finish(reject, error));
    });
    try {
      const authChange = client.auth.onAuthStateChange((event, session) => {
        if (event === 'SIGNED_OUT' || session?.user?.id !== actorUserId) {
          abort('LEGACY_SIDECAR_RECOVERY_ACTOR_CHANGED');
        }
      });
      subscription = authChange?.data?.subscription;
      check(typeof subscription?.unsubscribe === 'function', 'LEGACY_SIDECAR_RECOVERY_INPUT');
      const session = (await wait(() => client.auth.getSession()))?.data?.session;
      check(session?.user?.id === actorUserId
        && typeof session.access_token === 'string' && session.access_token.length > 0
        && session.access_token.length <= 16_384 && !/[\s\u0000-\u001f\u007f]/.test(session.access_token),
      'LEGACY_SIDECAR_RECOVERY_ACTOR_CHANGED');
      const rpcResponse = await wait(() => client.rpc(
        'read_document_generation_legacy_sidecar_archive_v1', {
          p_document_id:documentId,p_generation_id:pdfGenerationId,
        }).setHeader('Authorization', `Bearer ${session.access_token}`).abortSignal(controller.signal));
      if (rpcResponse?.error) throw failure(safeCodes.has(rpcResponse.error.code)
        ? rpcResponse.error.code : undefined);
      const proof = receipt(rpcResponse?.data, scope);
      const response = await wait(() => fetcher(endpoint, { method:'POST',redirect:'error',
        credentials:'omit',cache:'no-store',signal:controller.signal,
        headers:{ Authorization:`Bearer ${session.access_token}`,apikey:publicKey,
          'Content-Type':'application/json' },
        body:JSON.stringify({ action:'legacy-sidecar-recovery',document_id:documentId,
          generation_id:pdfGenerationId }) }));
      check(response?.status === 200 && typeof response.body?.getReader === 'function'
        && response.headers?.get('Content-Type')?.split(';')[0].trim().toLowerCase() === 'application/json'
        && /(?:^|,)\s*no-store\s*(?:,|$)/i.test(response.headers?.get('Cache-Control') || ''));
      const declared = response.headers.get('Content-Length');
      if (declared !== null) check(/^[0-9]+$/.test(declared)
        && BigInt(declared) === BigInt(proof.byteLength), 'LEGACY_SIDECAR_RECOVERY_PROTOCOL');
      const reader = response.body.getReader(), chunks = [];
      let size = 0;
      try {
        for (;;) {
          const part = await wait(() => reader.read());
          if (part.done) break;
          check(part.value instanceof Uint8Array);
          size += part.value.byteLength;
          check(size <= MAX_BYTES && BigInt(size) <= BigInt(proof.byteLength),
            'LEGACY_SIDECAR_RECOVERY_LIMIT');
          chunks.push(part.value.slice());
        }
      } finally {
        try { reader.releaseLock(); } catch { /* pending read */ }
      }
      check(BigInt(size) === BigInt(proof.byteLength), 'LEGACY_SIDECAR_RECOVERY_PROTOCOL');
      const blob = new Blob(chunks, { type:'application/json' });
      // Reject non-JSON bytes here. The server owns the exact archive hash;
      // this check only prevents a mislabeled response from reaching Save As.
      JSON.parse(await wait(() => Blob.prototype.text.call(blob)));
      alive();
      return Object.freeze({ version:1,actorUserId,documentId,pdfGenerationId,blob });
    } catch (error) {
      throw failure(safeCodes.has(error?.code) ? error.code : undefined);
    } finally {
      controller.abort(); clearTimeout(timer);
      signal?.removeEventListener('abort', externalAbort);
      try { subscription?.unsubscribe(); } catch { /* cleanup */ }
    }
  } });
}
