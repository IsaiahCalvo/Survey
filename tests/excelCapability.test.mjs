import test from 'node:test';
import assert from 'node:assert/strict';

import {
  CONSUMER_TENANT_ID,
  EXCEL_CAPABILITY,
  LIVE_WRITEBACK_ENABLED,
  classifyExcelCapability,
  canAttemptLiveWriteback,
} from '../src/services/excelCapability.js';

test('classifyExcelCapability returns none/local for unlinked or local files', () => {
  assert.deepEqual(classifyExcelCapability({}), {
    kind: EXCEL_CAPABILITY.NONE,
    liveWritebackEligible: false,
    reason: 'no-linked-workbook',
  });
  assert.deepEqual(classifyExcelCapability({
    template: { linkedExcelPath: '/tmp/a.xlsx', isOneDrive: false },
  }), {
    kind: EXCEL_CAPABILITY.LOCAL,
    liveWritebackEligible: false,
    reason: 'local-file',
  });
});

test('classifyExcelCapability fails safe for personal/consumer/unproven cloud files', () => {
  assert.equal(classifyExcelCapability({
    template: { linkedExcelPath: 'cloud', isOneDrive: true },
    tenantId: CONSUMER_TENANT_ID,
    isMicrosoftConnected: true,
    driveType: 'business',
  }).reason, 'consumer-tenant');

  assert.equal(classifyExcelCapability({
    template: { linkedExcelPath: 'cloud', isOneDrive: true },
    tenantId: 'work-tenant',
    isMicrosoftConnected: true,
    driveType: 'personal',
  }).reason, 'personal-drivetype');

  assert.equal(classifyExcelCapability({
    template: { linkedExcelPath: 'cloud', isOneDrive: true },
    tenantId: 'work-tenant',
    isMicrosoftConnected: false,
    driveType: 'business',
  }).reason, 'not-connected');

  assert.equal(classifyExcelCapability({
    template: { linkedExcelPath: 'cloud', isOneDrive: true },
    tenantId: '',
    isMicrosoftConnected: true,
    driveType: 'business',
  }).reason, 'no-work-tenant');

  assert.equal(classifyExcelCapability({
    template: { linkedExcelPath: 'cloud', isOneDrive: true },
    tenantId: 'work-tenant',
    isMicrosoftConnected: true,
    driveType: null,
  }).reason, 'drivetype-unconfirmed');
});

test('classifyExcelCapability marks proven business/sharepoint drives eligible', () => {
  assert.deepEqual(classifyExcelCapability({
    template: { linkedExcelPath: 'cloud', isOneDrive: true },
    tenantId: 'work-tenant',
    isMicrosoftConnected: true,
    driveType: 'business',
  }), {
    kind: EXCEL_CAPABILITY.BUSINESS_GRAPH,
    liveWritebackEligible: true,
    reason: 'business-onedrive',
  });
  assert.equal(classifyExcelCapability({
    template: { linkedExcelPath: 'cloud', isOneDrive: true },
    tenantId: 'work-tenant',
    isMicrosoftConnected: true,
    driveType: 'documentLibrary',
  }).reason, 'sharepoint-documentlibrary');
});

test('canAttemptLiveWriteback requires eligibility and the master gate', () => {
  assert.equal(LIVE_WRITEBACK_ENABLED, false);
  assert.equal(canAttemptLiveWriteback({ liveWritebackEligible: true }), false);
  assert.equal(canAttemptLiveWriteback(null), false);
});
