// Kal Voe suite plans (KAL-856): the one place the edge functions learn which
// Stripe price sells which app. Prices are found by lookup key, so a price can
// be replaced in Stripe (new amount, same key moved over) without a code change.
// Amounts live in Stripe and on the marketing site (scripts/pricing.mjs).

export const SUITE_PLANS = ['survey', 'walkthru', 'plot', 'suite'];

// Plot Pro has no paid features yet: Plot is free in full, and comes with the
// suite. Its price exists in Stripe but nothing sells it on its own until it does.
export const SELLABLE_PLANS = ['survey', 'walkthru', 'suite'];

export const LOOKUP_KEYS = {
  survey: { monthly: 'survey_pro_monthly', yearly: 'survey_pro_yearly' },
  walkthru: { monthly: 'walkthru_pro_monthly', yearly: 'walkthru_pro_yearly' },
  plot: { monthly: 'plot_pro_monthly', yearly: 'plot_pro_yearly' },
  suite: { monthly: 'suite_monthly', yearly: 'suite_yearly' },
};

const PLAN_BY_LOOKUP_KEY = Object.fromEntries(
  Object.entries(LOOKUP_KEYS).flatMap(([plan, keys]) => Object.values(keys).map((key) => [key, plan])),
);

export const PLAN_NAMES = {
  survey: 'Survey Pro',
  walkthru: 'Walkthru Pro',
  plot: 'Plot Pro',
  suite: 'Kal Voe Suite',
};

/** The suite plan a Stripe price sells, or null for any other price. */
export function planForPrice(price) {
  const key = price && typeof price === 'object' ? price.lookup_key : null;
  return (key && PLAN_BY_LOOKUP_KEY[key]) || null;
}

/** Which apps a plan unlocks. */
export function appsForPlan(plan) {
  if (plan === 'suite') return ['survey', 'walkthru', 'plot'];
  return SUITE_PLANS.includes(plan) ? [plan] : [];
}

/** Does this plan make a Survey account Pro? */
export function planIncludesSurvey(plan) {
  return plan === 'survey' || plan === 'suite';
}

export const ACTIVE_STATUSES = ['active', 'trialing', 'past_due'];

const RETURN_HOSTS = new Set([
  'kalvoe.com', 'www.kalvoe.com',
  'survey.kalvoe.com', 'walkthru.kalvoe.com', 'plot.kalvoe.com',
  'surveytool.app', 'www.surveytool.app',
  'walkthru.tools', 'www.walkthru.tools',
  'plot-taupe-eight.vercel.app',
]);
const DEV_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
export const DEFAULT_RETURN_URL = 'https://kalvoe.com/buy/thanks';

/** A checkout's return address: only our own sites, never anyone else's. */
export function suiteReturnUrl(candidate) {
  if (typeof candidate !== 'string' || !candidate.trim()) return DEFAULT_RETURN_URL;
  try {
    const url = new URL(candidate.trim());
    const dev = DEV_HOSTS.has(url.hostname) && url.protocol === 'http:';
    if (!dev && (url.protocol !== 'https:' || !RETURN_HOSTS.has(url.hostname))) return DEFAULT_RETURN_URL;
    url.hash = '';
    return url.toString();
  } catch {
    return DEFAULT_RETURN_URL;
  }
}

/** A plain email check: enough to refuse junk, the real check is Stripe's. */
export function cleanEmail(value) {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

/** Constant-time string compare for the shared app key. */
export function sameSecret(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || !a || !b) return false;
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  }
  return diff === 0;
}
