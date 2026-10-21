#!/usr/bin/env node
// scripts/e2e-local-supabase.mjs — local Supabase stack for the signed-in E2E
// suite (tests/e2e-signed-in/). How-to: docs/E2E-SIGNED-IN.md.
//
//   node scripts/e2e-local-supabase.mjs up      # start stack + write .env.e2e + seed
//   node scripts/e2e-local-supabase.mjs seed    # (re)seed only; idempotent
//   node scripts/e2e-local-supabase.mjs env     # rewrite .env.e2e from a running stack
//   node scripts/e2e-local-supabase.mjs status  # print stack status
//   node scripts/e2e-local-supabase.mjs down    # stop stack and drop its data
//
// The stack runs from a throwaway workdir (.e2e/supabase-stack, git-ignored)
// instead of the repo's supabase/ folder, for two reasons:
//   1. Its own project_id and ports (544xx) keep it from colliding with a dev
//      `supabase start` run from the repo (543xx).
//   2. Services the suite does not use (studio, mail, analytics, image proxy,
//      pooler) are switched off so it starts fast. The edge runtime stays on:
//      account deletion is only end to end through the real function.
//      E2E_EDGE_RUNTIME=off drops it where its container cannot start (some
//      sandboxes refuse its file limit); then serve the functions yourself and
//      point E2E_FUNCTIONS_URL at them (scripts/e2e-serve-functions.ts).
// Its migrations are a straight copy of supabase/migrations/: that folder
// alone builds the database (20241220000000_baseline.sql recreates what
// production had before the chain began).
//
// Everything here talks to 127.0.0.1 only. It refuses to seed any other host.

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import {
  E2E_ACCOUNTS,
  E2E_BASE_URL,
  E2E_DOCUMENT,
  E2E_PROJECT,
} from '../tests/e2e-signed-in/accounts.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STACK_DIR = path.resolve(ROOT, process.env.E2E_STACK_DIR || '.e2e/supabase-stack');
const ENV_FILE = path.join(ROOT, '.env.e2e');
const CLI_VERSION = '2.111.0'; // same pin as .github/workflows/deploy-production.yml
const PROJECT_ID = 'survey-e2e';
const EXCLUDED = [
  'studio', 'imgproxy', 'mailpit', 'postgres-meta',
  'logflare', 'vector', 'supavisor',
  ...(process.env.E2E_EDGE_RUNTIME === 'off' ? ['edge-runtime'] : []),
  // The iOS job's Colima VM is too slow for realtime's health check; the walk does not use it.
  ...(process.env.E2E_REALTIME === 'off' ? ['realtime'] : []),
];

const log = (...args) => console.log('[e2e-stack]', ...args);
const fail = (message) => {
  console.error(`[e2e-stack] ${message}`);
  process.exit(1);
};

function supabaseCli() {
  if (process.env.SUPABASE_CLI) return process.env.SUPABASE_CLI.split(' ');
  const probe = spawnSync('supabase', ['--version'], { encoding: 'utf8' });
  if (probe.status === 0 && probe.stdout.trim() === CLI_VERSION) return ['supabase'];
  return ['npx', '--yes', `supabase@${CLI_VERSION}`];
}

function runCli(args, { capture = false, allowFail = false } = {}) {
  const [cmd, ...pre] = supabaseCli();
  const result = spawnSync(cmd, [...pre, ...args, '--workdir', STACK_DIR], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: capture ? ['ignore', 'pipe', 'pipe'] : 'inherit',
  });
  if (result.status !== 0 && !allowFail) {
    if (capture) process.stderr.write(`${result.stdout || ''}${result.stderr || ''}`);
    fail(`supabase ${args.join(' ')} failed (exit ${result.status})`);
  }
  return result;
}

