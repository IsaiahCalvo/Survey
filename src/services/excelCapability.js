// src/services/excelCapability.js
//
// Classifies a linked Excel workbook into one of the capability tiers from the
// PLAN.md capability matrix (Amendment 2026-06-08(b)). This is the cheap, pure,
// synchronous baseline that decides HOW the app is allowed to write the Row ID
// back into a workbook:
//
//   - local            → file on disk; NEVER write under an open file; queue until
//                        Excel is closed (or an export through a safe path).
//   - personal-onedrive→ consumer/MSA OneDrive; Graph workbook session APIs are NOT
//                        available; treat like local/sync-folder (queue, no live PATCH).
//   - business-graph   → work/school OneDrive / SharePoint / Teams; the ONLY tier where
//                        a live single-cell Graph PATCH is eligible — and even then only
//                        when LIVE_WRITEBACK_ENABLED is on AND a runtime session probe
//                        (excelSessionService.checkSessionSupport) confirms support.
//
// Being "in OneDrive / SharePoint / Teams" is NOT sufficient proof on its own. A file
// can sit in personal OneDrive (no Graph cell sync) yet still carry an isOneDrive flag.
// So live writeback is eligible ONLY when EVERY business signal is positively proven:
//   1. the app is actually connected to Microsoft (a usable Graph client), AND
//   2. the signed-in account is a WORK/SCHOOL tenant (id present and NOT the consumer id),
//      decided from the Microsoft id token `tid` — never from the email address, AND
//   3. Microsoft Graph drive metadata `driveType` is `business` (OneDrive for Business) or
//      `documentLibrary` (SharePoint / Teams) — `personal` means no live cell sync.
// Any missing/contradictory signal fails SAFE (treated as personal → queue), never live.
// A runtime workbook `createSession` probe (excelSessionService.checkSessionSupport) is the
// final confirm before an actual PATCH; this classifier is the cheap synchronous gate.

export const CONSUMER_TENANT_ID = '9188040d-6c67-4c5b-b112-36a304b66dad';

// Graph drive metadata `driveType` values that can support live workbook sessions.
export const BUSINESS_DRIVE_TYPES = Object.freeze(['business', 'documentlibrary']);

export const EXCEL_CAPABILITY = Object.freeze({
  NONE: 'none',
  LOCAL: 'local',
  PERSONAL_ONEDRIVE: 'personal-onedrive',
  BUSINESS_GRAPH: 'business-graph'
});

// Master gate for live Graph cell writeback. Stays OFF until validated against a
// real Business M365 account (PLAN.md: capability-gated). When off, business-graph
// links still classify correctly but the flush path queues instead of patching live.
export const LIVE_WRITEBACK_ENABLED = false;

/**
 * @param {object} params
 * @param {object} params.template  the selected survey template (link metadata)
 * @param {string|null} [params.tenantId]  the signed-in Microsoft account's tenant id (id token `tid`)
 * @param {boolean} [params.isMicrosoftConnected]  true when the app holds a usable Graph client
 * @param {string|null} [params.driveType]  Graph drive metadata `driveType`: 'personal' | 'business' | 'documentLibrary'
 * @returns {{kind:string, liveWritebackEligible:boolean, reason:string}}
 *   liveWritebackEligible = the SETUP is PROVEN to support a live cell PATCH (business-graph).
 *   It does NOT mean writeback is on — that also requires LIVE_WRITEBACK_ENABLED and a
 *   runtime session probe. Local/personal/unproven are always false.
 */
export const classifyExcelCapability = ({ template, tenantId, isMicrosoftConnected = false, driveType = null } = {}) => {
  if (!template || !template.linkedExcelPath) {
    return { kind: EXCEL_CAPABILITY.NONE, liveWritebackEligible: false, reason: 'no-linked-workbook' };
  }
  if (!template.isOneDrive) {
    return { kind: EXCEL_CAPABILITY.LOCAL, liveWritebackEligible: false, reason: 'local-file' };
  }

  // From here the file lives in some Microsoft cloud location (OneDrive personal/business,
  // SharePoint, or Teams). Decide eligibility ONLY from proven Microsoft account + Graph signals.
  const normalizedTenant = typeof tenantId === 'string' ? tenantId.trim().toLowerCase() : '';
  const normalizedDriveType = typeof driveType === 'string' ? driveType.trim().toLowerCase() : '';
  const isConsumerTenant = normalizedTenant === CONSUMER_TENANT_ID;
  const isWorkTenant = Boolean(normalizedTenant) && !isConsumerTenant;
  const isBusinessDrive = BUSINESS_DRIVE_TYPES.includes(normalizedDriveType);
  const isPersonalDrive = normalizedDriveType === 'personal';

  // Hard personal signals → never live, regardless of anything else.
  if (isConsumerTenant) {
    return { kind: EXCEL_CAPABILITY.PERSONAL_ONEDRIVE, liveWritebackEligible: false, reason: 'consumer-tenant' };
  }
  if (isPersonalDrive) {
    return { kind: EXCEL_CAPABILITY.PERSONAL_ONEDRIVE, liveWritebackEligible: false, reason: 'personal-drivetype' };
  }

  // Eligible ONLY when connected AND work/school tenant AND a business/SharePoint drive type.
  if (isMicrosoftConnected && isWorkTenant && isBusinessDrive) {
    return {
      kind: EXCEL_CAPABILITY.BUSINESS_GRAPH,
      liveWritebackEligible: true,
      reason: normalizedDriveType === 'documentlibrary' ? 'sharepoint-documentlibrary' : 'business-onedrive'
    };
  }

  // Otherwise we cannot PROVE business → fail SAFE (queue, never live). Surface why.
  let reason = 'unproven-defaults-safe';
  if (!isMicrosoftConnected) reason = 'not-connected';
  else if (!isWorkTenant) reason = 'no-work-tenant';
  else if (!isBusinessDrive) reason = 'drivetype-unconfirmed';
  return { kind: EXCEL_CAPABILITY.PERSONAL_ONEDRIVE, liveWritebackEligible: false, reason };
};

/**
 * Whether the app may attempt a LIVE single-cell Graph writeback for this setup right
 * now. True only when the setup is business-graph eligible AND the master gate is on.
 * A runtime session probe still confirms before the actual PATCH.
 */
export const canAttemptLiveWriteback = (capability) =>
  Boolean(capability && capability.liveWritebackEligible && LIVE_WRITEBACK_ENABLED);
