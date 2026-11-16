import test from 'node:test';
import assert from 'node:assert/strict';
import { planAuthPatch, pick, WALKTHRU_REDIRECTS } from '../scripts/supabase-auth-settings.mjs';

test('plans every approved setting from a loose config', () => {
  const patch = planAuthPatch({
    password_hibp_enabled: false, password_min_length: 6, password_required_characters: '',
    mailer_autoconfirm: true, mfa_totp_enroll_enabled: false, mfa_totp_verify_enabled: false,
    rate_limit_otp: 150, rate_limit_verify: 30, rate_limit_email_sent: 2,
    db_max_pool_size: 10, db_max_pool_size_unit: 'connections',
    security_update_password_require_current_password: false,
    external_anonymous_users_enabled: false, rate_limit_anonymous_users: 30,
    saml_enabled: false, uri_allow_list: WALKTHRU_REDIRECTS.join(','),
  });
  assert.deepEqual(patch, {
    password_hibp_enabled: true, password_min_length: 8,
    password_required_characters: 'abcdefghijklmnopqrstuvwxyz:ABCDEFGHIJKLMNOPQRSTUVWXYZ:0123456789',
    mailer_autoconfirm: false, mfa_totp_enroll_enabled: true, mfa_totp_verify_enabled: true,
    security_update_password_require_current_password: true,
    external_anonymous_users_enabled: true, saml_enabled: true,
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
    saml_enabled: true, uri_allow_list: WALKTHRU_REDIRECTS.join(','),
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

test('adds Walkthru return addresses and keeps every existing one', () => {
  const patch = planAuthPatch({ uri_allow_list: 'https://surveytool.app/**, capacitor://localhost' });
  assert.equal(
    patch.uri_allow_list,
    ['https://surveytool.app/**', 'capacitor://localhost', ...WALKTHRU_REDIRECTS].join(','),
  );
  const some = planAuthPatch({ uri_allow_list: `x,${WALKTHRU_REDIRECTS[0]}` });
  assert.equal(some.uri_allow_list, ['x', ...WALKTHRU_REDIRECTS].join(','));
});

// Account emails carry the suite's name, not Survey's (KAL-664).
{
  const { test } = await import('node:test');
  const assert = (await import('node:assert/strict')).default;
  const { readStagedEmails, planEmailPatch, EMAIL_SENDER_NAME } = await import('../scripts/supabase-auth-settings.mjs');
  const { SUITE_NAME } = await import('../src/suite/suiteName.js');

  test('account emails: thirteen staged, each with a subject and a page', () => {
    const staged = readStagedEmails();
    assert.equal(Object.keys(staged).length, 26);
    for (const [key, value] of Object.entries(staged)) assert.ok(value.length > 0, key);
  });

  test('account emails: every subject names the suite and none names one app', () => {
    for (const [key, value] of Object.entries(readStagedEmails())) {
      if (!key.startsWith('mailer_subjects_')) continue;
      assert.ok(value.includes(SUITE_NAME), `${key}: ${value}`);
      assert.ok(!/Survey|Walkthru|Plot/.test(value), `${key}: ${value}`);
    }
  });

  test('account emails: no page is signed by Survey or links to its site', () => {
    for (const [key, value] of Object.entries(readStagedEmails())) {
      if (!key.endsWith('_content')) continue;
      assert.ok(value.includes(`Sent by ${SUITE_NAME}`), key);
      assert.ok(!value.includes('surveytool.app'), key);
      assert.ok(!value.includes('>SURVEY<'), key);
    }
  });

  test('account emails: the plan holds only what differs, and the sender name', () => {
    const staged = readStagedEmails();
    assert.deepEqual(planEmailPatch({ ...staged, smtp_sender_name: EMAIL_SENDER_NAME }, staged), {});
    assert.deepEqual(
      planEmailPatch({ ...staged, smtp_sender_name: 'Survey', mailer_subjects_recovery: 'Reset your Survey password' }, staged),
      { smtp_sender_name: EMAIL_SENDER_NAME, mailer_subjects_recovery: staged.mailer_subjects_recovery },
    );
  });
}
