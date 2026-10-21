// useProLock — the plan-aware form of blockIfProLocked (utils/proLock.js).
// Returns proLocked(feature): true when the feature is locked for this user's
// plan (the prompt is already shown, so the caller just stops).
import { useCallback } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../supabaseClient';
import { buildBillingReturnUrl, openDeferredExternalDestination } from '../utils/accountPlatform';
import { blockIfProLocked } from '../utils/proLock.js';
import { showToast } from '../utils/toast.js';

// Same checkout as the Pro card's button in Settings (StripeCheckout).
function startProCheckout() {
  // Claim the tab inside the click; one opened after the await is blocked.
  const tab = openDeferredExternalDestination();
  supabase.functions.invoke('create-checkout-session', {
    body: { tier: 'pro', billingPeriod: 'monthly', returnUrl: buildBillingReturnUrl() },
  }).then(({ data, error }) => {
    if (error) throw error;
    if (data?.error) throw new Error(data.error);
    if (!data?.url) throw new Error('No checkout URL returned');
    return tab.navigate(data.url);
  }).catch((err) => {
    tab.cancel();
    console.error('Payment Error:', err);
    showToast('Could not open checkout. Try again from Settings.', 'error');
  });
}

export function useProLock() {
  const { tier, loadingTier } = useAuth();
  return useCallback((feature) => {
    // While the plan is still loading every account reads as Free; do not
    // show a paying user an upgrade prompt.
    if (loadingTier) return false;
    return blockIfProLocked(feature, tier, { onUpgrade: startProCheckout });
  }, [tier, loadingTier]);
}
