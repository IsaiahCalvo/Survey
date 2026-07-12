// "Verify Live Sync" probe (Amendment 2026-06-08(b), slice 4): a guided,
// STRICTLY READ-ONLY check the user runs right after the first work-account
// sign-in. These tests drive the REAL modules — runLiveSyncVerification with
// its DEFAULT deps, i.e. the real liveSyncEligibility (and its real
// getDriveType probe) plus the real excelSessionService — with only the Graph
// client faked at the boundary. Proven here, step by step:
//   - each ordered step (sign-in → work account → business file → workbook
//     open → workbook read → sync stamp) passes/fails in the right place;
//   - every failure mode maps to the right plain-English vocabulary entry;
//   - the probe makes ZERO write calls (no patch/put; the only posts are the
//     non-persistent createSession + closeSession) and never flips any gate;
//   - slice-1's per-drive driveType cache is REUSED, not duplicated;
//   - token expiry surfaces the reconnect verdict — never a silent fail.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  VERIFY_STEP,
  VERIFY_STEP_ORDER,
  classifyLiveSyncProbeError,
  findExportStampInValues,
  runLiveSyncVerification
} from '../liveSyncVerification.js';
import { LIVE_SYNC_GATE_REASON } from '../liveSyncEligibility.js';
import {
  LIVE_SYNC_GATE_STATUS,
  LIVE_SYNC_VERIFY_STATUS,
  LIVE_SYNC_VERIFY_STEP_LABELS,
  SYNC_TONE,
  liveSyncVerifyStatus,
  syncMessageTone
} from '../excelSyncStatus.js';

const WORK_TENANT = '11111111-2222-3333-4444-555555555555';
const CONSUMER_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad';

const oneDriveTemplate = {
  linkedExcelPath: '/Surveys/site.xlsx',
  oneDriveApiPath: '/Surveys/site.xlsx',
  isOneDrive: true
};
const sharePointTemplate = { ...oneDriveTemplate, isSharePoint: true, sharePointDriveId: 'drv-123' };
const localTemplate = { linkedExcelPath: '/Users/x/site.xlsx', isOneDrive: false };

const workMainSignals = () => ({ tenantId: WORK_TENANT, custody: 'main' });

const STAMP = '2026-06-09T12:00:00.000Z';

// Chainable fake Graph client recording every call (path, method, selects,
// headers, body) so tests can also PROVE the probe never writes.
const makeFakeGraph = (handler) => {
  const calls = [];
  return {
    calls,
    api(path) {
      const call = { path, method: null, selects: [], headers: {}, body: undefined };
      calls.push(call);
      const chain = {
        select(fields) { call.selects.push(fields); return chain; },
        header(name, value) { call.headers[name] = value; return chain; },
        async get() { call.method = 'get'; return handler(call); },
        async post(body) { call.method = 'post'; call.body = body; return handler(call); },
        async patch(body) { call.method = 'patch'; call.body = body; return handler(call); },
        async put(body) { call.method = 'put'; call.body = body; return handler(call); }
      };
      return chain;
    }
  };
};

// A healthy business workbook behind Graph; knobs poke individual failures in.
const businessWorkbookHandler = ({
  driveType = 'business',
  stamp = STAMP,
  metaSheet = true,
  metaValues = null,
  failures = {}
} = {}) => (call) => {
  const { path, method } = call;
  const throwIf = (key) => {
    if (failures[key]) throw failures[key];
  };
  if (method === 'get' && (path === '/me/drive' || /^\/drives\/[^/]+$/.test(path))) {
    throwIf('driveProbe');
    return { driveType };
  }
  if (method === 'get' && path.includes('/root:')) {
    throwIf('resolveFileId');
    return { id: 'file-1' };
  }
  if (method === 'post' && path.endsWith('/workbook/createSession')) {
    throwIf('createSession');
    return { id: 'sess-1' };
  }
  if (method === 'post' && path.endsWith('/workbook/closeSession')) {
    return {};
  }
  if (method === 'get' && path.endsWith('/workbook/worksheets')) {
    throwIf('worksheets');
    const sheets = [{ id: 'w1', name: 'Sheet1', position: 0 }];
    if (metaSheet) sheets.push({ id: 'w2', name: '_SurveyMetadata', position: 1 });
    return { value: sheets };
  }
  if (method === 'get' && path.includes("worksheets('Sheet1')/usedRange")) {
    throwIf('usedRange');
    return { values: [['Row ID', 'Item']], address: 'Sheet1!A1:B1', rowCount: 1, columnCount: 2 };
  }
  if (method === 'get' && path.includes("worksheets('_SurveyMetadata')/usedRange")) {
    throwIf('metaRange');
    return {
      values: metaValues || [['template_id', 'tpl-1'], ['version', '2'], ['export_timestamp', stamp]],
      address: '_SurveyMetadata!A1:B3'
    };
  }
  throw new Error(`unexpected graph call: ${method} ${path}`);
};

