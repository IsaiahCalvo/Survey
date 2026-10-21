// One Survey agent turn (KAL-527): send the conversation to the survey-agent
// edge function, run each tool it asks for in the app, send the results back,
// until the model answers in words. The model call happens on the server (it
// holds the key and the cap); the tools run here, on the open document.
import { SURVEY_AGENT_LIMITS } from '../../supabase/functions/_shared/surveyAgentSpec.js';

const ERROR_TEXT = {
  sign_in_required: 'Sign in to use the Survey agent.',
  not_enabled_for_you: 'The Survey agent is not turned on for your account yet.',
  not_set_up: 'The Survey agent is not set up on the server yet.',
  monthly_cap_reached: 'You reached this month\'s Survey agent limit.',
  offline: 'No signal. It will send when you are back online.',
  busy_try_again: 'The agent is busy. Try again in a moment.',
  conversation_too_long: 'This chat is too long. Start a new one.',
  bad_message: 'This chat could not continue, so it starts fresh. Say that again.',
  bad_message_order: 'This chat could not continue, so it starts fresh. Say that again.',
};

export function surveyAgentErrorText(code) {
  return ERROR_TEXT[code] || 'The Survey agent could not answer. Check your connection and try again.';
}

export class SurveyAgentError extends Error {
  constructor(code, { retryAfter = null } = {}) {
    super(surveyAgentErrorText(code));
    this.code = code;
    this.retryAfter = retryAfter;
  }
}

const CALL_TIMEOUT_MS = { status: 15_000, turn: 45_000, transcribe: 30_000, speak: 20_000 };

const isOffline = () => typeof navigator !== 'undefined' && navigator.onLine === false;

// Calls the edge function through supabase-js (it adds the person's JWT).
// Each reply may carry usage_left, which onUsage receives.
export function makeSurveyAgentCaller(supabase, { onUsage } = {}) {
  return async (payload) => {
    // No Supabase config (offline builds, local test runs): nothing to call.
    if (!supabase?.functions) throw new SurveyAgentError('not_set_up');
    if (isOffline()) throw new SurveyAgentError('offline');
    // A weak signal can leave a call hanging; give up so the message waits.
    const timeout = CALL_TIMEOUT_MS[payload?.action] || CALL_TIMEOUT_MS.turn;
    const { data, error } = await supabase.functions.invoke('survey-agent', { body: payload, timeout });
    if (error) {
      let body = null;
      try { body = await error.context?.json?.(); } catch { /* not JSON */ }
      if (body?.usage_left) onUsage?.(body.usage_left);
      // A reply with no error code is the server failing, not the signal.
      const answered = typeof error.context?.status === 'number';
      throw new SurveyAgentError(body?.error || (answered ? 'server_error' : isOffline() ? 'offline' : 'network'), { retryAfter: body?.retry_after ?? null });
    }
    if (data?.usage_left) onUsage?.(data.usage_left);
    return data;
  };
}

// Errors worth trying again by themselves: a dropped connection or a busy
// model. Each call is one model step with no writes on the server, so a
// repeat cannot double anything.
const TRANSIENT = new Set(['network', 'server_error', 'busy_try_again', 'model_unavailable', 'transcription_failed']);

/** The same caller, trying a dropped or busy call again a few times. */
export function withRetries(call, { delays = [1000, 3000], wait = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  return async (payload) => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await call(payload);
      } catch (err) {
        if (!TRANSIENT.has(err?.code) || attempt >= delays.length || isOffline()) throw err;
        const hinted = Number(err.retryAfter) > 0 ? Math.min(Number(err.retryAfter) * 1000, 10_000) : 0;
        await wait(Math.max(delays[attempt], hinted));
      }
    }
  };
}

/**
 * What to tell the person about this month's allowance: null while plenty is
 * left, a warning near the end, or the stop text once it is used up.
 */
