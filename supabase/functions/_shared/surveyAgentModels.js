// Which model a Survey agent turn goes to. Groq's free tier caps each model
// per day for everyone together (gpt-oss-120b: 1000 requests and 200K
// tokens a day), so when the main model is near or past its cap the turn
// moves to the next free model instead of failing. Only "busy" when every
// model in the chain is resting.

// Free Groq models that take tools, best first after the main one.
// (llama-3.3-70b-versatile left: Groq answers model_not_found for it now.)
export const SURVEY_AGENT_FALLBACK_MODELS = Object.freeze([
  'openai/gpt-oss-20b',
]);

// Below this many requests left today, stop using a model before it runs out.
export const NEAR_CAP_REQUESTS = 25;
// A daily cap frees up slowly; don't go back to that model for a while.
const DAILY_REST_MS = 15 * 60 * 1000;
const MAX_REST_MS = 24 * 60 * 60 * 1000;

/**
 * The models to try, in order. `fallbackEnv` is a comma list (empty string
 * turns the fallback off); with no list, the free Groq chain is used only on
 * the default Groq provider, since another provider may not have those models.
 * @param {string} main
 * @param {{ fallbackEnv?: string | null, groqDefault?: boolean }} [options]
 */
export function modelChain(main, { fallbackEnv = null, groqDefault = false } = {}) {
  const extra = fallbackEnv != null
    ? String(fallbackEnv).split(',').map((m) => m.trim()).filter(Boolean)
    : (groqDefault ? SURVEY_AGENT_FALLBACK_MODELS : []);
  return [...new Set([main, ...extra])];
}

/** "1m26.4s", "2h3m", "45s", "120ms" → milliseconds, or null. */
export function parseWait(text) {
  const raw = String(text ?? '').trim();
  if (!raw) return null;
  if (/^\d+(\.\d+)?$/.test(raw)) return Number(raw) * 1000;
  const units = { h: 3_600_000, m: 60_000, s: 1000, ms: 1 };
  let total = 0;
  let found = false;
  for (const [, n, unit] of raw.matchAll(/(\d+(?:\.\d+)?)(ms|h|m|s)/g)) {
    total += Number(n) * units[unit];
    found = true;
  }
  return found ? total : null;
}

/**
 * How long to leave a model alone after a 429. A daily cap (requests or
 * tokens per day) rests it at least 15 minutes; a per-minute one only for
 * as long as Groq says.
 */
export function restAfterRefusal({ retryAfter, message }) {
  const text = String(message || '');
  const daily = /per day|\(RPD\)|\(TPD\)/i.test(text);
  const said = parseWait(retryAfter) ?? parseWait(text.match(/try again in ([\d.hms]+)/i)?.[1]) ?? 20_000;
  return { daily, ms: Math.min(daily ? Math.max(said, DAILY_REST_MS) : said, MAX_REST_MS) };
}

/**
 * Groq checks each tool call against the tool's schema and answers 400
 * (tool_use_failed) when the model's call does not fit. That is the model
 * slipping once, not a broken request: asking again usually works.
 */
export function isRejectedToolCall(status, text) {
  return status === 400 && /tool_use_failed|tool call validation failed/i.test(String(text || ''));
}

/** After a good reply: rest the model if its daily requests are nearly gone. */
export function restWhenNearCap({ remaining, resetIn }, nearCap = NEAR_CAP_REQUESTS) {
  const left = Number(remaining);
  if (remaining == null || remaining === '' || !Number.isFinite(left) || left >= nearCap) return null;
  return Math.min(Math.max(parseWait(resetIn) ?? 0, DAILY_REST_MS), MAX_REST_MS);
}

/** Per server instance: which models are resting, and until when. */
export function createModelRest(now = () => Date.now()) {
  const until = new Map();
  return {
    rest(model, ms) { until.set(model, Math.max(until.get(model) || 0, now() + ms)); },
    resting(model) { return (until.get(model) || 0) > now(); },
    available(chain) { return chain.filter((m) => !this.resting(m)); },
    /** Seconds until the first model in the chain is free again. */
    soonest(chain) {
      const times = chain.map((m) => until.get(m) || 0);
      return Math.max(1, Math.ceil((Math.min(...times) - now()) / 1000));
    },
  };
}
