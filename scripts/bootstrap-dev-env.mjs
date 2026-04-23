#!/usr/bin/env node
// Ensures dev env files exist on any machine before `npm run dev` starts.
// Idempotent: only writes a file when it's missing — never overwrites edits.
// These files stay gitignored; this script is the single source of truth so
// a fresh clone on a new device boots without the "Supabase credentials not
// found" warning and without ever prompting for the dev app login.

import { existsSync, writeFileSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

// Only Supabase's public anon key + URL live here. Supabase anon keys are
// designed to be exposed client-side (security comes from row-level-policies)
// so this is safe to commit to the public repo. All other secrets — dev
// auto-login credentials, GitHub log tokens, Syncfusion licenses — stay in
// your local .env.local and never ship via git.
const ENV_MAIN = {
  VITE_SUPABASE_URL: 'https://cvamwtpsuvxvjdnotbeg.supabase.co',
  VITE_SUPABASE_ANON_KEY:
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImN2YW13dHBzdXZ4dmpkbm90YmVnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjI3NTM4MzcsImV4cCI6MjA3ODMyOTgzN30.fI0webVL6oTiyjdc2wssoMo06gW4oqawRR6uY9_7Ek4',
};

function formatEnvFile(header, entries) {
  const body = Object.entries(entries)
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  return `${header}\n${body}\n`;
}

function ensureFile(relPath, header, entries) {
  const abs = join(repoRoot, relPath);
  if (existsSync(abs)) {
    const existing = readFileSync(abs, 'utf8');
    const missing = Object.keys(entries).filter(
      (k) => !new RegExp(`^\\s*${k}=`, 'm').test(existing)
    );
    if (missing.length === 0) {
      return { path: relPath, action: 'skip' };
    }
    const appended =
      existing.replace(/\s*$/, '') +
      '\n\n# Added by bootstrap-dev-env (missing keys)\n' +
      missing.map((k) => `${k}=${entries[k]}`).join('\n') +
      '\n';
    writeFileSync(abs, appended, { mode: 0o600 });
    return { path: relPath, action: 'patched', missing };
  }
  writeFileSync(abs, formatEnvFile(header, entries), { mode: 0o600 });
  return { path: relPath, action: 'created' };
}

const MAIN_HEADER = `# Auto-created by scripts/bootstrap-dev-env.mjs.
# Safe to edit — the bootstrap only fills in missing keys, never overwrites
# values you change here. Stays gitignored.`;

const results = [ensureFile('.env', MAIN_HEADER, ENV_MAIN)];

for (const r of results) {
  if (r.action === 'created') {
    console.log(`[bootstrap-dev-env] created ${r.path}`);
  } else if (r.action === 'patched') {
    console.log(`[bootstrap-dev-env] patched ${r.path} (added: ${r.missing.join(', ')})`);
  }
}
