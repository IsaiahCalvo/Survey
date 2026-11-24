// The suite's shared AI credit budget (owner 2026-11-24): paid AI calls run
// on Isaiah's monthly API credits and stop at the credit amount. The budget
// and ledger live in public.ai_credit_budgets / ai_credit_spend (see the
// 20261124010000 migration). Walkthru keeps a copy of the provider rules in
// apps/web/src/lib/ai-credit.ts; change both together.

// Which budget a call to this base URL spends. null means the call is free
// (Groq's free tier, a local fake) and needs no hold. Any other host is
// 'other', which has no budget row, so it is refused until one is added.
export function creditProviderFor(baseUrl) {
  let host = '';
  try { host = new URL(String(baseUrl || '')).hostname.toLowerCase(); } catch { return null; }
  if (!host) return null;
  if (host === 'api.openai.com') return 'openai';
  if (host === 'api.anthropic.com') return 'anthropic';
  if (host.endsWith('groq.com')) return null;
  if (host === 'localhost' || host === '127.0.0.1' || host === 'host.docker.internal') return null;
  return 'other';
}

// What a chat call could cost at most: every prompt token at the input price
// (about 4 characters a token, rounded up) plus the full output allowance.
export function chatHoldMicros({ promptChars = 0, maxOutputTokens = 0, prices = {} } = {}) {
  const input = Math.ceil(Math.max(0, Number(promptChars) || 0) / 3.5);
  const out = Math.max(0, Number(maxOutputTokens) || 0);
  return Math.ceil(input * (Number(prices.input) || 0) + out * (Number(prices.output) || 0));
}

// Hold before the call. Returns null when the budget refuses (or can't be
// read: a paid call never goes ahead unchecked), else a settle function to
// call with the real cost afterwards (0 when the call failed).
export async function holdCredit(admin, { provider, micros, app }) {
  if (!provider) return async () => {};
  const held = Math.max(1, Math.ceil(Number(micros) || 0));
  const { data, error } = await admin.rpc('reserve_ai_credit', { p_provider: provider, p_micros: held, p_app: app });
  if (error) {
    console.error('[ai-credit] hold failed', provider, error.message);
    return null;
  }
  if (data !== true) return null;
  let settled = false;
  return async (actualMicros = 0) => {
    if (settled) return;
    settled = true;
    const { error: settleError } = await admin.rpc('settle_ai_credit', {
      p_provider: provider,
      p_held_micros: held,
      p_actual_micros: Math.max(0, Math.ceil(Number(actualMicros) || 0)),
      p_app: app,
    });
    if (settleError) console.error('[ai-credit] settle failed', provider, settleError.message);
  };
}

// OpenAI's newer models take max_completion_tokens (max_tokens is refused)
// and some only take the default temperature. Shape the body for the host.
export function chatBodyFor(provider, body) {
  if (provider !== 'openai' || body.max_tokens == null) return body;
  const { max_tokens: maxTokens, ...rest } = body;
  return { ...rest, max_completion_tokens: maxTokens };
}

// A 400 that says this model won't take a temperature: send again without it.
export function refusesTemperature(status, text) {
  return status === 400 && /temperature/i.test(String(text || '')) && /unsupported|not support|only the default/i.test(String(text || ''));
}
