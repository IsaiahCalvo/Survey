// scripts/e2e-minio.mjs — a local S3 server (MinIO) standing in for Cloudflare
// R2 in the signed-in E2E stack, so pdf-file-url and the app's R2 path run end
// to end (docs/PDF-R2.md, tests/e2e-signed-in/pdf-r2.spec.mjs).
//
// Best-effort: if Docker cannot start it, the stack still comes up, the R2
// spec skips, and pdf-file-url answers "R2 unavailable" so opens use Supabase.
// Local-only throwaway keys; nothing here is a real credential.
import { spawnSync } from 'node:child_process';
import { r2Request } from '../supabase/functions/_shared/r2.js';

// minio/minio left Docker Hub in 2025; Chainguard's build is the same server.
const IMAGE = 'chainguard/minio@sha256:e70b2b1e74d79457f808710483bd726ff364529ca30736eaa15a6ab547d3a5a7';
export const MINIO_CONTAINER = 'survey-e2e-minio';
export const MINIO_PORT = 54480;

export const E2E_R2 = Object.freeze({
  R2_ENDPOINT: `http://127.0.0.1:${MINIO_PORT}`,
  R2_BUCKET: 'survey-e2e-pdfs',
  R2_ACCESS_KEY_ID: 'e2e-minio-local',
  R2_SECRET_ACCESS_KEY: 'e2e-minio-local-secret',
  R2_REGION: 'us-east-1',
});
// The edge runtime container reaches MinIO by name on the stack's network;
// links it signs still name 127.0.0.1, which the browser uses.
export const E2E_R2_SERVER_ENDPOINT = `http://${MINIO_CONTAINER}:9000`;

const docker = (args) => spawnSync('docker', args, { encoding: 'utf8' });

export function stopE2eMinio() {
  docker(['rm', '-f', MINIO_CONTAINER]);
}

export async function startE2eMinio({ network, log = console.log } = {}) {
  stopE2eMinio();
  const run = docker([
    'run', '-d', '--name', MINIO_CONTAINER,
    ...(network ? ['--network', network] : []),
    '-p', `127.0.0.1:${MINIO_PORT}:9000`,
    '--tmpfs', '/data:uid=65532,gid=65532',
    '-e', `MINIO_ROOT_USER=${E2E_R2.R2_ACCESS_KEY_ID}`,
    '-e', `MINIO_ROOT_PASSWORD=${E2E_R2.R2_SECRET_ACCESS_KEY}`,
    IMAGE, 'server', '/data', '--address', ':9000',
  ]);
  if (run.status !== 0) {
    log(`MinIO did not start (${(run.stderr || '').trim().split('\n').pop()}); R2 tests will skip`);
    return false;
  }
  const config = { ...configFor(E2E_R2.R2_ENDPOINT) };
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const res = await r2Request(config, 'PUT', null);
      const text = await res.text();
      if (res.ok || text.includes('BucketAlreadyOwnedByYou')) {
        log(`MinIO ready on ${E2E_R2.R2_ENDPOINT}, bucket ${E2E_R2.R2_BUCKET}`);
        return true;
      }
    } catch { /* not listening yet */ }
    await new Promise((r) => setTimeout(r, 500));
  }
  log('MinIO never answered; R2 tests will skip');
  return false;
}

export const configFor = (endpoint) => ({
  endpoint,
  serverEndpoint: endpoint,
  bucket: E2E_R2.R2_BUCKET,
  accessKeyId: E2E_R2.R2_ACCESS_KEY_ID,
  secretAccessKey: E2E_R2.R2_SECRET_ACCESS_KEY,
  region: E2E_R2.R2_REGION,
});
