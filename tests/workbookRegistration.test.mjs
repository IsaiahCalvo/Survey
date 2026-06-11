// workbookRegistration.test.mjs — KAL-307 unit tests.
//
// Coverage:
//   1. detectLegacyWorkbook — registered / unregistered-legacy / unknown variants
//   2. readRegistrationFromMetaSheet — all input styles
//   3. registerWorkbook — mint/hash/verify roundtrip (mocked at RPC boundary)
//   4. One-active-per-survey enforcement (owner can replace, editor cannot)
//   5. Generation increment on re-registration
//   6. embedRegistrationIntoMetaSheet — cells written correctly
//
// Integration against the TEST Supabase project: NOT done here.
// The guarded test bootstrap (excelLiveSyncWritebackIntegration pattern) requires
// matching the existing `survey-test` project harness, which does not yet have the
// kal307_register_workbook function deployed.  All server behaviour is mocked at
// the RPC boundary (fake supabaseClient.rpc stub) so we can prove the client logic
// without hitting any Supabase project.
//
// When the migration is applied to the TEST project, add an integration file
// tests/workbookRegistrationIntegration.test.mjs following the same mock-at-boundary
// pattern as excelLiveSyncWritebackIntegration.test.mjs.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  registerWorkbook,
  embedRegistrationIntoMetaSheet,
  detectLegacyWorkbook,
  readRegistrationFromMetaSheet,
  WORKBOOK_REGISTRATION_STATUS,
  WORKBOOK_REGISTRATION_CELLS,
} from '../src/services/workbookRegistration.js';

// ---------------------------------------------------------------------------
// Helpers / fixtures
// ---------------------------------------------------------------------------

const VALID_WB_ID = 'wb_deadbeef01234567deadbeef01234567';
const VALID_TOKEN  = 'st_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

/**
 * Creates a fake supabaseClient whose rpc() resolves with the provided data/error.
 * Records every call so we can assert RPC arguments.
 */
function makeFakeClient({ data = null, error = null } = {}) {
  const calls = [];
  return {
    calls,
    rpc: async (fn, params) => {
      calls.push({ fn, params });
      return { data, error };
    },
  };
}

/**
 * Creates a fake ExcelJS worksheet that records cell writes.
 */
function makeFakeSheet() {
  const cells = {};
  return {
    cells,
    getCell: (addr) => ({
      get value() { return cells[addr]; },
      set value(v) { cells[addr] = v; },
    }),
  };
}

// ---------------------------------------------------------------------------
// 1. detectLegacyWorkbook
// ---------------------------------------------------------------------------

test('detectLegacyWorkbook: null input → unknown', () => {
  assert.equal(detectLegacyWorkbook(null), WORKBOOK_REGISTRATION_STATUS.UNKNOWN);
});

test('detectLegacyWorkbook: undefined input → unknown', () => {
  assert.equal(detectLegacyWorkbook(undefined), WORKBOOK_REGISTRATION_STATUS.UNKNOWN);
});

test('detectLegacyWorkbook: valid wb_/st_ prefixes → registered', () => {
  const status = detectLegacyWorkbook({
    workbookId: VALID_WB_ID,
    syncToken:  VALID_TOKEN,
  });
  assert.equal(status, WORKBOOK_REGISTRATION_STATUS.REGISTERED);
});

test('detectLegacyWorkbook: empty object → unregistered-legacy', () => {
  assert.equal(detectLegacyWorkbook({}), WORKBOOK_REGISTRATION_STATUS.UNREGISTERED_LEGACY);
});

test('detectLegacyWorkbook: workbookId present but no syncToken → unregistered-legacy', () => {
  assert.equal(
    detectLegacyWorkbook({ workbookId: VALID_WB_ID }),
    WORKBOOK_REGISTRATION_STATUS.UNREGISTERED_LEGACY,
  );
});

