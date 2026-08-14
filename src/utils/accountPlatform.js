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

export const requestAccountDeletion = async (functionsClient) => {
  const { data, error } = await functionsClient.invoke('delete-account', {
    body: { confirmation: 'DELETE' },
  });
  if (error) throw error;
  if (data?.error) throw new Error(data.error);
  if (data?.deleted !== true) throw new Error('Account deletion did not complete.');
  return data;
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
