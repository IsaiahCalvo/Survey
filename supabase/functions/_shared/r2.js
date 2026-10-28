// Cloudflare R2 (or any S3-compatible store, MinIO in the e2e stack) with AWS
// Signature V4, using only fetch and Web Crypto so the same file runs in the
// edge functions (Deno), the copy script and the tests (Node).
//
// Environment, all four required, else R2 is off:
//   R2_ENDPOINT           https://<account id>.r2.cloudflarestorage.com
//   R2_BUCKET             the bucket the PDFs are copied into
//   R2_ACCESS_KEY_ID      an R2 API token's access key (Object Read & Write)
//   R2_SECRET_ACCESS_KEY  its secret
// Optional:
//   R2_REGION             'auto' for R2; MinIO wants 'us-east-1'
//   R2_SERVER_ENDPOINT    where server-side calls go when it differs from the
//                         address browsers use (the e2e stack's edge runtime
//                         reaches MinIO by container name, the browser by
//                         127.0.0.1). Presigned links always use R2_ENDPOINT.

const encoder = new TextEncoder();
const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
export const UNSIGNED_PAYLOAD = 'UNSIGNED-PAYLOAD';

export function r2ConfigFromEnv(get) {
  const read = (name) => String(get(name) ?? '').trim();
  const endpoint = read('R2_ENDPOINT').replace(/\/+$/, '');
  const bucket = read('R2_BUCKET');
  const accessKeyId = read('R2_ACCESS_KEY_ID');
  const secretAccessKey = read('R2_SECRET_ACCESS_KEY');
  if (!endpoint || !bucket || !accessKeyId || !secretAccessKey) return null;
  if (!/^https?:\/\//.test(endpoint)) return null;
  return {
    endpoint,
    serverEndpoint: read('R2_SERVER_ENDPOINT').replace(/\/+$/, '') || endpoint,
    bucket,
    accessKeyId,
    secretAccessKey,
    region: read('R2_REGION') || 'auto',
  };
}

// RFC 3986 encoding, as SigV4 wants it ('/' kept in object keys).
const encodeRfc3986 = (value) => encodeURIComponent(value)
  .replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
const encodeKey = (key) => String(key).split('/').map(encodeRfc3986).join('/');

const hex = (buffer) => [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, '0')).join('');

async function sha256Hex(data) {
  return hex(await crypto.subtle.digest('SHA-256', typeof data === 'string' ? encoder.encode(data) : data));
}

async function hmac(key, data) {
  const cryptoKey = await crypto.subtle.importKey(
    'raw', typeof key === 'string' ? encoder.encode(key) : key,
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  return crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(data));
}

async function signingKey(secret, date, region) {
  const kDate = await hmac(`AWS4${secret}`, date);
  const kRegion = await hmac(kDate, region);
  const kService = await hmac(kRegion, 's3');
  return hmac(kService, 'aws4_request');
}

const amzDate = (now) => now.toISOString().replace(/[:-]|\.\d{3}/g, '');

function canonicalQuery(query) {
  return Object.keys(query)
    .sort()
    .map((k) => `${encodeRfc3986(k)}=${encodeRfc3986(String(query[k]))}`)
    .join('&');
}

async function sign({ config, method, base, key, query, headers, payloadHash, now }) {
  const url = new URL(`${base}/${encodeRfc3986(config.bucket)}${key == null ? '' : `/${encodeKey(key)}`}`);
  const stamp = amzDate(now);
  const date = stamp.slice(0, 8);
  const scope = `${date}/${config.region}/s3/aws4_request`;
  const allHeaders = { ...headers, host: url.host };
  const names = Object.keys(allHeaders).map((n) => n.toLowerCase()).sort();
  const lower = Object.fromEntries(Object.entries(allHeaders).map(([n, v]) => [n.toLowerCase(), String(v).trim()]));
  const canonicalRequest = [
    method,
    url.pathname,
    canonicalQuery(query),
    names.map((n) => `${n}:${lower[n]}\n`).join(''),
    names.join(';'),
    payloadHash,
  ].join('\n');
  const stringToSign = ['AWS4-HMAC-SHA256', stamp, scope, await sha256Hex(canonicalRequest)].join('\n');
  const signature = hex(await hmac(await signingKey(config.secretAccessKey, date, config.region), stringToSign));
  return { url, stamp, scope, signedHeaders: names.join(';'), signature };
}