test('detectLegacyWorkbook: syncToken present but no workbookId → unregistered-legacy', () => {
  assert.equal(
    detectLegacyWorkbook({ syncToken: VALID_TOKEN }),
    WORKBOOK_REGISTRATION_STATUS.UNREGISTERED_LEGACY,
  );
});

test('detectLegacyWorkbook: wrong prefix for workbookId → unregistered-legacy', () => {
  assert.equal(
    detectLegacyWorkbook({ workbookId: 'bad_id', syncToken: VALID_TOKEN }),
    WORKBOOK_REGISTRATION_STATUS.UNREGISTERED_LEGACY,
  );
});

test('detectLegacyWorkbook: wrong prefix for syncToken → unregistered-legacy', () => {
  assert.equal(
    detectLegacyWorkbook({ workbookId: VALID_WB_ID, syncToken: 'bad_token' }),
    WORKBOOK_REGISTRATION_STATUS.UNREGISTERED_LEGACY,
  );
});

test('detectLegacyWorkbook: prefix-only strings (just "wb_"/"st_") → unregistered-legacy', () => {
  assert.equal(
    detectLegacyWorkbook({ workbookId: 'wb_', syncToken: 'st_' }),
    WORKBOOK_REGISTRATION_STATUS.UNREGISTERED_LEGACY,
  );
});

// ---------------------------------------------------------------------------
// 2. readRegistrationFromMetaSheet
// ---------------------------------------------------------------------------

test('readRegistrationFromMetaSheet: null → both null', () => {
  const r = readRegistrationFromMetaSheet(null);
  assert.equal(r.workbookId, null);
  assert.equal(r.syncToken, null);
});

test('readRegistrationFromMetaSheet: flat workbook_id/sync_token keys', () => {
  const r = readRegistrationFromMetaSheet({
    workbook_id: VALID_WB_ID,
    sync_token:  VALID_TOKEN,
  });
  assert.equal(r.workbookId, VALID_WB_ID);
  assert.equal(r.syncToken, VALID_TOKEN);
});

test('readRegistrationFromMetaSheet: camelCase workbookId/syncToken keys', () => {
  const r = readRegistrationFromMetaSheet({
    workbookId: VALID_WB_ID,
    syncToken:  VALID_TOKEN,
  });
  assert.equal(r.workbookId, VALID_WB_ID);
  assert.equal(r.syncToken, VALID_TOKEN);
});

test('readRegistrationFromMetaSheet: cell-address B5/B6 keys', () => {
  const r = readRegistrationFromMetaSheet({
    [WORKBOOK_REGISTRATION_CELLS.WORKBOOK_ID_VALUE]: VALID_WB_ID,
    [WORKBOOK_REGISTRATION_CELLS.SYNC_TOKEN_VALUE]:  VALID_TOKEN,
  });
  assert.equal(r.workbookId, VALID_WB_ID);
  assert.equal(r.syncToken, VALID_TOKEN);
});

test('readRegistrationFromMetaSheet: non-string values returned as null', () => {
  const r = readRegistrationFromMetaSheet({ workbook_id: 42, sync_token: null });
  assert.equal(r.workbookId, null);
  assert.equal(r.syncToken, null);
});

// ---------------------------------------------------------------------------
// 3. registerWorkbook — mint/hash/verify roundtrip (mocked at RPC boundary)
// ---------------------------------------------------------------------------

test('registerWorkbook: calls kal307_register_workbook with correct params', async () => {
  const client = makeFakeClient({
    data: [{ workbook_id: VALID_WB_ID, sync_token: VALID_TOKEN }],
  });

  const result = await registerWorkbook({
    documentId:     'doc-uuid-1',
    templateId:     'tpl-1',
    graphDriveId:   'drv-biz',
    graphItemId:    'item-001',
    capabilityTier: 'business',
    supabaseClient: client,
  });

  assert.equal(result.workbookId, VALID_WB_ID);
  assert.equal(result.syncToken,  VALID_TOKEN);

  assert.equal(client.calls.length, 1);
  const call = client.calls[0];
  assert.equal(call.fn, 'kal307_register_workbook');
  assert.equal(call.params.p_document_id,     'doc-uuid-1');
  assert.equal(call.params.p_template_id,     'tpl-1');
  assert.equal(call.params.p_graph_drive_id,  'drv-biz');
  assert.equal(call.params.p_graph_item_id,   'item-001');
  assert.equal(call.params.p_capability_tier, 'business');
});

