const TOKEN = /^[^\s\u0000-\u001f\u007f]{1,16384}$/;
const ENDPOINTS = Object.freeze({
  'same-origin': '/api/document-replacement',
  'trusted-app-host': 'https://surveytool.app/api/document-replacement',
});

const failure = () => Object.assign(
  new Error('Checked page changes are not available. Your page change was kept.'),
  { code: 'DOCUMENT_PAGE_REPLACEMENT_UNAVAILABLE' },
);
const check = value => { if (!value) throw failure(); };
const plain = value => value !== null && typeof value === 'object'
  && Object.getPrototypeOf(value) === Object.prototype;

function exactDataObject(value, keys) {
  if (!plain(value)) return null;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const ownKeys = Reflect.ownKeys(descriptors);
  if (ownKeys.length !== keys.length || ownKeys.some(key => typeof key !== 'string')
    || [...ownKeys].sort().some((key, index) => key !== keys[index])
    || keys.some(key => !descriptors[key]?.enumerable
      || !Object.hasOwn(descriptors[key], 'value'))) return null;
  return Object.freeze(Object.fromEntries(keys.map(key => [key, descriptors[key].value])));
}

/** One-request HTTP adapter for createDocumentPageReplacementClient. The
 * client owns actor, document, intent and receipt checks. This adapter owns the
 * trusted endpoint and sends no cookies, retry or alternate request. */
export function createDocumentPageReplacementTransport(options = {}) {
  const optionKeys = plain(options) ? Reflect.ownKeys(options) : [];
  const captured = optionKeys.every(key => key === 'fetch' || key === 'target')
    ? exactDataObject(options, optionKeys.sort()) : null;
  check(captured);
  const fetcher = captured.fetch ?? globalThis.fetch;
  check(typeof fetcher === 'function');
  const target = Object.hasOwn(captured, 'target') ? captured.target : 'same-origin';
  check(typeof target === 'string' && Object.hasOwn(ENDPOINTS, target));
  const endpoint = ENDPOINTS[target];

  return async function documentPageReplacementTransport(rawCall) {
    const call = exactDataObject(rawCall, ['accessToken', 'body', 'signal']);
    check(call && typeof call.accessToken === 'string' && TOKEN.test(call.accessToken)
      && plain(call.body)
      && call.signal instanceof AbortSignal && !call.signal.aborted);
    try {
      return await fetcher(endpoint, { method: 'POST', redirect: 'error', credentials: 'omit',
        cache: 'no-store', signal: call.signal,
        headers: { Authorization: `Bearer ${call.accessToken}`,
          'Content-Type': 'application/json' }, body: JSON.stringify(call.body) });
    } catch { throw failure(); }
  };
}
