// Reads, and with --apply sets, the Supabase Auth settings from the backend
// security pass (/mnt/project-files/security/backend-pass.md), approved by
// Isaiah 2026-10-21, plus anonymous sign-ins for guest links (2026-10-28) and
// SAML single sign-on for company sign-in (2026-11-01). Prints only the settings below: the auth config also
// holds SMTP and provider secrets, and this repo's Action logs are public.
import { pathToFileURL, fileURLToPath } from 'node:url';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import path from 'node:path';

export const WATCHED = [
  'password_hibp_enabled', 'password_min_length', 'password_required_characters',
  'mailer_autoconfirm', 'mailer_secure_email_change_enabled',
  'mfa_totp_enroll_enabled', 'mfa_totp_verify_enabled',
  'rate_limit_otp', 'rate_limit_verify', 'rate_limit_email_sent', 'rate_limit_token_refresh',
  'db_max_pool_size', 'db_max_pool_size_unit',
  'security_update_password_require_current_password',
  'security_update_password_require_reauthentication',
  'external_anonymous_users_enabled', 'rate_limit_anonymous_users',
  'saml_enabled',
  // Whether sign-ins (guest ones too) must carry a Turnstile token.
  'security_captcha_enabled', 'security_captcha_provider',
  // Where a sign-in may send people back to (no secrets in it).
  'uri_allow_list',
];

// Walkthru shares this sign-in server (KAL-579). Its web copies and its phone
// app (scheme walkthrough://, or exp:// while it runs inside Expo Go) must be
// allowed return addresses, or Google and Microsoft sign-in send people back to
// Survey instead. Added, never removed.
export const WALKTHRU_REDIRECTS = [
  'walkthrough://**',
  'exp://**',
  'https://walkthru.tools/**',
  'https://www.walkthru.tools/**',
  'https://walkthrough-ashen.vercel.app/**',
  'https://walkthu-nightly.vercel.app/**',
];

const LOWER_UPPER_DIGITS = 'abcdefghijklmnopqrstuvwxyz:ABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789';
// Supabase's password rule options, weakest first. A stronger rule is kept.
const CHARACTER_RULES = [
  '',
  'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789',
  LOWER_UPPER_DIGITS,
];
const MIN_LENGTH = 8;
// Sign-ins/sign-ups and token checks per 5 minutes per IP; emails per hour.
const RATE_CAP = 30;
// Today's fixed 10 auth connections of the 60 a Micro database allows.
const POOL_PERCENT = 17;

// Only the fields that change. Nothing is ever loosened: a longer minimum,
// a stricter character rule or a lower rate limit already in place is kept.
export function planAuthPatch(current) {
  const want = {
    password_hibp_enabled: true,
    mailer_autoconfirm: false,
    mfa_totp_enroll_enabled: true,
    mfa_totp_verify_enabled: true,
    security_update_password_require_current_password: true,
    // Guest links (Nightly, flag 'guest-links') sign guests in anonymously;
    // Isaiah approved turning this on 2026-10-28. Turnstile still guards it.
    external_anonymous_users_enabled: true,
    // "Sign in with company SSO" needs SAML on; each company is then added
    // with `supabase sso add`. Isaiah approved turning it on 2026-11-01.
    saml_enabled: true,
  };
  if (!(Number(current.password_min_length) >= MIN_LENGTH)) want.password_min_length = MIN_LENGTH;
  const rule = current.password_required_characters ?? '';
  if (CHARACTER_RULES.includes(rule) && CHARACTER_RULES.indexOf(rule) < CHARACTER_RULES.indexOf(LOWER_UPPER_DIGITS)) {
    want.password_required_characters = LOWER_UPPER_DIGITS;
  }
  for (const key of ['rate_limit_otp', 'rate_limit_verify', 'rate_limit_email_sent', 'rate_limit_anonymous_users']) {
    if (!(Number(current[key]) <= RATE_CAP)) want[key] = RATE_CAP;
  }
  if (current.db_max_pool_size_unit !== 'percent') {
    want.db_max_pool_size_unit = 'percent';
    want.db_max_pool_size = POOL_PERCENT;
  }
  const allowed = String(current.uri_allow_list ?? '').split(',').map((u) => u.trim()).filter(Boolean);
  const missing = WALKTHRU_REDIRECTS.filter((u) => !allowed.includes(u));
  if (missing.length) want.uri_allow_list = [...allowed, ...missing].join(',');
  return Object.fromEntries(Object.entries(want).filter(([k, v]) => current[k] !== v));
}

