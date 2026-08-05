const DEFAULT_ENDPOINT = 'https://analytics.agent-native.com/track';
const SESSION_STORAGE_KEY = 'survey-analytics-session-id';
const BLOCKED_PROPERTY = /(?:email|filename|fileName|token|password|authorization|content|annotation)/i;

const analyticsPublicKey = import.meta.env.VITE_AGENT_NATIVE_ANALYTICS_PUBLIC_KEY?.trim() || '';
const analyticsEndpoint = import.meta.env.VITE_AGENT_NATIVE_ANALYTICS_URL?.trim() || DEFAULT_ENDPOINT;

const safeString = (value, limit = 240) => String(value || '').replace(/[\r\n]+/g, ' ').slice(0, limit);

const sanitizeProperties = (value, depth = 0) => {
  if (depth > 3 || value == null) return value == null ? null : undefined;
  if (typeof value === 'string') return safeString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.slice(-24).map((entry) => sanitizeProperties(entry, depth + 1)).filter((entry) => entry !== undefined);
  }
  if (typeof value !== 'object') return undefined;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !BLOCKED_PROPERTY.test(key))
    .slice(0, 30)
    .map(([key, entry]) => [key, sanitizeProperties(entry, depth + 1)])
    .filter(([, entry]) => entry !== undefined));
};

const getSessionId = () => {
  if (typeof window === 'undefined') return 'server';
  if (window.__surveyShellSessionId) return safeString(window.__surveyShellSessionId, 100);
  try {
    const existing = window.sessionStorage.getItem(SESSION_STORAGE_KEY);
    if (existing) return existing;
    const generated = `web-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    window.sessionStorage.setItem(SESSION_STORAGE_KEY, generated);
    return generated;
  } catch {
    return `web-${Date.now()}`;
  }
};

export function trackSurveyAnalyticsEvent(event, properties = {}) {
  if (!analyticsPublicKey || typeof window === 'undefined' || typeof fetch !== 'function') return false;
  const sessionId = getSessionId();
  const path = /^\/mobile(?:\/|$)/.test(window.location.pathname) ? '/mobile' : window.location.pathname;
  const payload = {
    publicKey: analyticsPublicKey,
    event: safeString(event, 100),
    anonymousId: sessionId,
    sessionId,
    timestamp: new Date().toISOString(),
    properties: {
      app: 'survey',
      surface: window.ReactNativeWebView ? 'expo-webview' : 'web',
      path,
      ...sanitizeProperties(properties),
    },
    context: { source: 'survey-web' },
  };
  void fetch(analyticsEndpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => {});
  return true;
}

export function installSurveyAnalytics() {
  if (typeof window === 'undefined' || window.__surveyAnalyticsInstalled) return;
  window.__surveyAnalyticsInstalled = true;
  trackSurveyAnalyticsEvent('survey_app_opened', {
    mobile: /^\/mobile(?:\/|$)/.test(window.location.pathname),
  });
  window.addEventListener('load', () => {
    const navigation = performance.getEntriesByType?.('navigation')?.[0];
    trackSurveyAnalyticsEvent('survey_app_loaded', {
      responseMs: Math.round(navigation?.responseEnd || 0),
      domContentMs: Math.round(navigation?.domContentLoadedEventEnd || 0),
      loadMs: Math.round(navigation?.loadEventEnd || performance.now()),
    });
  }, { once: true });
  window.addEventListener('error', (event) => {
    trackSurveyAnalyticsEvent('$exception', {
      exceptionType: 'JavaScriptError',
      message: safeString(event.message),
      line: event.lineno || null,
      column: event.colno || null,
      fatal: false,
      unhandled: true,
    });
  });
  window.addEventListener('unhandledrejection', (event) => {
    trackSurveyAnalyticsEvent('$exception', {
      exceptionType: 'UnhandledPromiseRejection',
      message: safeString(event.reason?.message || event.reason),
      fatal: false,
      unhandled: true,
    });
  });
}