// A link anyone holding it can GET (with Range) until it runs out.
export async function presignGet(config, key, { expiresIn = 300, now = new Date() } = {}) {
  const base = { 'X-Amz-Algorithm': 'AWS4-HMAC-SHA256', 'X-Amz-Date': amzDate(now), 'X-Amz-Expires': String(expiresIn), 'X-Amz-SignedHeaders': 'host' };
  const date = base['X-Amz-Date'].slice(0, 8);
  base['X-Amz-Credential'] = `${config.accessKeyId}/${date}/${config.region}/s3/aws4_request`;
  const { url, signature } = await sign({
    config, method: 'GET', base: config.endpoint, key, query: base, headers: {}, payloadHash: UNSIGNED_PAYLOAD, now,
  });
  return `${url.origin}${url.pathname}?${canonicalQuery(base)}&X-Amz-Signature=${signature}`;
}

// One signed server-side call. A body that is not a string or bytes is sent
// unsigned (UNSIGNED-PAYLOAD), which R2 and MinIO accept over HTTPS and HTTP.
export async function r2Request(config, method, key, { query = {}, headers = {}, body, fetchImpl = fetch, now = new Date() } = {}) {
  let payloadHash = EMPTY_SHA256;
  if (typeof body === 'string' || body instanceof Uint8Array || body instanceof ArrayBuffer) {
    payloadHash = await sha256Hex(body);
  } else if (body != null) {
    payloadHash = UNSIGNED_PAYLOAD;
  }
  const signedHeaders = { ...headers, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate(now) };
  const { url, scope, signedHeaders: names, signature } = await sign({
    config, method, base: config.serverEndpoint, key, query, headers: signedHeaders, payloadHash, now,
  });
  const qs = canonicalQuery(query);
  return fetchImpl(`${url.origin}${url.pathname}${qs ? `?${qs}` : ''}`, {
    method,
    headers: {
      ...signedHeaders,
      Authorization: `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, SignedHeaders=${names}, Signature=${signature}`,
    },
    body,
  });
}

// HEAD: { exists, size, meta } where meta holds the x-amz-meta-* headers.
export async function headObject(config, key, opts = {}) {
  const res = await r2Request(config, 'HEAD', key, opts);
  if (res.status === 404) return { exists: false };
  if (!res.ok) throw new Error(`R2 HEAD ${res.status}`);
  const meta = {};
  res.headers.forEach((value, name) => {
    if (name.toLowerCase().startsWith('x-amz-meta-')) meta[name.toLowerCase().slice(11)] = value;
  });
  return { exists: true, size: Number(res.headers.get('content-length')), meta };
}

export async function deleteObject(config, key, opts = {}) {
  const res = await r2Request(config, 'DELETE', key, opts);
  // S3 answers 204 for a key that was never there too.
  if (!res.ok && res.status !== 404) throw new Error(`R2 DELETE ${res.status}`);
  await res.body?.cancel();
}

