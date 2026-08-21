import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  storageStateAfterResignIn,
  storageStateAfterSignedOut,
  storageStateWhenAccessRevoked,
} from '../src/components/collab/collabBannerState.js';

const providerSrc = readFileSync(
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../src/components/collab/YDocProvider.jsx'),
  'utf8',
);

test('P2-12 wiring: YDocProvider keeps permission_revoked through expiry and re-sign-in', () => {
  assert.match(providerSrc, /storageStateAfterSignedOut/);
  assert.match(providerSrc, /storageStateAfterResignIn/);
  assert.match(providerSrc, /storageStateWhenAccessRevoked/);
  assert.match(providerSrc, /accessRevokedRef/);
});

test('P2-12 intended: revoke then sign-in expiry keeps the access-removed banner', () => {
  const revoked = storageStateWhenAccessRevoked({ code: 'ok', role: 'editor' });
  assert.equal(revoked.code, 'permission_revoked');
  const afterExpiry = storageStateAfterSignedOut({
    accessRevoked: true,
    current: revoked,
  });
  assert.equal(afterExpiry.code, 'permission_revoked');
});

test('P2-12 break: re-sign-in must not clear a still-revoked lockout', () => {
  const after = storageStateAfterResignIn({
    accessRevoked: true,
    currentCode: 'login_expiry_failure',
  });
  assert.equal(after.code, 'permission_revoked');
  assert.notEqual(after.code, 'ok');
});

test('P2-12 edge: re-sign-in without revoke clears only the expiry banner', () => {
  const after = storageStateAfterResignIn({
    accessRevoked: false,
    currentCode: 'login_expiry_failure',
  });
  assert.deepEqual(after, { code: 'ok', role: 'unknown' });
});

test('P2-12 edge: sign-out without revoke still shows expiry', () => {
  const after = storageStateAfterSignedOut({
    accessRevoked: false,
    current: { code: 'ok', role: 'editor' },
  });
  assert.equal(after.code, 'login_expiry_failure');
});
