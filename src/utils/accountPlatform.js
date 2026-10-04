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

// Opens a destination whose URL is only known after an async round trip
// (Stripe checkout/portal sessions take seconds to mint). Browsers only honor
// window.open while a user gesture is "fresh"; calling it after the await gets
// popup-blocked — the user saw "Failed to open billing portal" while an
// orphaned single-use session expired in Stripe (owner-hit 2026-08-20).
// The fix is the standard one: claim a tab SYNCHRONOUSLY at click time, steer
// it when the URL arrives, close it if the fetch fails. Electron and native
// shells have no popup rules, so they keep the simple path.
export const openDeferredExternalDestination = (windowObject = window) => {
  if (windowObject.electronAPI?.openExternal || isNativeShellLocation(windowObject.location)) {
    return {
      navigate: (url) => openExternalDestination(url, windowObject),
      cancel: () => {},
    };
  }
  const pre = windowObject.open('', '_blank');
  if (pre) {
    try {
      pre.opener = null;
      pre.document.title = 'Opening…';
      pre.document.body.style.cssText = 'background:#0d0f14;color:#8d96a6;font-family:Helvetica,Arial,sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0';
      pre.document.body.textContent = 'Opening secure billing…';
    } catch { /* placeholder styling is best-effort */ }
  }
  return {
    navigate: async (url) => {
      if (pre && !pre.closed) {
        pre.location.replace(url);
        return 'browser';
      }
      // The pre-opened tab was blocked or closed; try the direct path so the
      // user at least gets the explicit allow-pop-ups message on failure.
      return openExternalDestination(url, windowObject);
    },
    cancel: () => {
      try { if (pre && !pre.closed) pre.close(); } catch { /* already gone */ }
    },
  };
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

// What Settings > Subscription says when the plan cannot be loaded (no
// network, no backend, a timeout). Plain words; the technical reason only goes
// to the console. Polish round 6: it used to print the raw JS error, e.g.
// "Cannot read properties of null (reading 'from')".
export const SUBSCRIPTION_LOAD_FAILED_TEXT = "Your plan couldn't be loaded right now. Check your connection, then try again.";

export const resolveSubscriptionQuery = async (query, timeoutMs = 10_000) => {
  const { data, error } = await withTimeout(
    query,
    timeoutMs,
    'Subscription status took too long to load.',
  );
  if (error) throw error;
  return data || { tier: 'free', status: 'active' };
};
