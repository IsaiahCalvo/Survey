const COLLECTOR_URL = 'https://analytics.agent-native.com/api/analytics/track';
const PRODUCTION_ORIGINS = new Set([
  'https://surveytool.app',
  'https://www.surveytool.app',
]);
const MAX_BODY_BYTES = 32 * 1024;
const MAX_EVENTS_PER_MINUTE = 60;
const BLOCKED_PROPERTY = /(?:email|filename|fileName|token|password|authorization|content|annotation)/i;
const requestWindows = new Map();

const isAllowedBrowserOrigin = (origin) => {
  if (PRODUCTION_ORIGINS.has(origin)) return true;
  if (origin === 'capacitor://localhost') return true;
  try {
    const url = new URL(origin);
    const hostname = url.hostname.toLowerCase();
    if ((url.protocol === 'http:' || url.protocol === 'https:')
      && (hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]')) return true;
    return url.protocol === 'https:' && hostname.endsWith('.taila0b324.ts.net');
  } catch {
    return false;
  }
};

const applyCors = (response, origin) => {
  response.setHeader('Access-Control-Allow-Origin', origin);
  response.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
};

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

const clientIp = (request) => String(request.headers?.['x-forwarded-for'] || request.socket?.remoteAddress || 'unknown')
  .split(',')[0]
  .trim();

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

const parseBody = (request) => {
  if (request.body && typeof request.body === 'object' && !Buffer.isBuffer(request.body)) return request.body;
  const raw = Buffer.isBuffer(request.body) ? request.body.toString('utf8') : String(request.body || '');
  return JSON.parse(raw);
};

const actualBodyBytes = (request) => {
  try {
    if (Buffer.isBuffer(request.body)) return request.body.byteLength;
    if (typeof request.body === 'string') return Buffer.byteLength(request.body, 'utf8');
    return Buffer.byteLength(JSON.stringify(request.body ?? ''), 'utf8');
  } catch {
    return null;
  }
};

const bearerToken = (request) => {
  const match = String(request.headers?.authorization || '').match(/^Bearer\s+([^\s]+)$/i);
  return match?.[1] || '';
};

const supabaseConfiguration = () => ({
  url: String(process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/$/, ''),
  serviceKey: String(process.env.SUPABASE_SERVICE_ROLE_KEY || ''),
});

const authenticatedUserId = async (token, configuration) => {
  const result = await fetch(`${configuration.url}/auth/v1/user`, {
    headers: {
      apikey: configuration.serviceKey,
      Authorization: `Bearer ${token}`,
    },
    signal: AbortSignal.timeout(5_000),
  }).catch(() => null);
  if (!result?.ok) return '';
  const user = await result.json().catch(() => null);
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(String(user?.id || ''))
    ? String(user.id)
    : '';
};

// This RPC serializes reservations inside Postgres. Unlike a module-level Map,
// it is one global/day ceiling shared by every concurrent Vercel instance.
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

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Vary', 'Origin');
  const origin = String(request.headers?.origin || '');

  // Browser preflight is intentionally origin-scoped. Electron never receives
  // an Origin:null exception; its trusted main-process bridge performs POST.
  if (request.method === 'OPTIONS') {
    if (!isAllowedBrowserOrigin(origin)) return response.status(403).json({ error: 'origin_not_allowed' });
    applyCors(response, origin);
    return response.status(204).end();
  }
  if (request.method !== 'POST') return response.status(405).json({ error: 'method_not_allowed' });
  if (origin && !isAllowedBrowserOrigin(origin)) return response.status(403).json({ error: 'origin_not_allowed' });
  if (origin) applyCors(response, origin);
  const measuredBodyBytes = actualBodyBytes(request);
  if (measuredBodyBytes === null) return response.status(400).json({ error: 'invalid_json' });
  if (measuredBodyBytes > MAX_BODY_BYTES) {
    return response.status(413).json({ error: 'payload_too_large' });
  }
  if (rateLimited(request)) return response.status(429).json({ error: 'rate_limited' });

  const publicKey = String(process.env.AGENT_NATIVE_ANALYTICS_PUBLIC_KEY || '').trim();
  const configuration = supabaseConfiguration();
  if (!publicKey || !configuration.url || !configuration.serviceKey) {
    return response.status(503).json({ error: 'analytics_not_configured' });
  }

  const token = bearerToken(request);
  if (!token) return response.status(401).json({ error: 'authentication_required' });
  if (token.length > 8_192 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(token)) {
    return response.status(401).json({ error: 'invalid_session' });
  }
  const userId = await authenticatedUserId(token, configuration);
  if (!userId) return response.status(401).json({ error: 'invalid_session' });

  let input;
  try {
    input = parseBody(request);
  } catch {
    return response.status(400).json({ error: 'invalid_json' });
  }
  const event = redactAnalyticsString(input?.event, 100);
  if (!/^[A-Za-z0-9_$.-]{1,100}$/.test(event)) return response.status(400).json({ error: 'invalid_event' });

  // Reserve before forwarding. A hosted-collector failure deliberately still
  // consumes one Survey slot: conservative under-counting is safer than any
  // path that can exceed the global cost ceiling during retries.
  const reserved = await reserveGlobalSlot(userId, configuration);
  if (reserved === null) return response.status(503).json({ error: 'analytics_quota_unavailable' });
  if (!reserved) return response.status(429).json({ error: 'analytics_daily_limit' });

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
  if (!upstream?.ok) return response.status(202).json({ accepted: false });
  return response.status(202).json({ accepted: true });
}
