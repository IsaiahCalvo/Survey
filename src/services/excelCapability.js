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
// Personal vs business is decided by the signed-in account's tenant: the well-known
// Microsoft consumer tenant id marks an MSA/personal account. Unknown tenant fails
// SAFE (treated as personal → queue), never as business.

export const CONSUMER_TENANT_ID = '9188040d-6c67-4c5b-b112-36a304b66dad';

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
 * @param {string|null} [params.tenantId]  the signed-in Microsoft account's tenant id
 * @returns {{kind:string, liveWritebackEligible:boolean, reason:string}}
 *   liveWritebackEligible = the SETUP could support a live cell PATCH (business-graph).
 *   It does NOT mean writeback is on — that also requires LIVE_WRITEBACK_ENABLED and a
 *   runtime session probe. Local/personal are always false.
 */
export const classifyExcelCapability = ({ template, tenantId } = {}) => {
  if (!template || !template.linkedExcelPath) {
    return { kind: EXCEL_CAPABILITY.NONE, liveWritebackEligible: false, reason: 'no-linked-workbook' };
  }
  if (!template.isOneDrive) {
    return { kind: EXCEL_CAPABILITY.LOCAL, liveWritebackEligible: false, reason: 'local-file' };
  }
  if (template.isSharePoint) {
    return { kind: EXCEL_CAPABILITY.BUSINESS_GRAPH, liveWritebackEligible: true, reason: 'sharepoint' };
  }
  const normalizedTenant = typeof tenantId === 'string' ? tenantId.trim().toLowerCase() : '';
  if (normalizedTenant === CONSUMER_TENANT_ID) {
    return { kind: EXCEL_CAPABILITY.PERSONAL_ONEDRIVE, liveWritebackEligible: false, reason: 'consumer-tenant' };
  }
  if (normalizedTenant) {
    return { kind: EXCEL_CAPABILITY.BUSINESS_GRAPH, liveWritebackEligible: true, reason: 'work-tenant' };
  }
  // Unknown tenant (not yet hydrated / older session): fail SAFE — queue, never live.
  return { kind: EXCEL_CAPABILITY.PERSONAL_ONEDRIVE, liveWritebackEligible: false, reason: 'unknown-tenant-defaults-safe' };
};

/**
 * Whether the app may attempt a LIVE single-cell Graph writeback for this setup right
 * now. True only when the setup is business-graph eligible AND the master gate is on.
 * A runtime session probe still confirms before the actual PATCH.
 */
export const canAttemptLiveWriteback = (capability) =>
  Boolean(capability && capability.liveWritebackEligible && LIVE_WRITEBACK_ENABLED);
