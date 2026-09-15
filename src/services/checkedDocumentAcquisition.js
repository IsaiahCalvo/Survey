import { createDocumentGenerationPdfReader, createDocumentGenerationReader,
  readDocumentGenerationNameReceipt } from './documentGenerationReader.js';
import { createDocumentGenerationDownload } from './documentGenerationDownload.js';
import { createLegacyDocumentDownload } from './legacyDocumentDownload.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const validId = value => typeof value === 'string' && UUID.test(value);
const validSignal = value => value == null || (typeof value.aborted === 'boolean'
  && typeof value.addEventListener === 'function' && typeof value.removeEventListener === 'function');
const safeCodes = new Set(['42501', '40001', '55P03', '23514', '22023', '25001', '54000',
  'SG001', 'SG002', 'PGRST202', 'PGRST301', 'PGRST302', 'DOCUMENT_OPEN_INPUT',
  'DOCUMENT_OPEN_PROTOCOL', 'DOCUMENT_OPEN_LIMIT', 'DOCUMENT_OPEN_ABORTED',
  'DOCUMENT_OPEN_ACTOR_CHANGED', 'DOCUMENT_OPEN_BYTES', 'DOCUMENT_OPEN_STATE', 'DOCUMENT_OPEN_DISABLED']);
const failure = (code = 'DOCUMENT_OPEN_PROTOCOL') => Object.assign(
  new Error('The complete document could not be opened. Your saved work was kept.'), { code });
const check = (value, code = 'DOCUMENT_OPEN_INPUT') => { if (!value) throw failure(code); };
const metadataFields = 'id,user_id,project_id,name,file_path,file_size,content_sha256,updated_at,archived,user_archived_at';
const exactKeys = (value, fields) => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === fields.split(',').sort().join(',');
function legacyMetadata(value, documentId) {
  check(exactKeys(value, metadataFields), 'DOCUMENT_OPEN_PROTOCOL');
  // Capture primitives before the next await; the SDK response is not owned.
  const row = { ...value };
  check(row.id === documentId && validId(row.user_id) && (row.project_id === null || validId(row.project_id))
    && typeof row.name === 'string' && typeof row.file_path === 'string' && row.file_path.length > 0
    && row.file_path.length <= 2048 && !/[\u0000-\u001f\u007f]/.test(row.file_path)
    && row.archived === false && row.user_archived_at === null
    && (row.updated_at === null || (typeof row.updated_at === 'string' && row.updated_at.length <= 64
      && Number.isFinite(Date.parse(row.updated_at))))
    && (row.content_sha256 === null || (typeof row.content_sha256 === 'string' && /^[0-9a-f]{64}$/.test(row.content_sha256)))
    && (row.file_size === null || (Number.isSafeInteger(row.file_size) && row.file_size > 0)
      || (typeof row.file_size === 'string' && /^[1-9][0-9]{0,18}$/.test(row.file_size)
        && BigInt(row.file_size) <= 9223372036854775807n)),
  'DOCUMENT_OPEN_PROTOCOL');
  // This is an acceptance bound, not a limit on the SDK's JSON allocation.
  check(row.name.length <= 65536, 'DOCUMENT_OPEN_LIMIT');
  // This is old/import metadata, not a current-byte receipt. Legacy mutable
  // saves can change the Storage object without changing these two fields.
  if (row.file_size !== null) row.file_size = String(row.file_size);
  return Object.freeze(row);
}

/** Explicit, default-off opens. open keeps its checked-only contract;
 * openCurrent discovers authoritative mode and never falls back after failure.
 * Legacy results are NOT generation-issued bundles or continuing access grants.
 * No idle subscription. The caller's opaque isCurrent guard must cover scope changes
 * between opens; observed auth retirement is permanent for this instance.
 * Each open owns one immutable JWT, deadline and subscription. dispose stops
 * every pending open; neither it nor a failed open changes local/cloud data. */
