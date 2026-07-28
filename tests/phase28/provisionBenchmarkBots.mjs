#!/usr/bin/env node
// tests/phase28/provisionBenchmarkBots.mjs
// Phase 28 Plan 28-04 — bot account provisioner for the transport bake-off harness.
//
// One-time exception to the project's no-bot-accounts norm, granted explicitly
// by the user 2026-04-27 because no human peer pool is available to drive a
// 4-5 concurrent peer benchmark on real shared wifi. See 28-04-PLAN.md
// "Peer identity provisioning (LOCKED — 2026-04-27)" for the full contract.
//
// What this script does:
//   1. Pulls the Supabase service-role key from `supabase projects api-keys`
//      (CLI must be logged in; project must be linked). Service-role key is
//      held only in process memory — never persisted to disk.
//   2. Idempotently creates 5 bot accounts using the Admin createUser API
//      with `email_confirm: true` so no email round-trip is required:
//        phase28-bot-1@betasafes2.test ... phase28-bot-5@betasafes2.test
//      (.test TLD is RFC-2606 reserved; never resolves, never sends mail.)
//   3. Tags each in auth.users.raw_user_meta_data with
//        { "phase28_bot": true, "created_at": "<ISO>" }
//      so cleanup is a single SQL filter:
//        DELETE FROM auth.users WHERE raw_user_meta_data->>'phase28_bot' = 'true';
//   4. Writes credentials to
//        .planning/phases/28-transport-spike-auth-validator/.bot-credentials.json
//      (gitignored — see .gitignore). Harness reads this file to authenticate
//      each peer.
//   5. Inserts collaborator rows on the test document (Package 2 - Rev 4 -- IC.pdf,
//      id 70dadd86-35f0-432b-925f-c59e919a4e4d) using the service-role client
//      (bypasses RLS for setup only). All 5 bots get role='editor' so they can
//      write annotations during the benchmark.
//
// Usage: node tests/phase28/provisionBenchmarkBots.mjs
// Idempotent — safe to re-run.

import { execSync } from 'node:child_process';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..', '..');

const PROJECT_REF = 'cvamwtpsuvxvjdnotbeg';
const SUPABASE_URL = `https://${PROJECT_REF}.supabase.co`;
const TEST_DOCUMENT_ID = '70dadd86-35f0-432b-925f-c59e919a4e4d'; // Package 2 - Rev 4 -- IC.pdf
// 5 bots is the locked count from CONTEXT.md ("4-5 concurrent peers"). Plan 28-04
// authorized higher peer counts (7-8) for fan-out characterization sweeps; we
// provision the upper bound so the harness can run those sweeps without re-provisioning.
const BOT_COUNT = 8;
const BOT_EMAIL_PREFIX = 'phase28-bot';
const BOT_EMAIL_DOMAIN = 'betasafes2.test'; // RFC-2606 reserved
const BOT_PASSWORD_LEN = 32;
const CREDENTIALS_FILE = resolve(
  REPO_ROOT,
  '.planning/phases/28-transport-spike-auth-validator/.bot-credentials.json'
);
const ANON_KEY_FROM_ENV = (() => {
  // Read VITE_SUPABASE_ANON_KEY from .env (committed, anon key is public-safe)
  const envFile = resolve(REPO_ROOT, '.env');
  if (!existsSync(envFile)) return null;
  const text = readFileSync(envFile, 'utf8');
  const m = text.match(/^VITE_SUPABASE_ANON_KEY=(.+)$/m);
  return m ? m[1].trim() : null;
})();

function pullServiceRoleKey() {
  // The CLI's `projects api-keys` outputs a fixed-width table. We grep the
  // service_role row and pull the JWT (starts with eyJ).
  // The supabase CLI is already logged in — see HANDOFF / state notes.
  const out = execSync(`supabase projects api-keys --project-ref ${PROJECT_REF}`, {
    encoding: 'utf8',
  });
  const lines = out.split('\n');
  for (const line of lines) {
    if (line.includes('service_role')) {
      const m = line.match(/(eyJ[A-Za-z0-9._-]+)/);
      if (m) return m[1];
    }
  }
  throw new Error('Could not parse service_role key from `supabase projects api-keys` output');
}

function generatePassword(len) {
  // 32-char random with at least one char from each of: lower / upper / digit / symbol.
  // Supabase project enforces all-four character classes on password updates.
  const lower = 'abcdefghijklmnopqrstuvwxyz';
  const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const digit = '0123456789';
  const symbol = '!@#$%^&*-_=+';
  const alphabet = lower + upper + digit + symbol;
  // Force one of each class to satisfy the policy regardless of random chance.
  let out =
    lower[Math.floor(Math.random() * lower.length)] +
    upper[Math.floor(Math.random() * upper.length)] +
    digit[Math.floor(Math.random() * digit.length)] +
    symbol[Math.floor(Math.random() * symbol.length)];
  for (let i = out.length; i < len; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)];
  // Shuffle so the forced chars aren't always at the front.
  return out
    .split('')
    .sort(() => Math.random() - 0.5)
    .join('');
}

async function findBotByEmail(adminClient, email) {
  // Admin listUsers paginates; bots live near the top of recent users so page 1 is enough,
  // but iterate up to 3 pages for safety.
  for (let page = 1; page <= 3; page++) {
    const { data, error } = await adminClient.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw new Error(`listUsers page ${page} failed: ${error.message}`);
    if (!data?.users?.length) break;
    const found = data.users.find((u) => u.email === email);
    if (found) return found;
    if (data.users.length < 200) break;
  }
  return null;
}

