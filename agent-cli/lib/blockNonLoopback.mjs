// Network guard for every Playwright harness under agent-cli/.
// Harnesses must never reach production: each browser context aborts any
// request whose host is not loopback, and a harness refuses to start vite when
// the env it would load points Supabase at a non-loopback host.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const PROD_SUPABASE_REF = 'cvamwtpsuvxvjdnotbeg';
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1']);

export function isLoopbackUrl(value) {
  let url;
  try {
    url = value instanceof URL ? value : new URL(String(value));
  } catch {
    return false;
  }
  if (url.protocol === 'data:' || url.protocol === 'blob:') return true;
  return LOOPBACK_HOSTS.has(url.hostname);
}

// Accepts a context, a promise of one, or null (optional second contexts).
// Returns the same context so callers can wrap the creating expression.
export async function guardContext(contextOrPromise) {
  const context = await contextOrPromise;
  if (!context) return context;
  await context.route((url) => !isLoopbackUrl(url), (route) => route.abort('blockedbyclient'));
  return context;
}

function parseEnvFile(source) {
  const values = {};
  for (const line of String(source).split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!match) continue;
    let value = match[2];
    if ((value.startsWith('"') && value.endsWith('"'))
      || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    values[match[1]] = value;
  }
  return values;
}

// Files vite (and vite.config.js's dev-auth loader) would read in dev mode.
export function viteEnvFiles(cwd = process.cwd(), homedir = os.homedir()) {
  return [
    '.env', '.env.local', '.env.development', '.env.development.local',
  ].map((name) => path.join(cwd, name))
    .concat(path.join(homedir, '.config', 'survey', 'dev-auth.env'));
}

export function assertNoProdEnv({
  env = process.env,
  files = viteEnvFiles(),
  readFile = (file) => fs.readFileSync(file, 'utf8'),
} = {}) {
  const sources = [['process.env', env.VITE_SUPABASE_URL]];
  for (const file of files) {
    let source;
    try {
      source = readFile(file);
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    sources.push([file, parseEnvFile(source).VITE_SUPABASE_URL]);
  }
  for (const [where, value] of sources) {
    if (!value) continue;
    if (String(value).includes(PROD_SUPABASE_REF) || !isLoopbackUrl(value)) {
      throw new Error(`Refusing to run harness: VITE_SUPABASE_URL from ${where} is not loopback (${value}).`);
    }
  }
}
