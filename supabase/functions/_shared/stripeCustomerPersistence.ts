type StripeCustomerPersistenceOptions = {
  existingCustomerId?: string | null;
  createCustomer: () => Promise<{ id: string }>;
  persistCandidate: (customerId: string) => Promise<void>;
  readAuthoritative: () => Promise<string | null>;
  removeCustomer: (customerId: string) => Promise<void>;
};

const asError = (value: unknown, fallback: string) => value instanceof Error
  ? value
  : new Error(value ? String(value) : fallback);

// Checkout must never use a newly-created Stripe customer until the database
// confirms which customer owns the account. The authoritative reread also
// resolves committed-but-lost responses and concurrent checkout requests.
export async function ensurePersistedStripeCustomer({
  existingCustomerId,
  createCustomer,
  persistCandidate,
  readAuthoritative,
  removeCustomer,
}: StripeCustomerPersistenceOptions): Promise<string> {
  if (existingCustomerId) return existingCustomerId;

  const created = await createCustomer();
  if (!created?.id) throw new Error('Stripe did not return a customer id');

  let persistenceError: Error | null = null;
  try {
    await persistCandidate(created.id);
  } catch (error) {
    persistenceError = asError(error, 'Could not persist Stripe customer id');
  }

  let authoritativeCustomerId: string | null;
  try {
    authoritativeCustomerId = await readAuthoritative();
  } catch (error) {
    // A failed authoritative read leaves the commit outcome ambiguous. Deleting
    // here could remove the customer the database now references, so abort the
    // checkout and retain it for a deterministic retry/reconciliation.
    throw new Error('Could not verify Stripe customer persistence', {
      cause: asError(error, 'Authoritative customer lookup failed'),
    });
  }

  if (authoritativeCustomerId === created.id) return created.id;

  try {
    await removeCustomer(created.id);
  } catch (error) {
    throw new Error('Could not remove an unpersisted Stripe customer', {
      cause: asError(error, 'Stripe customer cleanup failed'),
    });
  }

  if (authoritativeCustomerId) return authoritativeCustomerId;
  throw persistenceError || new Error('Could not persist Stripe customer id');
}
