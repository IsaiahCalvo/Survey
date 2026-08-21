export type AccountDeletionStages = {
  cancelBilling: () => Promise<void>;
  deleteDatabaseRows: () => Promise<void>;
  removeStorage: () => Promise<void>;
  deleteAuthUser: () => Promise<void>;
};

export class AccountDeletionStageError extends Error {
  stage: string;
  completed: string[];
  dataRemoved: boolean;

  constructor(
    message: string,
    opts: { stage: string; completed: string[]; dataRemoved: boolean },
  ) {
    super(message);
    this.name = 'AccountDeletionStageError';
    this.stage = opts.stage;
    this.completed = opts.completed;
    this.dataRemoved = opts.dataRemoved;
  }
}

export function isDataRemovedDeletionError(error: unknown) {
  return Boolean(
    error
    && typeof error === 'object'
    && (error as AccountDeletionStageError).dataRemoved === true,
  );
}

const wrapStageError = (error: unknown, stage: string, completed: string[]) => {
  if (error instanceof AccountDeletionStageError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new AccountDeletionStageError(message, {
    stage,
    completed,
    dataRemoved: completed.includes('database'),
  });
};

// Billing first so a billable account cannot disappear. Database rows are
// removed before storage so a failed blob cleanup cannot leave live rows
// pointing at missing PDFs. Auth is always attempted after a successful
// database wipe — even when storage fails — so a half-finished delete cannot
// leave the user signed into an empty account. Orphaned blobs are acceptable.
export async function runAccountDeletionStages(stages: AccountDeletionStages) {
  const completed: string[] = [];

  try {
    await stages.cancelBilling();
    completed.push('billing');
  } catch (error) {
    throw wrapStageError(error, 'billing', completed);
  }

  try {
    await stages.deleteDatabaseRows();
    completed.push('database');
  } catch (error) {
    throw wrapStageError(error, 'database', completed);
  }

  try {
    await stages.removeStorage();
    completed.push('storage');
  } catch {
    // Keep going: the auth user must not survive a completed data wipe.
  }

  try {
    await stages.deleteAuthUser();
    completed.push('auth');
  } catch (error) {
    throw wrapStageError(error, 'auth', completed);
  }
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
