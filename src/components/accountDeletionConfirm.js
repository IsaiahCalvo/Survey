// In-app account deletion (App Store 5.1.1(v) / Google Play). The typed word
// matches the delete-account edge function's required `confirmation` value.
export const ACCOUNT_DELETION_CONFIRMATION = 'DELETE';

export function isAccountDeletionConfirmed(typed) {
  return typeof typed === 'string' && typed.trim() === ACCOUNT_DELETION_CONFIRMATION;
}

// The button is self-serve: only an in-flight request disables it.
export function deleteAccountButtonState({ loading = false } = {}) {
  return { disabled: !!loading, label: loading ? 'Deleting account…' : 'Delete account' };
}
