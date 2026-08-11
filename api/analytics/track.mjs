const COLLECTOR_URL = 'https://analytics.agent-native.com/api/analytics/track';
const ALLOWED_ORIGINS = new Set([
  'https://surveytool.app',
  'https://www.surveytool.app',
]);
const MAX_BODY_BYTES = 32 * 1024;
const MAX_EVENTS_PER_MINUTE = 60;
const BLOCKED_PROPERTY = /(?:email|filename|fileName|token|password|authorization|content|annotation)/i;
const requestWindows = new Map();

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

export default async function handler(request, response) {
  response.setHeader('Cache-Control', 'no-store');
  response.setHeader('Vary', 'Origin');
  if (request.method !== 'POST') return response.status(405).json({ error: 'method_not_allowed' });

  const origin = String(request.headers?.origin || '');
  if (!ALLOWED_ORIGINS.has(origin)) return response.status(403).json({ error: 'origin_not_allowed' });
  if (Number(request.headers?.['content-length'] || 0) > MAX_BODY_BYTES) {
    return response.status(413).json({ error: 'payload_too_large' });
  }
  if (rateLimited(request)) return response.status(429).json({ error: 'rate_limited' });

  const publicKey = String(process.env.AGENT_NATIVE_ANALYTICS_PUBLIC_KEY || '').trim();
  if (!publicKey) return response.status(503).json({ error: 'analytics_not_configured' });

  let input;
  try {
    input = parseBody(request);
  } catch {
    return response.status(400).json({ error: 'invalid_json' });
  }
  const event = redactAnalyticsString(input?.event, 100);
  if (!/^[A-Za-z0-9_$.-]{1,100}$/.test(event)) return response.status(400).json({ error: 'invalid_event' });

  const payload = sanitize({
    ...input,
    publicKey,
    event,
    context: { source: 'survey-web' },
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