test('registerWorkbook: handles single-object return (not array)', async () => {
  // Supabase may return a plain object for single-row RPCs in some versions.
  const client = makeFakeClient({
    data: { workbook_id: VALID_WB_ID, sync_token: VALID_TOKEN },
  });
  const result = await registerWorkbook({
    documentId: 'doc-uuid-2', templateId: 'tpl-2', supabaseClient: client,
  });
  assert.equal(result.workbookId, VALID_WB_ID);
  assert.equal(result.syncToken, VALID_TOKEN);
});

test('registerWorkbook: throws on RPC error', async () => {
  const client = makeFakeClient({
    error: { message: 'kal307: owner-only — an active workbook registration already exists', code: 'P0001' },
  });
  await assert.rejects(
    () => registerWorkbook({ documentId: 'doc-uuid-3', templateId: 'tpl-3', supabaseClient: client }),
    /kal307: owner-only/,
  );
});

test('registerWorkbook: throws when workbook_id missing from response', async () => {
  const client = makeFakeClient({ data: [{ sync_token: VALID_TOKEN }] });
  await assert.rejects(
    () => registerWorkbook({ documentId: 'doc-uuid-4', templateId: 'tpl-4', supabaseClient: client }),
    /unexpected shape/,
  );
});

test('registerWorkbook: throws when sync_token missing from response', async () => {
  const client = makeFakeClient({ data: [{ workbook_id: VALID_WB_ID }] });
  await assert.rejects(
    () => registerWorkbook({ documentId: 'doc-uuid-5', templateId: 'tpl-5', supabaseClient: client }),
    /unexpected shape/,
  );
});

test('registerWorkbook: throws when documentId is missing', async () => {
  const client = makeFakeClient({ data: [] });
  await assert.rejects(
    () => registerWorkbook({ documentId: '', templateId: 'tpl-6', supabaseClient: client }),
    /documentId required/,
  );
});

test('registerWorkbook: throws when templateId is missing', async () => {
  const client = makeFakeClient({ data: [] });
  await assert.rejects(
    () => registerWorkbook({ documentId: 'doc-uuid-7', templateId: '', supabaseClient: client }),
    /templateId required/,
  );
});

test('registerWorkbook: defaults graphDriveId/graphItemId to null and capabilityTier to local', async () => {
  const client = makeFakeClient({
    data: [{ workbook_id: VALID_WB_ID, sync_token: VALID_TOKEN }],
  });
  await registerWorkbook({ documentId: 'doc-uuid-8', templateId: 'tpl-8', supabaseClient: client });
  const params = client.calls[0].params;
  assert.equal(params.p_graph_drive_id,  null);
  assert.equal(params.p_graph_item_id,   null);
  assert.equal(params.p_capability_tier, 'local');
});

// ---------------------------------------------------------------------------
// 4. One-active-per-survey enforcement (editor cannot replace)
// ---------------------------------------------------------------------------

test('one-active-per-survey: editor replacement rejected — RPC error propagated', async () => {
  // The RPC itself enforces this; the client wraps the error.
  const client = makeFakeClient({
    error: {
      message: 'kal307: owner-only — an active workbook registration already exists; only the document owner can replace it',
      code: 'P0001',
    },
  });
  await assert.rejects(
    () => registerWorkbook({ documentId: 'doc-uuid-9', templateId: 'tpl-9', supabaseClient: client }),
    (err) => {
      assert.match(err.message, /owner-only/);
      assert.equal(err.code, 'P0001');
      return true;
    },
  );
});

// ---------------------------------------------------------------------------
// 5. Generation increment — simulated via successful re-registration response
// ---------------------------------------------------------------------------

