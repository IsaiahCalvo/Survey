import { createDocumentGenerationReader } from './documentGenerationReader.js';
import { createDocumentGenerationDownload } from './documentGenerationDownload.js';

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

/** An explicit, default-off checked open. No legacy discovery/fallback or idle
 * subscription. The caller's opaque isCurrent guard must cover scope changes
 * between opens; observed auth retirement is permanent for this instance.
 * Each open owns one immutable JWT, deadline and subscription. dispose stops
 * every pending open; neither it nor a failed open changes local/cloud data. */
export function createCheckedDocumentAcquisition({ client, actorUserId, isCurrent, signal,
  supabaseUrl, publicKey, enabled = false, fetch: fetcher = globalThis.fetch,
  allowLoopback = false, timeoutMs = 60000, maxPdfBytes = 256 * 1024 * 1024,
  maxStateBytes = 64 * 1024 * 1024, maxUpdatePages = 1000 } = {}) {
  let retired = false;
  const pending = new Set();
  const retire = code => {
    retired = true;
    for (const abort of pending) abort(code);
  };
  return Object.freeze({
    dispose() { retire('DOCUMENT_OPEN_ABORTED'); },
    async open(input = {}) {
      // Disabled means zero auth, subscriptions, RPCs and HTTP, even with no config.
      check(enabled === true, 'DOCUMENT_OPEN_DISABLED');
      check(input !== null && typeof input === 'object' && !Array.isArray(input));
      const { documentId, pdfGenerationId = null, signal: openSignal } = input;
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
        const download = createDocumentGenerationDownload({ supabaseUrl, publicKey, fetch: fetcher,
          allowLoopback, timeoutMs, maxBytes: maxPdfBytes,
          getActorUserId: () => { alive(); return actorUserId; },
          getAccessToken: async () => { await readSession(); alive(); return accessToken; } });
        const reader = createDocumentGenerationReader({ timeoutMs, maxPdfBytes, maxStateBytes, maxUpdatePages,
          getActorUserId: () => { alive(); return actorUserId; }, download,
          request: async (name, params, context) => {
            await readSession(); alive();
            const response = await wait(() => {
              alive();
              return client.rpc(name, params).setHeader('Authorization', `Bearer ${accessToken}`)
                .abortSignal(context.signal);
            });
            alive(); return response;
          } });
        // Subscribe before the first session await to catch actor A -> B -> A.
        const result = client.auth.onAuthStateChange((event, session) => {
          if (active && (event === 'SIGNED_OUT' || session?.user?.id !== actorUserId)) retire('DOCUMENT_OPEN_ACTOR_CHANGED');
        });
        subscription = result?.data?.subscription;
        check(typeof subscription?.unsubscribe === 'function');
        alive();
        accessToken = await readSession(); alive();
        const bundle = await wait(() => reader.open({ documentId, actorUserId, pdfGenerationId, signal: controller.signal }));
        alive(); return bundle;
      } catch (error) {
        throw failure(reason?.code || (safeCodes.has(error?.code) ? error.code : undefined));
      } finally {
        active = false;
        pending.delete(abort);
        controller.abort(); clearTimeout(timer);
        for (const [source, listener] of listeners) source.removeEventListener('abort', listener);
        try { subscription?.unsubscribe(); } catch { /* cleanup must not expose SDK details */ }
      }
    },
  });
}
