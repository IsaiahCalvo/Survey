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

test('SharePoint → business-graph eligible', () => {
  const cap = classifyExcelCapability({
    template: { linkedExcelPath: '/drives/d/items/i', isOneDrive: true, isSharePoint: true }
  });
  assert.equal(cap.kind, EXCEL_CAPABILITY.BUSINESS_GRAPH);
  assert.equal(cap.liveWritebackEligible, true);
});

test('work tenant OneDrive → business-graph eligible', () => {
  const cap = classifyExcelCapability({
    template: { linkedExcelPath: '/x.xlsx', isOneDrive: true },
    tenantId: '11111111-2222-3333-4444-555555555555'
  });
  assert.equal(cap.kind, EXCEL_CAPABILITY.BUSINESS_GRAPH);
  assert.equal(cap.liveWritebackEligible, true);
});

test('consumer tenant OneDrive → personal, never live', () => {
  const cap = classifyExcelCapability({
    template: { linkedExcelPath: '/x.xlsx', isOneDrive: true },
    tenantId: CONSUMER_TENANT_ID.toUpperCase() // case-insensitive
  });
  assert.equal(cap.kind, EXCEL_CAPABILITY.PERSONAL_ONEDRIVE);
  assert.equal(cap.liveWritebackEligible, false);
});

test('unknown tenant OneDrive fails SAFE → personal', () => {
  const cap = classifyExcelCapability({
    template: { linkedExcelPath: '/x.xlsx', isOneDrive: true },
    tenantId: null
  });
  assert.equal(cap.kind, EXCEL_CAPABILITY.PERSONAL_ONEDRIVE);
  assert.equal(cap.liveWritebackEligible, false);
});

test('canAttemptLiveWriteback honors the master gate (off by default)', () => {
  const business = classifyExcelCapability({
    template: { linkedExcelPath: '/x', isOneDrive: true, isSharePoint: true }
  });
  // Gate is OFF until validated against a real Business M365 account.
  assert.equal(LIVE_WRITEBACK_ENABLED, false);
  assert.equal(canAttemptLiveWriteback(business), false);
  // Local can never attempt live writeback regardless of the gate.
  const local = classifyExcelCapability({ template: { linkedExcelPath: '/x.xlsx' } });
  assert.equal(canAttemptLiveWriteback(local), false);
});