// Section-aware rewrite of the repo's config.toml for the E2E workdir.
export function buildStackConfig(source) {
  const disable = new Set(['studio', 'inbucket', 'analytics', 'db.seed', 'db.pooler']);
  let section = '';
  return source.split('\n').map((line) => {
    const header = line.match(/^\s*\[([^\]]+)\]\s*$/);
    if (header) {
      section = header[1].trim();
      return line;
    }
    if (/^project_id\s*=/.test(line)) return `project_id = "${PROJECT_ID}"`;
    if (disable.has(section) && /^enabled\s*=/.test(line)) return 'enabled = false';
    if (/^(shadow_)?port\s*=\s*543\d\d\s*$/.test(line)) return line.replace(/543(\d\d)/, '544$1');
    // Production runs the OAuth server for outside AI agents (public/auth.md).
    if (section === 'auth.oauth_server' && /^(enabled|allow_dynamic_registration)\s*=/.test(line)) {
      return line.replace(/=.*/, '= true');
    }
    // Every test client signs in from 127.0.0.1, so the per-IP sign-in limit
    // (30 per 5 minutes) would stop scripts/db-load-test.mjs after 30 users.
    if (section === 'auth.rate_limit' && /^(sign_in_sign_ups|token_refresh)\s*=/.test(line)) {
      return line.replace(/=.*/, '= 10000');
    }
    if (section === 'auth' && /^site_url\s*=/.test(line)) return `site_url = "${E2E_BASE_URL}"`;
    if (section === 'auth' && /^additional_redirect_urls\s*=/.test(line)) {
      return `additional_redirect_urls = ["${E2E_BASE_URL}", "${E2E_BASE_URL.replace('127.0.0.1', 'localhost')}"]`;
    }
    return line;
  }).join('\n');
}

function prepareWorkdir() {
  const supabaseDir = path.join(STACK_DIR, 'supabase');
  const migrationsDir = path.join(supabaseDir, 'migrations');
  fs.rmSync(migrationsDir, { recursive: true, force: true });
  fs.mkdirSync(migrationsDir, { recursive: true });
  const config = buildStackConfig(fs.readFileSync(path.join(ROOT, 'supabase/config.toml'), 'utf8'));
  fs.writeFileSync(path.join(supabaseDir, 'config.toml'), config);
  const repoMigrations = fs.readdirSync(path.join(ROOT, 'supabase/migrations'))
    .filter((name) => name.endsWith('.sql'))
    .sort();
  for (const name of repoMigrations) {
    fs.copyFileSync(path.join(ROOT, 'supabase/migrations', name), path.join(migrationsDir, name));
  }
  const functionsDir = path.join(supabaseDir, 'functions');
  fs.rmSync(functionsDir, { recursive: true, force: true });
  fs.cpSync(path.join(ROOT, 'supabase/functions'), functionsDir, {
    recursive: true,
    filter: (source) => !source.includes(`${path.sep}node_modules`),
  });
  // The Survey agent answers "enabled" for the seeded owner, so app walks can
  // open it and start hands-free. The key is fake: nothing reaches Groq, and
  // a model call would fail, never cost.
  fs.writeFileSync(path.join(functionsDir, '.env'), [
    'GROQ_API_KEY=e2e-fake-no-calls',
    `SURVEY_AGENT_TESTERS=${E2E_ACCOUNTS.owner.email}`,
    'SURVEY_AGENT_TTS=off',
    '',
  ].join('\n'));
  log(`workdir ${path.relative(ROOT, STACK_DIR)}: ${repoMigrations.length} migrations`);
}

function readStatus() {
  const result = runCli(['status', '-o', 'json'], { capture: true, allowFail: true });
  if (result.status !== 0) return null;
  const text = result.stdout.slice(result.stdout.indexOf('{'));
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function writeEnvFile(status) {
  const url = status.API_URL;
  const anonKey = status.ANON_KEY;
  const serviceKey = status.SERVICE_ROLE_KEY;
  if (!url || !anonKey || !serviceKey) fail('supabase status did not report API_URL / ANON_KEY / SERVICE_ROLE_KEY');
  const body = [
    '# Written by scripts/e2e-local-supabase.mjs — LOCAL E2E stack only. Git-ignored.',
    '# Vite reads this with `--mode e2e`; Playwright reads it via playwright.e2e-signed-in.config.mjs.',
    `VITE_SUPABASE_URL=${url}`,
    `VITE_SUPABASE_ANON_KEY=${anonKey}`,
    `SUPABASE_SERVICE_ROLE_KEY=${serviceKey}`,
    `E2E_SUPABASE_DB_URL=${status.DB_URL || ''}`,
    `E2E_BASE_URL=${E2E_BASE_URL}`,
    '# Local GoTrue has no CAPTCHA; an empty key turns the Turnstile widget off.',
    'VITE_TURNSTILE_SITE_KEY=',
    '',
  ].join('\n');
  fs.writeFileSync(ENV_FILE, body, { mode: 0o600 });
  log(`wrote ${path.relative(ROOT, ENV_FILE)} (${url})`);
  return { url, anonKey, serviceKey };
}

function readEnvFile() {
  if (!fs.existsSync(ENV_FILE)) return null;
  const env = {};
  for (const line of fs.readFileSync(ENV_FILE, 'utf8').split('\n')) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (match) env[match[1]] = match[2];
  }
  return env.VITE_SUPABASE_URL
    ? { url: env.VITE_SUPABASE_URL, anonKey: env.VITE_SUPABASE_ANON_KEY, serviceKey: env.SUPABASE_SERVICE_ROLE_KEY }
    : null;
}

