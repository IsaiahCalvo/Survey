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

export type BillingResult = 'success' | 'cancelled';

export function withBillingResult(returnUrl: string, result: BillingResult): string {
  const parsed = new URL(returnUrl);
  parsed.searchParams.set('billing', result);
  return parsed.toString();
}

function asUrl(searchOrHref: string): URL {
  if (/^[a-zA-Z][a-zA-Z\d+\-.]*:/.test(searchOrHref)) return new URL(searchOrHref);
  return new URL(searchOrHref, CANONICAL_RETURN_URL);
}

export function parseBillingResult(searchOrHref: string): BillingResult | null {
  try {
    const raw = asUrl(searchOrHref).searchParams.get('billing');
    if (raw === 'success' || raw === 'cancelled') return raw;
    return null;
  } catch {
    return null;
  }
}

export function stripBillingResult(href: string): { href: string; result: BillingResult | null } {
  const result = parseBillingResult(href);
  if (!result) return { href, result: null };
  try {
    const url = asUrl(href);
    url.searchParams.delete('billing');
    return { href: url.toString(), result };
  } catch {
    return { href, result: null };
  }
}

export function billingResultToast(result: BillingResult | null): { message: string; type: 'success' | 'info' } | null {
  if (result === 'success') {
    return { message: "You're subscribed. Your plan is now active.", type: 'success' };
  }
  if (result === 'cancelled') {
    return { message: 'Checkout cancelled.', type: 'info' };
  }
  return null;
}

export function consumeBillingReturn(options: {
  href: string;
  replaceHref?: (nextHref: string) => void;
  toast?: (message: string, type: 'success' | 'info' | 'error' | 'warn') => void;
}): { result: BillingResult | null; href: string; toasted: boolean } {
  const { href, result } = stripBillingResult(options.href);
  if (!result) return { result: null, href: options.href, toasted: false };
  const toast = billingResultToast(result);
  if (toast) options.toast?.(toast.message, toast.type);
  if (href !== options.href) options.replaceHref?.(href);
  return { result, href, toasted: Boolean(toast) };
}
