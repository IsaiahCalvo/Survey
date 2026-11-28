const COLLECTOR_URL = 'https://analytics.agent-native.com/api/analytics/track';
const PRODUCTION_ORIGINS = new Set([
  'https://surveytool.app',
  'https://www.surveytool.app',
  // Survey's address under the Kal Voe domain, same Vercel project.
  'https://survey.kalvoe.com',
  'https://nightly.surveytool.app',
  'https://kalvoe.com',
  'https://www.kalvoe.com',
  'https://surveytool-nightly.vercel.app',
]);
const MAX_BODY_BYTES = 32 * 1024;
const MAX_EVENTS_PER_MINUTE = 60;
const MAX_TOKEN_CACHE = 500;
const TOKEN_CACHE_TTL_MS = 5 * 60_000;
const BLOCKED_PROPERTY = /(?:email|filename|fileName|token|password|authorization|content|annotation)/i;
const requestWindows = new Map();
const tokenValidationCache = new Map();

export const resetCfAnalyticsAuthCache = () => {
  tokenValidationCache.clear();
};

const isAllowedBrowserOrigin = (origin) => {
  if (PRODUCTION_ORIGINS.has(origin)) return true;
  if (origin === 'capacitor://localhost') return true;
  if (origin === 'https://localhost') return true;
  try {
    const url = new URL(origin);
    const hostname = url.hostname.toLowerCase();
    if (
      (url.protocol === 'http:' || url.protocol === 'https:')
      && (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]')
    ) {
      return true;
    }
    if (url.protocol === 'https:' && hostname.endsWith('.taila0b324.ts.net')) return true;
    // Allow our own Cloudflare Pages preview deployments (survey*.pages.dev / kalvoe*.pages.dev).
    if (url.protocol === 'https:' && /^(?:[a-z0-9-]+\.)?(?:survey|kalvoe)[a-z0-9-]*\.pages\.dev$/.test(hostname)) {
      return true;
    }
    return false;
  } catch {
    return false;
  }
};

const corsHeaders = (origin) => (origin
  ? {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    }
  : {});

const jsonResponse = (body, status, extraHeaders = {}) => new Response(JSON.stringify(body), {
  status,
  headers: {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
    ...extraHeaders,
  },
});

export const redactAnalyticsString = (value, limit = 500) => String(value ?? '')
  .replace(/\bBearer\s+[^\s]+/gi, 'Bearer [TOKEN]')
  .replace(/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}(?:\.[A-Za-z0-9_-]{10,})?/g, '[TOKEN]')
  .replace(/https?:\/\/[^\s"'<>]+/gi, '[URL]')
  .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[EMAIL]')
  .replace(/\b[A-F0-9]{32,}\b/gi, '[TOKEN]')
  .replace(/[\r\n]+/g, ' ')
  .slice(0, limit);

const sanitize = (value, depth = 0) => {
  if (value == null) return null;
  if (depth > 4) return undefined;
  if (typeof value === 'string') return redactAnalyticsString(value);
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) {
    return value.slice(-24).map((entry) => sanitize(entry, depth + 1)).filter((entry) => entry !== undefined);
  }
  if (typeof value !== 'object') return undefined;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !BLOCKED_PROPERTY.test(key))
    .slice(0, 40)
    .map(([key, entry]) => [key, sanitize(entry, depth + 1)])
    .filter(([, entry]) => entry !== undefined));
};

const clientIp = (request) => String(
  request.headers.get('cf-connecting-ip')
  || request.headers.get('x-forwarded-for')
  || 'unknown',
).split(',')[0].trim();

const rateLimited = (request, now = Date.now()) => {
  const key = clientIp(request);
  const cutoff = now - 60_000;
  const recent = (requestWindows.get(key) || []).filter((timestamp) => timestamp > cutoff);
  if (recent.length >= MAX_EVENTS_PER_MINUTE) {
    requestWindows.set(key, recent);
    return true;
  }
  recent.push(now);
  requestWindows.set(key, recent);
  if (requestWindows.size > 1_000) {
    for (const [ip, timestamps] of requestWindows) {
      if (!timestamps.some((timestamp) => timestamp > cutoff)) requestWindows.delete(ip);
    }
  }
  return false;
};

const bearerToken = (request) => {
  const match = String(request.headers.get('authorization') || '').match(/^Bearer\s+([^\s]+)$/i);
  return match?.[1] || '';
};

const jwtExpiryMs = (token) => {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return null;
    const base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
    const json = atob(padded);
    const payload = JSON.parse(json);
    return typeof payload?.exp === 'number' && Number.isFinite(payload.exp) ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
};

const tokenDigest = async (token) => {
  const bytes = new TextEncoder().encode(token);
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(hash), (b) => b.toString(16).padStart(2, '0')).join('');
};

const cacheTokenVerdict = (key, userId, expiresAt, now) => {
  tokenValidationCache.set(key, { userId, expiresAt });
  if (tokenValidationCache.size > MAX_TOKEN_CACHE) {
    for (const [entryKey, entry] of tokenValidationCache) {
      if (entry.expiresAt <= now) tokenValidationCache.delete(entryKey);
    }
    while (tokenValidationCache.size > MAX_TOKEN_CACHE) {
      const oldestKey = tokenValidationCache.keys().next().value;
      if (oldestKey === undefined) break;
      tokenValidationCache.delete(oldestKey);
    }
  }
};