export function usageWarning(left) {
  if (!left) return null;
  const requests = Number(left.requests);
  const share = Number(left.cost_share);
  if ((Number.isFinite(requests) && requests <= 0) || (Number.isFinite(share) && share <= 0)) {
    return surveyAgentErrorText('monthly_cap_reached');
  }
  if ((Number.isFinite(requests) && requests <= 100) || (Number.isFinite(share) && share <= 0.1)) {
    const n = Number.isFinite(requests) ? requests : null;
    return n != null && (!Number.isFinite(share) || share > 0.1)
      ? `Almost at this month's Survey agent limit: about ${n} requests left.`
      : 'Almost at this month\'s Survey agent limit.';
  }
  return null;
}

const yieldToApp = () => new Promise((resolve) => setTimeout(resolve, 0));

const parseArgs = (raw) => {
  if (raw && typeof raw === 'object') return raw;
  try { return JSON.parse(raw || '{}'); } catch { return null; }
};

const sizeOf = (messages) => messages.reduce((n, m) => n + JSON.stringify(m).length, 0);

/**
 * A long chat, cut down by whole turns from the oldest. Groq does not count
 * a prompt prefix it has seen (the rules, the tools, the chat so far) against
 * the free caps, so a growing chat costs only its new part per call. The cut
 * is rare and large, so the prefix stays the same between cuts.
 */
export function compactHistory(history, { maxMessages = 60, maxChars = 60_000 } = {}) {
  if (history.length <= maxMessages && sizeOf(history) <= maxChars) return history;
  const starts = history.map((m, i) => (m.role === 'user' ? i : -1)).filter((i) => i > 0);
  for (const start of starts) {
    const rest = history.slice(start);
    if (rest.length <= maxMessages / 2 && sizeOf(rest) <= maxChars / 2) return rest;
  }
  return starts.length ? history.slice(starts[starts.length - 1]) : [];
}

/**
 * history: the conversation so far (OpenAI chat shape: user, assistant with
 * tool_calls, tool), not changed on error. Returns { history, reply, changes }
 * where changes are the writes this turn made, oldest first.
 */
export async function runSurveyAgentTurn({ history = [], userText, call, toolbox, answerValues, annotations = false, lang = 'en', maxSteps = SURVEY_AGENT_LIMITS.maxToolSteps }) {
  const messages = [...compactHistory(history), { role: 'user', content: userText }];
  const changes = [];
  // A summary a tool made this turn ({ title, text }), for the person to save.
  let summary = null;
  for (let step = 0; step < maxSteps; step += 1) {
    let response;
    try {
      response = await call({ action: 'turn', messages, answer_values: answerValues, ...(annotations ? { annotations: true } : {}), ...(lang && lang !== 'en' ? { lang } : {}) });
    } catch (err) {
      // The caller keeps its old history; it still needs this turn's writes for Undo.
      err.changes = changes;
      throw err;
    }
    const reply = String(response?.message?.content || '').trim();
    const calls = (Array.isArray(response?.message?.tool_calls) ? response.message.tool_calls : [])
      .filter((c) => c?.id && c?.function?.name);
    if (!calls.length) {
      messages.push({ role: 'assistant', content: reply || '(no reply)' });
      return { history: messages, reply: reply || (changes.length ? 'Done.' : 'I did not change anything.'), changes, summary };
    }
    messages.push({
      role: 'assistant',
      content: reply || null,
      tool_calls: calls.map((c) => ({
        id: c.id,
        type: 'function',
        function: {
          name: c.function.name,
          arguments: typeof c.function.arguments === 'string' ? c.function.arguments : JSON.stringify(c.function.arguments || {}),
        },
      })),
    });
    for (const c of calls) {
      const args = parseArgs(c.function.arguments);
      const result = args
        ? await toolbox.run(c.function.name, args)
        : { content: 'The tool input was not valid JSON. Try again.', isError: true };
      if (result.change) changes.push(result.change);
      if (result.changes) changes.push(...result.changes);
      if (result.summary) summary = result.summary;
      messages.push({ role: 'tool', tool_call_id: c.id, content: result.isError ? `Error: ${result.content}` : result.content });
      // Let the panel re-render so the next tool reads the new state.
      await yieldToApp();
    }
  }
  // Too many steps: close the turn so the conversation stays valid.
  messages.push({ role: 'assistant', content: 'I stopped there; that took too many steps.' });
  return { history: messages, reply: 'I stopped there; that took too many steps. Check what I changed below.', changes, summary };
}
