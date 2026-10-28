// Reads, and with --apply sets, the Supabase Auth settings from the backend
// security pass (/mnt/project-files/security/backend-pass.md), approved by
// Isaiah 2026-10-21, plus anonymous sign-ins for guest links (2026-10-28). Prints only the settings below: the auth config also
// holds SMTP and provider secrets, and this repo's Action logs are public.
import { pathToFileURL } from 'node:url';

export const WATCHED = [
  'password_hibp_enabled', 'password_min_length', 'password_required_characters',
  'mailer_autoconfirm', 'mailer_secure_email_change_enabled',
  'mfa_totp_enroll_enabled', 'mfa_totp_verify_enabled',
  'rate_limit_otp', 'rate_limit_verify', 'rate_limit_email_sent', 'rate_limit_token_refresh',
  'db_max_pool_size', 'db_max_pool_size_unit',
  'security_update_password_require_current_password',
  'security_update_password_require_reauthentication',
  'external_anonymous_users_enabled', 'rate_limit_anonymous_users',
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
  return Object.fromEntries(Object.entries(want).filter(([k, v]) => current[k] !== v));
}

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
  const patch = planAuthPatch(before);
  console.log('Before:', JSON.stringify(pick(before), null, 2));
  console.log('Would change:', JSON.stringify(patch, null, 2));
  if (!process.argv.includes('--apply') || !Object.keys(patch).length) return;
  const res = await fetch(url, { method: 'PATCH', headers, body: JSON.stringify(patch) });
  // The response echoes the whole config, secrets included; print only errors.
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`PATCH config/auth -> HTTP ${res.status}: ${text.slice(0, 300)}`);
  }
  const after = pick(await read());
  console.log('After:', JSON.stringify(after, null, 2));
  const missed = Object.keys(patch).filter((k) => after[k] !== patch[k]);
  if (missed.length) throw new Error(`Not applied: ${missed.join(', ')}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err) => { console.error(err.message); process.exit(1); });
}