const stepStatus = (result, step) => result.steps.find((s) => s.step === step)?.status;
const stepReason = (result, step) => result.steps.find((s) => s.step === step)?.reasonCode;

const runVerified = (overrides = {}) => runLiveSyncVerification({
  template: oneDriveTemplate,
  isMicrosoftConnected: true,
  getAuthSignals: workMainSignals,
  ...overrides
});

// ---------------------------------------------------------------------------
// Happy path + read-only proof
// ---------------------------------------------------------------------------

test('verify: healthy business workbook → ready, all six steps pass', async () => {
  const graph = makeFakeGraph(businessWorkbookHandler());
  const result = await runVerified({ graphClient: graph, appExportStamp: STAMP });

  assert.equal(result.ready, true);
  assert.equal(result.verdictCode, 'ready');
  assert.equal(result.failedStep, null);
  for (const step of VERIFY_STEP_ORDER) {
    assert.equal(stepStatus(result, step), 'pass', `step ${step} should pass`);
  }
  assert.equal(result.driveType, 'business');
  assert.equal(result.eligibility?.allowed, true);
  // The verdict the banner shows reads as a success.
  assert.equal(liveSyncVerifyStatus(result.verdictCode).tone, SYNC_TONE.SUCCESS);
  assert.equal(syncMessageTone(liveSyncVerifyStatus(result.verdictCode).label), SYNC_TONE.SUCCESS);
});

test('verify: STRICTLY read-only — no patch/put, only the non-persistent session posts', async () => {
  const graph = makeFakeGraph(businessWorkbookHandler());
  await runVerified({ graphClient: graph, appExportStamp: STAMP });

  const writes = graph.calls.filter((c) => c.method === 'patch' || c.method === 'put');
  assert.deepEqual(writes, [], 'the probe must never PATCH or PUT');

  const posts = graph.calls.filter((c) => c.method === 'post');
  assert.equal(posts.length, 2);
  assert.ok(posts[0].path.endsWith('/workbook/createSession'));
  assert.equal(posts[0].body?.persistChanges, false, 'probe session must be non-persistent');
  assert.ok(posts[1].path.endsWith('/workbook/closeSession'), 'probe session must be closed');
  assert.equal(posts[1].headers['workbook-session-id'], 'sess-1');
});

test('verify: reads run under the probe session (workbook-session-id header)', async () => {
  const graph = makeFakeGraph(businessWorkbookHandler());
  await runVerified({ graphClient: graph, appExportStamp: STAMP });
  const sheetReads = graph.calls.filter((c) => c.path.includes('/workbook/worksheets') && c.method === 'get');
  assert.ok(sheetReads.length >= 2);
  for (const read of sheetReads) {
    assert.equal(read.headers['workbook-session-id'], 'sess-1');
  }
});

test('verify: reuses slice-1 driveType cache — no duplicate drive probe', async () => {
  const graph = makeFakeGraph(businessWorkbookHandler());
  const cache = new Map([['me', 'business']]);
  const result = await runVerified({ graphClient: graph, appExportStamp: STAMP, driveTypeCache: cache });
  assert.equal(result.ready, true);
  const driveProbes = graph.calls.filter((c) => c.path === '/me/drive');
  assert.equal(driveProbes.length, 0, 'cached driveType must skip the Graph drive probe');
});

test('verify: SharePoint link keeps every call drive-scoped', async () => {
  const graph = makeFakeGraph(businessWorkbookHandler({ driveType: 'documentLibrary' }));
  const result = await runVerified({
    template: sharePointTemplate,
    graphClient: graph,
    appExportStamp: STAMP
  });
  assert.equal(result.ready, true);
  assert.ok(graph.calls.length > 0);
  for (const call of graph.calls) {
    assert.ok(call.path.startsWith('/drives/drv-123'), `expected drive-scoped path, got ${call.path}`);
  }
});

// ---------------------------------------------------------------------------
// Preconditions and gate-step failures (steps 1–3, via slice-1's gate)
// ---------------------------------------------------------------------------

