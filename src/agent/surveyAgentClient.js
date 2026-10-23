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

// Old turns kept as words only after a cut: what was said and answered.
const OLD_TURNS_KEPT = 10;

const turnsOf = (history) => {
  const turns = [];
  for (const m of history) {
    if (m.role === 'user' || !turns.length) turns.push([]);
    turns[turns.length - 1].push(m);
  }
  return turns;
};

// A turn as words: the person's message and the agent's final reply.
const wordsOf = (turn) => {
  const reply = [...turn].reverse().find((m) => m.role === 'assistant' && !m.tool_calls?.length && m.content);
  return turn[0]?.role === 'user' && reply ? [turn[0], reply] : null;
};

// The turn's get_survey_context call and result, kept so the agent does not
// fetch the survey again after a cut.
const contextOf = (turn) => {
  for (let i = turn.length - 1; i >= 0; i -= 1) {
    const call = turn[i].tool_calls?.find((c) => c.function?.name === 'get_survey_context');
    const result = call && turn.find((m) => m.role === 'tool' && m.tool_call_id === call.id);
    if (result) {
      const words = wordsOf(turn);
      return [turn[0], { role: 'assistant', content: null, tool_calls: [call] }, result, words ? words[1] : { role: 'assistant', content: 'Done.' }];
    }
  }
  return null;
};

/**
 * A long chat, cut down. Groq does not count a prompt prefix it has seen
 * (the rules, the tools, the chat so far) against the free caps, so a
 * growing chat costs only its new part per call; the cut is rare and large,
 * so the prefix stays the same between cuts. Recent turns stay whole; the
 * last few before them stay as words, plus the newest survey context.
 */
export function compactHistory(history, { maxMessages = 60, maxChars = 60_000 } = {}) {
  if (history.length <= maxMessages && sizeOf(history) <= maxChars) return history;
  const turns = turnsOf(history).filter((t) => t[0]?.role === 'user');
  let whole = 1;
  while (whole < turns.length) {
    const recent = turns.slice(-(whole + 1)).flat();
    if (recent.length > maxMessages / 2 || sizeOf(recent) > maxChars / 2) break;
    whole += 1;
  }
  const older = turns.slice(0, turns.length - whole);
  const ctxAt = older.findLastIndex((t) => contextOf(t));
  const kept = [];
  older.forEach((t, i) => {
    if (i === ctxAt) kept.push(contextOf(t));
    else if (i >= older.length - OLD_TURNS_KEPT) { const w = wordsOf(t); if (w) kept.push(w); }
  });
  const out = [...kept.flat(), ...turns.slice(-whole).flat()];
  return out.length <= maxMessages && sizeOf(out) <= maxChars ? out : turns.slice(-whole).flat();
}

const hasContext = (messages) => messages.some((m) => m.tool_calls?.some((c) => c.function?.name === 'get_survey_context'));