function assertLocal(url) {
  const host = new URL(url).hostname;
  if (!['127.0.0.1', 'localhost'].includes(host)) fail(`refusing to seed non-local Supabase host "${host}"`);
}

async function ensureUser(admin, account, existingByEmail) {
  const attrs = {
    password: account.password,
    email_confirm: true,
    user_metadata: { first_name: account.firstName, last_name: account.lastName, full_name: account.label },
  };
  const existing = existingByEmail.get(account.email);
  if (existing) {
    // A password change needs an ask first (migration 20261022020200).
    const { error: askError } = await admin.rpc('begin_auth_change', { p_action: 'password', p_user_id: existing.id });
    if (askError) throw new Error(`begin_auth_change ${account.email}: ${askError.message}`);
    const { data, error } = await admin.auth.admin.updateUserById(existing.id, attrs);
    if (error) throw new Error(`update user ${account.email}: ${error.message}`);
    return data.user;
  }
  const { data, error } = await admin.auth.admin.createUser({ email: account.email, ...attrs });
  if (error) throw new Error(`create user ${account.email}: ${error.message}`);
  return data.user;
}

async function must(label, promise) {
  const { data, error } = await promise;
  if (error) throw new Error(`${label}: ${error.message}`);
  return data;
}

export async function seed({ url, serviceKey }) {
  assertLocal(url);
  const admin = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const listed = await must('list users', admin.auth.admin.listUsers({ page: 1, perPage: 1000 }));
  const existingByEmail = new Map(listed.users.map((user) => [user.email, user]));
  const ids = {};
  for (const [key, account] of Object.entries(E2E_ACCOUNTS)) {
    const user = await ensureUser(admin, account, existingByEmail);
    ids[key] = user.id;
    await must(`subscription ${account.email}`, admin.from('user_subscriptions').upsert({
      user_id: user.id,
      tier: account.tier,
      status: 'active',
    }, { onConflict: 'user_id' }));
  }

  const ownerId = ids.owner;
  await must('project', admin.from('projects').upsert({
    id: E2E_PROJECT.id,
    user_id: ownerId,
    name: E2E_PROJECT.name,
    description: 'Seeded by scripts/e2e-local-supabase.mjs',
  }, { onConflict: 'id' }));

  const pdfBytes = fs.readFileSync(path.join(ROOT, E2E_DOCUMENT.fixture));
  const sha = createHash('sha256').update(pdfBytes).digest('hex');
  const filePath = `${ownerId}/${E2E_DOCUMENT.id}.pdf`;
  await must('upload pdf', admin.storage.from('documents').upload(
    filePath,
    new Blob([pdfBytes], { type: 'application/pdf' }),
    { contentType: 'application/pdf', upsert: true },
  ));
  // file_path is immutable once set (trg_documents_file_path_immutable), so
  // insert the row once and only refresh the mutable fields on later runs.
  await must('document insert', admin.from('documents').upsert({
    id: E2E_DOCUMENT.id,
    user_id: ownerId,
    project_id: E2E_PROJECT.id,
    name: E2E_DOCUMENT.name,
    file_path: filePath,
    file_size: pdfBytes.length,
    page_count: E2E_DOCUMENT.pageCount,
    content_sha256: sha,
  }, { onConflict: 'id', ignoreDuplicates: true }));
  await must('document refresh', admin.from('documents').update({
    name: E2E_DOCUMENT.name,
    project_id: E2E_PROJECT.id,
    archived: false,
    user_archived_at: null,
    user_archive_expires_at: null,
    user_archived_by: null,
    archive_group_id: null,
    locked_at: null,
    locked_by: null,
    locked_label: null,
  }).eq('id', E2E_DOCUMENT.id));

  for (const key of ['editor', 'viewer']) {
    const account = E2E_ACCOUNTS[key];
    const row = {
      user_id: ids[key],
      invited_by: ownerId,
      role: account.role,
      email: account.email,
      status: 'active',
    };
    await must(`document collaborator ${key}`, admin.from('document_collaborators').upsert(
      { ...row, document_id: E2E_DOCUMENT.id },
      { onConflict: 'document_id,user_id' },
    ));
    await must(`project collaborator ${key}`, admin.from('project_collaborators').upsert(
      { ...row, project_id: E2E_PROJECT.id },
      { onConflict: 'project_id,user_id' },
    ));
  }

  // Local stack only (assertLocal above): the owner test account is an app
  // admin here so the /flags and /kits pages can be tested signed in.
  assertLocal(url);
  await must('local test admin', admin.from('feature_flag_admins').upsert({ user_id: ownerId }));
  // The app shows the Survey agent button to the owner, as /flags does for testers.
  await must('survey-agent flag', admin.from('feature_flags').upsert({
    key: 'survey-agent',
    mode: 'testers',
    tester_emails: [E2E_ACCOUNTS.owner.email],
    description: 'Seeded by scripts/e2e-local-supabase.mjs',
  }, { onConflict: 'key' }));

  log('seeded:');
  for (const [key, account] of Object.entries(E2E_ACCOUNTS)) {
    log(`  ${key.padEnd(6)} ${account.email.padEnd(28)} tier=${account.tier}${account.role ? ` role=${account.role}` : ''}`);
  }
  log(`  project "${E2E_PROJECT.name}" (${E2E_PROJECT.id}), document "${E2E_DOCUMENT.name}" (${E2E_DOCUMENT.id})`);
}

