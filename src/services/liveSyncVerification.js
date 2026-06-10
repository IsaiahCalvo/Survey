// src/services/liveSyncVerification.js
//
// The guided "Verify Live Sync" probe (Amendment 2026-06-08(b)): one read-only
// pass the user runs right after their first work-account sign-in, answering
// "will live sync actually work for THIS workbook?" with a plain-English
// verdict instead of a toggle that fails mysteriously later.
//
// Ordered steps (each pass/fail, stopping at the first failure):
//   1. sign-in        signed in to Microsoft via the system-browser work sign-in
//   2. work-account   work/school tenant (id-token `tid`), not a personal account
//   3. business-file  the linked file's drive PROVES business/documentLibrary
//   4. workbook-open  the workbook opens under a Graph workbook session
//   5. workbook-read  worksheets + usedRange read back successfully
//   6. sync-stamp     the workbook's export stamp is readable and not stale
//
// Steps 1–3 REUSE slice 1's cached eligibility (resolveLiveSyncEligibility +
// the caller-owned per-drive driveType cache) — the probe never duplicates the
// drive probe. Steps 4–6 run under ONE non-persistent workbook session
// (persistChanges:false — Graph discards any session state; we only ever GET)
// that is always closed. STRICTLY READ-ONLY: no cell writes, no uploads, no
// gate flips. LIVE_WRITEBACK_ENABLED is never consulted or touched here.
//
// Token expiry mid-probe is NEVER a silent fail: auth-shaped Graph errors map
// to the 'auth-expired' verdict, whose vocabulary entry tells the user to
// reconnect (excelSyncStatus.LIVE_SYNC_VERIFY_STATUS).
//
// Pure-ish service: the Graph boundary (eligibility resolver, session ops,
// reads) is injected via `deps`, so every step's failure mode is unit-testable
// with the REAL session/eligibility modules behind a fake Graph client.

import { resolveLiveSyncEligibility, LIVE_SYNC_GATE_REASON } from './liveSyncEligibility.js';
import {
  getFileIdFromPath,
  createWorkbookSession,
  closeWorkbookSession,
  getWorksheets,
  getUsedRange
} from './excelSessionService.js';
import {
  RECENCY,
  classifyWorkbookRecency,
  META_SHEET_NAME,
  META_STAMP_KEY
} from './excelImportRecencyGuard.js';

// The ordered probe steps. Every key has a plain-English label in
// excelSyncStatus.LIVE_SYNC_VERIFY_STEP_LABELS (asserted by tests).
export const VERIFY_STEP = Object.freeze({
  SIGN_IN: 'sign-in',
  WORK_ACCOUNT: 'work-account',
  BUSINESS_FILE: 'business-file',
  WORKBOOK_OPEN: 'workbook-open',
  WORKBOOK_READ: 'workbook-read',
  SYNC_STAMP: 'sync-stamp'
});

export const VERIFY_STEP_ORDER = Object.freeze([
  VERIFY_STEP.SIGN_IN,
  VERIFY_STEP.WORK_ACCOUNT,
  VERIFY_STEP.BUSINESS_FILE,
  VERIFY_STEP.WORKBOOK_OPEN,
  VERIFY_STEP.WORKBOOK_READ,
  VERIFY_STEP.SYNC_STAMP
]);

// Slice-1 gate refusal → which probe step it fails. Preconditions (nothing
// linked / a local file) abort before step 1 — the gate label is the verdict.
const GATE_REASON_FAILED_STEP = Object.freeze({
  [LIVE_SYNC_GATE_REASON.NOT_SIGNED_IN]: VERIFY_STEP.SIGN_IN,
  // Signed in the legacy/embedded way (or missing the `tid` claim): the FIX is
  // a fresh system-browser sign-in, so it reads as a sign-in step failure.
  [LIVE_SYNC_GATE_REASON.LEGACY_RECONNECT]: VERIFY_STEP.SIGN_IN,
  [LIVE_SYNC_GATE_REASON.PERSONAL_ACCOUNT]: VERIFY_STEP.WORK_ACCOUNT,
  [LIVE_SYNC_GATE_REASON.UNCONFIRMED]: VERIFY_STEP.BUSINESS_FILE
});

const PRECONDITION_REASONS = Object.freeze([
  LIVE_SYNC_GATE_REASON.NOT_LINKED,
  LIVE_SYNC_GATE_REASON.LOCAL_FILE
]);

/**
 * Auth-shaped vs other Graph probe errors. Unlike rowIdGraphWriteback's
 * classifier this one ALSO sniffs the message text, because
 * excelSessionService wraps Graph errors in plain `Error`s ("Failed to create
 * session: <original message>") that lose statusCode/code — and a token-expiry
 * must surface as reconnect, never as a generic failure (recon C). The sniff
 * is deliberately narrow: only unambiguous auth markers.
 * @returns {'auth-expired'|'error'}
 */
