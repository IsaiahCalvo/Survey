// Live Sync gate (Amendment 2026-06-08(b), HANDOFF item 2): the toggle may
// turn ON only for a positively PROVEN business/work setup. These tests drive
// the REAL modules with the Graph drive probe mocked at the boundary:
//   - evaluateLiveSyncGate: pure signals-in → verdict-out policy
//   - resolveLiveSyncEligibility: lazy probe + per-drive caching, retryable failures
//   - getDriveType: read-only, drive-scoped Graph probe
//   - excelSyncStatus vocabulary: every reason code has a plain-English label
//     and the banner tone classifier reads the refusals as warnings.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  LIVE_SYNC_GATE_REASON,
  evaluateLiveSyncGate,
  liveSyncDriveCacheKey,
  resolveLiveSyncEligibility
} from '../liveSyncEligibility.js';
import { EXCEL_CAPABILITY, LIVE_WRITEBACK_ENABLED } from '../excelCapability.js';
import { getDriveType } from '../excelGraphService.js';
import { LIVE_SYNC_GATE_STATUS, SYNC_TONE, liveSyncGateStatus, syncMessageTone } from '../excelSyncStatus.js';

const WORK_TENANT = '11111111-2222-3333-4444-555555555555';
const CONSUMER_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad';

const oneDriveTemplate = { linkedExcelPath: '/Surveys/site.xlsx', isOneDrive: true };
const sharePointTemplate = { ...oneDriveTemplate, isSharePoint: true, sharePointDriveId: 'drv-123' };
const localTemplate = { linkedExcelPath: '/Users/x/site.xlsx', isOneDrive: false };

const workMainSignals = () => ({ tenantId: WORK_TENANT, custody: 'main' });

// Chainable fake Graph client in the excelSessionService.test.mjs makeFakeGraph
// style: records every path/select/method so tests can also prove NO writes.
const makeFakeGraph = (getHandler) => {
  const calls = [];
  return {
    calls,
    api(path) {
      const call = { path, selects: [], method: null };
      calls.push(call);
      const chain = {
        select(fields) { call.selects.push(fields); return chain; },
        header() { return chain; },
        async get() { call.method = 'get'; return getHandler ? getHandler(path) : {}; },
        async post() { call.method = 'post'; throw new Error('unexpected write (post)'); },
        async patch() { call.method = 'patch'; throw new Error('unexpected write (patch)'); },
        async put() { call.method = 'put'; throw new Error('unexpected write (put)'); }
      };
      return chain;
    }
  };
};

// ---------------------------------------------------------------------------
// evaluateLiveSyncGate — pure policy
// ---------------------------------------------------------------------------

test('gate: work tenant + main custody + business drive → ELIGIBLE', () => {
  const verdict = evaluateLiveSyncGate({
    template: oneDriveTemplate,
    isMicrosoftConnected: true,
    tenantId: WORK_TENANT,
    custody: 'main',
    driveTypeProbe: { state: 'ok', driveType: 'business' }
  });
  assert.equal(verdict.allowed, true);
  assert.equal(verdict.reasonCode, LIVE_SYNC_GATE_REASON.ELIGIBLE);
  assert.equal(verdict.capability.kind, EXCEL_CAPABILITY.BUSINESS_GRAPH);
});

test('gate: SharePoint documentLibrary drive → ELIGIBLE', () => {
  const verdict = evaluateLiveSyncGate({
    template: sharePointTemplate,
    isMicrosoftConnected: true,
    tenantId: WORK_TENANT,
    custody: 'main',
    driveTypeProbe: { state: 'ok', driveType: 'documentLibrary' }
  });
  assert.equal(verdict.allowed, true);
  assert.equal(verdict.reasonCode, LIVE_SYNC_GATE_REASON.ELIGIBLE);
});

test('gate: eligibility is the PULL gate — independent of the writeback master gate (still OFF)', () => {
  const verdict = evaluateLiveSyncGate({
    template: oneDriveTemplate,
    isMicrosoftConnected: true,
    tenantId: WORK_TENANT,
    custody: 'main',
    driveTypeProbe: { state: 'ok', driveType: 'business' }
  });
  assert.equal(verdict.allowed, true);
  assert.equal(LIVE_WRITEBACK_ENABLED, false); // live sync ON never implies writes
});

