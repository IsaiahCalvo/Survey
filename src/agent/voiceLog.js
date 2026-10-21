// What happened in the last few spoken turns, with times, so a person can
// send it when hearing goes wrong ("Send voice log") and we can see where the
// time went: the tap, the mic starting, speech start and end, the clip, what
// speech to text heard, each model call and tool, the reply being spoken.
// Never the audio, and never keys or tokens: every value is scrubbed and cut.

const SECRET_KEY = /key|token|secret|authorization|password|cookie|audio|base64/i;
const MAX_TEXT = 300;
const MAX_ARGS = 400;

/** A copy of value safe to send: no secret-looking keys, strings cut short. */
export function scrubLogValue(value, depth = 0) {
  if (value == null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.length > MAX_TEXT ? `${value.slice(0, MAX_TEXT)}…` : value;
  if (depth > 4) return '[deep]';
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => scrubLogValue(v, depth + 1));
  if (typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (SECRET_KEY.test(k)) continue;
      out[k] = scrubLogValue(v, depth + 1);
    }
    return out;
  }
  return String(value);
}

const clock = () => (globalThis.performance?.now ? globalThis.performance.now() : Date.now());

/**
 * The timeline. tap() starts a hands-free session (times count from it),
 * turn() starts a new spoken turn, event() adds to the current one. Only the
 * last maxTurns turns are kept. onError runs once per session, on the first
 * error(), so a failing walk sends its own log.
 */
export function createVoiceLog({ maxTurns = 20, maxEventsPerTurn = 60, now = clock, wall = () => Date.now(), onError = null } = {}) {
  let origin = null;
  let startedAt = null;
  let turns = [];
  let errorSent = false;

  const current = () => {
    if (!turns.length) turns.push({ n: 0, events: [] });
    return turns[turns.length - 1];
  };
  const add = (type, data) => {
    if (origin == null) { origin = now(); startedAt = wall(); }
    const turn = current();
    if (turn.events.length >= maxEventsPerTurn) { turn.dropped = (turn.dropped || 0) + 1; return; }
    turn.events.push({ t: Math.round(now() - origin), type, ...(data === undefined ? {} : { data: scrubLogValue(data) }) });
  };

  return {
    tap(type = 'tap', data) {
      origin = now();
      startedAt = wall();
      errorSent = false;
      this.turn(type, data);
    },
    turn(type, data) {
      const n = turns.length ? turns[turns.length - 1].n + 1 : 1;
      turns.push({ n, events: [] });
      if (turns.length > maxTurns) turns = turns.slice(-maxTurns);
      add(type, data);
    },
    event(type, data) { add(type, data); },
    error(type, data) {
      add(type, data);
      if (!errorSent && onError) {
        errorSent = true;
        try { onError(type); } catch { /* sending is best effort */ }
      }
    },
    isEmpty() { return !turns.some((t) => t.events.length); },
    snapshot() {
      return { started_at: startedAt ? new Date(startedAt).toISOString() : null, turns: turns.filter((t) => t.events.length).map((t) => ({ ...t, events: [...t.events] })) };
    },
    clear() { turns = []; origin = null; startedAt = null; },
  };
}

const MODEL_ERRORS = new Set(['transcription_failed', 'model_unavailable', 'server_error', 'busy_try_again']);

const trimArgs = (raw) => {
  const text = typeof raw === 'string' ? raw : JSON.stringify(raw || {});
  return text.length > MAX_ARGS ? `${text.slice(0, MAX_ARGS)}…` : text;
};

/**
 * The agent's server caller, with each call timed into the log: speech to
 * text (what it heard), model steps (tool calls and reply) and speech.
 * getLog() returns the log or null.
 */
export function loggedCaller(call, getLog) {
  return async (payload) => {
    const log = getLog?.();
    const action = payload?.action;
    if (!log || action === 'status') return call(payload);
    const started = clock();
    const ms = () => Math.round(clock() - started);
    if (action === 'transcribe') log.event('transcribe_sent', { duration_ms: payload.duration_ms, lang: payload.lang || 'en' });
    if (action === 'turn') log.event('model_sent', { messages: payload.messages?.length || 0 });
    if (action === 'speak') log.event('tts_sent', { chars: String(payload.text || '').length });
    try {
      const out = await call(payload);
      if (action === 'transcribe') log.event('transcribed', { ms: ms(), text: out?.text || '' });
      else if (action === 'turn') {
        const calls = Array.isArray(out?.message?.tool_calls) ? out.message.tool_calls : [];
        log.event('model_done', {
          ms: ms(),
          tools: calls.map((c) => ({ name: c?.function?.name, args: trimArgs(c?.function?.arguments) })),
          reply: out?.message?.content || '',
          finish: out?.finish_reason || null,
        });
      } else if (action === 'speak') log.event('tts_done', { ms: ms() });
      else log.event(`${action || 'call'}_done`, { ms: ms() });
      return out;
    } catch (err) {
      const data = { ms: ms(), action, code: err?.code || null, message: err?.message || null };
      if (MODEL_ERRORS.has(err?.code)) log.error('call_failed', data);
      else log.event('call_failed', data);
      throw err;
    }
  };
}

const MAX_LOG_BYTES = 200_000;

/** The platform line for a log: browser, phone app, screen. No ids. */
export function voiceLogPlatform({ nav = globalThis.navigator, win = globalThis.window } = {}) {
  const native = Boolean(win?.Capacitor?.isNativePlatform?.());
  return [native ? `app:${win.Capacitor.getPlatform?.() || 'native'}` : 'web', String(nav?.userAgent || '').slice(0, 200)].join(' ');
}

/**
 * Store the log (survey_agent_voice_logs, readable by the sender and the
 * team). Returns true when saved. A log too big is cut to its newest turns.
 */
export async function sendVoiceLog(supabase, log, { reason = 'manual', release = null, platform = voiceLogPlatform() } = {}) {
  if (!supabase?.from || !log || log.isEmpty()) return false;
  const snap = log.snapshot();
  while (snap.turns.length > 1 && JSON.stringify(snap).length > MAX_LOG_BYTES) snap.turns.shift();
  if (JSON.stringify(snap).length > MAX_LOG_BYTES) return false;
  const { error } = await supabase.from('survey_agent_voice_logs').insert({
    reason: reason === 'error' ? 'error' : 'manual',
    release: release ? String(release).slice(0, 64) : null,
    platform: String(platform || '').slice(0, 240),
    log: snap,
  });
  return !error;
}
