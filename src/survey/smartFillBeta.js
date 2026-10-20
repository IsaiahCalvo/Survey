/**
 * smartFillBeta.js — turns the Smart fill beta on at load when its flag is on
 * (smartFillFlag.js). Imported for its side effect by SVGAnnotationLayer, so
 * desktop and phone both get it. Flag off = no provider = no Smart fill
 * button anywhere, exactly as before.
 */
import { isSmartFillBetaEnabled } from './smartFillFlag.js';
import { registerSmartFillProvider } from './smartFillProvider.js';
import { showToast } from '../utils/toast';

// UX: say why nothing appeared, in the user's words, instead of a silent tap.
const NO_MATCH_MESSAGES = {
  'on-blank': 'Smart fill: tap inside a tag, not on its line.',
  open: 'Smart fill: no closed outline around that spot.',
  'too-small': 'Smart fill: that outline is too small to fill.',
  'too-large': 'Smart fill: that area is too big for a tag. Try Rectangle.',
  'not-ready': 'Smart fill: the page is still loading. Try again.',
  timeout: 'Smart fill took too long here. Try zooming in, or use Rectangle.',
  error: 'Smart fill hit a problem on that spot. Try again or use Rectangle.',
};

if (typeof window !== 'undefined' && typeof document !== 'undefined' && isSmartFillBetaEnabled()) {
  registerSmartFillProvider({
    onNoMatch: (reason) => showToast(NO_MATCH_MESSAGES[reason] || NO_MATCH_MESSAGES.open, 'info', { id: 'smart-fill-no-match' }),
  });
}