test('gate: signed out → NOT_SIGNED_IN', () => {
  const verdict = evaluateLiveSyncGate({
    template: oneDriveTemplate,
    isMicrosoftConnected: false,
    tenantId: null,
    custody: null
  });
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.reasonCode, LIVE_SYNC_GATE_REASON.NOT_SIGNED_IN);
});

test('gate: consumer/MSA tenant → PERSONAL_ACCOUNT (terminal, even with business driveType)', () => {
  const verdict = evaluateLiveSyncGate({
    template: oneDriveTemplate,
    isMicrosoftConnected: true,
    tenantId: CONSUMER_TENANT,
    custody: 'main',
    driveTypeProbe: { state: 'ok', driveType: 'business' }
  });
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.reasonCode, LIVE_SYNC_GATE_REASON.PERSONAL_ACCOUNT);
  assert.equal(verdict.retryable, false);
});

test('gate: personal driveType → PERSONAL_ACCOUNT even on a work tenant', () => {
  const verdict = evaluateLiveSyncGate({
    template: oneDriveTemplate,
    isMicrosoftConnected: true,
    tenantId: WORK_TENANT,
    custody: 'main',
    driveTypeProbe: { state: 'ok', driveType: 'personal' }
  });
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.reasonCode, LIVE_SYNC_GATE_REASON.PERSONAL_ACCOUNT);
});

test('gate: legacy renderer-PKCE custody → LEGACY_RECONNECT (work signals alone are not enough)', () => {
  const verdict = evaluateLiveSyncGate({
    template: oneDriveTemplate,
    isMicrosoftConnected: true,
    tenantId: WORK_TENANT,
    custody: 'legacy',
    driveTypeProbe: { state: 'ok', driveType: 'business' }
  });
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.reasonCode, LIVE_SYNC_GATE_REASON.LEGACY_RECONNECT);
});

test('gate: personal account on the legacy path → PERSONAL_ACCOUNT outranks reconnect (honest reason)', () => {
  const verdict = evaluateLiveSyncGate({
    template: oneDriveTemplate,
    isMicrosoftConnected: true,
    tenantId: CONSUMER_TENANT,
    custody: 'legacy'
  });
  assert.equal(verdict.reasonCode, LIVE_SYNC_GATE_REASON.PERSONAL_ACCOUNT);
});

test('gate: probe failed → UNCONFIRMED and retryable (fail safe, never assume business)', () => {
  const verdict = evaluateLiveSyncGate({
    template: oneDriveTemplate,
    isMicrosoftConnected: true,
    tenantId: WORK_TENANT,
    custody: 'main',
    driveTypeProbe: { state: 'error', driveType: null }
  });
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.reasonCode, LIVE_SYNC_GATE_REASON.UNCONFIRMED);
  assert.equal(verdict.retryable, true);
});

test('gate: probe not yet run → UNCONFIRMED retryable (fail safe; resolver will probe)', () => {
  const pending = evaluateLiveSyncGate({
    template: oneDriveTemplate,
    isMicrosoftConnected: true,
    tenantId: WORK_TENANT,
    custody: 'main',
    driveTypeProbe: { state: 'pending', driveType: null }
  });
  assert.equal(pending.reasonCode, LIVE_SYNC_GATE_REASON.UNCONFIRMED);
  assert.equal(pending.retryable, true);

  // Missing tid with the probe still pending is also UNCONFIRMED — the
  // resolver probes before surfacing anything to the user.
  const noTidPending = evaluateLiveSyncGate({
    template: oneDriveTemplate,
    isMicrosoftConnected: true,
    tenantId: null,
    custody: 'main',
    driveTypeProbe: { state: 'pending', driveType: null }
  });
  assert.equal(noTidPending.reasonCode, LIVE_SYNC_GATE_REASON.UNCONFIRMED);
  assert.equal(noTidPending.retryable, true);
});

