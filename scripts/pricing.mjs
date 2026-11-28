// The one place Kal Voe prices live. scripts/build-suite-site.mjs (kalvoe.com)
// and scripts/build-marketing.mjs (surveytool.app) both read these, so the two
// sites can never show different prices.
//
// Approved 2026-11-28: any one app $12 a month or $120 a year, the Kal Voe
// Suite $24 per user a month or $240 a year, Enterprise $35 per user a month
// (contact us only, KAL-414). Yearly is two months free. Checkout gives a
// 7-day free trial.

export const TRIAL_DAYS = 7;

// One app on its own. `checkout: false` means the app can't be bought alone
// yet: Plot is free in full while it is in early access and has no accounts.
export const APP_PRICES = {
  survey: { monthly: 12, yearly: 120, checkout: true },
  walkthru: { monthly: 12, yearly: 120, checkout: true },
  plot: { monthly: 12, yearly: 120, checkout: false },
};

export const SUITE_PRICE = { monthly: 24, yearly: 240 };
export const ENTERPRISE_PRICE = { monthly: 35 };

export const money = (n) => '$' + (Number.isInteger(n) ? n.toLocaleString('en-US') : n.toFixed(2));
const round2 = (n) => Math.round(n * 100) / 100;

// What one app saves by paying yearly (two months).
export const appYearSave = (k) => round2(APP_PRICES[k].monthly * 12 - APP_PRICES[k].yearly);
// The three apps bought one by one, against the suite.
export const SEPARATE_MONTHLY = round2(Object.values(APP_PRICES).reduce((t, a) => t + a.monthly, 0));
export const SEPARATE_YEARLY = round2(Object.values(APP_PRICES).reduce((t, a) => t + a.yearly, 0));
export const SUITE_SAVE_MONTHLY = round2(SEPARATE_MONTHLY - SUITE_PRICE.monthly);
export const SUITE_SAVE_YEARLY = round2(SEPARATE_YEARLY - SUITE_PRICE.yearly);
export const SUITE_YEAR_SAVE = round2(SUITE_PRICE.monthly * 12 - SUITE_PRICE.yearly);

// Where the buy page sends checkout requests (Survey's Supabase project).
export const CHECKOUT_ENDPOINT = 'https://cvamwtpsuvxvjdnotbeg.supabase.co/functions/v1/suite-checkout';
