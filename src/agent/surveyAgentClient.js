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
  busy_try_again: 'The agent is busy. Try again in a moment.',
  conversation_too_long: 'This chat is too long. Start a new one.',
  bad_message: 'This chat could not continue, so it starts fresh. Say that again.',
  bad_message_order: 'This chat could not continue, so it starts fresh. Say that again.',
};

export function surveyAgentErrorText(code) {
  return ERROR_TEXT[code] || 'The Survey agent could not answer. Check your connection and try again.';
}

export class SurveyAgentError extends Error {
  constructor(code) {
    super(surveyAgentErrorText(code));
    this.code = code;
  }
}

// Calls the edge function through supabase-js (it adds the person's JWT).
export function makeSurveyAgentCaller(supabase) {
  return async (payload) => {
    // No Supabase config (offline builds, local test runs): nothing to call.
    if (!supabase?.functions) throw new SurveyAgentError('not_set_up');
    const { data, error } = await supabase.functions.invoke('survey-agent', { body: payload });
    if (error) {
      let code = null;
      try { code = (await error.context?.json?.())?.error || null; } catch { /* not JSON */ }
      throw new SurveyAgentError(code || 'network');
    }
    return data;
  };
}

const yieldToApp = () => new Promise((resolve) => setTimeout(resolve, 0));

const parseArgs = (raw) => {
  if (raw && typeof raw === 'object') return raw;
  try { return JSON.parse(raw || '{}'); } catch { return null; }
};

/**
 * history: the conversation so far (OpenAI chat shape: user, assistant with
 * tool_calls, tool), not changed on error. Returns { history, reply, changes }
 * where changes are the writes this turn made, oldest first.
 */
export async function runSurveyAgentTurn({ history = [], userText, call, toolbox, answerValues, maxSteps = SURVEY_AGENT_LIMITS.maxToolSteps }) {
  const messages = [...history, { role: 'user', content: userText }];
  const changes = [];
  for (let step = 0; step < maxSteps; step += 1) {
    let response;
    try {
      response = await call({ action: 'turn', messages, answer_values: answerValues });
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
      return { history: messages, reply: reply || (changes.length ? 'Done.' : 'I did not change anything.'), changes };
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
      messages.push({ role: 'tool', tool_call_id: c.id, content: result.isError ? `Error: ${result.content}` : result.content });
      // Let the panel re-render so the next tool reads the new state.
      await yieldToApp();
    }
  }
  // Too many steps: close the turn so the conversation stays valid.
  messages.push({ role: 'assistant', content: 'I stopped there; that took too many steps.' });
  return { history: messages, reply: 'I stopped there; that took too many steps. Check what I changed below.', changes };
}
