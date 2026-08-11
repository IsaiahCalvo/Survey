import { trackSurveyAnalyticsEvent } from './surveyAnalytics.js';

const safeSurface = (value) => String(value || 'unknown')
  .replace(/[^A-Za-z0-9_.-]/g, '_')
  .slice(0, 80);

export async function copyTextToClipboard(text, {
  clipboard = globalThis.navigator?.clipboard,
  surface = 'unknown',
} = {}) {
  if (!String(text ?? '')) {
    trackSurveyAnalyticsEvent('survey_clipboard_write_failed', {
      surface: safeSurface(surface),
      reason: 'empty',
    });
    return { ok: false, reason: 'empty' };
  }
  if (!clipboard?.writeText) {
    trackSurveyAnalyticsEvent('survey_clipboard_write_failed', {
      surface: safeSurface(surface),
      reason: 'unavailable',
    });
    return { ok: false, reason: 'unavailable' };
  }
  try {
    await clipboard.writeText(String(text ?? ''));
    return { ok: true, reason: null };
  } catch {
    trackSurveyAnalyticsEvent('survey_clipboard_write_failed', {
      surface: safeSurface(surface),
      reason: 'denied',
    });
    return { ok: false, reason: 'denied' };
  }
}
