import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAIN_PROCESS_CUSTODY,
  buildMainAuthAccount,
  buildConnectionMarkerRow,
  isMainCustodyRow,
  hasLegacyRendererTokens,
  shouldWipeSharedConnectionRow,
  shouldAdoptRemoteRefreshToken,
  interpretMainProcessRestore,
} from '../microsoftConnectionMarker.js';

const ACCOUNT = { homeAccountId: 'oid.tid', tenantId: 'tid-1', username: 'u@work.com', name: 'User' };

test('marker row carries identity + custody flag and NO token material', () => {
  const row = buildConnectionMarkerRow({ userId: 'user-1', account: ACCOUNT, nowIso: '2026-06-09T00:00:00.000Z' });
  assert.equal(row.user_id, 'user-1');
  assert.equal(row.service_name, 'microsoft');
  assert.equal(row.is_connected, true);
  assert.equal(row.account_id, 'oid.tid');
  assert.equal(row.metadata.tenant_id, 'tid-1');
  assert.equal(row.metadata.token_custody, MAIN_PROCESS_CUSTODY);
  // The invariant this module exists for: no tokens in the database on this path.
  for (const forbidden of ['access_token', 'refresh_token', 'id_token', 'expires_at']) {
    assert.equal(forbidden in row.metadata, false, `metadata must not contain ${forbidden}`);
  }
});

test('buildMainAuthAccount maps fields and nulls the gaps', () => {
  assert.deepEqual(buildMainAuthAccount(ACCOUNT), ACCOUNT);
  assert.deepEqual(buildMainAuthAccount({}), { homeAccountId: null, tenantId: null, username: null, name: null });
});

test('row classifiers distinguish custody marker vs legacy token rows', () => {
  const marker = buildConnectionMarkerRow({ userId: 'u', account: ACCOUNT });
  assert.equal(isMainCustodyRow(marker), true);
  assert.equal(hasLegacyRendererTokens(marker), false);
  const legacy = { metadata: { refresh_token: 'rt', access_token: 'at' } };
  assert.equal(isMainCustodyRow(legacy), false);
  assert.equal(hasLegacyRendererTokens(legacy), true);
});

test('desktop marker merge preserves web tokens and does not invent them', () => {
  const fresh = buildConnectionMarkerRow({ userId: 'u', account: ACCOUNT });
  for (const forbidden of ['access_token', 'refresh_token', 'id_token', 'expires_at']) {
    assert.equal(forbidden in fresh.metadata, false);
  }

  const merged = buildConnectionMarkerRow({
    userId: 'u',
    account: ACCOUNT,
    existingMetadata: {
      refresh_token: 'web-rt',
      access_token: 'web-at',
      id_token: 'web-id',
      expires_at: 99,
      tenant_id: 'old-tid',
      junk: 'drop-me',
    },
  });
  assert.equal(merged.metadata.token_custody, MAIN_PROCESS_CUSTODY);
  assert.equal(merged.metadata.refresh_token, 'web-rt');
  assert.equal(merged.metadata.access_token, 'web-at');
  assert.equal(merged.metadata.id_token, 'web-id');
  assert.equal(merged.metadata.expires_at, 99);
  assert.equal('junk' in merged.metadata, false);
  assert.equal(isMainCustodyRow(merged), true);
  assert.equal(hasLegacyRendererTokens(merged), true);

  const emptyExisting = buildConnectionMarkerRow({
    userId: 'u',
    account: ACCOUNT,
    existingMetadata: { refresh_token: '', access_token: null },
  });
  assert.equal('refresh_token' in emptyExisting.metadata, false);
});

test('stale-tab wipe only clears the shared row when the failed token is still stored', () => {
  assert.equal(shouldWipeSharedConnectionRow({
    storedRefreshToken: 'rt-old',
    failedRefreshToken: 'rt-old',
  }), true);
  assert.equal(shouldWipeSharedConnectionRow({
    storedRefreshToken: 'rt-new',
    failedRefreshToken: 'rt-old',
  }), false);
  assert.equal(shouldAdoptRemoteRefreshToken({
    storedRefreshToken: 'rt-new',
    failedRefreshToken: 'rt-old',
  }), true);
  assert.equal(shouldWipeSharedConnectionRow({
    storedRefreshToken: null,
    failedRefreshToken: 'rt-old',
  }), false);
  assert.equal(shouldWipeSharedConnectionRow({
    storedRefreshToken: 'rt-old',
    failedRefreshToken: '',
  }), false);
  assert.equal(shouldAdoptRemoteRefreshToken({
    storedRefreshToken: 'rt-old',
    failedRefreshToken: 'rt-old',
  }), false);
});

test('desktop restore classifies adopt / reconnect / transient / fallthrough', () => {
  assert.deepEqual(interpretMainProcessRestore({ signedIn: false }), { action: 'legacy-fallthrough' });
  assert.deepEqual(interpretMainProcessRestore({
    signedIn: true,
    tokenResult: { success: true, accessToken: 'at' },
  }), { action: 'adopt' });
  assert.deepEqual(interpretMainProcessRestore({
    signedIn: true,
    tokenResult: { success: false, needsInteraction: true },
  }), { action: 'reconnect' });
  assert.deepEqual(interpretMainProcessRestore({
    signedIn: true,
    tokenResult: { success: false, transient: true, needsInteraction: false },
  }), { action: 'transient' });
  assert.deepEqual(interpretMainProcessRestore({
    signedIn: true,
    tokenResult: { success: false },
  }), { action: 'transient' });
});
