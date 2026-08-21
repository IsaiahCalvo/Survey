const currentLocation = () => (typeof window === 'undefined' ? null : window.location);
const currentGlobal = () => (typeof window === 'undefined' ? undefined : window);

/**
 * P2-13: Capacitor WebViews cannot complete the web/desktop PKCE redirect
 * (deep-link OAuth is out of scope). Hide Connect/Reconnect and refuse login.
 * Do not treat this as permission to remove MSAL — desktop/web still use it.
 */
export const isCapacitorNativeRuntime = (globalObj = currentGlobal()) => {
  if (!globalObj) return false;
  try {
    if (globalObj.Capacitor?.isNativePlatform?.() === true) return true;
  } catch {
    /* ignore missing Capacitor bridge */
  }
  const origin = String(globalObj.location?.origin || '');
  return origin.startsWith('capacitor://') || origin.startsWith('ionic://');
};

export const isCapacitorMicrosoftConnectHidden = (win = currentGlobal()) =>
  isCapacitorNativeRuntime(win);

export const isMicrosoftConnectAvailable = (globalObj = currentGlobal()) =>
  !isCapacitorNativeRuntime(globalObj);

export const shouldStartFullPageMicrosoftOAuth = (globalObj = currentGlobal()) => {
  if (!isMicrosoftConnectAvailable(globalObj)) return false;
  if (globalObj?.electronAPI?.microsoftSignIn) return false;
  if (globalObj?.electronAPI?.openOAuthWindow) return false;
  return true;
};


const PRODUCTION_ORIGIN = 'https://surveytool.app';
const REGISTERED_REDIRECT_ORIGINS = new Map([
  [PRODUCTION_ORIGIN, PRODUCTION_ORIGIN],
  ['https://www.surveytool.app', PRODUCTION_ORIGIN],
  ['http://localhost:5173', 'http://localhost:5173'],
]);

const registeredOriginFor = (location) => {
  const candidate = typeof location?.origin === 'string' ? location.origin : '';
  return REGISTERED_REDIRECT_ORIGINS.get(candidate) || PRODUCTION_ORIGIN;
};

export const microsoftRedirectUriFor = (location = currentLocation()) => {
  if (!location) return 'https://surveytool.app/';
  const path = /^\/mobile(?:\/|$)/.test(location.pathname || '') ? '/mobile' : '/';
  return new URL(path, registeredOriginFor(location)).toString();
};

export const microsoftReturnUrlFor = (location = currentLocation()) => {
  if (!location) return '/';
  return `${location.pathname || '/'}${location.search || ''}${location.hash || ''}`;
};

export const cleanMicrosoftReturnUrl = (returnUrl, origin) => {
  const target = new URL(returnUrl || '/', origin);
  if (target.origin !== origin) throw new Error('cross-origin return');
  target.searchParams.delete('code');
  target.searchParams.delete('state');
  target.searchParams.delete('error');
  target.searchParams.delete('error_description');
  return `${target.pathname}${target.search}${target.hash}`;
};