export function createCheckedDocumentAcquisition({ client, actorUserId, isCurrent, signal,
  supabaseUrl, publicKey, enabled = false, fetch: fetcher = globalThis.fetch,
  allowLoopback = false, timeoutMs = 60000, maxPdfBytes = 256 * 1024 * 1024,
  maxStateBytes = 64 * 1024 * 1024, maxUpdatePages = 1000,
  conditionalAnnotationCheckpoint = false } = {}) {
  check(typeof conditionalAnnotationCheckpoint === 'boolean');
  let retired = false;
  const pending = new Set();
  const previewDescriptors = new WeakMap();
  const retire = code => {
    retired = true;
    for (const abort of pending) abort(code);
  };
  async function run(input = {}, discover = false, preview = null) {
      // Disabled means zero auth, subscriptions, RPCs and HTTP, even with no config.
      check(enabled === true, 'DOCUMENT_OPEN_DISABLED');
      check(input !== null && typeof input === 'object' && !Array.isArray(input));
      const { documentId, pdfGenerationId = null, signal: openSignal } = input;
      check(!discover || (pdfGenerationId === null && typeof client?.from === 'function'));
      check(validId(actorUserId) && validId(documentId) && (pdfGenerationId === null || validId(pdfGenerationId))
        && typeof isCurrent === 'function' && typeof client?.auth?.getSession === 'function'
        && typeof client?.auth?.onAuthStateChange === 'function' && typeof client?.rpc === 'function'
        && validSignal(signal) && validSignal(openSignal)
        && Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 120000);
      const controller = new AbortController(), listeners = [];
      const deadline = performance.now() + timeoutMs;
      let reason, timer, subscription, active = true;
      const abort = code => {
        reason ||= failure(code);
        controller.abort();
      };
      const alive = () => {
        if (reason) throw reason;
        check(!controller.signal.aborted && performance.now() < deadline, 'DOCUMENT_OPEN_ABORTED');
        check(!retired, 'DOCUMENT_OPEN_ACTOR_CHANGED');
        let current = false;
        try { current = isCurrent() === true; } catch { /* fail closed */ }
        if (!current) { retire('DOCUMENT_OPEN_ACTOR_CHANGED'); throw failure('DOCUMENT_OPEN_ACTOR_CHANGED'); }
      };
      // Uncooperative SDK/auth promises must not retain our listeners or prevent
      // deadline/abort settlement. Late values have no path to a returned bundle.
      const wait = operation => {
        alive();
        return new Promise((resolve, reject) => {
          let settled = false;
          const finish = (callback, value) => {
            if (settled) return;
            settled = true;
            controller.signal.removeEventListener('abort', onAbort);
            callback(value);
          };
          const onAbort = () => finish(reject, reason || failure('DOCUMENT_OPEN_ABORTED'));
          controller.signal.addEventListener('abort', onAbort, { once: true });
          Promise.resolve().then(() => { alive(); return operation(); }).then(value => {
            try { alive(); finish(resolve, value); } catch (error) { finish(reject, error); }
          }, error => finish(reject, error));
        });
      };
      const readSession = async () => {
        const response = await wait(() => client.auth.getSession());
        alive();
        const session = response?.data?.session;
        if (response?.error || session?.user?.id !== actorUserId) {
          retire('DOCUMENT_OPEN_ACTOR_CHANGED'); throw failure('DOCUMENT_OPEN_ACTOR_CHANGED');
        }
        check(typeof session.access_token === 'string' && session.access_token.length > 0
          && session.access_token.length <= 16384 && !/[\s\u0000-\u001f\u007f]/.test(session.access_token));
        return session.access_token;
      };
      try {
        alive();
        for (const source of [signal, openSignal].filter(Boolean)) {
          if (source.aborted) { abort('DOCUMENT_OPEN_ABORTED'); break; }
          const listener = () => abort('DOCUMENT_OPEN_ABORTED');
          source.addEventListener('abort', listener, { once: true }); listeners.push([source, listener]);
        }
        alive();
        pending.add(abort);
        timer = setTimeout(() => abort('DOCUMENT_OPEN_ABORTED'), timeoutMs);
        let accessToken;
        const request = async (name, params, context = { signal: controller.signal }) => {
          await readSession(); alive();
          const response = await wait(() => client.rpc(name, params)
            .setHeader('Authorization', `Bearer ${accessToken}`).abortSignal(context.signal));
          alive(); return response;
        };
        const readMode = async (modernOnly = false) => {
          let response = await request(modernOnly ? 'read_document_open_mode_v2' : 'read_document_open_mode',
            { p_document_id: documentId });
          if (!modernOnly && response?.error?.code === 'SG003') response = await request(
            'read_document_open_mode_v2', { p_document_id: documentId });
          if (response?.error) throw response.error;
          const value = response?.data;
          const old = exactKeys(value, 'version,actor_user_id,document_id,mode,generation_id')
            && value.version === 1;
          const modern = exactKeys(value, 'version,actor_user_id,document_id,mode,generation_id,content_model_version')
            && value.version === 2 && [1, 2].includes(value.content_model_version);
          check((old || modern) && value.actor_user_id === actorUserId && value.document_id === documentId
            && ((value.mode === 'legacy' && value.generation_id === null)
              || (value.mode === 'checked' && validId(value.generation_id))), 'DOCUMENT_OPEN_PROTOCOL');
          return Object.freeze({ mode: value.mode, generationId: value.generation_id,
            contentModelVersion: modern ? value.content_model_version : 1, modern });
        };
        const readMetadata = async () => {
          await readSession(); alive();
          const response = await wait(() => client.from('documents').select(metadataFields).eq('id', documentId)
            .eq('archived', false).is('user_archived_at', null)
            .setHeader('Authorization', `Bearer ${accessToken}`).abortSignal(controller.signal).retry(false).maybeSingle());
          if (response?.error) throw response.error;
          alive(); return legacyMetadata(response?.data, documentId);
        };
        const legacyDownload = discover ? createLegacyDocumentDownload({ supabaseUrl, publicKey, fetch: fetcher,
          allowLoopback, timeoutMs, maxBytes: maxPdfBytes,
          getActorUserId: () => { alive(); return actorUserId; },
          getAccessToken: async () => { await readSession(); alive(); return accessToken; } }) : null;
        const download = createDocumentGenerationDownload({ supabaseUrl, publicKey, fetch: fetcher,
          allowLoopback, timeoutMs, maxBytes: maxPdfBytes,
          getActorUserId: () => { alive(); return actorUserId; },
          getAccessToken: async () => { await readSession(); alive(); return accessToken; } });
        const reader = createDocumentGenerationReader({ timeoutMs, maxPdfBytes, maxStateBytes, maxUpdatePages,
          getActorUserId: () => { alive(); return actorUserId; }, download,
          request });
        const pdfReader = createDocumentGenerationPdfReader({ timeoutMs,maxPdfBytes,
          getActorUserId: () => { alive(); return actorUserId; },download,request });
        // Subscribe before the first session await to catch actor A -> B -> A.
        const result = client.auth.onAuthStateChange((event, session) => {
          if (active && (event === 'SIGNED_OUT' || session?.user?.id !== actorUserId)) retire('DOCUMENT_OPEN_ACTOR_CHANGED');
        });
        subscription = result?.data?.subscription;
        check(typeof subscription?.unsubscribe === 'function');
        alive();
        accessToken = await readSession(); alive();
        const mode = discover ? await readMode(preview !== null) : null;
        if (preview?.kind === 'describe') {
          const cacheKey = mode.mode === 'checked' ? JSON.stringify([
            'document-preview-v1',actorUserId,documentId,mode.generationId,mode.contentModelVersion,
          ]) : null;
          const descriptor = Object.freeze({ version:1,mode:mode.mode,actorUserId,documentId,
            pdfGenerationId:mode.mode === 'checked' ? mode.generationId : null,
            contentModelVersion:mode.mode === 'checked' ? mode.contentModelVersion : null,cacheKey });
          previewDescriptors.set(descriptor, Object.freeze({ mode:mode.mode,generationId:mode.generationId,
            contentModelVersion:mode.contentModelVersion,modern:mode.modern,cacheKey }));
          await readSession(); alive(); return descriptor;
        }
        if (preview?.kind === 'acquire') {
          const issued = preview.issued;
          check(mode.mode === issued.mode && mode.generationId === issued.generationId
            && mode.contentModelVersion === issued.contentModelVersion && mode.modern === issued.modern,
          'DOCUMENT_OPEN_STATE');
        }
        if (preview?.kind === 'name' && mode.mode === 'checked') {
          const response = await request('read_document_generation_open_v3', {
            p_document_id:documentId,p_generation_id:mode.generationId,
            p_content_model_version:mode.contentModelVersion,p_include_snapshot:false,
          });
          if (response?.error) throw response.error;
          const name = readDocumentGenerationNameReceipt(response?.data, {
            actorUserId,documentId,pdfGenerationId:mode.generationId,
            contentModelVersion:mode.contentModelVersion,
          });
          const finalMode = await readMode(true);
          check(finalMode.mode === 'checked' && finalMode.generationId === mode.generationId
            && finalMode.contentModelVersion === mode.contentModelVersion && finalMode.modern === mode.modern,
          'DOCUMENT_OPEN_STATE');
          await readSession(); alive();
          return Object.freeze({ version:1,mode:'checked',actorUserId,documentId,
            pdfGenerationId:mode.generationId,contentModelVersion:mode.contentModelVersion,name });
        }
        if (mode?.mode === 'legacy') {
          const document = await readMetadata();
          if (preview?.kind === 'name') {
            const finalMode = await readMode(true);
            check(finalMode.mode === 'legacy' && finalMode.generationId === null && finalMode.modern === mode.modern,
            'DOCUMENT_OPEN_STATE');
            await readSession(); alive();
            return Object.freeze({ version:1,mode:'legacy',actorUserId,documentId,
              pdfGenerationId:null,contentModelVersion:null,name:document.name });
          }
          const blob = await wait(() => legacyDownload({ path: document.file_path },
          { actorUserId, documentId, signal: controller.signal }));
          const finalDocument = await readMetadata();
          check(metadataFields.split(',').every(key => document[key] === finalDocument[key]), 'DOCUMENT_OPEN_BYTES');
          const finalMode = await readMode();
          check(finalMode.mode === 'legacy', 'SG001');
          await readSession(); alive();
          // Hashless mutable Storage objects cannot prove a physical version.
          // No descriptor-only equality claim upgrades this to checked mode.
          if (preview?.kind === 'acquire') {
            const owned = Blob.prototype.slice.call(blob, 0, undefined, 'application/pdf');
            return Object.freeze({ version:1,mode:'legacy',actorUserId,documentId,pdfGenerationId:null,
              contentModelVersion:null,name:finalDocument.name,blob:owned,byteLength:String(owned.size),
              contentSha256:null,cacheKey:null });
          }
          return Object.freeze({ mode: 'legacy', actorUserId, documentId, document, blob, checkedBundle: null });
        }
        if (preview?.kind === 'acquire') {
          const issued = preview.issued;
          const result = await pdfReader.open({ documentId,actorUserId,pdfGenerationId:issued.generationId,
            contentModelVersion:issued.modern ? issued.contentModelVersion : null,signal:controller.signal });
          const finalMode = await readMode(true);
          check(finalMode.mode === issued.mode && finalMode.generationId === issued.generationId
            && finalMode.contentModelVersion === issued.contentModelVersion && finalMode.modern === issued.modern,
          'DOCUMENT_OPEN_STATE');
          await readSession(); alive();
          const blob = Blob.prototype.slice.call(result.blob, 0, undefined, 'application/pdf');
          return Object.freeze({ version:1,mode:'checked',actorUserId,documentId,
            pdfGenerationId:issued.generationId,contentModelVersion:issued.contentModelVersion,
            name:result.name,blob,byteLength:result.pdf.byte_length,contentSha256:result.pdf.content_sha256,
            cacheKey:issued.cacheKey });
        }
        const bundle = await wait(() => reader.open({ documentId, actorUserId,
          pdfGenerationId: mode ? mode.generationId : pdfGenerationId,
          contentModelVersion: mode?.modern ? mode.contentModelVersion : null,
          conditionalAnnotationCheckpoint, signal: controller.signal }));
        if (discover) { await readSession(); alive(); }
        alive(); return discover ? Object.freeze({ mode: 'checked', actorUserId, documentId, checkedBundle: bundle }) : bundle;
      } catch (error) {
        throw failure(reason?.code || (safeCodes.has(error?.code) ? error.code : undefined));
      } finally {
        active = false;
        pending.delete(abort);
        controller.abort(); clearTimeout(timer);
        for (const [source, listener] of listeners) source.removeEventListener('abort', listener);
        try { subscription?.unsubscribe(); } catch { /* cleanup must not expose SDK details */ }
      }
  }
  return Object.freeze({
    dispose() { retire('DOCUMENT_OPEN_ABORTED'); },
    open(input) { return run(input); },
    openCurrent(input) { return run(input, true); },
    readNameCurrent(input) { return run(input, true, { kind:'name' }); },
    describePreviewCurrent(input) { return run(input, true, { kind:'describe' }); },
    acquirePreviewPdf(descriptor, input = {}) {
      check(input !== null && typeof input === 'object' && !Array.isArray(input)
        && Object.keys(input).every(key => key === 'signal'));
      const issued = previewDescriptors.get(descriptor);
      check(issued);
      return run({ documentId:descriptor.documentId,signal:input.signal }, true, { kind:'acquire',issued });
    },
  });
}
