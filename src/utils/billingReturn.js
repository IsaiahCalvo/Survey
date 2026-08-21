import { consumeBillingReturn } from '../../supabase/functions/_shared/billingReturn.ts';
import { showToast } from './toast.js';

/**
 * Boot-time reader for checkout/portal `?billing=success|cancelled`.
 * Toasts once and strips the query so a refresh does not repeat it.
 */
export function consumeBillingQueryOnBoot(windowObject = typeof window === 'undefined' ? null : window) {
  if (!windowObject?.location?.href) {
    return { result: null, href: '', toasted: false };
  }
  return consumeBillingReturn({
    href: windowObject.location.href,
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
