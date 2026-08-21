// Banner-code merge for YDocProvider storageState.
// permission_revoked must outrank login_expiry_failure so a later sign-in
// expiry cannot hide an access-removed lockout (P2-12).

export function storageStateAfterSignedOut({ accessRevoked = false, current = null } = {}) {
  if (accessRevoked || current?.code === 'permission_revoked') {
    return { code: 'permission_revoked', role: current?.role ?? 'unknown' };
  }
  return { code: 'login_expiry_failure', role: 'unknown' };
}

export function storageStateAfterResignIn({ accessRevoked = false, currentCode = null } = {}) {
  if (accessRevoked || currentCode === 'permission_revoked') {
    return { code: 'permission_revoked', role: 'unknown' };
  }
  if (currentCode === 'login_expiry_failure') {
    return { code: 'ok', role: 'unknown' };
  }
  return { code: currentCode || 'ok', role: 'unknown' };
}

export function storageStateWhenAccessRevoked(current = null) {
  if (current?.code === 'permission_revoked') return current;
  return { code: 'permission_revoked', role: current?.role ?? 'unknown' };
}
