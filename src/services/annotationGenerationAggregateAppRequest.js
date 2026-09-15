const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const TOKEN = /^[^\s\u0000-\u001f\u007f]{1,16384}$/;
const PUBLIC_KEY = /^[^\r\n\u0000]{1,16384}$/;
const QUERY_KEYS = Object.freeze([
  'client_id',
  'client_seq',
  'content_model_version',
  'document_id',
  'generation_id',
  'receipt_version',
]);

function failure(code) {
  return Object.assign(new Error('The annotation update could not be confirmed.'), { code });
}

function check(value, code = 'ANNOTATION_AGGREGATE_APP_REQUEST_INPUT') {
  if (!value) throw failure(code);
}

function plain(value) {
  return value !== null && typeof value === 'object'
    && Object.getPrototypeOf(value) === Object.prototype;
}

function exactDataObject(value, keys) {
  if (!plain(value)) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const ownKeys = Reflect.ownKeys(descriptors);
  if (ownKeys.length !== keys.length
    || ownKeys.some(key => typeof key !== 'string')
    || [...ownKeys].sort().some((key, index) => key !== keys[index])
    || keys.some(key => !descriptors[key]?.enumerable
      || !Object.hasOwn(descriptors[key], 'value'))) return null;
  return Object.freeze(Object.fromEntries(keys.map(key => [key, descriptors[key].value])));
}

function validSignal(signal) {
  return signal instanceof AbortSignal;
}

function cancel(response) {
  try { void response?.body?.cancel().catch(() => {}); } catch { /* body is locked or closed */ }
}

function checkedCall(call, documentId) {
  const captured = exactDataObject(call, ['body', 'functionName', 'headers', 'signal']);
  check(captured);
  const headerKeys = Reflect.ownKeys(Object.getOwnPropertyDescriptors(captured.headers || {}));
  const expectedHeaderKeys = headerKeys.length === 1
    ? ['Content-Type'] : ['Authorization', 'Content-Type'];
  const headers = exactDataObject(captured.headers, expectedHeaderKeys);
  check(typeof captured.functionName === 'string' && captured.functionName.length <= 2048
    && captured.body instanceof Blob && captured.body.type === 'application/octet-stream'
    && captured.body.size > 0 && headers
    && headers['Content-Type'] === 'application/octet-stream'
    && (headers.Authorization === undefined || typeof headers.Authorization === 'string')
    && validSignal(captured.signal));
  let url;
  try { url = new URL(captured.functionName, 'https://aggregate.invalid/functions/v1/'); }
  catch { throw failure('ANNOTATION_AGGREGATE_APP_REQUEST_INPUT'); }
  check(url.origin === 'https://aggregate.invalid'
    && url.pathname === '/functions/v1/annotation-generation-aggregate'
    && !url.username && !url.password && !url.hash);
  const queryKeys = [...url.searchParams.keys()].sort();
  check(queryKeys.length === QUERY_KEYS.length
    && queryKeys.every((key, index) => key === QUERY_KEYS[index])
    && QUERY_KEYS.every(key => url.searchParams.getAll(key).length === 1)
    && url.searchParams.get('document_id') === documentId
    && UUID.test(url.searchParams.get('generation_id') || '')
    && url.searchParams.get('content_model_version') === '2'
    && url.searchParams.get('receipt_version') === '2');
  return Object.freeze({ body: captured.body, headers, signal: captured.signal,
    search: url.searchParams.toString() });
}

function waitFor(operation, signal, dispose = null) {
  if (signal.aborted) return Promise.reject(failure('ANNOTATION_AGGREGATE_UNCONFIRMED'));
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener('abort', aborted);
      callback(value);
    };
    const aborted = () => finish(reject, failure('ANNOTATION_AGGREGATE_UNCONFIRMED'));
    signal.addEventListener('abort', aborted, { once: true });
    Promise.resolve().then(operation).then(
      value => {
        if (settled) {
          try { dispose?.(value); } catch { /* best-effort late response release */ }
          return;
        }
        finish(resolve, value);
      },
      () => finish(reject, failure('ANNOTATION_AGGREGATE_UNCONFIRMED')),
    );
  });
}

/**
 * Creates the app request adapter consumed by
 * createAnnotationGenerationAggregateTransport. That existing module remains
 * the sole owner of binary request and receipt validation. This adapter binds
 * each call to one actor, one document and the current session bearer token.
 * It sends one request and has no RPC, snapshot or legacy fallback.
 */
export function createAnnotationGenerationAggregateAppRequest(options = {}) {
  check(plain(options));
  const allowed = ['actorUserId', 'allowLoopback', 'client', 'documentId', 'fetch',
    'publicKey', 'supabaseUrl'];
  check(Object.keys(options).every(key => allowed.includes(key)));
  const { actorUserId, documentId, client, supabaseUrl, publicKey,
    fetch: fetcher = globalThis.fetch, allowLoopback = false } = options;
  check(UUID.test(actorUserId || '') && UUID.test(documentId || '')
    && typeof client?.auth?.getSession === 'function'
    && typeof supabaseUrl === 'string' && PUBLIC_KEY.test(publicKey || '')
    && typeof fetcher === 'function' && typeof allowLoopback === 'boolean');
  let origin;
  try { origin = new URL(supabaseUrl); }
  catch { throw failure('ANNOTATION_AGGREGATE_APP_REQUEST_INPUT'); }
  check((supabaseUrl === origin.origin || supabaseUrl === `${origin.origin}/`)
    && !origin.username && !origin.password && !origin.search && !origin.hash
    && origin.pathname === '/'
    && (origin.protocol === 'https:' || (allowLoopback && origin.protocol === 'http:'
      && ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname))));
  const endpoint = new URL('/functions/v1/annotation-generation-aggregate', origin).href;

  return async function annotationGenerationAggregateAppRequest(rawCall) {
    const call = checkedCall(rawCall, documentId);
    try {
      const sessionResult = await waitFor(() => client.auth.getSession(), call.signal);
      const session = sessionResult?.data?.session;
      check(!sessionResult?.error && session?.user?.id === actorUserId
        && TOKEN.test(session?.access_token || ''), 'ANNOTATION_ACTOR_MISMATCH');
      if (call.signal.aborted) throw failure('ANNOTATION_AGGREGATE_UNCONFIRMED');
      const response = await waitFor(() => fetcher(`${endpoint}?${call.search}`, {
        method: 'POST',
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
        signal: call.signal,
        headers: {
          ...call.headers,
          Authorization: `Bearer ${session.access_token}`,
          apikey: publicKey,
        },
        body: call.body,
      }), call.signal, cancel);
      if (call.signal.aborted) {
        cancel(response);
        throw failure('ANNOTATION_AGGREGATE_UNCONFIRMED');
      }
      return response;
    } catch (error) {
      if (error?.code === 'ANNOTATION_ACTOR_MISMATCH'
        || error?.code === 'ANNOTATION_AGGREGATE_APP_REQUEST_INPUT'
        || error?.code === 'ANNOTATION_AGGREGATE_UNCONFIRMED') throw error;
      throw failure('ANNOTATION_AGGREGATE_UNCONFIRMED');
    }
  };
}
