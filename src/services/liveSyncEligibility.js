// src/services/liveSyncEligibility.js
//
// The Live Sync GATE (Amendment 2026-06-08(b), HANDOFF item 2): decides whether
// the Live Sync toggle may turn ON for the currently linked workbook. Live sync
// is allowed ONLY for a positively PROVEN business/work setup:
//   connected to Microsoft  +  work/school tenant (id-token `tid`)  +
//   main-process token custody (the new system-browser sign-in)  +
//   Graph drive `driveType` of business/documentLibrary.
// Everything unproven fails SAFE (refused, with an honest plain-English reason
// from src/services/excelSyncStatus.js — never an inline literal).
//
// Two layers:
//   - evaluateLiveSyncGate(...)        pure, synchronous: signals in → verdict out.
//                                      All policy lives here; fully unit-testable.
//   - resolveLiveSyncEligibility(...)  thin async wrapper: samples auth signals,
//                                      runs the READ-ONLY Graph driveType probe
//                                      lazily (only when the verdict hinges on it)
//                                      and caches the result per drive. No polling,
//                                      no writes, no retries on its own.
//
// This module gates the live-sync PULL toggle only. It does NOT touch the live
// writeback master gate (LIVE_WRITEBACK_ENABLED in excelCapability.js stays
// false) and performs NO Graph writes of any kind.

import { EXCEL_CAPABILITY, classifyExcelCapability } from './excelCapability.js';
import { getDriveType } from './excelGraphService.js';

// Reason codes for the gate verdict. Each code has a matching plain-English
// entry in excelSyncStatus.LIVE_SYNC_GATE_STATUS (asserted by tests).
export const LIVE_SYNC_GATE_REASON = Object.freeze({
  ELIGIBLE: 'eligible',
  CHECKING: 'checking', // transient UI state while the probe runs (never returned by evaluate)
  NOT_LINKED: 'not-linked',
  LOCAL_FILE: 'local-file',
  NOT_SIGNED_IN: 'not-signed-in',
  LEGACY_RECONNECT: 'legacy-reconnect',
  PERSONAL_ACCOUNT: 'personal-account',
  UNCONFIRMED: 'unconfirmed-business'
});

/**
 * Pure gate decision: signals in → eligibility + reason out.
 *
 * @param {object} params
 * @param {object|null} params.template  the selected survey template (link metadata)
 * @param {boolean} [params.isMicrosoftConnected]  true when the app holds a usable Graph client
 * @param {string|null} [params.tenantId]  signed-in account's tenant id (id-token `tid`)
 * @param {string|null} [params.custody]  'main' (system-browser sign-in, main-process MSAL)
 *                                        | 'legacy' (renderer PKCE / web build) | null (signed out)
 * @param {{state:('ok'|'error'|'pending'), driveType:(string|null)}} [params.driveTypeProbe]
 *        result of the read-only Graph drive probe; 'pending' = not attempted yet
 * @returns {{allowed:boolean, reasonCode:string, retryable:boolean, capability:object}}
 */
export const evaluateLiveSyncGate = ({
  template = null,
  isMicrosoftConnected = false,
  tenantId = null,
  custody = null,
  driveTypeProbe = { state: 'pending', driveType: null }
} = {}) => {
  const probeState = driveTypeProbe?.state || 'pending';
  const probedDriveType = probeState === 'ok' ? (driveTypeProbe?.driveType ?? null) : null;
  const capability = classifyExcelCapability({
    template,
    tenantId,
    isMicrosoftConnected: Boolean(isMicrosoftConnected),
    driveType: probedDriveType
  });
  const refuse = (reasonCode, retryable = false) => ({ allowed: false, reasonCode, retryable, capability });

  if (capability.kind === EXCEL_CAPABILITY.NONE) return refuse(LIVE_SYNC_GATE_REASON.NOT_LINKED);
  if (capability.kind === EXCEL_CAPABILITY.LOCAL) return refuse(LIVE_SYNC_GATE_REASON.LOCAL_FILE);
  if (!isMicrosoftConnected) return refuse(LIVE_SYNC_GATE_REASON.NOT_SIGNED_IN);

  // Hard personal proof (consumer/MSA tenant, or the drive itself says
  // 'personal') outranks everything else — neither a reconnect nor a retry
  // can change it. Honest answer: live sync needs a work/school account.
  if (capability.reason === 'consumer-tenant' || capability.reason === 'personal-drivetype') {
    return refuse(LIVE_SYNC_GATE_REASON.PERSONAL_ACCOUNT);
  }

  // Connected through the legacy embedded sign-in (or the web build): work
  // live sync requires the new system-browser sign-in with main-process token
  // custody. Reconnecting migrates the account.
  if (custody !== 'main') return refuse(LIVE_SYNC_GATE_REASON.LEGACY_RECONNECT);

  // The read-only drive probe failed (network/Graph error). Retryable: the
  // next toggle attempt probes again. Never assume business on a failed probe.
  if (probeState === 'error') return refuse(LIVE_SYNC_GATE_REASON.UNCONFIRMED, true);

  // Main-custody sign-in whose token metadata carries no tenant id (`tid`)
  // even AFTER the drive probe ran: retrying can never supply the missing
  // claim — signing in again (reconnect) re-seeds the metadata. Not
  // retryable. (A probed 'personal' driveType was already caught above as
  // PERSONAL_ACCOUNT, the honest answer when the drive itself proves MSA.)
  if (probeState === 'ok' && capability.reason === 'no-work-tenant') {
    return refuse(LIVE_SYNC_GATE_REASON.LEGACY_RECONNECT);
  }

  if (capability.kind === EXCEL_CAPABILITY.BUSINESS_GRAPH) {
    return { allowed: true, reasonCode: LIVE_SYNC_GATE_REASON.ELIGIBLE, retryable: false, capability };
  }

  // Connected work-ish setup we cannot positively prove yet (probe not run,
  // missing `tid`, blank driveType) → fail safe, allow retry.
  return refuse(LIVE_SYNC_GATE_REASON.UNCONFIRMED, true);
};