test('verify: nothing linked → not-linked precondition, zero Graph calls, no steps run', async () => {
  const graph = makeFakeGraph(() => { throw new Error('must not be called'); });
  const result = await runVerified({ template: null, graphClient: graph });
  assert.equal(result.ready, false);
  assert.equal(result.verdictCode, LIVE_SYNC_GATE_REASON.NOT_LINKED);
  assert.equal(result.failedStep, null);
  assert.ok(result.steps.every((s) => s.status === 'not-run'));
  assert.equal(graph.calls.length, 0);
});

test('verify: local file → local-file precondition, zero Graph calls', async () => {
  const graph = makeFakeGraph(() => { throw new Error('must not be called'); });
  const result = await runVerified({ template: localTemplate, graphClient: graph });
  assert.equal(result.verdictCode, LIVE_SYNC_GATE_REASON.LOCAL_FILE);
  assert.equal(graph.calls.length, 0);
});

test('verify: signed out → sign-in step fails, later steps never run, zero Graph calls', async () => {
  const result = await runVerified({
    graphClient: null,
    isMicrosoftConnected: false,
    getAuthSignals: () => ({ tenantId: null, custody: null })
  });
  assert.equal(result.ready, false);
  assert.equal(result.verdictCode, LIVE_SYNC_GATE_REASON.NOT_SIGNED_IN);
  assert.equal(result.failedStep, VERIFY_STEP.SIGN_IN);
  assert.equal(stepStatus(result, VERIFY_STEP.SIGN_IN), 'fail');
  assert.equal(stepStatus(result, VERIFY_STEP.WORK_ACCOUNT), 'not-run');
  assert.equal(stepStatus(result, VERIFY_STEP.WORKBOOK_OPEN), 'not-run');
});

test('verify: legacy embedded sign-in → sign-in step fails with the reconnect reason', async () => {
  const graph = makeFakeGraph(() => { throw new Error('must not be called'); });
  const result = await runVerified({
    graphClient: graph,
    getAuthSignals: () => ({ tenantId: WORK_TENANT, custody: 'legacy' })
  });
  assert.equal(result.verdictCode, LIVE_SYNC_GATE_REASON.LEGACY_RECONNECT);
  assert.equal(result.failedStep, VERIFY_STEP.SIGN_IN);
  assert.equal(graph.calls.length, 0, 'legacy refusal must not probe Graph');
});

test('verify: consumer tenant → work-account step fails (sign-in passed)', async () => {
  const graph = makeFakeGraph(() => { throw new Error('must not be called'); });
  const result = await runVerified({
    graphClient: graph,
    getAuthSignals: () => ({ tenantId: CONSUMER_TENANT, custody: 'main' })
  });
  assert.equal(result.verdictCode, LIVE_SYNC_GATE_REASON.PERSONAL_ACCOUNT);
  assert.equal(result.failedStep, VERIFY_STEP.WORK_ACCOUNT);
  assert.equal(stepStatus(result, VERIFY_STEP.SIGN_IN), 'pass');
  assert.equal(stepReason(result, VERIFY_STEP.WORK_ACCOUNT), 'personal-account');
  assert.equal(graph.calls.length, 0);
});

test('verify: drive proves personal → work-account step fails honestly', async () => {
  const graph = makeFakeGraph(businessWorkbookHandler({ driveType: 'personal' }));
  const result = await runVerified({ graphClient: graph });
  assert.equal(result.verdictCode, LIVE_SYNC_GATE_REASON.PERSONAL_ACCOUNT);
  assert.equal(result.failedStep, VERIFY_STEP.WORK_ACCOUNT);
  assert.equal(stepStatus(result, VERIFY_STEP.WORKBOOK_OPEN), 'not-run', 'no session on a refused gate');
});

test('verify: drive probe error → business-file step fails, retryable, no session attempted', async () => {
  const graph = makeFakeGraph(businessWorkbookHandler({ failures: { driveProbe: new Error('network down') } }));
  const result = await runVerified({ graphClient: graph });
  assert.equal(result.ready, false);
  assert.equal(result.verdictCode, LIVE_SYNC_GATE_REASON.UNCONFIRMED);
  assert.equal(result.failedStep, VERIFY_STEP.BUSINESS_FILE);
  assert.equal(result.retryable, true);
  assert.equal(stepStatus(result, VERIFY_STEP.SIGN_IN), 'pass');
  assert.equal(stepStatus(result, VERIFY_STEP.WORK_ACCOUNT), 'pass');
  assert.equal(graph.calls.filter((c) => c.method === 'post').length, 0);
});