export const classifyLiveSyncProbeError = (error) => {
  const status = error?.statusCode ?? error?.status ?? null;
  const code = typeof error?.code === 'string' ? error.code : '';
  const message = typeof error?.message === 'string' ? error.message : '';
  const authPattern = /InvalidAuthenticationToken|TokenExpired|unauthenticated|token.{0,10}expired/i;
  if (status === 401 || authPattern.test(code) || authPattern.test(message)) {
    return 'auth-expired';
  }
  return 'error';
};

/**
 * Find the export stamp ('export_timestamp' key, column A → value in column B)
 * inside a usedRange `values` grid read from the very-hidden _SurveyMetadata
 * sheet. Mirrors excelImportRecencyGuard.readWorkbookExportStamp, which reads
 * the same cells through ExcelJS — one stamp, two transports.
 * @param {Array<Array>|null} values
 * @returns {string|null}
 */
export const findExportStampInValues = (values) => {
  if (!Array.isArray(values)) return null;
  for (const row of values) {
    if (!Array.isArray(row)) continue;
    const key = row[0];
    if (key != null && String(key).trim() === META_STAMP_KEY) {
      const value = row[1];
      if (value == null) return null;
      const text = String(value).trim();
      return text || null;
    }
  }
  return null;
};

/**
 * Run the guided live-sync verification. Read-only; stops at the first failing
 * step; every verdict code maps to a plain-English entry in
 * excelSyncStatus (liveSyncVerifyStatus → LIVE_SYNC_VERIFY_STATUS, falling
 * back to LIVE_SYNC_GATE_STATUS for the slice-1 gate reasons).
 *
 * @param {object} params
 * @param {object|null} params.template          the linked survey template
 * @param {object|null} params.graphClient
 * @param {boolean} [params.isMicrosoftConnected]
 * @param {(function():{tenantId:?string, custody:?string})|null} [params.getAuthSignals]
 * @param {Map<string,string>} [params.driveTypeCache]  slice-1's per-drive cache — REUSED, not duplicated
 * @param {string|null} [params.appExportStamp]  latestAppExportStamp(surveyMarkers) for the recency check
 * @param {string|null} [params.fileId]          known Graph item id; omitted → resolved from the template path
 * @param {object} [params.deps]                 injectable Graph boundary (tests)
 * @returns {Promise<{ready:boolean, verdictCode:string, failedStep:(string|null),
 *           retryable:boolean, steps:Array<{step:string,status:string,reasonCode?:string,detail?:object}>,
 *           eligibility:(object|null), driveType:(string|null), errorMessage?:string}>}
 */
