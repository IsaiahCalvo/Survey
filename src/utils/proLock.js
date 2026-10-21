// src/utils/proLock.js — who may use the Pro features listed on the pricing
// page, once paid plans are switched on.
//
// Behind the 'pro-lock' flag. With the flag off nothing here ever locks, so the
// app behaves as it did before. With it on, a Free plan user who clicks one of
// these features gets a short prompt instead. Call sites check at the button,
// menu or mode switch the user clicks (see hooks/useProLock.js).
//
// The native apps (Capacitor / Expo shells) never show an Upgrade button, a
// price or a checkout link: app store rules. They only say the feature is not
// on this plan.

import { isFeatureOn } from '../featureFlags.js';
import { isNativeShellLocation } from './accountPlatform.js';
import { showToast } from './toast.js';

export const PRO_LOCK_FLAG = 'pro-lock';

export const PAID_TIERS = Object.freeze(['pro', 'enterprise', 'developer']);

export const PRO_LOCK_FEATURES = Object.freeze({
  excel: Object.freeze({ label: 'Excel export', plural: false }),
  regions: Object.freeze({ label: 'Regions', plural: true }),
  survey: Object.freeze({ label: 'Survey tools', plural: true }),
  onedrive: Object.freeze({ label: 'OneDrive', plural: false }),
});

/** True when the app runs inside the iOS / Android shell. */
export function isNativeApp(win = typeof window === 'undefined' ? null : window) {
  if (!win) return false;
  try {
    if (win.Capacitor?.isNativePlatform?.()) return true;
  } catch {
    // A half-loaded bridge counts as not native.
  }
  return isNativeShellLocation(win.location);
}

/**
 * Is this Pro feature locked for this plan?
 * flagOn defaults to the 'pro-lock' flag. Unknown features never lock.
 */
export function isProLocked(feature, tier, { flagOn = isFeatureOn(PRO_LOCK_FLAG) } = {}) {
  if (!flagOn) return false;
  if (!Object.prototype.hasOwnProperty.call(PRO_LOCK_FEATURES, feature)) return false;
  return !PAID_TIERS.includes(tier);
}

/** What the prompt says. Native: no Upgrade button and no price. */
export function proLockPrompt(feature, { native = isNativeApp() } = {}) {
  const def = PRO_LOCK_FEATURES[feature] || { label: 'This feature', plural: false };
  const { label } = def;
  const verb = def.plural ? 'are' : 'is';
  if (native) {
    return {
      feature,
      label,
      message: `${label} ${verb} not available on your plan.`,
      showUpgrade: false,
    };
  }
  return {
    feature,
    label,
    message: `${label} ${verb} part of Pro. Upgrade to use ${def.plural ? 'them' : 'it'}.`,
    showUpgrade: true,
    upgradeLabel: 'Upgrade',
  };
}

/**
 * The one-line check for a call site: when the feature is locked, show the
 * prompt and return true (the caller stops). onUpgrade starts checkout; it is
 * never offered in the native apps.
 */
export function blockIfProLocked(feature, tier, { flagOn, native, onUpgrade } = {}) {
  const locked = flagOn === undefined ? isProLocked(feature, tier) : isProLocked(feature, tier, { flagOn });
  if (!locked) return false;
  const prompt = proLockPrompt(feature, native === undefined ? undefined : { native });
  const action = prompt.showUpgrade && typeof onUpgrade === 'function'
    ? { label: prompt.upgradeLabel, onClick: onUpgrade }
    : undefined;
  showToast(prompt.message, 'warn', action ? { action } : {});
  return true;
}
