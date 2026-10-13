import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAIN_PROCESS_CUSTODY,
  buildMainAuthAccount,
  buildConnectionMarkerRow,
  isMainCustodyRow,
  hasLegacyRendererTokens,
} from '../src/services/microsoftConnectionMarker.js';

test('buildMainAuthAccount maps account fields with null defaults', () => {
  assert.deepEqual(buildMainAuthAccount(), {
    homeAccountId: null,
    tenantId: null,
    username: null,
    name: null,
  });
  assert.deepEqual(buildMainAuthAccount({
    homeAccountId: 'home',
    tenantId: 'tenant',
    username: 'a@b.com',
    name: 'A',
  }), {
    homeAccountId: 'home',
    tenantId: 'tenant',
    username: 'a@b.com',
    name: 'A',
  });
});

test('buildConnectionMarkerRow never includes tokens', () => {
  const row = buildConnectionMarkerRow({
    userId: 'user-1',
    account: {
      homeAccountId: 'home',
      tenantId: 'tenant',
      username: 'a@b.com',
      name: 'A',
    },
    nowIso: '2026-07-12T00:00:00.000Z',
  });
  assert.equal(row.user_id, 'user-1');
  assert.equal(row.service_name, 'microsoft');
  assert.equal(row.is_connected, true);
  assert.equal(row.metadata.token_custody, MAIN_PROCESS_CUSTODY);
  assert.equal(row.metadata.tenant_id, 'tenant');
  assert.equal('access_token' in row, false);
  assert.equal('refresh_token' in row, false);
  assert.equal('access_token' in row.metadata, false);
  assert.equal('refresh_token' in row.metadata, false);
});

test('custody detectors distinguish main vs legacy rows', () => {
  assert.equal(isMainCustodyRow({ metadata: { token_custody: MAIN_PROCESS_CUSTODY } }), true);
  assert.equal(isMainCustodyRow({ metadata: {} }), false);
  assert.equal(hasLegacyRendererTokens({ metadata: { refresh_token: 'x' } }), true);
  assert.equal(hasLegacyRendererTokens({ metadata: {} }), false);
});
