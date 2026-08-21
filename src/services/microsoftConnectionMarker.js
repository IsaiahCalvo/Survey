// src/services/microsoftConnectionMarker.js
//
// With main-process token custody (PLAN.md Amendment 2026-06-08(b) #5), the
// Supabase `connected_services` row is reduced to a "connected" MARKER — the
// MSAL cache in the Electron main process is the source of truth for tokens.
// This module builds that marker row. Desktop never introduces tokens; when a
// web/mobile row already has PKCE tokens, restore must merge them so the
// shared connected_services row is not clobbered (P2-14).
//
// Pure + unit-tested; the renderer context calls it, tests assert the
// no-token invariant.

export const MAIN_PROCESS_CUSTODY = 'main-process';

const LEGACY_TOKEN_KEYS = ['access_token', 'refresh_token', 'id_token', 'expires_at'];

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
 * Keep web/mobile PKCE tokens when desktop writes a main-custody marker.
 * Desktop still never *introduces* tokens; it only preserves ones already stored.
 */
export const preserveLegacyTokenMetadata = (existingMetadata = {}) => {
  const kept = {};
  for (const key of LEGACY_TOKEN_KEYS) {
    if (existingMetadata?.[key] != null && existingMetadata[key] !== '') {
      kept[key] = existingMetadata[key];
    }
  }
  return kept;
};

/**
 * The connected_services upsert payload for the main-custody path.
 * Carries identity + tenant — and any already-stored web tokens so desktop
 * restore cannot clobber the shared row (P2-14).
 */
export const buildConnectionMarkerRow = ({ userId, account, nowIso, existingMetadata } = {}) => {
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
      token_custody: MAIN_PROCESS_CUSTODY,
      ...preserveLegacyTokenMetadata(existingMetadata),
    },
    connected_at: stamp,
    last_used_at: stamp
  };
};

/** Wipe the shared row only when it still holds the refresh token that just failed. */
export const shouldWipeSharedConnectionRow = ({ storedRefreshToken, failedRefreshToken } = {}) => (
  Boolean(storedRefreshToken && failedRefreshToken && storedRefreshToken === failedRefreshToken)
);

/** Another tab already rotated; adopt that row instead of wiping. */
export const shouldAdoptRemoteRefreshToken = ({ storedRefreshToken, failedRefreshToken } = {}) => (
  Boolean(storedRefreshToken && failedRefreshToken && storedRefreshToken !== failedRefreshToken)
);

/**
 * Desktop launch restore: only InteractionRequired is a real reconnect.
 * Network/unknown failures stay transient so a blip cannot lock the user out.
 */
export const interpretMainProcessRestore = ({ signedIn, tokenResult } = {}) => {
  if (!signedIn) return { action: 'legacy-fallthrough' };
  if (tokenResult?.success && tokenResult.accessToken) return { action: 'adopt' };
  if (tokenResult?.needsInteraction) return { action: 'reconnect' };
  return { action: 'transient' };
};

/** True when a stored connected_services row says tokens live in the main process. */
export const isMainCustodyRow = (row) =>
  row?.metadata?.token_custody === MAIN_PROCESS_CUSTODY;

/** True when a stored row still carries legacy renderer-managed tokens. */
export const hasLegacyRendererTokens = (row) =>
  Boolean(row?.metadata?.refresh_token);
