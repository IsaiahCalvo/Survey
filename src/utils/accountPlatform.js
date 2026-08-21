const MOBILE_PATH = '/mobile';

const currentLocation = () => (typeof window === 'undefined' ? null : window.location);

export const isNativeShellLocation = (location = currentLocation()) => {
  if (!location) return false;
  const params = new URLSearchParams(location.search || '');
  if (['expo', 'capacitor'].includes(params.get('nativeShell'))) return true;
  if (typeof document === 'undefined') return false;
  return ['expo', 'capacitor'].includes(document.documentElement?.dataset?.nativeShell);
};

export const appReturnPath = (location = currentLocation()) => {
  if (!location) return '/';
  const params = new URLSearchParams(location.search || '');
  const nativeShell = params.get('nativeShell');
  const mobileTabs = params.get('mobileNav') === 'tabs';
  const mobilePath = /^\/mobile(?:\/|$)/.test(location.pathname || '');
  if (!mobilePath && !mobileTabs && !['expo', 'capacitor'].includes(nativeShell)) return '/';

  const next = new URLSearchParams();
  next.set('mobileNav', 'tabs');
  if (['expo', 'capacitor'].includes(nativeShell)) next.set('nativeShell', nativeShell);
  return `${MOBILE_PATH}?${next.toString()}`;
};

export const buildAppDestination = ({ location = currentLocation(), params = {} } = {}) => {
  const base = appReturnPath(location);
  const url = new URL(base, location?.origin || 'https://surveytool.app');
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') {
      url.searchParams.set(key, String(value));
    }
  });
  return `${url.pathname}${url.search}${url.hash}`;
};

export const buildBillingReturnUrl = (location = currentLocation()) => {
  const origin = location?.origin && /^https?:$/i.test(location.protocol || '')
    ? location.origin
    : 'https://surveytool.app';
  return new URL(buildAppDestination({ location }), origin).toString();
};

export const openExternalDestination = async (url, windowObject = window) => {
  if (windowObject.electronAPI?.openExternal) {
    await windowObject.electronAPI.openExternal(url);
    return 'electron';
  }
  if (isNativeShellLocation(windowObject.location)) {
    windowObject.location.assign(url);
    return 'native-shell';
  }
  const popup = windowObject.open(url, '_blank', 'noopener,noreferrer');
  if (!popup) throw new Error('Your browser blocked the new window. Allow pop-ups and try again.');
  return 'browser';
};

export const withTimeout = (promise, timeoutMs, message) => {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
};

export const providerIdentity = (user, provider) => (
  user?.identities?.find((identity) => identity?.provider === provider) || null
);

export const canUnlinkProvider = (user, provider) => {
  const identity = providerIdentity(user, provider);
  if (!identity) return { allowed: false, identity: null, reason: 'not-connected' };
  const otherIdentities = (user?.identities || []).filter((candidate) => candidate?.identity_id !== identity.identity_id);
  if (!otherIdentities.length) {
    return { allowed: false, identity, reason: 'last-sign-in-method' };
  }
  return { allowed: true, identity, reason: null };
};

export const unlinkOAuthProvider = async ({ auth, user, provider }) => {
  const check = canUnlinkProvider(user, provider);
  if (!check.allowed) {
    if (check.reason === 'last-sign-in-method') {
      throw new Error(`Add another sign-in method before disconnecting ${provider}.`);
    }
    throw new Error(`${provider} is not connected.`);
  }
  const { data, error } = await auth.unlinkIdentity(check.identity);
  if (error) throw error;
  if (data?.user) return data.user;
  const refreshed = await auth.getUser();
  if (refreshed?.error) throw refreshed.error;
  return refreshed?.data?.user || user;
};

export const isGoogleIdentityConnected = (user) => (
  user?.app_metadata?.provider === 'google'
  || Boolean(user?.identities?.some((identity) => identity?.provider === 'google'))
);

export const hasPasswordIdentity = (user) => {
  if (user?.identities?.some((identity) => identity?.provider === 'email')) return true;
  const providers = user?.app_metadata?.providers;
  return Array.isArray(providers) && providers.includes('email');
};

export const passwordChangeKind = (user) => (hasPasswordIdentity(user) ? 'change' : 'set');

export const validatePasswordForm = ({
  kind,
  currentPassword,
  newPassword,
  confirmPassword,
  email,
  firstName,
  lastName,
  passwordMeetsRequirements,
} = {}) => {
  const changing = kind === 'change'
    ? Boolean(newPassword || confirmPassword || currentPassword)
    : Boolean(newPassword || confirmPassword);
  if (!changing) return { changing: false };

  if (kind === 'change' && !currentPassword) {
    return { changing: true, error: 'Please enter your current password to change your password' };
  }
  if (!newPassword) return { changing: true, error: 'Please enter a new password' };
  if (newPassword !== confirmPassword) return { changing: true, error: 'New passwords do not match' };
  if (typeof passwordMeetsRequirements === 'function'
    && !passwordMeetsRequirements(newPassword, { email, firstName, lastName })) {
    return { changing: true, error: 'Password does not meet requirements' };
  }
  if (kind === 'change' && newPassword === currentPassword) {
    return { changing: true, error: 'Your new password must be different from your current password' };
  }
  return { changing: true };
};

