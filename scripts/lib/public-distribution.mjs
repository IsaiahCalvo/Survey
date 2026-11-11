import { createHash } from 'node:crypto';

// Public app files only. Never use the documents, media or backup buckets here.
export const PROJECT = 'cvamwtpsuvxvjdnotbeg';
export const BUCKET = 'app-public';
export const PUBLIC_BASE = `https://${PROJECT}.supabase.co/storage/v1/object/public/${BUCKET}`;

export async function distributionStore(env = process.env, fetcher = fetch) {
  const base = `https://${PROJECT}.supabase.co`;
  let key = env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key && env.SUPABASE_ACCESS_TOKEN) {
    const response = await fetcher(`https://api.supabase.com/v1/projects/${PROJECT}/api-keys?reveal=true`, {
      headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Could not read publishing key (${response.status})`);
    const keys = await response.json();
    key = keys.find((item) => item.name === 'service_role' || item.id === 'service_role')?.api_key;
  }
  if (!key) throw new Error('Publishing needs SUPABASE_ACCESS_TOKEN or SUPABASE_SERVICE_ROLE_KEY');
  if (env.GITHUB_ACTIONS === 'true') console.log(`::add-mask::${key}`);
  const headers = { apikey: key, Authorization: `Bearer ${key}` };
  return {
    async ensureBucket() {
      const response = await fetcher(`${base}/storage/v1/bucket/${BUCKET}`, { headers });
      if (response.ok) {
        const bucket = await response.json();
        if (bucket.public !== true) throw new Error('Public app bucket is private; refusing to change an existing bucket');
        return;
      }
      const error = await response.json().catch(() => ({}));
      if (response.status !== 404 && error.message !== 'Bucket not found') throw new Error(`Bucket check failed (${response.status})`);
      const created = await fetcher(`${base}/storage/v1/bucket`, {
        method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: BUCKET, name: BUCKET, public: true, file_size_limit: 1024 * 1024 * 1024 }),
      });
      if (!created.ok) throw new Error(`Could not create public app bucket (${created.status})`);
    },
    async put(path, body, type = 'application/octet-stream', mutable = false) {
      if (!/^(?:desktop\/(?:v[\d.]+\/survey[- ][\w. -]+\.(?:exe|dmg|zip|blockmap)|latest(?:-mac)?\.yml)|android\/survey-(?:stable|nightly)\.apk|status\.json)$/.test(path)) {
        throw new Error('File is outside the public app allowlist');
      }
      const response = await fetcher(`${base}/storage/v1/object/${BUCKET}/${path.split('/').map(encodeURIComponent).join('/')}`, {
        method: 'POST', headers: { ...headers, 'Content-Type': type, 'x-upsert': String(mutable), 'cache-control': mutable ? '60' : '31536000' },
        body, signal: AbortSignal.timeout(600_000),
      });
      if (!response.ok) {
        const error = await response.json().catch(() => ({}));
        if (!mutable && (response.status === 409 || error.error === 'Duplicate')) {
          const existing = await fetcher(`${PUBLIC_BASE}/${path.split('/').map(encodeURIComponent).join('/')}`);
          const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
          if (existing.ok && hash(Buffer.from(await existing.arrayBuffer())) === hash(body)) return;
          throw new Error(`Published version differs; bump the app version: ${path}`);
        }
        throw new Error(`Public app upload failed (${response.status}): ${path}`);
      }
    },
  };
}
