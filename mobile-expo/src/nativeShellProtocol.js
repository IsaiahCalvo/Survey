const DEFAULT_SURVEY_URL = 'https://surveytool.app/mobile';

const normalizeSurveyUrl = (rawUrl) => {
  const url = new URL(rawUrl || DEFAULT_SURVEY_URL);
  url.searchParams.set('mobileNav', 'tabs');
  url.searchParams.set('nativeShell', 'expo');
  return url.toString();
};

export function resolveSurveyDeepLink(rawUrl) {
  if (!rawUrl) return null;
  try {
    const incoming = new URL(rawUrl);
    const surveyOrigin = new URL(DEFAULT_SURVEY_URL).origin;
    if (['http:', 'https:'].includes(incoming.protocol)) {
      if (incoming.origin !== surveyOrigin) return null;
      return normalizeSurveyUrl(incoming.toString());
    }
    if (incoming.protocol !== 'com.kalvoe.survey:') return null;

    const embeddedUrl = incoming.searchParams.get('url');
    if (embeddedUrl) {
      const parsedEmbedded = new URL(embeddedUrl);
      if (parsedEmbedded.origin !== surveyOrigin) return null;
      return normalizeSurveyUrl(parsedEmbedded.toString());
    }
    const path = incoming.searchParams.get('path');
    if (!path?.startsWith('/') || path.startsWith('//')) return null;
    return normalizeSurveyUrl(new URL(path, DEFAULT_SURVEY_URL).toString());
  } catch {
    return null;
  }
}

export function parseNativeShellMessage(rawData) {
  try {
    const parsed = typeof rawData === 'string' ? JSON.parse(rawData) : rawData;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
