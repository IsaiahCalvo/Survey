import { consumeBillingReturn } from '../../supabase/functions/_shared/billingReturn.ts';
import { showToast } from './toast.js';

function readBillingQuery(href) {
  try {
    const raw = new URL(href).searchParams.get('billing');
    if (raw === 'success' || raw === 'cancelled') return raw;
    return null;
  } catch {
    return null;
  }
}

/**
 * Boot-time reader for checkout/portal `?billing=success|cancelled`.
 * Toasts once and strips the query so a refresh does not repeat it.
 */
export function consumeBillingQueryOnBoot(windowObject = typeof window === 'undefined' ? null : window) {
  if (!windowObject?.location?.href) {
    return { result: null, href: '', toasted: false };
  }
  const href = windowObject.location.href;
  // P2-38: src/ itself reads Stripe's return query (not only the shared helper).
  if (!readBillingQuery(href)) {
    return { result: null, href, toasted: false };
  }
  return consumeBillingReturn({
    href,
    replaceHref: (nextHref) => {
      try {
        windowObject.history?.replaceState?.(windowObject.history.state, '', nextHref);
      } catch {
        // History can be missing in some webviews; the toast still fired.
      }
    },
    toast: showToast,
  });
}
