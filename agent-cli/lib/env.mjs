// agent-cli/lib/env.mjs — load local credential files into process.env.
//
// Mirrors the inline .env parser the existing live-contract e2e scripts use
// (scripts/fix19-live-auth-contract-e2e.mjs et al). Reads .env then .env.local
// from the repo root; later files do NOT override values already set. These
// files are gitignored and hold the Supabase URL, anon key, service-role key,
// and the dev test-login credentials — everything this CLI needs to reach the
// real backend headlessly. No secret values are ever printed.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function loadFile(name) {
  let text;
  try {
    text = readFileSync(join(REPO_ROOT, name), 'utf8');
  } catch {
    return;
  }
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

export function loadEnv() {
  loadFile('.env');
  loadFile('.env.local');
}