// ---------------------------------------------------------------------------
// Workbook steps (4–6)
// ---------------------------------------------------------------------------

test('verify: session refused (403) → workbook-open fails with its own reason', async () => {
  const graph = makeFakeGraph(businessWorkbookHandler({
    failures: { createSession: Object.assign(new Error('Access denied'), { statusCode: 403, code: 'AccessDenied' }) }
  }));
  const result = await runVerified({ graphClient: graph });
  assert.equal(result.ready, false);
  assert.equal(result.verdictCode, 'workbook-open-failed');
  assert.equal(result.failedStep, VERIFY_STEP.WORKBOOK_OPEN);
  assert.equal(stepStatus(result, VERIFY_STEP.BUSINESS_FILE), 'pass');
  assert.equal(stepStatus(result, VERIFY_STEP.WORKBOOK_READ), 'not-run');
  const closes = graph.calls.filter((c) => c.path.endsWith('/closeSession'));
  assert.equal(closes.length, 0, 'no session was created, none to close');
  // The error that reached the probe's classifier is the REAL
  // createWorkbookSession 403 wrap — a plain Error stripped of statusCode and
  // code. Locking the exact message proves the production error shape was
  // exercised and read as a plain failure, never as auth-expired.
  assert.equal(
    result.errorMessage,
    'Excel session API requires Microsoft 365 Business account. Personal OneDrive accounts are not supported for live sync.'
  );
});

test('verify: token expired opening the workbook → reconnect verdict, never silent (recon C)', async () => {
  // excelSessionService wraps the original error in a plain Error; the probe
  // classifier must still recognize the auth marker in the message.
  const graph = makeFakeGraph(businessWorkbookHandler({
    failures: { createSession: Object.assign(new Error('InvalidAuthenticationToken'), { statusCode: 401 }) }
  }));
  const result = await runVerified({ graphClient: graph });
  assert.equal(result.verdictCode, 'auth-expired');
  assert.equal(result.failedStep, VERIFY_STEP.WORKBOOK_OPEN);
  const status = liveSyncVerifyStatus(result.verdictCode);
  assert.match(status.label, /reconnect/i);
  assert.equal(syncMessageTone(status.label), SYNC_TONE.WARN);
});

test('verify: worksheets read fails → workbook-read fails AND the session still closes', async () => {
  const graph = makeFakeGraph(businessWorkbookHandler({
    failures: { worksheets: Object.assign(new Error('Service unavailable'), { statusCode: 503 }) }
  }));
  const result = await runVerified({ graphClient: graph });
  assert.equal(result.verdictCode, 'workbook-read-failed');
  assert.equal(result.failedStep, VERIFY_STEP.WORKBOOK_READ);
  assert.equal(stepStatus(result, VERIFY_STEP.WORKBOOK_OPEN), 'pass');
  assert.equal(stepStatus(result, VERIFY_STEP.SYNC_STAMP), 'not-run');
  const closes = graph.calls.filter((c) => c.path.endsWith('/closeSession') && c.method === 'post');
  assert.equal(closes.length, 1, 'the probe session must be closed even on failure');
});

test('verify: token expires mid-read → reconnect verdict on the sync-stamp step', async () => {
  const graph = makeFakeGraph(businessWorkbookHandler({
    failures: { metaRange: Object.assign(new Error('Access token has expired. TokenExpired'), { statusCode: 401 }) }
  }));
  const result = await runVerified({ graphClient: graph, appExportStamp: STAMP });
  assert.equal(result.verdictCode, 'auth-expired');
  assert.equal(result.failedStep, VERIFY_STEP.SYNC_STAMP);
  assert.equal(stepStatus(result, VERIFY_STEP.WORKBOOK_READ), 'pass');
});

test('verify: no sync stamp while the app has exported → sync-stamp step fails with the export-once reason', async () => {
  const graph = makeFakeGraph(businessWorkbookHandler({ metaSheet: false }));
  const result = await runVerified({ graphClient: graph, appExportStamp: STAMP });
  assert.equal(result.ready, false);
  assert.equal(result.verdictCode, 'no-sync-stamp');
  assert.equal(result.failedStep, VERIFY_STEP.SYNC_STAMP);
  assert.equal(stepStatus(result, VERIFY_STEP.WORKBOOK_READ), 'pass');
});

