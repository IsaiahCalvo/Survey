// Shared Supabase admin client for audit scripts.
// Reads SUPABASE URL + service-role key from .env / .env.local in the WORKTREE.
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..', '..', '..');

function parseEnv(path) {
  try {
    const raw = readFileSync(path, 'utf8');
    const out = {};
    for (const line of raw.split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (!m) continue;
      let v = m[2];
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      out[m[1]] = v;
    }
    return out;
  } catch {
    return {};
  }
}

const envFile = parseEnv(join(REPO_ROOT, '.env'));
const envLocal = parseEnv(join(REPO_ROOT, '.env.local'));
const merged = { ...envFile, ...envLocal };

export const SUPABASE_URL = merged.VITE_SUPABASE_URL;
export const SUPABASE_ANON_KEY = merged.VITE_SUPABASE_ANON_KEY;
export const SUPABASE_SERVICE_ROLE_KEY = merged.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env');
}

// Sanity check project ref
const ref = SUPABASE_URL.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
if (ref !== 'cvamwtpsuvxvjdnotbeg') {
  throw new Error(`Wrong project ref: ${ref}, expected cvamwtpsuvxvjdnotbeg`);
}

export const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { autoRefreshToken: false, persistSession: false }
});

export const anonClient = () =>
  createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false }
  });
