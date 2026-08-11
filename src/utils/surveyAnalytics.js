import { createAnalyticsRateLimiter } from './analyticsRateLimiter.js';

const DEFAULT_ENDPOINT = '/api/analytics/track';
const SESSION_STORAGE_KEY = 'survey-analytics-session-id';
const BLOCKED_PROPERTY = /(?:email|filename|fileName|token|password|authorization|content|annotation)/i;
const URL_VALUE = /\b(?:https?|file):\/\/[^\s<>"'`]+/gi;
const EMAIL_VALUE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;
const JWT_VALUE = /\beyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\b/g;
const BEARER_VALUE = /\bBearer\s+[A-Za-z0-9._~+\/-]+=*/gi;
const KNOWN_KEY_VALUE = /\b(?:anpk_|sk_(?:live|test)_|sb_(?:secret|publishable)_|AIza)[A-Za-z0-9_-]{12,}\b/g;
const NAMED_SECRET_VALUE = /\b(?:access[_-]?token|refresh[_-]?token|id[_-]?token|api[_-]?key|authorization|password|secret|signature|sig)\b\s*(?:=|:)\s*["']?[^\s,"'}]+["']?/gi;
const ABSOLUTE_PATH_VALUE = /(?:\/[A-Za-z0-9._ -]+){2,}\/[A-Za-z0-9._ -]+|\b[A-Z]:\\(?:[^\\\r\n]+\\)*[^\\\r\n]+/g;
const DOCUMENT_NAME_VALUE = /\b[^\s<>"'`/\\]+\.(?:pdf|docx?|xlsx?|pptx?|png|jpe?g|tiff?)\b/gi;

const analyticsPublicKey = import.meta.env?.VITE_AGENT_NATIVE_ANALYTICS_PUBLIC_KEY?.trim() || '';
const analyticsEndpoint = import.meta.env?.VITE_AGENT_NATIVE_ANALYTICS_URL?.trim() || DEFAULT_ENDPOINT;
const analyticsRateLimiter = createAnalyticsRateLimiter();

const safeIdentifier = (value, limit = 240) => String(value || '').replace(/[\r\n]+/g, ' ').slice(0, limit);

export const redactAnalyticsString = (value, limit = 240) => String(value || '')
  .replace(/[\r\n]+/g, ' ')
  .replace(URL_VALUE, '[url]')
  .replace(BEARER_VALUE, 'Bearer [redacted]')
  .replace(JWT_VALUE, '[token]')
  .replace(KNOWN_KEY_VALUE, '[key]')
  .replace(NAMED_SECRET_VALUE, '[secret]')
  .replace(EMAIL_VALUE, '[email]')
  .replace(ABSOLUTE_PATH_VALUE, '[path]')
  .replace(DOCUMENT_NAME_VALUE, '[file]')
  .slice(0, limit);

export const sanitizeAnalyticsProperties = (value, depth = 0) => {
  if (depth > 3 || value == null) return value == null ? null : undefined;
  if (typeof value === 'string') return redactAnalyticsString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.slice(-24).map((entry) => sanitizeAnalyticsProperties(entry, depth + 1)).filter((entry) => entry !== undefined);
  }
  if (typeof value !== 'object') return undefined;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !BLOCKED_PROPERTY.test(key))
    .slice(0, 30)
    .map(([key, entry]) => [key, sanitizeAnalyticsProperties(entry, depth + 1)])
    .filter(([, entry]) => entry !== undefined));
};

const getSessionId = () => {
  if (typeof window === 'undefined') return 'server';
  if (window.__surveyShellSessionId) return safeIdentifier(window.__surveyShellSessionId, 100);
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
  if (typeof window === 'undefined' || typeof fetch !== 'function') return false;
  // Hard client ceiling: analytics must never create an unbounded event bill or
  // error-loop storm. No retries and no session replay are installed here.
  if (!analyticsRateLimiter.allow()) return false;
  const sessionId = getSessionId();
  const path = /^\/mobile(?:\/|$)/.test(window.location.pathname) ? '/mobile' : window.location.pathname;
  const payload = {
    event: safeIdentifier(event, 100),
    anonymousId: sessionId,
    sessionId,
    timestamp: new Date().toISOString(),
    properties: {
      app: 'survey',
      surface: window.ReactNativeWebView ? 'expo-webview' : 'web',
      path,
      ...sanitizeAnalyticsProperties(properties),
    },
    context: { source: 'survey-web' },
  };
  const headers = { 'Content-Type': 'application/json' };
  if (analyticsPublicKey) {
    payload.publicKey = analyticsPublicKey;
    headers['x-agent-native-analytics-key'] = analyticsPublicKey;
  }
  void fetch(analyticsEndpoint, {
    method: 'POST',
    headers,
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
      message: event.message,
      line: event.lineno || null,
      column: event.colno || null,
      fatal: false,
      unhandled: true,
    });
  });
  window.addEventListener('unhandledrejection', (event) => {
    trackSurveyAnalyticsEvent('$exception', {
      exceptionType: 'UnhandledPromiseRejection',
      message: event.reason?.message || event.reason,
      fatal: false,
      unhandled: true,
    });
  });
  window.addEventListener('survey-native-analytics', (event) => {
    const name = event?.detail?.event;
    if (typeof name !== 'string' || !name) return;
    trackSurveyAnalyticsEvent(name, event?.detail?.properties || {});
  });
}