// Account emails (KAL-664). One account signs in to Survey, Walkthru and Plot,
// so the emails Supabase Auth sends carry the suite's name. The wording lives
// in scripts/gen-auth-email-templates.mjs, which writes the staged files read
// here. `--emails` checks them against the live ones; with `--apply` it sets
// the ones that differ, and the sender name.
export const EMAIL_SENDER_NAME = 'Kal Voe';
const STAGED_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'debug', 'email-templates-staged');

export function readStagedEmails(dir = STAGED_DIR) {
  const want = {};
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.html')).sort()) {
    const key = file.slice(0, -'.html'.length);
    want[`mailer_subjects_${key}`] = readFileSync(path.join(dir, `${key}.subject.txt`), 'utf8');
    want[`mailer_templates_${key}_content`] = readFileSync(path.join(dir, file), 'utf8');
  }
  return want;
}

export function planEmailPatch(current, staged = readStagedEmails()) {
  const want = { ...staged, smtp_sender_name: EMAIL_SENDER_NAME };
  return Object.fromEntries(Object.entries(want).filter(([k, v]) => current[k] !== v));
}

// Subjects and the sender name print as they are; a template prints as a short
// hash, since thirteen pages of HTML would bury the log.
const sha = (text) => createHash('sha256').update(String(text ?? '')).digest('hex').slice(0, 12);
export const pickEmails = (config, keys) => Object.fromEntries(keys.map((k) => [
  k, k.endsWith('_content') ? `sha256:${sha(config[k])}` : config[k] ?? null,
]));

export const pick = (config) => Object.fromEntries(WATCHED.map((k) => [k, config[k] ?? null]));

async function main() {
  const { SUPABASE_ACCESS_TOKEN: token, SUPABASE_PROJECT_ID: ref } = process.env;
  if (!token || !ref) throw new Error('SUPABASE_ACCESS_TOKEN and SUPABASE_PROJECT_ID are required');
  const url = `https://api.supabase.com/v1/projects/${ref}/config/auth`;
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  const read = async () => {
    const res = await fetch(url, { headers });
    if (!res.ok) throw new Error(`GET config/auth -> HTTP ${res.status}`);
    return res.json();
  };
  const before = await read();
  const emails = process.argv.includes('--emails');
  const patch = emails ? planEmailPatch(before) : planAuthPatch(before);
  const show = emails
    ? (config) => pickEmails(config, [...Object.keys(readStagedEmails()), 'smtp_sender_name'].filter((k) => !k.endsWith('_content') || k in patch))
    : pick;
  console.log('Before:', JSON.stringify(show(before), null, 2));
  console.log('Would change:', JSON.stringify(emails ? pickEmails(patch, Object.keys(patch)) : patch, null, 2));
  if (!process.argv.includes('--apply') || !Object.keys(patch).length) return;
  const res = await fetch(url, { method: 'PATCH', headers, body: JSON.stringify(patch) });
  // The response echoes the whole config, secrets included; print only errors.
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PATCH config/auth -> HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  const afterAll = await read();
  console.log('After:', JSON.stringify(show(afterAll), null, 2));
  const after = emails ? afterAll : pick(afterAll);
  const missed = Object.keys(patch).filter((k) => after[k] !== patch[k]);
  if (missed.length) throw new Error(`Not applied: ${missed.join(', ')}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}