export const describeProfileSaveOutcome = ({
  nameSaved = false,
  passwordSaved = false,
  nameError = null,
  passwordError = null,
  attemptedName = false,
  attemptedPassword = false,
} = {}) => {
  if (!attemptedName && !attemptedPassword) {
    return { kind: 'noop', message: 'No changes detected', changedFields: [] };
  }
  const changedFields = [
    ...(nameSaved ? ['name'] : []),
    ...(passwordSaved ? ['password'] : []),
  ];
  if (nameSaved && passwordError) {
    return {
      kind: 'partial',
      message: `Your name was saved, but the password could not be updated: ${passwordError}`,
      changedFields,
    };
  }
  if (passwordSaved && nameError) {
    return {
      kind: 'partial',
      message: `Your password was updated, but the name could not be saved: ${nameError}`,
      changedFields,
    };
  }
  if (nameError && passwordError) {
    return {
      kind: 'error',
      message: `Could not save name (${nameError}) or password (${passwordError}).`,
      changedFields,
    };
  }
  if (nameError) return { kind: 'error', message: nameError, changedFields };
  if (passwordError) return { kind: 'error', message: passwordError, changedFields };
  return { kind: 'success', message: null, changedFields };
};

export const googleOAuthRedirectTo = (location = currentLocation(), windowObject = typeof window === 'undefined' ? null : window) => {
  if (!location) return undefined;
  let redirectTo = location.origin;
  if (/^\/mobile(?:\/|$)/.test(location.pathname || '')) {
    redirectTo = `${location.origin}/mobile`;
  }
  if (windowObject?.electronAPI) {
    redirectTo = String(location.href || '').split('#')[0];
  }
  return redirectTo;
};

export const linkOAuthProvider = async ({
  auth,
  provider,
  idToken,
  location = currentLocation(),
  windowObject = typeof window === 'undefined' ? null : window,
} = {}) => {
  if (!auth?.linkIdentity) {
    throw new Error('Connecting this sign-in method is temporarily unavailable.');
  }
  if (idToken) {
    const { data, error } = await auth.linkIdentity({ provider, token: idToken });
    if (error) throw error;
    return data;
  }
  const { data, error } = await auth.linkIdentity({
    provider,
    options: {
      redirectTo: googleOAuthRedirectTo(location, windowObject),
      skipBrowserRedirect: false,
      queryParams: { prompt: 'select_account' },
    },
  });
  if (error) throw error;
  return data;
};

export const assertLinkedSameUser = (previousUserId, nextUserId) => {
  if (previousUserId && nextUserId && previousUserId !== nextUserId) {
    throw new Error('That Google account belongs to a different Survey account. Sign in with it separately instead of connecting it here.');
  }
};

export const ACCOUNT_DELETION_CONFIRMATION = 'DELETE';

export const isAccountDeletionConfirmation = (value) => (
  String(value || '').trim() === ACCOUNT_DELETION_CONFIRMATION
);

export const accountDeletionUserMessage = (payload = {}) => {
  const documents = Array.isArray(payload.documents) ? payload.documents : [];
  const count = Number.isFinite(payload.documentCount) ? payload.documentCount : documents.length;
  if (payload.code === 'ACCOUNT_HAS_COLLABORATORS' || count > 0) {
    const names = documents
      .slice(0, 5)
      .map((doc) => doc?.name || 'Untitled')
      .filter(Boolean)
      .join(', ');
    const extra = count > 5 ? ` and ${count - 5} more` : '';
    const named = names ? ` (${names}${extra})` : '';
    return `This account still owns ${count} shared document${count === 1 ? '' : 's'}${named}. Transfer ownership or remove collaborators before deleting the account.`;
  }
  if (payload.code === 'DATA_REMOVED_RETRY' || payload.dataRemoved) {
    return payload.message
      || payload.error
      || 'Your data was removed, but the account could not finish closing. Retry to finish closing the account.';
  }
  return payload.message || payload.error || 'Account deletion could not finish. Please try again or contact support.';
};

export const resolveAccountDeletionResponse = (data, error) => {
  if (data?.deleted === true) return { ok: true, data };
  const body = data && typeof data === 'object' ? data : {};
  const code = body.code || null;
  const documents = Array.isArray(body.documents) ? body.documents : null;
  const stage = body.stage || null;
  const dataRemoved = Boolean(body.dataRemoved);
  if (body.error) {
    return {
      ok: false,
      message: body.error,
      code: code || (documents?.length ? 'ACCOUNT_HAS_COLLABORATORS' : null),
      documents,
      stage,
      dataRemoved,
    };
  }
  if (error) {
    return {
      ok: false,
      message: error.message || String(error),
      code,
      documents,
      stage,
      dataRemoved,
    };
  }
  return { ok: false, message: 'Account deletion did not complete.', code: 'INCOMPLETE' };
};

export const requestAccountDeletion = async (functionsClient) => {
  const { data, error } = await functionsClient.invoke('delete-account', {
    body: { confirmation: ACCOUNT_DELETION_CONFIRMATION },
  });
  const payload = resolveAccountDeletionResponse(data, error);
  if (payload.ok) return payload.data;
  const failure = new Error(accountDeletionUserMessage(payload));
  failure.code = payload.code;
  failure.documents = payload.documents;
  failure.stage = payload.stage;
  failure.dataRemoved = payload.dataRemoved;
  throw failure;
};

export const resolveSubscriptionQuery = async (query, timeoutMs = 10_000) => {
  const { data, error } = await withTimeout(
    query,
    timeoutMs,
    'Subscription status took too long to load.',
  );
  if (error) throw error;
  return data || { tier: 'free', status: 'active' };
};
