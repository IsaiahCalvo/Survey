export type AccountDeletionStages = {
  cancelBilling: () => Promise<void>;
  deleteDatabaseRows: () => Promise<void>;
  removeStorage: () => Promise<void>;
  deleteAuthUser: () => Promise<void>;
};

// Every operation in this sequence is deliberately idempotent. Database rows
// are removed transactionally before storage so a failed storage cleanup can
// leave only orphaned blobs, never live document rows pointing at missing PDFs.
export async function runAccountDeletionStages(stages: AccountDeletionStages) {
  await stages.cancelBilling();
  await stages.deleteDatabaseRows();
  await stages.removeStorage();
  await stages.deleteAuthUser();
}

export function isMissingStripeCustomer(error: unknown) {
  const value = error as { code?: string; statusCode?: number; type?: string } | null;
  return value?.code === 'resource_missing'
    || (value?.statusCode === 404 && value?.type === 'StripeInvalidRequestError');
}

export async function deleteStripeCustomer(stripe: any, customerId?: string | null) {
  if (!customerId) return;
  try {
    await stripe.customers.del(customerId);
  } catch (error) {
    // A previous attempt may have cancelled billing and then failed later.
    // Stripe's missing-customer response therefore means this stage is done.
    if (!isMissingStripeCustomer(error)) throw error;
  }
}
