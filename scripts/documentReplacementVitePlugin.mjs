import { createDocumentReplacementApiHandler } from '../api/document-replacement.mjs';

const BODY_LIMIT = 16 * 1024;
const BODY_TIMEOUT_MS = 10_000;
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

const send = (response, status, value = null) => {
  response.statusCode = status;
  for (const [name, header] of Object.entries(CORS)) response.setHeader(name, header);
  response.setHeader('Cache-Control', 'no-store');
  if (value === null) return response.end();
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify(value));
};
const drain = request => { try { request.resume?.(); } catch { /* connection is already closed */ } };

function readBody(request, timeoutMs) {
  const contentLength = request.headers?.['content-length'];
  if (typeof contentLength !== 'undefined'
    && (typeof contentLength !== 'string' || !/^[0-9]+$/.test(contentLength))) {
    drain(request); return Promise.reject(Object.assign(new Error('invalid'), { code: 'invalid' }));
  }
  if (typeof contentLength === 'string' && /^[0-9]+$/.test(contentLength)
    && Number(contentLength) > BODY_LIMIT) {
    drain(request); return Promise.reject(Object.assign(new Error('too_large'), { code: 'too_large' }));
  }
  return new Promise((resolve, reject) => {
    const chunks = []; let length = 0; let done = false;
    const timer = setTimeout(() => fail(Object.assign(new Error('timeout'), { code: 'timeout' })), timeoutMs);
    const cleanup = () => {
      clearTimeout(timer);
      request.off?.('data', data); request.off?.('end', end); request.off?.('aborted', aborted);
      request.off?.('error', failed);
    };
    const finish = callback => value => {
      if (done) return; done = true; cleanup(); callback(value);
    };
    const fail = finish(reject);
    const data = chunk => {
      const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      length += value.byteLength;
      if (length > BODY_LIMIT) {
        drain(request); fail(Object.assign(new Error('too_large'), { code: 'too_large' })); return;
      }
      chunks.push(value);
    };
    const end = finish(() => {
      try { resolve(JSON.parse(Buffer.concat(chunks, length).toString('utf8'))); }
      catch { reject(Object.assign(new Error('invalid'), { code: 'invalid' })); }
    });
    const aborted = () => fail(Object.assign(new Error('aborted'), { code: 'aborted' }));
    const failed = () => fail(Object.assign(new Error('invalid'), { code: 'invalid' }));
    request.on('data', data); request.once('end', end); request.once('aborted', aborted); request.once('error', failed);
  });
}

const apiResponse = response => ({
  status(code) { response.statusCode = code; return this; },
  setHeader: (...args) => response.setHeader(...args),
  end: (...args) => response.end(...args),
  on: (...args) => response.on(...args),
  off: (...args) => response.off(...args),
});

export function documentReplacementVitePlugin({ environment = process.env,
  createApiHandler = createDocumentReplacementApiHandler, createServer,
  bodyTimeoutMs = BODY_TIMEOUT_MS } = {}) {
  if (!Number.isInteger(bodyTimeoutMs) || bodyTimeoutMs < 10 || bodyTimeoutMs > 60_000) {
    throw new Error('Invalid document replacement body timeout.');
  }
  let apiHandler = null;
  const api = () => {
    if (!apiHandler) apiHandler = createApiHandler({ environment, ...(createServer ? { createServer } : {}) });
    return apiHandler;
  };
  return {
    name: 'document-replacement-api',
    configureServer(server) {
      server.middlewares.use('/api/document-replacement', async (request, response) => {
        const pathname = String(request.url || '').split('?', 1)[0];
        if (pathname !== '' && pathname !== '/') { send(response, 404, { error: { code: 'not_found' } }); return; }
        if (request.method === 'OPTIONS') { send(response, 204); return; }
        if (request.method !== 'POST') {
          send(response, 405, { error: { code: 'method_not_allowed' } }); return;
        }
        if (!enabled(environment)) {
          drain(request);
          send(response, 503, { error: { code: 'unavailable', message: 'Checked document replacement is not enabled.' } });
          return;
        }
        const contentType = request.headers?.['content-type'];
        if (typeof contentType !== 'string' || !/^application\/json(?:\s*;.*)?$/i.test(contentType)) {
          drain(request); send(response, 415, { error: { code: 'unsupported_media_type' } }); return;
        }
        let body;
        try { body = await readBody(request, bodyTimeoutMs); }
        catch (error) {
          if (error?.code === 'aborted') { response.destroy(); return; }
          if (error?.code === 'timeout') response.setHeader('Connection', 'close');
          send(response, error?.code === 'too_large' ? 413 : error?.code === 'timeout' ? 408 : 400,
            { error: { code: error?.code === 'too_large' ? 'payload_too_large'
              : error?.code === 'timeout' ? 'request_timeout' : 'invalid_request' } });
          return;
        }
        await api()({ method: request.method, headers: request.headers, body,
          on: request.on.bind(request), off: request.off.bind(request) }, apiResponse(response));
      });
    },
  };
}