test('gate: missing tid AFTER the probe ran → LEGACY_RECONNECT (terminal), never a retry loop', () => {
  // Retrying can never supply a missing id-token `tid`; signing in again can.
  const noTid = evaluateLiveSyncGate({
    template: oneDriveTemplate,
    isMicrosoftConnected: true,
    tenantId: null,
    custody: 'main',
    driveTypeProbe: { state: 'ok', driveType: 'business' }
  });
  assert.equal(noTid.allowed, false);
  assert.equal(noTid.reasonCode, LIVE_SYNC_GATE_REASON.LEGACY_RECONNECT);
  assert.equal(noTid.retryable, false);

  // ...but a probed PERSONAL drive outranks the reconnect hint — the honest
  // answer is that live sync needs a work account, not a re-sign-in.
  const noTidPersonalDrive = evaluateLiveSyncGate({
    template: oneDriveTemplate,
    isMicrosoftConnected: true,
    tenantId: null,
    custody: 'main',
    driveTypeProbe: { state: 'ok', driveType: 'personal' }
  });
  assert.equal(noTidPersonalDrive.reasonCode, LIVE_SYNC_GATE_REASON.PERSONAL_ACCOUNT);

  // A probe ERROR with a missing tid stays retryable — the next attempt
  // probes again and only then settles on reconnect/personal.
  const noTidProbeError = evaluateLiveSyncGate({
    template: oneDriveTemplate,
    isMicrosoftConnected: true,
    tenantId: null,
    custody: 'main',
    driveTypeProbe: { state: 'error', driveType: null }
  });
  assert.equal(noTidProbeError.reasonCode, LIVE_SYNC_GATE_REASON.UNCONFIRMED);
  assert.equal(noTidProbeError.retryable, true);
});

test('gate: local file / no link → LOCAL_FILE / NOT_LINKED', () => {
  assert.equal(
    evaluateLiveSyncGate({ template: localTemplate, isMicrosoftConnected: true, tenantId: WORK_TENANT, custody: 'main' }).reasonCode,
    LIVE_SYNC_GATE_REASON.LOCAL_FILE
  );
  assert.equal(evaluateLiveSyncGate({ template: null }).reasonCode, LIVE_SYNC_GATE_REASON.NOT_LINKED);
  assert.equal(evaluateLiveSyncGate({}).reasonCode, LIVE_SYNC_GATE_REASON.NOT_LINKED);
});

// ---------------------------------------------------------------------------
// resolveLiveSyncEligibility — lazy probe + caching (probe mocked)
// ---------------------------------------------------------------------------

const makeProbe = (impl) => {
  const probe = async (...args) => {
    probe.calls.push(args);
    return impl(...args);
  };
  probe.calls = [];
  return probe;
};

test('resolver: business drive → allowed; driveType cached per drive (one probe across calls)', async () => {
  const cache = new Map();
  const probe = makeProbe(async () => 'business');
  const graphClient = {};

  const first = await resolveLiveSyncEligibility({
    template: oneDriveTemplate,
    graphClient,
    isMicrosoftConnected: true,
    getAuthSignals: workMainSignals,
    cache,
    probeDriveType: probe
  });
  assert.equal(first.allowed, true);
  assert.equal(first.reasonCode, LIVE_SYNC_GATE_REASON.ELIGIBLE);
  assert.equal(first.driveType, 'business');
  assert.equal(cache.get(liveSyncDriveCacheKey(oneDriveTemplate)), 'business');
  assert.equal(probe.calls.length, 1);
  assert.equal(probe.calls[0][1], null); // own drive → /me/drive scope

  const second = await resolveLiveSyncEligibility({
    template: oneDriveTemplate,
    graphClient,
    isMicrosoftConnected: true,
    getAuthSignals: workMainSignals,
    cache,
    probeDriveType: probe
  });
  assert.equal(second.allowed, true);
  assert.equal(probe.calls.length, 1); // cache hit — no second Graph call
});

test('resolver: SharePoint template probes the file\'s own drive id and caches under it', async () => {
  const cache = new Map();
  const probe = makeProbe(async () => 'documentLibrary');
  const verdict = await resolveLiveSyncEligibility({
    template: sharePointTemplate,
    graphClient: {},
    isMicrosoftConnected: true,
    getAuthSignals: workMainSignals,
    cache,
    probeDriveType: probe
  });
  assert.equal(verdict.allowed, true);
  assert.equal(probe.calls[0][1], 'drv-123'); // drive-scoped, not /me/drive
  assert.equal(cache.get('drive:drv-123'), 'documentLibrary');
});