function ensureDocker() {
  const probe = spawnSync('docker', ['info'], { stdio: 'ignore' });
  if (probe.status !== 0) {
    fail('Docker is not reachable. In a Claude cloud container start it with `(dockerd >/tmp/dockerd.log 2>&1 &)` and retry.');
  }
}

async function main() {
  const command = process.argv[2] || 'up';
  if (command === 'up') {
    ensureDocker();
    // `supabase start` is a no-op on an already-running stack, so a stack that
    // was started from an older config.toml keeps that old config (e.g. OAuth
    // off, before the oauth_server rewrite above). Detect that drift and
    // restart so the current config always applies.
    const configPath = path.join(STACK_DIR, 'supabase/config.toml');
    const previousConfig = fs.existsSync(configPath) ? fs.readFileSync(configPath, 'utf8') : null;
    const alreadyRunning = readStatus() !== null;
    prepareWorkdir();
    if (alreadyRunning && previousConfig !== fs.readFileSync(configPath, 'utf8')) {
      log('stack config changed since it started; restarting so the new config applies');
      runCli(['stop', '--no-backup'], { allowFail: true });
    }
    runCli(['start', '-x', EXCLUDED.join(',')]);
    const status = readStatus();
    if (!status) fail('stack started but `supabase status` failed');
    await seed(writeEnvFile(status));
    log(`ready. Run the suite with: npm run test:e2e:signed-in`);
  } else if (command === 'env') {
    const status = readStatus();
    if (!status) fail('stack is not running; use `npm run e2e:stack:up`');
    writeEnvFile(status);
  } else if (command === 'seed') {
    const status = readStatus();
    const creds = status ? writeEnvFile(status) : readEnvFile();
    if (!creds) fail('no running stack and no .env.e2e; use `npm run e2e:stack:up`');
    await seed(creds);
  } else if (command === 'status') {
    if (!fs.existsSync(path.join(STACK_DIR, 'supabase/config.toml'))) fail('stack workdir not prepared; use `npm run e2e:stack:up`');
    runCli(['status']);
  } else if (command === 'down') {
    if (!fs.existsSync(path.join(STACK_DIR, 'supabase/config.toml'))) {
      log('no stack workdir; nothing to stop');
      return;
    }
    runCli(['stop', '--no-backup'], { allowFail: true });
    log('stopped (data volumes removed)');
  } else {
    fail(`unknown command "${command}" (use up | seed | env | status | down)`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => fail(error.stack || error.message));
}
