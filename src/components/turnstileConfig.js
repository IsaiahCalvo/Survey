export const DEFAULT_TURNSTILE_SITE_KEY = '0x4AAAAAADvT0lMMs6ifYoKO';

export function resolveTurnstileSiteKey(env = {}) {
  const value = env?.VITE_TURNSTILE_SITE_KEY;
  if (value === undefined) return DEFAULT_TURNSTILE_SITE_KEY;
  return String(value).trim();
}

export function isTurnstileEnabled(siteKey) {
  return Boolean(siteKey);
}
