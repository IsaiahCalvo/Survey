/* GOAL-1 — client + wiring contract guards for the two-branch invite send.
 *
 * Locks the invariants from PLAN-GOAL1-invite-email.md (Codex APPROVED r4):
 *   - No client-side invite email path remains: the three legacy senders are
 *     gone from shareEmailService and unreferenced anywhere in src/ (a
 *     client-built send could email localhost/stale links — round-2 #1).
 *   - All six call sites (create + resend × document/project/template) go
 *     through sendInviteEmailSmart.
 *   - The edge function's real wiring (index.ts) builds the invite lookup
 *     client from the ANON key + the caller's Authorization header (RLS
 *     owner semantics), keeps the service role for auth.admin only, and
 *     stays a thin wrapper over handler.js.
 *   - config.toml disables gateway verify_jwt for the browser-invoked
 *     function (preflight OPTIONS carries no JWT).
 */
import test from 'node:test';
import { equal, ok, match, doesNotMatch } from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const repoRoot = path.resolve(new URL('.', import.meta.url).pathname, '..');
const read = (p) => fs.readFileSync(path.join(repoRoot, p), 'utf8');

const SERVICES = [
  'src/services/documentInviteService.js',
  'src/services/projectInviteService.js',
  'src/services/templateInviteService.js',
];

test('GOAL-1 client: legacy invite senders are deleted from shareEmailService', () => {
  const text = read('src/services/shareEmailService.js');
  for (const name of ['sendDocumentInviteEmail', 'sendProjectInviteEmail', 'sendTemplateInviteEmail']) {
    doesNotMatch(text, new RegExp(name), `${name} must be gone`);
  }
  match(text, /export async function sendInviteEmailSmart/);
  // Still-used senders survive.
  match(text, /sendPermissionChangedEmail/);
  match(text, /sendAccessRemovedEmail/);
  // The smart sender never builds a URL — the server derives it.
  const smart = text.slice(text.indexOf('sendInviteEmailSmart'));
  doesNotMatch(smart.slice(0, smart.indexOf('export', 10)), /inviteUrl|buildInviteUrl|window\.location/);
});

test('GOAL-1 client: no legacy invite-sender reference anywhere in src/', () => {
  const out = execSync(
    "grep -rn 'sendDocumentInviteEmail\\|sendProjectInviteEmail\\|sendTemplateInviteEmail' src/ --include='*.js' --include='*.jsx' || true",
    { cwd: repoRoot, encoding: 'utf8' },
  ).trim();
  equal(out, '', `stale references:\n${out}`);
});

test('GOAL-1 client: new-user create + all resends keep the smart token sender', () => {
  for (const file of SERVICES.slice(1)) {
    const text = read(file);
    match(text, /import \{[\s\S]*sendInviteEmailSmart[\s\S]*\} from '\.\/shareEmailService'/);
    const calls = text.match(/sendInviteEmailSmart\(\{/g) || [];
    equal(calls.length, 2, `${file}: expected exactly 2 smart-send call sites (create + resend), got ${calls.length}`);
    match(text, /token: data\.token/);
    match(text, /token: row\.token/);
  }

  const documentText = read(SERVICES[0]);
  match(documentText, /import \{[\s\S]*sendInviteEmailSmart[\s\S]*\} from '\.\/shareEmailService'/);
  equal(
    (documentText.match(/sendInviteEmailSmart\(\{/g) || []).length,
    2,
    'document create + resend both call the server-derived smart sender',
  );
  match(documentText, /token:\s*data\.token/);
  match(documentText, /token:\s*row\.token/);
});

test('GOAL-1 wiring: index.ts is a thin wrapper — caller-scoped RLS lookup and service role only for auth admin', () => {
  const text = read('supabase/functions/send-invite-email/index.ts');
  match(text, /from '\.\/handler\.js'/);
  // Caller-scoped lookup client: anon key + caller Authorization header.
  match(text, /createClient\(SUPABASE_URL, ANON_KEY, \{\s*global: \{ headers: \{ Authorization: authHeader \} \}/);
  // The row lookup runs on the caller client, never the admin client.
  match(text, /callerClient\s*\n?\s*\.from\(table\)|callerClient\s*\.from\(table\)/);
  doesNotMatch(text, /adminClient\s*\.from\(/);
  // Admin client is used exactly for the auth invite.
  match(text, /adminClient\.auth\.admin\.inviteUserByEmail/);
  // Fallback goes server-to-server with the already-validated caller JWT.
  // Modern sb_secret_ service keys are not JWTs and fail the Edge gateway.
  match(text, /functions\/v1\/send-email/);
  match(text, /apikey:\s*ANON_KEY/);
  match(text, /Authorization:\s*authHeader/);
  // Thin: no branch logic in the wrapper.
  doesNotMatch(text, /email_exists/);
});

test('GOAL-1 wiring: handler derives recipient/URL from the row, canonical origin only', () => {
  const text = read('supabase/functions/send-invite-email/handler.js');
  match(text, /CANONICAL_ORIGIN = 'https:\/\/surveytool\.app'/);
  match(text, /\$\{CANONICAL_ORIGIN\}\/invite\/\$\{encodeURIComponent\(row\.token\)\}/);
  // Recipient always comes from the row.
  match(text, /row\.target_email/);
  doesNotMatch(text, /body\.email|body\?\.email/);
  // Generic response: no `exists` field in any returned body.
  doesNotMatch(text, /['"]?exists['"]?\s*:\s*(true|false|isExisting)/);
  // Intentional wildcard CORS with the do-not-tighten comment.
  match(text, /'Access-Control-Allow-Origin': '\*'/);
  match(text, /INTENTIONAL — do NOT tighten/);
});

test('GOAL-1 wiring: config.toml disables gateway verify_jwt for send-invite-email (preflight)', () => {
  const text = read('supabase/config.toml');
  match(text, /\[functions\.send-invite-email\]\s*\nverify_jwt = false/);
});