export async function runLiveSyncVerification({
  template = null,
  graphClient = null,
  isMicrosoftConnected = false,
  getAuthSignals = null,
  driveTypeCache = new Map(),
  appExportStamp = null,
  fileId = null,
  deps = {}
} = {}) {
  const {
    resolveEligibility = resolveLiveSyncEligibility,
    resolveFileId = getFileIdFromPath,
    createSession = createWorkbookSession,
    closeSession = closeWorkbookSession,
    listWorksheets = getWorksheets,
    readUsedRange = getUsedRange
  } = deps;

  const steps = VERIFY_STEP_ORDER.map((step) => ({ step, status: 'not-run' }));
  const stepIndex = (step) => VERIFY_STEP_ORDER.indexOf(step);
  const pass = (step, detail) => {
    steps[stepIndex(step)] = detail === undefined
      ? { step, status: 'pass' }
      : { step, status: 'pass', detail };
  };
  const fail = (step, reasonCode) => {
    steps[stepIndex(step)] = { step, status: 'fail', reasonCode };
  };
  const refuse = (failedStep, verdictCode, { retryable = false, eligibility = null, driveType = null, errorMessage } = {}) => {
    if (failedStep) fail(failedStep, verdictCode);
    const verdict = { ready: false, verdictCode, failedStep: failedStep || null, retryable, steps, eligibility, driveType };
    if (errorMessage) verdict.errorMessage = errorMessage;
    return verdict;
  };

  // Steps 1–3: slice-1's eligibility gate IS the probe for sign-in, tenant and
  // driveType — same policy, same per-drive cache, at most one Graph read.
  let eligibility = null;
  try {
    eligibility = await resolveEligibility({
      template,
      graphClient,
      isMicrosoftConnected,
      getAuthSignals,
      cache: driveTypeCache
    });
  } catch {
    eligibility = null; // resolveLiveSyncEligibility doesn't throw; fail safe anyway
  }
  if (!eligibility) {
    return refuse(null, LIVE_SYNC_GATE_REASON.UNCONFIRMED, { retryable: true });
  }
  if (PRECONDITION_REASONS.includes(eligibility.reasonCode)) {
    // Nothing to verify yet — no steps ran, the gate label is the verdict.
    return refuse(null, eligibility.reasonCode, { eligibility });
  }
  if (!eligibility.allowed) {
    const failedStep = GATE_REASON_FAILED_STEP[eligibility.reasonCode] || VERIFY_STEP.BUSINESS_FILE;
    for (const step of VERIFY_STEP_ORDER) {
      if (step === failedStep) break;
      pass(step);
    }
    return refuse(failedStep, eligibility.reasonCode, {
      retryable: Boolean(eligibility.retryable),
      eligibility,
      driveType: eligibility.driveType ?? null
    });
  }
  pass(VERIFY_STEP.SIGN_IN);
  pass(VERIFY_STEP.WORK_ACCOUNT);
  pass(VERIFY_STEP.BUSINESS_FILE, { driveType: eligibility.driveType ?? null });

  // Steps 4–6: one read-only workbook session, always closed.
  const driveId = template?.sharePointDriveId || undefined;
  let resolvedFileId = fileId || null;
  let sessionId = null;

  try {
    if (!resolvedFileId) {
      const apiPath = template?.oneDriveApiPath || template?.linkedExcelPath;
      resolvedFileId = await resolveFileId(graphClient, apiPath, driveId);
    }
    // persistChanges:false — a probe session whose state Graph throws away;
    // combined with GET-only calls below, the workbook cannot change.
    const session = await createSession(graphClient, resolvedFileId, false, driveId);
    sessionId = session?.sessionId || null;
    pass(VERIFY_STEP.WORKBOOK_OPEN);
  } catch (openErr) {
    const kind = classifyLiveSyncProbeError(openErr);
    return refuse(
      VERIFY_STEP.WORKBOOK_OPEN,
      kind === 'auth-expired' ? 'auth-expired' : 'workbook-open-failed',
      { retryable: kind !== 'auth-expired', eligibility, driveType: eligibility.driveType ?? null, errorMessage: openErr?.message }
    );
  }

  try {
    const worksheets = await listWorksheets(graphClient, resolvedFileId, sessionId, driveId);
    const sheetNames = (Array.isArray(worksheets) ? worksheets : [])
      .map((sheet) => sheet?.name)
      .filter((name) => typeof name === 'string' && name);
    const dataSheet = sheetNames.find((name) => name !== META_SHEET_NAME) || sheetNames[0];
    if (!dataSheet) {
      throw new Error('The workbook has no worksheets.');
    }
    const usedRange = await readUsedRange(graphClient, resolvedFileId, sessionId, dataSheet, driveId);
    pass(VERIFY_STEP.WORKBOOK_READ, {
      sheetCount: sheetNames.length,
      sheetName: dataSheet,
      address: usedRange?.address ?? null
    });

    let workbookExportStamp = null;
    if (sheetNames.includes(META_SHEET_NAME)) {
      const metaRange = await readUsedRange(graphClient, resolvedFileId, sessionId, META_SHEET_NAME, driveId);
      workbookExportStamp = findExportStampInValues(metaRange?.values);
    }
    const recency = classifyWorkbookRecency({ workbookExportStamp, appExportStamp });
    if (recency.verdict === RECENCY.STALE_WORKBOOK) {
      return refuse(VERIFY_STEP.SYNC_STAMP, 'stale-workbook', { eligibility, driveType: eligibility.driveType ?? null });
    }
    if (recency.verdict === RECENCY.MISSING_EXPORT_CLOCK) {
      return refuse(VERIFY_STEP.SYNC_STAMP, 'no-sync-stamp', { eligibility, driveType: eligibility.driveType ?? null });
    }
    // CURRENT, or NO_APP_CLOCK (never exported yet → nothing to be stale against).
    pass(VERIFY_STEP.SYNC_STAMP, {
      workbookExportStamp: recency.workbookExportStamp,
      recency: recency.verdict
    });

    return {
      ready: true,
      verdictCode: 'ready',
      failedStep: null,
      retryable: false,
      steps,
      eligibility,
      driveType: eligibility.driveType ?? null
    };
  } catch (readErr) {
    const kind = classifyLiveSyncProbeError(readErr);
    const failedStep = steps[stepIndex(VERIFY_STEP.WORKBOOK_READ)].status === 'pass'
      ? VERIFY_STEP.SYNC_STAMP
      : VERIFY_STEP.WORKBOOK_READ;
    return refuse(failedStep, kind === 'auth-expired' ? 'auth-expired' : 'workbook-read-failed', {
      retryable: kind !== 'auth-expired',
      eligibility,
      driveType: eligibility.driveType ?? null,
      errorMessage: readErr?.message
    });
  } finally {
    if (sessionId) {
      // Best-effort: closeWorkbookSession never throws.
      await closeSession(graphClient, resolvedFileId, sessionId, driveId);
    }
  }
}