test('resolver: probe failure → UNCONFIRMED retryable, NOT cached; next attempt probes again', async () => {
  const cache = new Map();
  let shouldFail = true;
  const probe = makeProbe(async () => {
    if (shouldFail) throw new Error('network down');
    return 'business';
  });

  const failed = await resolveLiveSyncEligibility({
    template: oneDriveTemplate,
    graphClient: {},
    isMicrosoftConnected: true,
    getAuthSignals: workMainSignals,
    cache,
    probeDriveType: probe
  });
  assert.equal(failed.allowed, false);
  assert.equal(failed.reasonCode, LIVE_SYNC_GATE_REASON.UNCONFIRMED);
  assert.equal(failed.retryable, true);
  assert.equal(cache.size, 0); // failures are never cached

  shouldFail = false;
  const retried = await resolveLiveSyncEligibility({
    template: oneDriveTemplate,
    graphClient: {},
    isMicrosoftConnected: true,
    getAuthSignals: workMainSignals,
    cache,
    probeDriveType: probe
  });
  assert.equal(retried.allowed, true);
  assert.equal(probe.calls.length, 2);
});

test('resolver: missing tid DOES probe — business drive settles on RECONNECT (no silent retry loop)', async () => {
  const cache = new Map();
  const probe = makeProbe(async () => 'business');
  const noTidSignals = () => ({ tenantId: null, custody: 'main' });

  const verdict = await resolveLiveSyncEligibility({
    template: oneDriveTemplate,
    graphClient: {},
    isMicrosoftConnected: true,
    getAuthSignals: noTidSignals,
    cache,
    probeDriveType: probe
  });
  assert.equal(verdict.allowed, false);
  assert.equal(verdict.reasonCode, LIVE_SYNC_GATE_REASON.LEGACY_RECONNECT);
  assert.equal(verdict.retryable, false); // a retry can never supply the tid
  assert.equal(probe.calls.length, 1); // the probe DID fire (no dead-end UNCONFIRMED)
  assert.equal(verdict.driveType, 'business');

  // The successful probe is cached: a second click re-answers without Graph.
  const again = await resolveLiveSyncEligibility({
    template: oneDriveTemplate,
    graphClient: {},
    isMicrosoftConnected: true,
    getAuthSignals: noTidSignals,
    cache,
    probeDriveType: probe
  });
  assert.equal(again.reasonCode, LIVE_SYNC_GATE_REASON.LEGACY_RECONNECT);
  assert.equal(probe.calls.length, 1);
});

test('resolver: missing tid + probed PERSONAL drive → PERSONAL_ACCOUNT (honest, terminal)', async () => {
  const probe = makeProbe(async () => 'personal');
  const verdict = await resolveLiveSyncEligibility({
    template: oneDriveTemplate,
    graphClient: {},
    isMicrosoftConnected: true,
    getAuthSignals: () => ({ tenantId: null, custody: 'main' }),
    cache: new Map(),
    probeDriveType: probe
  });
  assert.equal(verdict.reasonCode, LIVE_SYNC_GATE_REASON.PERSONAL_ACCOUNT);
  assert.equal(verdict.retryable, false);
  assert.equal(probe.calls.length, 1);
});

test('resolver: missing tid + probe failure → UNCONFIRMED retryable; the retry probes AGAIN', async () => {
  const cache = new Map();
  let shouldFail = true;
  const probe = makeProbe(async () => {
    if (shouldFail) throw new Error('network down');
    return 'business';
  });
  const noTidSignals = () => ({ tenantId: null, custody: 'main' });

  const failed = await resolveLiveSyncEligibility({
    template: oneDriveTemplate,
    graphClient: {},
    isMicrosoftConnected: true,
    getAuthSignals: noTidSignals,
    cache,
    probeDriveType: probe
  });
  assert.equal(failed.reasonCode, LIVE_SYNC_GATE_REASON.UNCONFIRMED);
  assert.equal(failed.retryable, true);
  assert.equal(probe.calls.length, 1);
  assert.equal(cache.size, 0); // failures are never cached

  shouldFail = false;
  const retried = await resolveLiveSyncEligibility({
    template: oneDriveTemplate,
    graphClient: {},
    isMicrosoftConnected: true,
    getAuthSignals: noTidSignals,
    cache,
    probeDriveType: probe
  });
  assert.equal(retried.reasonCode, LIVE_SYNC_GATE_REASON.LEGACY_RECONNECT);
  assert.equal(probe.calls.length, 2); // the retry actually re-probed
});

