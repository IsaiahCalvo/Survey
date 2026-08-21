/**
 * Stripe delivers at-least-once. Insert-first on event_id so retried webhooks
 * do not re-send Payment Received / Failed / Canceled emails.
 */

const UNIQUE_VIOLATION = '23505';

type InsertResult = { error?: { code?: string } | null };
type DeleteEq = { eq: (column: string, value: string) => Promise<unknown> };
type StripeEventTable = {
  insert: (row: { event_id: string }) => Promise<InsertResult>;
  delete: () => DeleteEq;
};

export function isUniqueViolation(error: { code?: string } | null | undefined): boolean {
  return error?.code === UNIQUE_VIOLATION;
}

export async function claimStripeEvent(
  supabase: { from: (table: string) => StripeEventTable },
  eventId: string,
): Promise<'claimed' | 'duplicate'> {
  if (!eventId) throw new Error('Stripe event id is required');
  const { error } = await supabase.from('processed_stripe_events').insert({ event_id: eventId });
  if (!error) return 'claimed';
  if (isUniqueViolation(error)) return 'duplicate';
  throw error;
}

export async function releaseStripeEvent(
  supabase: { from: (table: string) => StripeEventTable },
  eventId: string,
): Promise<void> {
  await supabase.from('processed_stripe_events').delete().eq('event_id', eventId);
}

export async function withStripeEventIdempotency<T>(
  supabase: { from: (table: string) => StripeEventTable },
  eventId: string,
  work: () => Promise<T>,
): Promise<{ status: 'handled'; value: T } | { status: 'duplicate' }> {
  const claim = await claimStripeEvent(supabase, eventId);
  if (claim === 'duplicate') return { status: 'duplicate' };
  try {
    const value = await work();
    return { status: 'handled', value };
  } catch (error) {
    await releaseStripeEvent(supabase, eventId);
    throw error;
  }
}
