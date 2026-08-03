#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);

function readArg(name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : '';
}

function readEnvValue(filePath, name) {
  const source = readFileSync(filePath, 'utf8');
  const match = source.match(new RegExp(`^\\s*${name}\\s*=\\s*(.+?)\\s*$`, 'm'));
  return match?.[1]?.replace(/^['\"]|['\"]$/g, '') || '';
}

const email = readArg('--email').trim().toLowerCase();
if (!email || !email.includes('@')) {
  console.error('Usage: npm run dev:auth:configure -- --email you@example.com');
  process.exit(1);
}

const supabaseUrl = readEnvValue(join(repoRoot, '.env'), 'VITE_SUPABASE_URL');
const projectRef = readArg('--project-ref') || supabaseUrl.match(/^https:\/\/([^.]+)\.supabase\.co$/)?.[1];
if (!projectRef) {
  console.error('Could not determine the Supabase project ref. Pass --project-ref explicitly.');
  process.exit(1);
}

let apiKeys;
try {
  const raw = execFileSync(
    'npx',
    ['--yes', 'supabase', 'projects', 'api-keys', '--project-ref', projectRef, '--reveal', '--output', 'json'],
    { cwd: repoRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }
  );
  apiKeys = JSON.parse(raw);
} catch {
  console.error('Could not read Supabase keys. Run `npx supabase login`, then retry.');
  process.exit(1);
}

const serviceRole = apiKeys.find((key) => key.id === 'service_role' && key.type === 'legacy')?.api_key;
if (!serviceRole) {
  console.error('The linked Supabase project did not return its legacy service-role key.');
  process.exit(1);
}

const configPath = join(homedir(), '.config', 'survey', 'dev-auth.env');
const tempPath = `${configPath}.${process.pid}.tmp`;
mkdirSync(dirname(configPath), { recursive: true, mode: 0o700 });
writeFileSync(
  tempPath,
  [
    '# Local Survey development auth. Never commit or expose this file.',
    `SURVEY_DEV_AUTH_EMAIL=${email}`,
    `SUPABASE_SERVICE_ROLE_KEY=${serviceRole}`,
    '',
  ].join('\n'),
  { mode: 0o600 }
);
chmodSync(tempPath, 0o600);
renameSync(tempPath, configPath);
chmodSync(configPath, 0o600);

console.log(`Configured persistent Survey dev auth for ${email}.`);
console.log(`Stored securely at ${configPath} (mode 0600).`);
