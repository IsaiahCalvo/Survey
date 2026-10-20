// src/survey/smartFillFlag.js
// Owner 2026-10-20: Smart fill ships as a BETA, off by default. Its switch is
// the 'smart-fill' flag in src/featureFlags.js: on for testers or everyone
// from /flags, always on in the nightly build, and still on for a browser
// with localStorage.setItem('SMART_FILL_BETA', '1') ('0' forces it off).
//
// UX: while off, the Survey Marker group shows only Rectangle and Freehand,
// exactly as before.
import { isFeatureOn } from '../featureFlags.js';

export const SMART_FILL_BETA_STORAGE_KEY = 'SMART_FILL_BETA';

export function isSmartFillBetaEnabled() {
  return isFeatureOn('smart-fill');
}
