const currentLocation = () => (typeof window === 'undefined' ? null : window.location);

const PRODUCTION_ORIGIN = 'https://surveytool.app';
const REGISTERED_REDIRECT_ORIGINS = new Map([
  [PRODUCTION_ORIGIN, PRODUCTION_ORIGIN],
  ['https://www.surveytool.app', PRODUCTION_ORIGIN],
  ['http://localhost:5173', 'http://localhost:5173'],
]);

const currentGlobal = () => (typeof window === 'undefined' ? undefined : window);

const registeredOriginFor = (location) => {
  const candidate = typeof location?.origin === 'string' ? location.origin : '';
  return REGISTERED_REDIRECT_ORIGINS.get(candidate) || PRODUCTION_ORIGIN;
};

/**
 * Capacitor iOS/Android WebView. Full deep-link OAuth (custom scheme +
 * @capacitor/browser + appUrlOpen) is out of scope; callers must hide/refuse
 * Connect here instead of starting PKCE (P2-13).
 */
export const isCapacitorNativeRuntime = (globalObj = currentGlobal()) => {
  if (globalObj?.Capacitor?.isNativePlatform?.()) return true;
  const origin = String(globalObj?.location?.origin || '');
  return origin.startsWith('capacitor://') || origin.startsWith('ionic://');
};

export const isMicrosoftConnectAvailable = (globalObj = currentGlobal()) =>
  !isCapacitorNativeRuntime(globalObj);

export const shouldStartFullPageMicrosoftOAuth = (globalObj = currentGlobal()) => {
  if (!isMicrosoftConnectAvailable(globalObj)) return false;
  if (globalObj?.electronAPI?.microsoftSignIn) return false;
  if (globalObj?.electronAPI?.openOAuthWindow) return false;
  return true;
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
