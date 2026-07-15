export function isServiceRoleCaller(authHeader, serviceRoleKey) {
  if (!serviceRoleKey || typeof authHeader !== 'string') return false;
  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  return !!token && token === serviceRoleKey;
}
