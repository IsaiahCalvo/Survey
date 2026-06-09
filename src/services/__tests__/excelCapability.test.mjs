import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  CONSUMER_TENANT_ID,
  EXCEL_CAPABILITY,
  LIVE_WRITEBACK_ENABLED,
  classifyExcelCapability,
  canAttemptLiveWriteback
} from '../excelCapability.js';

test('no linked workbook → none', () => {
  assert.equal(classifyExcelCapability({ template: {} }).kind, EXCEL_CAPABILITY.NONE);
  assert.equal(classifyExcelCapability({}).kind, EXCEL_CAPABILITY.NONE);
});

test('local file (not OneDrive) → local, no live writeback', () => {
  const cap = classifyExcelCapability({ template: { linkedExcelPath: '/Users/x/Desktop/s.xlsx' } });
  assert.equal(cap.kind, EXCEL_CAPABILITY.LOCAL);
  assert.equal(cap.liveWritebackEligible, false);
});

const WORK_TENANT = '11111111-2222-3333-4444-555555555555';

test('work tenant + connected + business drive → business-graph eligible', () => {
  const cap = classifyExcelCapability({
    template: { linkedExcelPath: '/x.xlsx', isOneDrive: true },
    tenantId: WORK_TENANT,
    isMicrosoftConnected: true,
    driveType: 'business'
  });
  assert.equal(cap.kind, EXCEL_CAPABILITY.BUSINESS_GRAPH);
  assert.equal(cap.liveWritebackEligible, true);
});

test('SharePoint/Teams documentLibrary + connected + work tenant → business-graph eligible', () => {
  const cap = classifyExcelCapability({
    template: { linkedExcelPath: '/drives/d/items/i', isOneDrive: true, isSharePoint: true },
    tenantId: WORK_TENANT,
    isMicrosoftConnected: true,
    driveType: 'documentLibrary' // case-insensitive
  });
  assert.equal(cap.kind, EXCEL_CAPABILITY.BUSINESS_GRAPH);
  assert.equal(cap.liveWritebackEligible, true);
  assert.equal(cap.reason, 'sharepoint-documentlibrary');
});

test('SharePoint flag alone is NOT enough — no connection/tenant/driveType proof → not eligible', () => {
  const cap = classifyExcelCapability({
    template: { linkedExcelPath: '/drives/d/items/i', isOneDrive: true, isSharePoint: true }
  });
  assert.equal(cap.kind, EXCEL_CAPABILITY.PERSONAL_ONEDRIVE);
  assert.equal(cap.liveWritebackEligible, false);
  assert.equal(cap.reason, 'not-connected');
});

test('work tenant but NOT connected → not eligible (fail safe)', () => {
  const cap = classifyExcelCapability({
    template: { linkedExcelPath: '/x.xlsx', isOneDrive: true },
    tenantId: WORK_TENANT,
    isMicrosoftConnected: false,
    driveType: 'business'
  });
  assert.equal(cap.liveWritebackEligible, false);
  assert.equal(cap.reason, 'not-connected');
});

test('connected work tenant but driveType unconfirmed → not eligible', () => {
  const cap = classifyExcelCapability({
    template: { linkedExcelPath: '/x.xlsx', isOneDrive: true },
    tenantId: WORK_TENANT,
    isMicrosoftConnected: true,
    driveType: null
  });
  assert.equal(cap.liveWritebackEligible, false);
  assert.equal(cap.reason, 'drivetype-unconfirmed');
});

test('connected work tenant but personal driveType → personal, never live', () => {
  const cap = classifyExcelCapability({
    template: { linkedExcelPath: '/x.xlsx', isOneDrive: true },
    tenantId: WORK_TENANT,
    isMicrosoftConnected: true,
    driveType: 'personal'
  });
  assert.equal(cap.kind, EXCEL_CAPABILITY.PERSONAL_ONEDRIVE);
  assert.equal(cap.liveWritebackEligible, false);
  assert.equal(cap.reason, 'personal-drivetype');
});

test('consumer tenant → personal, never live (even if connected + business driveType)', () => {
  const cap = classifyExcelCapability({
    template: { linkedExcelPath: '/x.xlsx', isOneDrive: true },
    tenantId: CONSUMER_TENANT_ID.toUpperCase(), // case-insensitive
    isMicrosoftConnected: true,
    driveType: 'business'
  });
  assert.equal(cap.kind, EXCEL_CAPABILITY.PERSONAL_ONEDRIVE);
  assert.equal(cap.liveWritebackEligible, false);
  assert.equal(cap.reason, 'consumer-tenant');
});

test('unknown tenant fails SAFE → personal', () => {
  const cap = classifyExcelCapability({
    template: { linkedExcelPath: '/x.xlsx', isOneDrive: true },
    tenantId: null,
    isMicrosoftConnected: true,
    driveType: 'business'
  });
  assert.equal(cap.kind, EXCEL_CAPABILITY.PERSONAL_ONEDRIVE);
  assert.equal(cap.liveWritebackEligible, false);
  assert.equal(cap.reason, 'no-work-tenant');
});

test('canAttemptLiveWriteback honors the master gate (off by default)', () => {
  const business = classifyExcelCapability({
    template: { linkedExcelPath: '/x', isOneDrive: true, isSharePoint: true },
    tenantId: WORK_TENANT,
    isMicrosoftConnected: true,
    driveType: 'documentLibrary'
  });
  // Even a fully-proven business setup cannot patch live while the master gate is OFF.
  assert.equal(business.liveWritebackEligible, true);
  assert.equal(LIVE_WRITEBACK_ENABLED, false);
  assert.equal(canAttemptLiveWriteback(business), false);
  // Local can never attempt live writeback regardless of the gate.
  const local = classifyExcelCapability({ template: { linkedExcelPath: '/x.xlsx' } });
  assert.equal(canAttemptLiveWriteback(local), false);
});