async function ensureBot(adminClient, index) {
  const email = `${BOT_EMAIL_PREFIX}-${index}@${BOT_EMAIL_DOMAIN}`;
  const password = generatePassword(BOT_PASSWORD_LEN);

  const existing = await findBotByEmail(adminClient, email);
  if (existing) {
    // Update password so the credentials file matches what's in Supabase.
    // (Idempotent re-run path — we want fresh credentials on every provision run.)
    const { data: updated, error: updateErr } = await adminClient.auth.admin.updateUserById(
      existing.id,
      {
        password,
        user_metadata: {
          ...(existing.user_metadata || {}),
          phase28_bot: true,
          // Preserve original created_at if present, otherwise stamp now.
          phase28_bot_created_at:
            existing.user_metadata?.phase28_bot_created_at || new Date().toISOString(),
        },
      }
    );
    if (updateErr) throw new Error(`updateUserById(${email}) failed: ${updateErr.message}`);
    return { id: updated.user.id, email, password, reused: true };
  }

  const { data, error } = await adminClient.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: {
      phase28_bot: true,
      phase28_bot_created_at: new Date().toISOString(),
    },
  });
  if (error) throw new Error(`createUser(${email}) failed: ${error.message}`);
  return { id: data.user.id, email, password, reused: false };
}

async function ensureCollaborator(adminClient, documentId, userId) {
  // Use upsert via select-then-insert because document_collaborators has UNIQUE(document_id, user_id).
  // Service-role client bypasses RLS for setup.
  const { data: existing, error: selErr } = await adminClient
    .from('document_collaborators')
    .select('id, role, status')
    .eq('document_id', documentId)
    .eq('user_id', userId)
    .maybeSingle();
  if (selErr) throw new Error(`select collaborator failed: ${selErr.message}`);

  if (existing) {
    if (existing.role !== 'editor' || existing.status !== 'active') {
      const { error: upErr } = await adminClient
        .from('document_collaborators')
        .update({ role: 'editor', status: 'active' })
        .eq('id', existing.id);
      if (upErr) throw new Error(`update collaborator failed: ${upErr.message}`);
      return { id: existing.id, action: 'updated' };
    }
    return { id: existing.id, action: 'already_present' };
  }

  const { data: inserted, error: insErr } = await adminClient
    .from('document_collaborators')
    .insert({
      document_id: documentId,
      user_id: userId,
      role: 'editor',
      status: 'active',
    })
    .select('id')
    .single();
  if (insErr) throw new Error(`insert collaborator failed: ${insErr.message}`);
  return { id: inserted.id, action: 'inserted' };
}

async function main() {
  if (process.env.SURVEY_COORDINATOR_PROVISION_BOTS !== 'I_AM_THE_TEST_ACCOUNT_COORDINATOR') {
    throw new Error(
      'Bot provisioning is disabled for workers. '
      + 'A coordinator must explicitly set SURVEY_COORDINATOR_PROVISION_BOTS='
      + 'I_AM_THE_TEST_ACCOUNT_COORDINATOR.',
    );
  }
  console.log('[provisionBenchmarkBots] pulling service-role key from Supabase CLI…');
  const serviceRoleKey = pullServiceRoleKey();
  if (!ANON_KEY_FROM_ENV) {
    throw new Error('VITE_SUPABASE_ANON_KEY not found in .env — required for credentials file');
  }

  const adminClient = createClient(SUPABASE_URL, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log(`[provisionBenchmarkBots] ensuring ${BOT_COUNT} bot accounts…`);
  const bots = [];
  for (let i = 1; i <= BOT_COUNT; i++) {
    const bot = await ensureBot(adminClient, i);
    console.log(
      `  [${bot.reused ? 'reused' : 'created'}] ${bot.email} → ${bot.id}`
    );
    bots.push(bot);
  }

  console.log(`[provisionBenchmarkBots] ensuring collaborators on test document ${TEST_DOCUMENT_ID}…`);
  for (const bot of bots) {
    const result = await ensureCollaborator(adminClient, TEST_DOCUMENT_ID, bot.id);
    console.log(`  [collab ${result.action}] ${bot.email} → ${result.id}`);
  }

  // Write credentials file (gitignored). Service-role key is NOT included.
  const credentials = {
    project_ref: PROJECT_REF,
    supabase_url: SUPABASE_URL,
    supabase_anon_key: ANON_KEY_FROM_ENV,
    test_document_id: TEST_DOCUMENT_ID,
    test_document_name: 'Package 2 - Rev 4 -- IC.pdf',
    provisioned_at: new Date().toISOString(),
    bots: bots.map(({ id, email, password }) => ({ id, email, password })),
  };
  const credentialsDir = dirname(CREDENTIALS_FILE);
  if (!existsSync(credentialsDir)) mkdirSync(credentialsDir, { recursive: true });
  writeFileSync(CREDENTIALS_FILE, JSON.stringify(credentials, null, 2) + '\n', { mode: 0o600 });
  console.log(`[provisionBenchmarkBots] wrote ${CREDENTIALS_FILE}`);

  console.log('\n[provisionBenchmarkBots] DONE.');
  console.log(`  bots provisioned: ${bots.length}`);
  console.log(`  test document  : ${TEST_DOCUMENT_ID} (${credentials.test_document_name})`);
  console.log('\n[cleanup contract] (run after Phase 28 closes)');
  console.log(`  DELETE FROM auth.users WHERE raw_user_meta_data->>'phase28_bot' = 'true';`);
  console.log(`  rm ${CREDENTIALS_FILE}`);
}

main().catch((err) => {
  console.error('[provisionBenchmarkBots] FAILED:', err?.message || err);
  process.exit(1);
});
