import {
  createDocumentReplacementNodeServer,
  createDocumentReplacementServiceAdapters,
} from '../src/services/documentReplacementNodeServer.js';

const MAX_RESPONSE_BYTES = 16 * 1024;
const CORS = Object.freeze({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
});

const enabled = env => env.SURVEY_DOCUMENT_REPLACEMENT === 'v5-definition-bound'
  && env.SURVEY_GENERATION_SOURCE_CAPTURE === 'v1-metadata-only'
  && env.SURVEY_GENERATION_SOURCE_ARCHIVES === 'v1-complete-source'
  && env.SURVEY_GENERATION_STORAGE_CONTRACT === 'versioned-standard-v1'
  && typeof env.SUPABASE_URL === 'string' && env.SUPABASE_URL.length > 0
  && typeof env.SUPABASE_ANON_KEY === 'string' && env.SUPABASE_ANON_KEY.length > 0
  && typeof env.SUPABASE_SERVICE_ROLE_KEY === 'string' && env.SUPABASE_SERVICE_ROLE_KEY.length > 0;

function send(response, status, body, headers = {}) {
  response.status(status);
  for (const [name, value] of Object.entries(headers)) response.setHeader(name, value);
  response.end(body);
}

export function createDocumentReplacementApiHandler({ environment = process.env,
  createServer = createDocumentReplacementNodeServer } = {}) {
  let runtime = null;
  return async function documentReplacementApi(request, response) {
    response.setHeader('Cache-Control', 'no-store');
    for (const [name, value] of Object.entries(CORS)) response.setHeader(name, value);
    if (request.method === 'OPTIONS') return send(response, 204, '');
    if (request.method !== 'POST') return send(response, 405,
      JSON.stringify({ error: { code: 'method_not_allowed' } }), { 'Content-Type': 'application/json' });
    if (!enabled(environment)) return send(response, 503, JSON.stringify({ error: {
      code: 'unavailable', message: 'Checked document replacement is not enabled.' } }),
    { 'Content-Type': 'application/json' });
    if (!runtime) runtime = createServer({ enabled: true,
      createAdapters: () => createDocumentReplacementServiceAdapters({
        url: environment.SUPABASE_URL, anonKey: environment.SUPABASE_ANON_KEY,
        serviceKey: environment.SUPABASE_SERVICE_ROLE_KEY }), timeoutMs: 120000 });
    const controller = new AbortController();
    const abort = () => controller.abort();
    request.on?.('aborted', abort);
    response.on?.('close', abort);
    try {
      const result = await runtime.handle({ authorization: request.headers?.authorization,
        body: request.body, signal: controller.signal });
      const bytes = new Uint8Array(await result.arrayBuffer());
      if (bytes.byteLength > MAX_RESPONSE_BYTES) return send(response, 502,
        JSON.stringify({ error: { code: 'invalid_receipt' } }), { 'Content-Type': 'application/json' });
      const headers = {};
      for (const name of ['access-control-allow-origin', 'access-control-allow-headers',
        'access-control-allow-methods', 'cache-control', 'content-type']) {
        const value = result.headers.get(name); if (value) headers[name] = value;
      }
      return send(response, result.status, Buffer.from(bytes), headers);
    } catch {
      return send(response, 502, JSON.stringify({ error: { code: 'replacement_failed' } }),
        { 'Content-Type': 'application/json' });
    } finally {
      request.off?.('aborted', abort);
      response.off?.('close', abort);
    }
  };
}

export default createDocumentReplacementApiHandler();