test('generation increment: two successful calls produce two distinct workbook IDs', async () => {
  const WB2 = 'wb_aaaa1111aaaa1111aaaa1111aaaa1111';
  const TK2 = 'st_bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222';

  let callCount = 0;
  const client = {
    calls: [],
    rpc: async (fn, params) => {
      client.calls.push({ fn, params });
      callCount += 1;
      return {
        data: callCount === 1
          ? [{ workbook_id: VALID_WB_ID, sync_token: VALID_TOKEN }]
          : [{ workbook_id: WB2, sync_token: TK2 }],
        error: null,
      };
    },
  };

  const reg1 = await registerWorkbook({ documentId: 'doc-gen', templateId: 'tpl-gen', supabaseClient: client });
  const reg2 = await registerWorkbook({ documentId: 'doc-gen', templateId: 'tpl-gen', supabaseClient: client });

  assert.notEqual(reg1.workbookId, reg2.workbookId, 'workbook IDs must differ across generations');
  assert.notEqual(reg1.syncToken,  reg2.syncToken,  'sync tokens must differ across generations');
  assert.equal(client.calls.length, 2);
});

// ---------------------------------------------------------------------------
// 6. embedRegistrationIntoMetaSheet — cells written correctly
// ---------------------------------------------------------------------------

test('embedRegistrationIntoMetaSheet: writes workbook_id + sync_token to correct cells', () => {
  const sheet = makeFakeSheet();
  embedRegistrationIntoMetaSheet(sheet, VALID_WB_ID, VALID_TOKEN);

  const c = WORKBOOK_REGISTRATION_CELLS;
  assert.equal(sheet.cells[c.WORKBOOK_ID_LABEL], 'workbook_id');
  assert.equal(sheet.cells[c.WORKBOOK_ID_VALUE],  VALID_WB_ID);
  assert.equal(sheet.cells[c.SYNC_TOKEN_LABEL],   'sync_token');
  assert.equal(sheet.cells[c.SYNC_TOKEN_VALUE],   VALID_TOKEN);
});

test('embedRegistrationIntoMetaSheet: label cells use A5/A6, value cells use B5/B6', () => {
  const sheet = makeFakeSheet();
  embedRegistrationIntoMetaSheet(sheet, VALID_WB_ID, VALID_TOKEN);

  assert.equal(sheet.cells['A5'], 'workbook_id', 'A5 is the workbook_id label');
  assert.equal(sheet.cells['B5'], VALID_WB_ID,   'B5 is the workbook_id value');
  assert.equal(sheet.cells['A6'], 'sync_token',  'A6 is the sync_token label');
  assert.equal(sheet.cells['B6'], VALID_TOKEN,   'B6 is the sync_token value');
});

// ---------------------------------------------------------------------------
// 7. Legacy detection end-to-end: detectLegacyWorkbook ∘ readRegistrationFromMetaSheet
// ---------------------------------------------------------------------------

test('legacy e2e: cells absent from metasheet → unregistered-legacy', () => {
  // Simulates a pre-V1 workbook whose _SurveyMetadata sheet has rows 1-4 but no 5/6.
  const parsed = readRegistrationFromMetaSheet({ B1: 'tpl-old', B3: '2026-01-01T00:00:00.000Z' });
  const status  = detectLegacyWorkbook({ workbookId: parsed.workbookId, syncToken: parsed.syncToken });
  assert.equal(status, WORKBOOK_REGISTRATION_STATUS.UNREGISTERED_LEGACY);
});

test('legacy e2e: cells present → registered', () => {
  const parsed = readRegistrationFromMetaSheet({ workbook_id: VALID_WB_ID, sync_token: VALID_TOKEN });
  const status  = detectLegacyWorkbook({ workbookId: parsed.workbookId, syncToken: parsed.syncToken });
  assert.equal(status, WORKBOOK_REGISTRATION_STATUS.REGISTERED);
});