const xmlEscape = (s) => String(s).replace(/[<>&'"]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[c]));
const xmlValue = (xml, tag) => xml.match(new RegExp(`<${tag}>([^<]*)</${tag}>`))?.[1] ?? null;

// Parts R2 needs to be the same size (all but the last) and at least 5 MiB.
export const PART_SIZE = 8 * 1024 * 1024;

async function readExactly(reader, carry, size) {
  const chunks = carry.length ? [carry] : [];
  let length = carry.length;
  while (length < size) {
    const { value, done } = await reader.read();
    if (done) break;
    chunks.push(value);
    length += value.byteLength;
  }
  const all = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { all.set(chunk, offset); offset += chunk.byteLength; }
  return { part: all.subarray(0, Math.min(size, length)), rest: all.subarray(Math.min(size, length)) };
}

// Streams `body` (a ReadableStream) into `key`, holding at most one part in
// memory, so a 300 MB drawing set fits an edge function. Small files are one PUT.
export async function putObjectStream(config, key, body, { meta = {}, contentType = 'application/pdf', fetchImpl = fetch } = {}) {
  const metaHeaders = Object.fromEntries(Object.entries(meta).map(([k, v]) => [`x-amz-meta-${k}`, String(v)]));
  const reader = body.getReader();
  let { part, rest } = await readExactly(reader, new Uint8Array(0), PART_SIZE);
  const next = await readExactly(reader, rest, PART_SIZE);
  if (next.part.byteLength === 0) {
    const res = await r2Request(config, 'PUT', key, {
      headers: { ...metaHeaders, 'content-type': contentType }, body: part, fetchImpl,
    });
    if (!res.ok) throw new Error(`R2 PUT ${res.status}`);
    await res.body?.cancel();
    return { size: part.byteLength };
  }

  const created = await r2Request(config, 'POST', key, {
    query: { uploads: '' }, headers: { ...metaHeaders, 'content-type': contentType }, fetchImpl,
  });
  if (!created.ok) throw new Error(`R2 multipart start ${created.status}`);
  const uploadId = xmlValue(await created.text(), 'UploadId');
  if (!uploadId) throw new Error('R2 multipart start: no UploadId');
  const etags = [];
  let size = 0;
  try {
    let current = part;
    let pending = next;
    for (let partNumber = 1; current.byteLength > 0; partNumber += 1) {
      const res = await r2Request(config, 'PUT', key, {
        query: { partNumber: String(partNumber), uploadId }, body: current, fetchImpl,
      });
      if (!res.ok) throw new Error(`R2 part ${partNumber} ${res.status}`);
      await res.body?.cancel();
      etags.push(res.headers.get('etag'));
      size += current.byteLength;
      current = pending.part;
      pending = current.byteLength ? await readExactly(reader, pending.rest, PART_SIZE) : pending;
    }
    const xml = `<CompleteMultipartUpload>${etags.map((etag, i) => `<Part><PartNumber>${i + 1}</PartNumber><ETag>${xmlEscape(etag)}</ETag></Part>`).join('')}</CompleteMultipartUpload>`;
    const done = await r2Request(config, 'POST', key, { query: { uploadId }, body: xml, fetchImpl });
    const text = await done.text();
    // S3 can answer 200 with an <Error> body here.
    if (!done.ok || text.includes('<Error>')) throw new Error(`R2 multipart finish ${done.status}`);
    return { size };
  } catch (error) {
    await r2Request(config, 'DELETE', key, { query: { uploadId }, fetchImpl }).then((r) => r.body?.cancel()).catch(() => {});
    throw error;
  }
}

// One page of keys under `prefix`: { keys, next } (next = continuation token).
export async function listObjects(config, prefix, { continuationToken, fetchImpl = fetch } = {}) {
  const query = { 'list-type': '2', prefix, 'max-keys': '1000' };
  if (continuationToken) query['continuation-token'] = continuationToken;
  const res = await r2Request(config, 'GET', null, { query, fetchImpl });
  const xml = await res.text();
  if (!res.ok) throw new Error(`R2 LIST ${res.status}`);
  const keys = [...xml.matchAll(/<Key>([^<]*)<\/Key>/g)].map((m) => m[1]
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&'));
  const truncated = xmlValue(xml, 'IsTruncated') === 'true';
  return { keys, next: truncated ? xmlValue(xml, 'NextContinuationToken') : null };
}

// Lets browsers stream the presigned links (pdf.js range requests) from any of
// the app's origins: web, Electron file:// (Origin: null) and the mobile apps.
// The links carry no cookie or token beyond their own signature.
export async function putBucketCors(config, { fetchImpl = fetch } = {}) {
  const xml = '<CORSConfiguration><CORSRule>'
    + '<AllowedOrigin>*</AllowedOrigin><AllowedMethod>GET</AllowedMethod><AllowedMethod>HEAD</AllowedMethod>'
    + '<AllowedHeader>range</AllowedHeader>'
    + '<ExposeHeader>Content-Length</ExposeHeader><ExposeHeader>Content-Range</ExposeHeader>'
    + '<ExposeHeader>Accept-Ranges</ExposeHeader><ExposeHeader>ETag</ExposeHeader>'
    + '<MaxAgeSeconds>3600</MaxAgeSeconds></CORSRule></CORSConfiguration>';
  const md5 = await md5Base64(xml);
  const res = await r2Request(config, 'PUT', null, {
    query: { cors: '' }, headers: md5 ? { 'content-md5': md5 } : {}, body: xml, fetchImpl,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`R2 PUT cors ${res.status}: ${text.slice(0, 200)}`);
}

// S3 asks for Content-MD5 on PutBucketCors; Web Crypto has no MD5, so it comes
// from node:crypto where that exists (the copy script) and is left out
// elsewhere (R2 does not require it).
async function md5Base64(text) {
  try {
    const { createHash } = await import('node:crypto');
    return createHash('md5').update(text).digest('base64');
  } catch {
    return null;
  }
}

export const r2KeyForDocument = (path) => `documents/${String(path).replace(/^\/+/, '')}`;