test('resolver is LAZY: terminal refusals never hit Graph (signed out / personal / legacy)', async () => {
  const probe = makeProbe(async () => 'business');

  const signedOut = await resolveLiveSyncEligibility({
    template: oneDriveTemplate,
    graphClient: null,
    isMicrosoftConnected: false,
    getAuthSignals: () => ({ tenantId: null, custody: null }),
    probeDriveType: probe
  });
  assert.equal(signedOut.reasonCode, LIVE_SYNC_GATE_REASON.NOT_SIGNED_IN);

  const personal = await resolveLiveSyncEligibility({
    template: oneDriveTemplate,
    graphClient: {},
    isMicrosoftConnected: true,
    getAuthSignals: () => ({ tenantId: CONSUMER_TENANT, custody: 'main' }),
    probeDriveType: probe
  });
  assert.equal(personal.reasonCode, LIVE_SYNC_GATE_REASON.PERSONAL_ACCOUNT);

  const legacy = await resolveLiveSyncEligibility({
    template: oneDriveTemplate,
    graphClient: {},
    isMicrosoftConnected: true,
    getAuthSignals: () => ({ tenantId: WORK_TENANT, custody: 'legacy' }),
    probeDriveType: probe
  });
  assert.equal(legacy.reasonCode, LIVE_SYNC_GATE_REASON.LEGACY_RECONNECT);

  assert.equal(probe.calls.length, 0); // no Graph traffic for any of them
});

test('resolver: a throwing getAuthSignals fails SAFE (no crash, refused)', async () => {
  const probe = makeProbe(async () => 'business');
  const verdict = await resolveLiveSyncEligibility({
    template: oneDriveTemplate,
    graphClient: {},
    isMicrosoftConnected: true,
    getAuthSignals: () => { throw new Error('ipc gone'); },
    probeDriveType: probe
  });
  assert.equal(verdict.allowed, false);
  assert.equal(probe.calls.length, 0);
});

test('resolver end-to-end with the REAL getDriveType: read-only Graph traffic only', async () => {
  const graph = makeFakeGraph((path) => {
    assert.equal(path, '/drives/drv-123');
    return { driveType: 'documentLibrary' };
  });
  const verdict = await resolveLiveSyncEligibility({
    template: sharePointTemplate,
    graphClient: graph,
    isMicrosoftConnected: true,
    getAuthSignals: workMainSignals,
    cache: new Map()
  });
  assert.equal(verdict.allowed, true);
  assert.equal(graph.calls.length, 1);
  assert.equal(graph.calls[0].method, 'get'); // NO writes anywhere in this slice
  assert.deepEqual(graph.calls[0].selects, ['driveType']);
});

// ---------------------------------------------------------------------------
// getDriveType — drive scoping + read-only
// ---------------------------------------------------------------------------

test('getDriveType scopes to /drives/{id} when a driveId is given, else /me/drive', async () => {
  const scoped = makeFakeGraph(() => ({ driveType: 'business' }));
  assert.equal(await getDriveType(scoped, 'abc'), 'business');
  assert.equal(scoped.calls[0].path, '/drives/abc');

  const own = makeFakeGraph(() => ({ driveType: 'personal' }));
  assert.equal(await getDriveType(own), 'personal');
  assert.equal(own.calls[0].path, '/me/drive');
});

test('getDriveType returns null when Graph omits driveType, throws without a client', async () => {
  const empty = makeFakeGraph(() => ({}));
  assert.equal(await getDriveType(empty, 'abc'), null);
  await assert.rejects(() => getDriveType(null), /Not authenticated/);
});

// ---------------------------------------------------------------------------
// excelSyncStatus vocabulary — every reason code reads as plain English
// ---------------------------------------------------------------------------

test('every gate reason code has a plain-English vocabulary entry', () => {
  for (const code of Object.values(LIVE_SYNC_GATE_REASON)) {
    const status = LIVE_SYNC_GATE_STATUS[code];
    assert.ok(status, `missing LIVE_SYNC_GATE_STATUS entry for '${code}'`);
    assert.ok(typeof status.label === 'string' && status.label.length > 0);
    assert.ok(Object.values(SYNC_TONE).includes(status.tone));
  }
  // Unknown codes fall back safely instead of rendering a blank tooltip.
  assert.equal(liveSyncGateStatus('???').key, 'unconfirmed-business');
});

test('refusal labels classify as WARN on the free-text banner (not error, not info)', () => {
  for (const code of ['not-signed-in', 'legacy-reconnect', 'personal-account', 'unconfirmed-business']) {
    assert.equal(
      syncMessageTone(LIVE_SYNC_GATE_STATUS[code].label),
      SYNC_TONE.WARN,
      `label for '${code}' should read as a warning`
    );
  }
});