test('verify: metadata sheet exists but carries no stamp row → no-sync-stamp', async () => {
  const graph = makeFakeGraph(businessWorkbookHandler({ metaValues: [['template_id', 'tpl-1']] }));
  const result = await runVerified({ graphClient: graph, appExportStamp: STAMP });
  assert.equal(result.verdictCode, 'no-sync-stamp');
});

test('verify: workbook stamp older than the app clock → stale-workbook', async () => {
  const graph = makeFakeGraph(businessWorkbookHandler({ stamp: '2026-06-09T11:00:00.000Z' }));
  const result = await runVerified({ graphClient: graph, appExportStamp: '2026-06-09T12:00:00.000Z' });
  assert.equal(result.ready, false);
  assert.equal(result.verdictCode, 'stale-workbook');
  assert.equal(result.failedStep, VERIFY_STEP.SYNC_STAMP);
});

test('verify: never exported from the app → a stampless workbook still verifies ready', async () => {
  const graph = makeFakeGraph(businessWorkbookHandler({ metaSheet: false }));
  const result = await runVerified({ graphClient: graph, appExportStamp: null });
  assert.equal(result.ready, true, 'NO_APP_CLOCK abstains — nothing to be stale against');
  assert.equal(result.verdictCode, 'ready');
});

test('verify: a workbook with zero worksheets fails the read step', async () => {
  const handler = businessWorkbookHandler();
  const graph = makeFakeGraph((call) => {
    if (call.method === 'get' && call.path.endsWith('/workbook/worksheets')) return { value: [] };
    return handler(call);
  });
  const result = await runVerified({ graphClient: graph });
  assert.equal(result.verdictCode, 'workbook-read-failed');
  assert.equal(result.failedStep, VERIFY_STEP.WORKBOOK_READ);
});

test('verify: an explicit fileId skips path resolution', async () => {
  const graph = makeFakeGraph(businessWorkbookHandler());
  const result = await runVerified({ graphClient: graph, appExportStamp: STAMP, fileId: 'file-1' });
  assert.equal(result.ready, true);
  assert.equal(graph.calls.filter((c) => c.path.includes('/root:')).length, 0);
});

// ---------------------------------------------------------------------------
// Error classifier + stamp finder
// ---------------------------------------------------------------------------

test('classifyLiveSyncProbeError: auth markers → auth-expired; everything else → error', () => {
  assert.equal(classifyLiveSyncProbeError({ statusCode: 401, message: 'x' }), 'auth-expired');
  assert.equal(classifyLiveSyncProbeError({ code: 'InvalidAuthenticationToken' }), 'auth-expired');
  assert.equal(classifyLiveSyncProbeError(new Error('Failed to create session: InvalidAuthenticationToken')), 'auth-expired');
  assert.equal(classifyLiveSyncProbeError(new Error('Failed to get used range: Access token has expired.')), 'auth-expired');
  assert.equal(classifyLiveSyncProbeError({ statusCode: 403, code: 'AccessDenied', message: 'denied' }), 'error');
  // The exact plain-Error string the REAL createWorkbookSession emits for a
  // 403 (statusCode/code stripped) — must stay 'error', never 'auth-expired'.
  assert.equal(
    classifyLiveSyncProbeError(new Error('Excel session API requires Microsoft 365 Business account. Personal OneDrive accounts are not supported for live sync.')),
    'error'
  );
  assert.equal(classifyLiveSyncProbeError(new Error('network down')), 'error');
  assert.equal(classifyLiveSyncProbeError(null), 'error');
});

test('findExportStampInValues: finds, trims, and fails safe', () => {
  assert.equal(findExportStampInValues([['export_timestamp', ` ${STAMP} `]]), STAMP);
  assert.equal(findExportStampInValues([['template_id', 'x'], [' export_timestamp ', STAMP]]), STAMP);
  assert.equal(findExportStampInValues([['export_timestamp', '']]), null);
  assert.equal(findExportStampInValues([['template_id', 'x']]), null);
  assert.equal(findExportStampInValues(null), null);
  assert.equal(findExportStampInValues([null, 'junk']), null);
  // Graph returns values: [[]] for an empty sheet's usedRange — must fail safe.
  assert.equal(findExportStampInValues([[]]), null);
});

// ---------------------------------------------------------------------------
// Vocabulary contract — every step and verdict reads as plain English
// ---------------------------------------------------------------------------

