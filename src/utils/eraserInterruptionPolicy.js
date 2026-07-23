export function resolveEraserInterruptionPolicy({
  accessRevoked = false,
  docRole = null,
  documentLocked = false,
} = {}) {
  return accessRevoked || docRole === 'viewer' || documentLocked
    ? 'cancel'
    : 'commit';
}
