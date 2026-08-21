export const BILLING_PORTAL_RETURN_URL = 'https://surveytool.app/';

export function getTierFromPriceId(
  priceId: string | null | undefined,
  env: Record<string, string | undefined> = {},
): 'pro' | 'enterprise' | 'free' {
  if (!priceId) return 'free';
  if (priceId === env.STRIPE_PRO_MONTHLY_PRICE_ID || priceId === env.STRIPE_PRO_ANNUAL_PRICE_ID) {
    return 'pro';
  }
  if (priceId === env.STRIPE_ENTERPRISE_PRICE_ID) {
    return 'enterprise';
  }
  return 'free';
}

export function checkoutStatusFromSubscription(status: string | null | undefined): 'trialing' | 'active' {
  return status === 'trialing' ? 'trialing' : 'active';
}

export function trialDaysLeft(trialEndUnix: number | null | undefined, nowMs = Date.now()): number {
  if (!Number.isFinite(trialEndUnix) || Number(trialEndUnix) <= 0) return 0;
  return Math.ceil((Number(trialEndUnix) * 1000 - nowMs) / (1000 * 60 * 60 * 24));
}

// Soft replay: same user_id upsert is safe. Event-id persistence lives in
// stripeEventIdempotency.ts (processed_stripe_events, insert-first).
export function shouldTreatCheckoutReplayAsNoop(
  existing: { stripe_subscription_id?: string | null; stripe_price_id?: string | null; status?: string | null } | null,
  next: { stripe_subscription_id?: string | null; stripe_price_id?: string | null; status?: string | null },
): boolean {
  if (!existing) return false;
  return (
    existing.stripe_subscription_id === next.stripe_subscription_id
    && existing.stripe_price_id === next.stripe_price_id
    && existing.status === next.status
  );
}
