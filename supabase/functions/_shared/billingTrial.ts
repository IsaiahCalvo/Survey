/**
 * Pro checkout may include a 7-day trial only the first time.
 * `trial_used_at` is the durable flag; Stripe subscription history is the
 * backfill for customers who canceled before that column existed.
 */

export const PRO_TRIAL_PERIOD_DAYS = 7;

type StripeTrialish = { trial_end?: number | null } | null | undefined;

export function hasRecordedTrial(trialUsedAt: unknown): boolean {
  if (trialUsedAt == null) return false;
  if (typeof trialUsedAt === 'string' && trialUsedAt.trim() === '') return false;
  return true;
}

export function stripeCustomerUsedTrial(subscriptions: ReadonlyArray<StripeTrialish> | null | undefined): boolean {
  if (!subscriptions?.length) return false;
  return subscriptions.some((sub) => sub?.trial_end != null);
}

export function shouldGrantProTrial(
  tier: unknown,
  trialUsedAt: unknown,
  stripeSubscriptions?: ReadonlyArray<StripeTrialish> | null,
): boolean {
  if (tier !== 'pro') return false;
  if (hasRecordedTrial(trialUsedAt)) return false;
  if (stripeCustomerUsedTrial(stripeSubscriptions)) return false;
  return true;
}

export function proTrialPeriodDays(
  tier: unknown,
  trialUsedAt: unknown,
  stripeSubscriptions?: ReadonlyArray<StripeTrialish> | null,
): number | undefined {
  return shouldGrantProTrial(tier, trialUsedAt, stripeSubscriptions)
    ? PRO_TRIAL_PERIOD_DAYS
    : undefined;
}

export function trialUsedAtPatch(
  subscription: { trial_end?: number | null; trial_start?: number | null } | null | undefined,
  now: Date = new Date(),
): { trial_used_at: string } | Record<string, never> {
  if (!subscription?.trial_end) return {};
  const started = subscription.trial_start
    ? new Date(subscription.trial_start * 1000)
    : now;
  return { trial_used_at: started.toISOString() };
}