const authenticatedUserId = async (token, configuration, now = Date.now()) => {
  const expMs = jwtExpiryMs(token);
  if (expMs !== null && expMs <= now) return '';

  const key = await tokenDigest(token);
  const cached = tokenValidationCache.get(key);
  if (cached && cached.expiresAt > now) return cached.userId;
  if (cached) tokenValidationCache.delete(key);

  const result = await fetch(`${configuration.url}/auth/v1/user`, {
    headers: {
      apikey: configuration.serviceKey,
      Authorization: `Bearer ${token}`,
    },
    signal: AbortSignal.timeout(5_000),
  }).catch(() => null);
  if (!result) return '';
  if (!result.ok) {
    if (result.status === 401 || result.status === 403) {
      const ttlUntil = expMs !== null ? Math.min(now + TOKEN_CACHE_TTL_MS, expMs) : now + TOKEN_CACHE_TTL_MS;
      if (ttlUntil > now) cacheTokenVerdict(key, '', ttlUntil, now);
    }
    return '';
  }
  const user = await result.json().catch(() => null);
  const userId = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(user?.id || ''))
    ? String(user.id)
    : '';
  if (userId) {
    const ttlUntil = expMs !== null ? Math.min(now + TOKEN_CACHE_TTL_MS, expMs) : now + TOKEN_CACHE_TTL_MS;
    if (ttlUntil > now) cacheTokenVerdict(key, userId, ttlUntil, now);
  }
  return userId;
};

const reserveGlobalSlot = async (userId, configuration) => {
  const result = await fetch(`${configuration.url}/rest/v1/rpc/reserve_analytics_ingestion_slot`, {
    method: 'POST',
    headers: {
      apikey: configuration.serviceKey,
      Authorization: `Bearer ${configuration.serviceKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ p_user_id: userId }),
    signal: AbortSignal.timeout(5_000),
  }).catch(() => null);
  if (!result?.ok) return null;
  return (await result.json().catch(() => false)) === true;
};

export async function onRequest(context) {
  const { request, env = {} } = context;
  const origin = String(request.headers.get('origin') || '');

  if (request.method === 'OPTIONS') {
    if (!isAllowedBrowserOrigin(origin)) return jsonResponse({ error: 'origin_not_allowed' }, 403);
    return new Response(null, {
      status: 204,
      headers: {
        'Cache-Control': 'no-store',
        Vary: 'Origin',
        ...corsHeaders(origin),
      },
    });
  }
  if (request.method !== 'POST') return jsonResponse({ error: 'method_not_allowed' }, 405);
  if (origin && !isAllowedBrowserOrigin(origin)) return jsonResponse({ error: 'origin_not_allowed' }, 403);
  const cors = corsHeaders(origin);

  const rawBody = await request.text().catch(() => null);
  if (rawBody === null) return jsonResponse({ error: 'invalid_json' }, 400, cors);
  const measuredBodyBytes = new TextEncoder().encode(rawBody).byteLength;
  if (measuredBodyBytes > MAX_BODY_BYTES) {
    return jsonResponse({ error: 'payload_too_large' }, 413, cors);
  }
  if (rateLimited(request)) return jsonResponse({ error: 'rate_limited' }, 429, cors);

  const publicKey = String(env.AGENT_NATIVE_ANALYTICS_PUBLIC_KEY || '').trim();
  const configuration = {
    url: String(env.SUPABASE_URL || env.VITE_SUPABASE_URL || '').replace(/\/$/, ''),
    serviceKey: String(env.SUPABASE_SERVICE_ROLE_KEY || ''),
  };
  if (!publicKey || !configuration.url || !configuration.serviceKey) {
    return jsonResponse({ error: 'analytics_not_configured' }, 503, cors);
  }

  const token = bearerToken(request);
  if (!token) return jsonResponse({ error: 'authentication_required' }, 401, cors);
  if (token.length > 8_192 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
    return jsonResponse({ error: 'invalid_session' }, 401, cors);
  }
  const userId = await authenticatedUserId(token, configuration);
  if (!userId) return jsonResponse({ error: 'invalid_session' }, 401, cors);

  let input;
  try {
    input = JSON.parse(rawBody);
  } catch {
    return jsonResponse({ error: 'invalid_json' }, 400, cors);
  }
  const event = redactAnalyticsString(input?.event, 100);
  if (!/^[A-Za-z0-9_$.-]{1,100}$/.test(event)) return jsonResponse({ error: 'invalid_event' }, 400, cors);

  const reserved = await reserveGlobalSlot(userId, configuration);
  if (reserved === null) return jsonResponse({ error: 'analytics_quota_unavailable' }, 503, cors);
  if (!reserved) return jsonResponse({ error: 'analytics_daily_limit' }, 429, cors);

  const payload = sanitize({
    ...input,
    publicKey,
    event,
    context: { source: 'survey-web', authenticated: true },
  });
  const upstream = await fetch(COLLECTOR_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-agent-native-analytics-key': publicKey,
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(5_000),
  }).catch(() => null);
  if (!upstream?.ok) return jsonResponse({ accepted: false }, 202, cors);
  return jsonResponse({ accepted: true }, 202, cors);
}