// Plain-English guard: no camelCase developer tokens in a user-facing label.
// Microsoft product names (OneDrive, SharePoint) are legitimate words.
const looksLikeCamelCase = (label) => /[a-z][A-Z]/.test(label.replace(/OneDrive|SharePoint/g, ''));

test('vocabulary: every probe step has a plain-English label', () => {
  for (const step of VERIFY_STEP_ORDER) {
    const label = LIVE_SYNC_VERIFY_STEP_LABELS[step];
    assert.ok(typeof label === 'string' && label.length > 0, `missing step label for ${step}`);
    assert.ok(!looksLikeCamelCase(label), `step label "${label}" looks like camelCase`);
  }
});

test('vocabulary: every reachable verdict code maps to a labeled status with an honest tone', () => {
  const expectations = [
    ['ready', SYNC_TONE.SUCCESS],
    ['verifying', SYNC_TONE.INFO],
    ['auth-expired', SYNC_TONE.WARN],
    ['workbook-open-failed', SYNC_TONE.ERROR],
    ['workbook-read-failed', SYNC_TONE.ERROR],
    ['no-sync-stamp', SYNC_TONE.WARN],
    ['stale-workbook', SYNC_TONE.WARN],
    // Gate reasons reused by steps 1–3 fall through to the gate vocabulary:
    [LIVE_SYNC_GATE_REASON.NOT_SIGNED_IN, SYNC_TONE.WARN],
    [LIVE_SYNC_GATE_REASON.LEGACY_RECONNECT, SYNC_TONE.WARN],
    [LIVE_SYNC_GATE_REASON.PERSONAL_ACCOUNT, SYNC_TONE.WARN],
    [LIVE_SYNC_GATE_REASON.UNCONFIRMED, SYNC_TONE.WARN],
    [LIVE_SYNC_GATE_REASON.NOT_LINKED, SYNC_TONE.INFO],
    [LIVE_SYNC_GATE_REASON.LOCAL_FILE, SYNC_TONE.INFO]
  ];
  for (const [code, tone] of expectations) {
    const status = liveSyncVerifyStatus(code);
    assert.ok(status.label.length > 0, `no label for ${code}`);
    assert.equal(status.tone, tone, `tone mismatch for ${code}`);
    assert.ok(!looksLikeCamelCase(status.label), `label "${status.label}" looks like camelCase`);
    // The free-text banner classifier must color the label with the same tone.
    assert.equal(syncMessageTone(status.label), tone, `banner tone mismatch for "${status.label}"`);
  }
});

test('vocabulary: unknown verdict codes fall back to the safe unconfirmed status', () => {
  assert.equal(liveSyncVerifyStatus('made-up-code'), LIVE_SYNC_GATE_STATUS['unconfirmed-business']);
  assert.equal(liveSyncVerifyStatus(undefined), LIVE_SYNC_GATE_STATUS['unconfirmed-business']);
});

test('vocabulary: probe-specific statuses are self-consistent (key mirrors map key)', () => {
  for (const [key, status] of Object.entries(LIVE_SYNC_VERIFY_STATUS)) {
    assert.equal(status.key, key);
    assert.ok(Object.values(SYNC_TONE).includes(status.tone));
  }
});

// VERIFY_STEP completeness — the ordered list and the enum stay in lockstep.
test('VERIFY_STEP_ORDER covers exactly the VERIFY_STEP values, in order', () => {
  assert.deepEqual([...VERIFY_STEP_ORDER], [
    VERIFY_STEP.SIGN_IN,
    VERIFY_STEP.WORK_ACCOUNT,
    VERIFY_STEP.BUSINESS_FILE,
    VERIFY_STEP.WORKBOOK_OPEN,
    VERIFY_STEP.WORKBOOK_READ,
    VERIFY_STEP.SYNC_STAMP
  ]);
  assert.equal(new Set(VERIFY_STEP_ORDER).size, Object.values(VERIFY_STEP).length);
});

test('verify: resolveEligibility throw → unconfirmed refuse', async () => {
  const result = await runLiveSyncVerification({
    template: oneDriveTemplate,
    graphClient: {},
    isMicrosoftConnected: true,
    deps: {
      resolveEligibility: async () => { throw new Error('eligibility-boom'); },
    },
  });
  assert.equal(result.ready, false);
  assert.equal(result.verdictCode, LIVE_SYNC_GATE_REASON.UNCONFIRMED);
  assert.equal(result.retryable, true);
  assert.equal(result.eligibility, null);
});