// A reply that says something was done or shown. Plain "I couldn't..." or
// "nothing changed" replies are not claims.
const CLAIMS_SHOWN = /\b(showing|shown|here it is|pulled (it )?up|took you|zoomed|on screen now)\b/i;
// First-person or leading verbs only ("Set it to...", "I've added..."), so a
// read-only answer ("D-117 is marked N") is not taken for a claim.
const CLAIMS_WRITE = /(?:^|[.!]\s+|\bI(?:'ve| have)?\s+(?:also\s+)?)(?:recorded|marked|set|added|noted|saved|updated|attached|logged|changed|cleared)\b/i;
// Not "not" alone: an entity can be "Not Started".
const DENIES = /\b(did not|didn't|could not|couldn't|cannot|can't|unable|nothing|no changes?|have not|haven't|was not|wasn't|not (?:find|found|sure|able))\b|\?\s*$/i;
const SHOW_TOOLS = new Set(['show_item', 'show_on_plan']);

/** What the reply claims that no tool did this turn: 'show', 'write' or null. */
export function unbackedClaim(reply, { shown = false, wrote = false } = {}) {
  const text = String(reply || '');
  if (!text || DENIES.test(text)) return null;
  if (!shown && CLAIMS_SHOWN.test(text)) return 'show';
  if (!wrote && CLAIMS_WRITE.test(text)) return 'write';
  return null;
}

const CLAIM_CHECK = {
  show: 'Check: your reply says you showed it, but no show tool ran this turn. Call show_item or show_on_plan now, or say plainly you did not show it.',
  write: 'Check: your reply says you recorded something, but nothing changed this turn. Call the tool now, or say plainly that nothing changed.',
};

/**
 * history: the conversation so far (OpenAI chat shape: user, assistant with
 * tool_calls, tool), not changed on error. Returns { history, reply, changes }
 * where changes are the writes this turn made, oldest first.
 */
export async function runSurveyAgentTurn({ history = [], userText, call, toolbox, answerValues, typedLines = false, annotations = false, lang = 'en', maxSteps = SURVEY_AGENT_LIMITS.maxToolSteps }) {
  const messages = [...compactHistory(history), { role: 'user', content: userText }];
  const changes = [];
  // A summary a tool made this turn ({ title, text }), for the person to save.
  let summary = null;
  // The survey context goes in up front, as if the model had asked for it:
  // that saves a whole model step (the full prompt again) on a new chat.
  if (!hasContext(messages)) {
    const ctx = await toolbox.run('get_survey_context', {});
    if (!ctx.isError) {
      const id = `ctx-${messages.length}`;
      messages.push(
        { role: 'assistant', content: null, tool_calls: [{ id, type: 'function', function: { name: 'get_survey_context', arguments: '{}' } }] },
        { role: 'tool', tool_call_id: id, content: ctx.content },
      );
    }
  }
  let shown = false;
  // A reply claiming what no tool did gets one check; it and the check are
  // left out of the history kept.
  let checked = null;
  for (let step = 0; step < maxSteps; step += 1) {
    let response;
    try {
      response = await call({ action: 'turn', messages, answer_values: answerValues, ...(typedLines ? { typed_lines: true } : {}), ...(annotations ? { annotations: true } : {}), ...(lang && lang !== 'en' ? { lang } : {}) });
    } catch (err) {
      // The caller keeps its old history; it still needs this turn's writes for Undo.
      err.changes = changes;
      throw err;
    }
    const reply = String(response?.message?.content || '').trim();
    const calls = (Array.isArray(response?.message?.tool_calls) ? response.message.tool_calls : [])
      .filter((c) => c?.id && c?.function?.name);
    if (!calls.length) {
      const claim = unbackedClaim(reply, { shown, wrote: changes.length > 0 });
      if (claim && !checked) {
        checked = messages.length;
        messages.push({ role: 'assistant', content: reply }, { role: 'user', content: CLAIM_CHECK[claim] });
        continue;
      }
      if (checked != null) messages.splice(checked, 2);
      // Still claiming after the check: say what is true instead.
      const said = !claim ? reply
        : claim === 'show' ? (changes.length ? 'Done, but I did not show it.' : 'I did not show it.')
          : 'I did not change anything.';
      messages.push({ role: 'assistant', content: said || '(no reply)' });
      return { history: messages, reply: said || (changes.length ? 'Done.' : 'I did not change anything.'), changes, summary };
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
      if (!result.isError && SHOW_TOOLS.has(c.function.name)) shown = true;
      if (result.change) changes.push(result.change);
      if (result.changes) changes.push(...result.changes);
      if (result.summary) summary = result.summary;
      messages.push({ role: 'tool', tool_call_id: c.id, content: result.isError ? `Error: ${result.content}` : result.content });
      // Let the panel re-render so the next tool reads the new state.
      await yieldToApp();
    }
  }
  // Too many steps: close the turn so the conversation stays valid.
  if (checked != null) messages.splice(checked, 2);
  messages.push({ role: 'assistant', content: 'I stopped there; that took too many steps.' });
  return { history: messages, reply: 'I stopped there; that took too many steps. Check what I changed below.', changes, summary };
}