/**
 * Cache key for the per-drive driveType probe result. driveType is a property
 * of the DRIVE, not the file: SharePoint/Teams files carry sharePointDriveId;
 * everything else lives on the signed-in user's own drive ('me').
 */
export const liveSyncDriveCacheKey = (template) =>
  template?.sharePointDriveId ? `drive:${template.sharePointDriveId}` : 'me';

/**
 * Resolve the gate verdict for the current link, probing Graph lazily.
 *
 * - Runs the pure gate first with whatever is already known; only when the
 *   verdict hinges on an unprobed driveType does it make ONE read-only Graph
 *   call (GET /drives/{id} or /me/drive, ?select=driveType).
 * - Successful probe results are cached in the caller-owned `cache` Map per
 *   drive; probe FAILURES are never cached so the next attempt retries.
 * - NO writes, no polling, no timers.
 *
 * @param {object} params
 * @param {object|null} params.template
 * @param {object|null} params.graphClient
 * @param {boolean} [params.isMicrosoftConnected]
 * @param {(function():{tenantId:?string, custody:?string})|null} [params.getAuthSignals]
 *        MSGraphContext's sample-at-call-time auth signals
 * @param {Map<string,string>} [params.cache]  per-drive driveType cache (caller-owned)
 * @param {function} [params.probeDriveType]  injectable for tests; defaults to the real Graph probe
 * @returns {Promise<{allowed:boolean, reasonCode:string, retryable:boolean, capability:object, driveType:(string|null)}>}
 */
export const resolveLiveSyncEligibility = async ({
  template = null,
  graphClient = null,
  isMicrosoftConnected = false,
  getAuthSignals = null,
  cache = new Map(),
  probeDriveType = getDriveType
} = {}) => {
  let signals = {};
  try {
    signals = (typeof getAuthSignals === 'function' ? getAuthSignals() : null) || {};
  } catch {
    signals = {};
  }
  const base = {
    template,
    // A usable connection needs BOTH the auth flag and an actual Graph client.
    isMicrosoftConnected: Boolean(isMicrosoftConnected && graphClient),
    tenantId: signals.tenantId ?? null,
    custody: signals.custody ?? null
  };

  const cacheKey = liveSyncDriveCacheKey(template);
  const cachedDriveType = cache.get(cacheKey);
  let probe = typeof cachedDriveType === 'string' && cachedDriveType
    ? { state: 'ok', driveType: cachedDriveType }
    : { state: 'pending', driveType: null };

  const verdict = evaluateLiveSyncGate({ ...base, driveTypeProbe: probe });

  // Probe ONLY when the verdict hinges on unprobed Graph data:
  //   - 'drivetype-unconfirmed': work tenant proven, drive not yet probed;
  //   - 'no-work-tenant' (missing id-token `tid`, main custody — legacy
  //     custody never reaches UNCONFIRMED): the probe still refines the
  //     answer — driveType 'personal' → honest personal-account refusal,
  //     anything else → terminal reconnect instead of a silent retry loop
  //     that could never resolve the missing `tid`.
  // Signed-out / personal-proof / legacy verdicts stay terminal without a
  // Graph call.
  const needsProbe =
    probe.state === 'pending' &&
    verdict.reasonCode === LIVE_SYNC_GATE_REASON.UNCONFIRMED &&
    (verdict.capability?.reason === 'drivetype-unconfirmed' ||
      verdict.capability?.reason === 'no-work-tenant') &&
    graphClient;
  if (!needsProbe) {
    return { ...verdict, driveType: probe.driveType };
  }

  try {
    const driveType = await probeDriveType(graphClient, template?.sharePointDriveId || null);
    if (typeof driveType === 'string' && driveType) {
      cache.set(cacheKey, driveType);
    }
    probe = { state: 'ok', driveType: typeof driveType === 'string' && driveType ? driveType : null };
  } catch {
    probe = { state: 'error', driveType: null };
  }

  const finalVerdict = evaluateLiveSyncGate({ ...base, driveTypeProbe: probe });
  return { ...finalVerdict, driveType: probe.driveType };
};
