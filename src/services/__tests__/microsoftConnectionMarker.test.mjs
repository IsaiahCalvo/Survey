import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  MAIN_PROCESS_CUSTODY,
  buildMainAuthAccount,
  buildConnectionMarkerRow,
  isMainCustodyRow,
  hasLegacyRendererTokens
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
