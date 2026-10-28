import test from 'node:test';
import assert from 'node:assert/strict';
import { planAuthPatch, pick } from '../scripts/supabase-auth-settings.mjs';

test('plans every approved setting from a loose config', () => {
  const patch = planAuthPatch({
    password_hibp_enabled: false, password_min_length: 6, password_required_characters: '',
    mailer_autoconfirm: true, mfa_totp_enroll_enabled: false, mfa_totp_verify_enabled: false,
    rate_limit_otp: 150, rate_limit_verify: 30, rate_limit_email_sent: 2,
    db_max_pool_size: 10, db_max_pool_size_unit: 'connections',
    security_update_password_require_current_password: false,
    external_anonymous_users_enabled: false, rate_limit_anonymous_users: 30,
  });
  assert.deepEqual(patch, {
    password_hibp_enabled: true, password_min_length: 8,
    password_required_characters: 'abcdefghijklmnopqrstuvwxyz:ABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789',
    mailer_autoconfirm: false, mfa_totp_enroll_enabled: true, mfa_totp_verify_enabled: true,
    security_update_password_require_current_password: true,
    external_anonymous_users_enabled: true,
    rate_limit_otp: 30, db_max_pool_size_unit: 'percent', db_max_pool_size: 17,
  });
});

test('changes nothing once applied, and never loosens a tighter rate limit', () => {
  const done = {
    password_hibp_enabled: true, password_min_length: 8,
    password_required_characters: 'abcdefghijklmnopqrstuvwxyz:ABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789',
    mailer_autoconfirm: false, mfa_totp_enroll_enabled: true, mfa_totp_verify_enabled: true,
    security_update_password_require_current_password: true,
    rate_limit_otp: 10, rate_limit_verify: 30, rate_limit_email_sent: 4,
    db_max_pool_size: 20, db_max_pool_size_unit: 'percent',
    external_anonymous_users_enabled: true, rate_limit_anonymous_users: 30,
  };
  assert.deepEqual(planAuthPatch(done), {});
});

test('never weakens a stricter password rule already in place', () => {
  const symbols = 'abcdefghijklmnopqrstuvwxyz:ABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789:!@#$%^&*()_+-=[]{};\'\\\\:"|<>?,./`~';
  const patch = planAuthPatch({ password_min_length: 12, password_required_characters: symbols });
  assert.equal(patch.password_min_length, undefined);
  assert.equal(patch.password_required_characters, undefined);
});

test('prints only the watched settings, never secrets', () => {
  const shown = pick({ password_min_length: 8, smtp_pass: 'secret', external_google_secret: 'x' });
  assert.equal(shown.password_min_length, 8);
  assert.ok(!JSON.stringify(shown).includes('secret'));
});
