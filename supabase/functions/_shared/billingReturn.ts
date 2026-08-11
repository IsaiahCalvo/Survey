const CANONICAL_RETURN_URL = 'https://surveytool.app/';

const isAllowedProductionHost = (host: string) => (
  host === 'surveytool.app' || host === 'www.surveytool.app'
);

const isLocalDevHost = (host: string) => (
  host === 'localhost' || host === '127.0.0.1' || host === '[::1]'
);

export function resolveBillingReturnUrl(candidate: unknown, requestOrigin: string | null): string {
  const raw = typeof candidate === 'string' && candidate.trim()
    ? candidate.trim()
    : (requestOrigin && requestOrigin !== 'null' ? requestOrigin : CANONICAL_RETURN_URL);

  try {
    const parsed = new URL(raw);
    if (!['http:', 'https:'].includes(parsed.protocol)) return CANONICAL_RETURN_URL;
    const requestUrl = requestOrigin && requestOrigin !== 'null' ? new URL(requestOrigin) : null;
    const sameRequestOrigin = requestUrl?.origin === parsed.origin;
    if (!sameRequestOrigin && !isAllowedProductionHost(parsed.hostname) && !isLocalDevHost(parsed.hostname)) {
      return CANONICAL_RETURN_URL;
    }
    parsed.hash = '';
    return parsed.toString();
  } catch {
    return CANONICAL_RETURN_URL;
  }
}

export function withBillingResult(returnUrl: string, result: 'success' | 'cancelled'): string {
  const parsed = new URL(returnUrl);
  parsed.searchParams.set('billing', result);
  return parsed.toString();
}
