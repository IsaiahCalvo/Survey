// src/services/microsoftConnectionMarker.js
//
// With main-process token custody (PLAN.md Amendment 2026-06-08(b) #5), the
// Supabase `connected_services` row is reduced to a "connected" MARKER — the
// MSAL cache in the Electron main process is the source of truth for tokens.
// This module builds that marker row and is the single place that guarantees
// NO access/refresh/id token ever lands in the database on the new path.
//
// Pure + unit-tested; the renderer context calls it, tests assert the
// no-token invariant.

export const MAIN_PROCESS_CUSTODY = 'main-process';

/**
 * Map the main process's sign-in/status result account into the app's account
 * shape (mirrors what the legacy id-token decode produced).
 */
export const buildMainAuthAccount = (account = {}) => ({
  homeAccountId: account.homeAccountId || null,
  tenantId: account.tenantId || null,
  username: account.username || null,
  name: account.name || null
});

/**
 * The connected_services upsert payload for the main-custody path.
 * Carries identity + tenant only — never tokens.
 */
export const buildConnectionMarkerRow = ({ userId, account, nowIso }) => {
  const acct = buildMainAuthAccount(account);
  const stamp = nowIso || new Date().toISOString();
  return {
    user_id: userId,
    service_name: 'microsoft',
    is_connected: true,
    account_id: acct.homeAccountId,
    account_email: acct.username,
    account_name: acct.name,
    metadata: {
      tenant_id: acct.tenantId,
      token_custody: MAIN_PROCESS_CUSTODY
    },
    connected_at: stamp,
    last_used_at: stamp
  };
};

/** True when a stored connected_services row says tokens live in the main process. */
export const isMainCustodyRow = (row) =>
  row?.metadata?.token_custody === MAIN_PROCESS_CUSTODY;

/** True when a stored row still carries legacy renderer-managed tokens. */
export const hasLegacyRendererTokens = (row) =>
  Boolean(row?.metadata?.refresh_token);
