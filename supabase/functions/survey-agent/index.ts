// survey-agent (KAL-527): the Survey agent's model call. The app sends the
// conversation; this function checks who is asking (signed in, on the tester
// list or a paid plan once opened up, under the monthly caps), calls the
// model with the Survey tools, records the use and returns the model's reply.
// The tools themselves run in the app on the open document, with the same
// writes a tap makes, so this function never touches survey data.
//
// The model is any OpenAI-style chat completions API (owner 2026-10-20: a
// free model while testing, no Anthropic). Secrets:
//   GROQ_API_KEY: free Groq tier, used for the model and for Whisper speech
//     to text unless the SURVEY_AGENT_* values below say otherwise.
//   GROQ_BASE_URL: test only; sends Groq calls to a fake (E2E stack).
//   SURVEY_AGENT_BASE_URL / SURVEY_AGENT_API_KEY / SURVEY_AGENT_MODEL: any
//     other provider (Cloudflare Workers AI, OpenRouter, a paid model later).
//   SURVEY_AGENT_PRICE_IN / SURVEY_AGENT_PRICE_OUT: USD per million tokens
//     (default 0, free tier). SURVEY_AGENT_MONTHLY_CAP_USD (default 5) and
//     SURVEY_AGENT_MONTHLY_REQUEST_CAP (default 3000) per person.
//   SURVEY_AGENT_TESTERS: comma-separated emails allowed in while testing.
//   SURVEY_AGENT_OPEN: 'true' also lets in paid plans.
//   OPENAI_API_KEY: speech to text when there is no Groq key, or first when
//     SURVEY_AGENT_STT is 'openai'.
//   Paid calls (OpenAI, Anthropic, any host but Groq) also spend the suite's
//   shared monthly AI credit budget (_shared/aiCredit.js): each holds its
//   most possible cost first and is refused with 'credit_used_up' once the
//   provider's monthly cap (public.ai_credit_budgets) would be passed.
//   SURVEY_AGENT_TTS: 'off' turns the server voice off (the app then uses
//     the device's own voice). SURVEY_AGENT_TTS_MODEL / _VOICE pick the
//     voice (Groq Orpheus by default); SURVEY_AGENT_TTS_PRICE is USD per
//     million characters (default 0, free tier; Orpheus lists 22).
//   SURVEY_AGENT_FALLBACK_MODELS: comma list of models to move to when the
//     main one is near or past its daily cap ('' turns it off). On the
//     default Groq provider it defaults to the free models in
//     surveyAgentModels.js.
// Actions: status | turn | transcribe | speak.
import { createClient } from 'npm:@supabase/supabase-js@2.110.8';
import {
  SURVEY_AGENT_DEFAULT_PROVIDER,
  SURVEY_AGENT_LANGUAGES,
  SURVEY_AGENT_LIMITS,
  SURVEY_AGENT_NOTE_STYLES,
  SURVEY_AGENT_PHOTO_LIMITS,
  SURVEY_AGENT_PROMPT_VERSION,
  SURVEY_AGENT_FEEDBACK_EVENTS,
  surveyAgentPhotoMessages,
  surveyAgentCappedTokens,
  surveyAgentSystemMessages,
  buildSurveyAgentTools,
  markupOpenInTurn,
  sanitizeAgentMessages,
  surveyAgentCostMicros,
} from '../_shared/surveyAgentSpec.js';
import { parseBody, s } from '../_shared/inputSchema.js';
import { ANNOTATION_AGENT_FLAG } from '../_shared/annotationAgentSpec.js';
import {
  createModelRest,
  isRejectedToolCall,
  modelChain,
  restAfterRefusal,
  restWhenNearCap,
} from '../_shared/surveyAgentModels.js';
import { GUEST_REFUSED_MESSAGE, isGuestUser } from '../_shared/guestSession.js';
import { chatBodyFor, chatHoldMicros, creditProviderFor, holdCredit, refusesTemperature } from '../_shared/aiCredit.js';

const corsHeaders = {
  // INTENTIONAL: web, Electron (file://) and Capacitor all call this with a
  // Bearer token, never cookies. See CLAUDE.md CORS invariant.
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (status: number, body: Record<string, unknown>) => new Response(JSON.stringify(body), {
  status,
  headers: { ...corsHeaders, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
});

const MAX_AUDIO_BYTES = 4 * 1024 * 1024;
const AUDIO_TYPES = new Set(['audio/webm', 'audio/mp4', 'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/x-m4a', 'audio/aac']);

function testers(): Set<string> {
  return new Set((Deno.env.get('SURVEY_AGENT_TESTERS') || '')
    .split(',').map((s) => s.trim().toLowerCase()).filter(Boolean));
}

const envNumber = (name: string, fallback: number) => {
  const raw = Deno.env.get(name);
  if (raw == null || raw.trim() === '') return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
};

function capMicros() {
  return Math.round(envNumber('SURVEY_AGENT_MONTHLY_CAP_USD', 5) * 1_000_000);
}

// GROQ_BASE_URL points every Groq call (chat, hearing, voice) somewhere
// else; only the signed-in E2E stack sets it, to a fake Groq on the host.
function groqBase() {
  return (Deno.env.get('GROQ_BASE_URL') || SURVEY_AGENT_DEFAULT_PROVIDER.baseUrl).replace(/\/$/, '');
}

function modelProvider() {
  const key = Deno.env.get('SURVEY_AGENT_API_KEY') || Deno.env.get('GROQ_API_KEY');
  if (!key) return null;
  const custom = Boolean(Deno.env.get('SURVEY_AGENT_API_KEY'));
  const baseUrl = (Deno.env.get('SURVEY_AGENT_BASE_URL') || (custom ? '' : groqBase())).replace(/\/$/, '');
  const model = Deno.env.get('SURVEY_AGENT_MODEL') || SURVEY_AGENT_DEFAULT_PROVIDER.model;
  return {
    key,
    baseUrl,
    model,
    models: modelChain(model, {
      fallbackEnv: Deno.env.get('SURVEY_AGENT_FALLBACK_MODELS') ?? null,
      groqDefault: baseUrl === groqBase(),
    }),
    prices: { input: envNumber('SURVEY_AGENT_PRICE_IN', 0), output: envNumber('SURVEY_AGENT_PRICE_OUT', 0) },
  };
}

// KAL-532: the model that looks at a photo (action 'look'). Groq's free
// Llama 4 Scout takes images; SURVEY_AGENT_VISION_MODEL picks another, or
// 'off'. With a custom provider there is no default: set it by hand.
const DEFAULT_VISION_MODEL = 'meta-llama/llama-4-scout-17b-16e-instruct';
const PHOTO_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);
function visionModel() {
  const named = Deno.env.get('SURVEY_AGENT_VISION_MODEL') || '';
  if (named === 'off') return null;
  const provider = modelProvider();
  if (!provider?.baseUrl) return null;
  const model = named || (Deno.env.get('SURVEY_AGENT_API_KEY') ? '' : DEFAULT_VISION_MODEL);
  if (!model) return null;
  return {
    ...provider,
    model,
    prices: { input: envNumber('SURVEY_AGENT_VISION_PRICE_IN', 0), output: envNumber('SURVEY_AGENT_VISION_PRICE_OUT', 0) },
  };
}

// How long to wait for the main model's per-minute cap before moving on.
const MAIN_MODEL_WAIT_MS = 8000;
const MODEL_GONE_REST_MS = 24 * 60 * 60 * 1000;
// Models resting after hitting (or nearly hitting) a cap, per instance.
const modelRest = createModelRest();

function transcriber() {
  const groq = Deno.env.get('GROQ_API_KEY');
  const openai = Deno.env.get('OPENAI_API_KEY');
  const viaOpenai = openai
    ? { url: 'https://api.openai.com/v1/audio/transcriptions', key: openai, model: Deno.env.get('SURVEY_AGENT_STT_MODEL') || 'gpt-4o-mini-transcribe', microsPerSecond: 50 }
    : null;
  if (viaOpenai && Deno.env.get('SURVEY_AGENT_STT') === 'openai') return viaOpenai;
  if (groq) return { url: `${groqBase()}/audio/transcriptions`, key: groq, model: 'whisper-large-v3-turbo', microsPerSecond: 12 };
  return viaOpenai;
}

function speaker() {
  const groq = Deno.env.get('GROQ_API_KEY');
  if (!groq || Deno.env.get('SURVEY_AGENT_TTS') === 'off') return null;
  return {
    url: `${groqBase()}/audio/speech`,
    key: groq,
    model: Deno.env.get('SURVEY_AGENT_TTS_MODEL') || 'canopylabs/orpheus-v1-english',
    voice: Deno.env.get('SURVEY_AGENT_TTS_VOICE') || 'hannah',
    microsPerChar: envNumber('SURVEY_AGENT_TTS_PRICE', 0),
  };
}

// Orpheus takes at most 200 characters; cut at a word.
const MAX_SPEECH_CHARS = 200;
function speechText(value: unknown): string {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  if (text.length <= MAX_SPEECH_CHARS) return text;
  return text.slice(0, MAX_SPEECH_CHARS).replace(/\s+\S*$/, '');
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

function decodeBase64(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' });

  const raw = await req.text();
  if (raw.length > SURVEY_AGENT_LIMITS.maxRequestBytes + MAX_AUDIO_BYTES * 1.4) return json(413, { error: 'too_large' });
  let parsedJson: unknown = {};
  try { parsedJson = JSON.parse(raw || '{}'); } catch { return json(400, { error: 'bad_json' }); }
  // Types and sizes; sanitizeAgentMessages / buildSurveyAgentTools check the insides.
  const parsed = parseBody({
    action: s.enum(['status', 'transcribe', 'turn', 'speak', 'look', 'feedback']),
    text: s.string({ max: 1000, optional: true }),
    mime: s.string({ max: 200, optional: true }),
    audio: s.string({ max: Math.ceil(MAX_AUDIO_BYTES * 1.4), optional: true }),
    hints: s.array(s.any({ maxBytes: 2048 }), { max: 200, optional: true }),
    duration_ms: s.any({ maxBytes: 64 }),
    messages: s.array(s.any({ maxBytes: SURVEY_AGENT_LIMITS.maxRequestBytes }), { max: SURVEY_AGENT_LIMITS.maxMessages * 2, optional: true }),
    answer_values: s.any({ maxBytes: SURVEY_AGENT_LIMITS.maxRequestBytes }),
    annotations: s.boolean({ optional: true }),
    typed_lines: s.boolean({ optional: true }),
    lang: s.enum([...SURVEY_AGENT_LANGUAGES], { optional: true }),
    offers: s.boolean({ optional: true }),
    photos: s.boolean({ optional: true }),
    event: s.enum([...SURVEY_AGENT_FEEDBACK_EVENTS], { optional: true }),
    prompt_version: s.string({ max: 32, optional: true }),
    image: s.string({ max: Math.ceil(SURVEY_AGENT_PHOTO_LIMITS.maxImageBytes * 1.4), optional: true }),
    question: s.string({ max: SURVEY_AGENT_PHOTO_LIMITS.maxQuestionChars, optional: true }),
    note_style: s.enum([...SURVEY_AGENT_NOTE_STYLES], { optional: true }),
  }, parsedJson);
  if (!parsed.ok) return json(400, { error: 'bad_request', detail: parsed.error });
  const body: Record<string, unknown> = parsed.value;
  const action = String(body.action || '');

  // Who is asking: a signed-in person (their own Supabase JWT).
  const token = (req.headers.get('Authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return json(401, { error: 'sign_in_required' });
  const admin = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    { auth: { persistSession: false } },
  );
  const { data: userData, error: userError } = await admin.auth.getUser(token);
  const user = userData?.user;
  if (userError || !user) return json(401, { error: 'sign_in_required' });
  if (isGuestUser(user)) return json(403, { error: 'guest_not_allowed', message: GUEST_REFUSED_MESSAGE });

  const email = (user.email || '').toLowerCase();
  let allowed = Boolean(email) && testers().has(email);
  if (!allowed && Deno.env.get('SURVEY_AGENT_OPEN') === 'true') {
    const { data: sub } = await admin.from('user_subscriptions')
      .select('tier, status').eq('user_id', user.id).maybeSingle();
    allowed = Boolean(sub && ['active', 'trialing'].includes(sub.status) && sub.tier && sub.tier !== 'free');
  }

  const month = new Date().toISOString().slice(0, 7) + '-01';
  const { data: usage } = await admin.from('survey_agent_usage')
    .select('cost_micros, requests').eq('user_id', user.id).eq('month', month).maybeSingle();
  const requestCap = envNumber('SURVEY_AGENT_MONTHLY_REQUEST_CAP', 3000);
  const overCap = Number(usage?.cost_micros || 0) >= capMicros()
    || Number(usage?.requests || 0) >= requestCap;
  // What is left this month after `used` more requests, so the app can warn
  // before the cap instead of stopping mid-walk.
  const usageLeft = (used = 0) => ({
    requests: Math.max(0, Math.floor(requestCap - Number(usage?.requests || 0) - used)),
    cost_share: capMicros() > 0 ? Math.max(0, 1 - Number(usage?.cost_micros || 0) / capMicros()) : 0,
  });
  const provider = modelProvider();
  const modelReady = Boolean(provider?.baseUrl);

  if (action === 'status') {
    return json(200, {
      enabled: allowed && modelReady,
      reason: !allowed ? 'not_enabled_for_you' : !modelReady ? 'not_set_up' : overCap ? 'monthly_cap_reached' : null,
      transcription: Boolean(transcriber()),
      speech: Boolean(speaker()),
      photos: Boolean(visionModel()),
      over_cap: overCap,
      usage_left: allowed ? usageLeft() : null,
    });
  }
  if (!allowed) return json(403, { error: 'not_enabled_for_you' });
  if (overCap) return json(429, { error: 'monthly_cap_reached', usage_left: usageLeft() });

  // Count this request before any paid call, atomically under both caps, so
  // parallel requests cannot all pass the read above. The cost cap can still
  // be passed by the requests already in flight when it is reached.
  const reserve = async () => {
    const { data, error } = await admin.rpc('reserve_survey_agent_request', {
      p_user_id: user.id,
      p_request_cap: Math.floor(envNumber('SURVEY_AGENT_MONTHLY_REQUEST_CAP', 3000)),
      p_cost_cap_micros: capMicros(),
    });
    if (error) console.error('[survey-agent] reserve failed', error.message);
    return data === true;
  };
  // A refused reservation is either the monthly cap or the per-minute burst
  // limit (reserve_survey_agent_request); read the row again to tell which.
  const refused = async () => {
    const { data: now } = await admin.from('survey_agent_usage')
      .select('cost_micros, requests').eq('user_id', user.id).eq('month', month).maybeSingle();
    const monthly = Number(now?.cost_micros || 0) >= capMicros()
      || Number(now?.requests || 0) >= envNumber('SURVEY_AGENT_MONTHLY_REQUEST_CAP', 3000);
    // The per-minute limit clears within a minute: the app waits and sends again.
    return monthly
      ? json(429, { error: 'monthly_cap_reached', usage_left: usageLeft() })
      : json(429, { error: 'busy_try_again', retry_after: 20 });
  };

  // Groq's free caps are per model per day across everyone; the hourly alert
  // job reads these counts (survey_agent_daily_usage). A failed count never
  // fails the request.
  // With each count, what the call would cost at paid prices: the day's spend.
  const countDaily = async (kind: string, tokens: number, audioSeconds = 0, costMicros = 0) => {
    const { error } = await admin.rpc('record_survey_agent_daily', {
      p_kind: kind, p_tokens: Math.max(0, Math.round(tokens)), p_audio_seconds: audioSeconds,
      p_cost_micros: Math.max(0, Math.round(costMicros)),
    });
    if (error) console.warn('[survey-agent] daily count failed', error.message);
  };

  if (action === 'speak') {
    const v = speaker();
    if (!v) return json(501, { error: 'speech_not_set_up' });
    const input = speechText(body.text);
    if (!input) return json(400, { error: 'bad_request' });
    if (!(await reserve())) return refused();
    let res: Response;
    try {
      res = await fetch(v.url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${v.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: v.model, voice: v.voice, input, response_format: 'wav' }),
      });
    } catch (err) {
      console.error('[survey-agent] speech failed', err);
      return json(502, { error: 'speech_unavailable' });
    }
    // Orpheus's free tier allows only about 100 replies a day for everyone;
    // the app falls back to the device's voice for the rest of the session.
    if (res.status === 429) return json(429, { error: 'speech_limit_reached' });
    if (!res.ok) {
      // For example the model's terms not yet accepted on the Groq account.
      console.error('[survey-agent] speech error', res.status, (await res.text()).slice(0, 300));
      return json(502, { error: 'speech_unavailable' });
    }
    const audio = new Uint8Array(await res.arrayBuffer());
    const speakCost = Math.ceil(input.length * v.microsPerChar);
    await admin.rpc('record_survey_agent_usage', {
      p_user_id: user.id, p_input_tokens: 0, p_output_tokens: 0, p_cost_micros: speakCost,
    });
    await countDaily('speak', input.length, 0, speakCost);
    return json(200, { audio: encodeBase64(audio), mime: res.headers.get('content-type') || 'audio/wav', usage_left: usageLeft(1) });
  }

  if (action === 'transcribe') {
    const t = transcriber();
    if (!t) return json(501, { error: 'transcription_not_set_up' });
    const mime = String(body.mime || '').split(';')[0].trim().toLowerCase();
    if (!AUDIO_TYPES.has(mime)) return json(400, { error: 'unsupported_audio' });
    let bytes: Uint8Array<ArrayBuffer>;
    try { bytes = decodeBase64(String(body.audio || '')); } catch { return json(400, { error: 'bad_audio' }); }
    if (!bytes.length || bytes.length > MAX_AUDIO_BYTES) return json(413, { error: 'audio_too_large' });
    if (!(await reserve())) return refused();
    const hints = (Array.isArray(body.hints) ? body.hints : [])
      .filter((h) => typeof h === 'string').map((h) => h.slice(0, 40)).slice(0, 60).join(', ');
    const form = new FormData();
    const ext = mime.split('/')[1].replace('x-', '').replace('mpeg', 'mp3');
    form.append('file', new Blob([bytes], { type: mime }), `clip.${ext}`);
    form.append('model', t.model);
    form.append('response_format', 'json');
    form.append('temperature', '0');
    // A set language keeps Whisper from guessing (or translating) short clips.
    if (body.lang) form.append('language', String(body.lang));
    if (hints) {
      form.append('prompt', body.lang === 'es'
        ? `Inspección de obra. Palabras y nombres: ${hints}.`
        : `Construction site survey. Words and item names: ${hints}.`);
    }
    const seconds = Math.min(600, Math.max(1, Number(body.duration_ms || 0) / 1000 || bytes.length / 4000));
    const heardCost = Math.ceil(seconds * t.microsPerSecond);
    const settle = await holdCredit(admin, { provider: creditProviderFor(t.url), micros: heardCost, app: 'survey-agent' });
    if (!settle) return json(429, { error: 'credit_used_up' });
    let res: Response;
    try {
      res = await fetch(t.url, { method: 'POST', headers: { Authorization: `Bearer ${t.key}` }, body: form });
    } catch (err) {
      await settle(0);
      console.error('[survey-agent] transcription call failed', err);
      return json(502, { error: 'transcription_failed' });
    }
    if (!res.ok) await settle(0);
    if (res.status === 429) return json(429, { error: 'busy_try_again', retry_after: null });
    if (!res.ok) {
      console.error('[survey-agent] transcription failed', res.status, (await res.text()).slice(0, 300));
      return json(502, { error: 'transcription_failed' });
    }
    await settle(heardCost);
    const out = await res.json();
    await admin.rpc('record_survey_agent_usage', {
      p_user_id: user.id, p_input_tokens: 0, p_output_tokens: 0, p_cost_micros: heardCost,
    });
    await countDaily('transcribe', 0, seconds, heardCost);
    return json(200, { text: String(out?.text || '').trim(), usage_left: usageLeft(1) });
  }

  if (action === 'turn') {
    if (!provider?.baseUrl) return json(503, { error: 'not_set_up' });
    const clean = sanitizeAgentMessages(body.messages);
    if (clean.error) return json(400, { error: clean.error });
    if (!(await reserve())) return refused();
    // The markup tools, when the app has them and the annotation-agent flag
    // is on for this person (the same feature_flags row the app reads).
    let annotations = false;
    if (body.annotations === true) {
      const { data: flag } = await admin.from('feature_flags')
        .select('mode, tester_emails').eq('key', ANNOTATION_AGENT_FLAG).maybeSingle();
      annotations = flag?.mode === 'on'
        || (flag?.mode === 'testers' && Boolean(email) && (flag.tester_emails || []).includes(email));
    }
    const request = {
      messages: [...surveyAgentSystemMessages(body.lang, { noteStyle: body.note_style }), ...(clean.messages || [])],
      tools: buildSurveyAgentTools(body.answer_values, {
        annotations,
        markupOpen: markupOpenInTurn(clean.messages),
        typedLines: body.typed_lines === true,
        offers: body.offers === true,
        photos: body.photos === true && Boolean(visionModel()),
      }),
      tool_choice: 'auto',
      temperature: 0.2,
      max_tokens: SURVEY_AGENT_LIMITS.maxOutputTokens,
    };
    const credit = creditProviderFor(provider.baseUrl);
    const settle = await holdCredit(admin, {
      provider: credit,
      micros: chatHoldMicros({ promptChars: JSON.stringify(request).length, maxOutputTokens: request.max_tokens, prices: provider.prices }),
      app: 'survey-agent',
    });
    if (!settle) return json(429, { error: 'credit_used_up' });
    let spent = 0;
    try {
      let res: Response | null = null;
      const chain = modelRest.available(provider.models);
      let waited = false;
      let askedAgain = false;
      let droppedTemperature = false;
      for (let i = 0; i < chain.length; i += 1) {
        const model = chain[i];
        try {
          res = await fetch(`${provider.baseUrl}/chat/completions`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${provider.key}`, 'Content-Type': 'application/json' },
            body: JSON.stringify(chatBodyFor(credit, { model, ...request })),
          });
        } catch (err) {
          console.error('[survey-agent] model call failed', err);
          return json(502, { error: 'model_unavailable' });
        }
        if (!droppedTemperature && res.status === 400 && refusesTemperature(400, await res.clone().text())) {
          droppedTemperature = true;
          delete (request as { temperature?: number }).temperature;
          res = null;
          i -= 1;
          continue;
        }
        // A model the provider no longer has (or never had for this key):
        // leave it alone for a day and go on down the chain.
        if (res.status === 404 || (res.status === 400 && /model_not_found|decommissioned/.test(await res.clone().text()))) {
          modelRest.rest(model, MODEL_GONE_REST_MS);
          console.error('[survey-agent] model missing, resting a day', model);
          res = null;
          continue;
        }
        if (!askedAgain && isRejectedToolCall(res.status, res.status === 400 ? await res.clone().text() : '')) {
          askedAgain = true;
          console.info('[survey-agent] model sent a tool call that did not fit, asking again', model);
          res = null;
          i -= 1;
          continue;
        }
        if (res.status !== 429) {
          const nearCap = restWhenNearCap({
            remaining: res.headers.get('x-ratelimit-remaining-requests'),
            resetIn: res.headers.get('x-ratelimit-reset-requests'),
          });
          if (nearCap && provider.models.length > 1) {
            modelRest.rest(model, nearCap);
            console.info('[survey-agent] model near its daily cap, resting', model, Math.round(nearCap / 1000));
          }
          break;
        }
        const refusal = restAfterRefusal({ retryAfter: res.headers.get('retry-after'), message: await res.text() });
        res = null;
        // The main model's per-minute cap frees up in seconds: wait for it
        // once rather than hand the turn to a weaker model.
        if (i === 0 && !refusal.daily && !waited && refusal.ms <= MAIN_MODEL_WAIT_MS) {
          waited = true;
          console.info('[survey-agent] model busy for a moment, waiting', model, Math.round(refusal.ms / 1000));
          await new Promise((r) => setTimeout(r, refusal.ms + 250));
          i -= 1;
          continue;
        }
        // A cap on this model: rest it and try the next one in the same turn.
        modelRest.rest(model, refusal.ms);
        console.info('[survey-agent] model refused, moving on', model, refusal.daily ? 'daily' : 'per minute', Math.round(refusal.ms / 1000));
      }
      // Every model is resting: say how long until the first is free.
      if (!res) return json(429, { error: 'busy_try_again', retry_after: Math.min(modelRest.soonest(provider.models), 60) });
      if (!res.ok) {
        console.error('[survey-agent] model error', res.status, (await res.text()).slice(0, 500));
        return json(502, { error: 'model_unavailable' });
      }
      const out = await res.json();
      const choice = out?.choices?.[0] || {};
      const message = choice.message || {};
      const turnCost = surveyAgentCostMicros(out?.usage, provider.prices);
      spent = turnCost;
      await admin.rpc('record_survey_agent_usage', {
        p_user_id: user.id,
        p_input_tokens: Number(out?.usage?.prompt_tokens || 0),
        p_output_tokens: Number(out?.usage?.completion_tokens || 0),
        p_cost_micros: turnCost,
      });
      // What the call took from Groq's daily cap (a cached prompt prefix is free).
      await countDaily('turn', surveyAgentCappedTokens(out?.usage), 0, turnCost);
      return json(200, {
        message: {
          content: typeof message.content === 'string' ? message.content : '',
          tool_calls: Array.isArray(message.tool_calls) ? message.tool_calls : [],
        },
        finish_reason: choice.finish_reason || null,
        prompt_version: SURVEY_AGENT_PROMPT_VERSION,
        usage_left: usageLeft(1),
      });
    } finally {
      await settle(spent);
    }
  }

  // KAL-532 learning loop: a turn that changed something, or the person
  // taking one back. Counted per day and prompt version only, and only for
  // people who turned on "Help improve Survey". Costs no model call.
  if (action === 'feedback') {
    if (user.user_metadata?.improve_survey_opt_in?.on !== true) return json(200, { recorded: false });
    const version = String(body.prompt_version || '');
    if (!body.event || !/^[a-z0-9-]{1,32}$/.test(version)) return json(400, { error: 'bad_request' });
    const { error } = await admin.rpc('record_survey_agent_feedback', { p_prompt_version: version, p_event: body.event });
    if (error) console.warn('[survey-agent] feedback not recorded', error.message);
    return json(200, { recorded: !error });
  }

  if (action === 'look') {
    const v = visionModel();
    if (!v) return json(501, { error: 'photos_not_set_up' });
    const mime = String(body.mime || '').split(';')[0].trim().toLowerCase();
    if (!PHOTO_TYPES.has(mime)) return json(400, { error: 'unsupported_image' });
    const question = String(body.question || '').trim();
    if (!question) return json(400, { error: 'bad_request' });
    let bytes: Uint8Array<ArrayBuffer>;
    try { bytes = decodeBase64(String(body.image || '')); } catch { return json(400, { error: 'bad_image' }); }
    if (!bytes.length || bytes.length > SURVEY_AGENT_PHOTO_LIMITS.maxImageBytes) return json(413, { error: 'image_too_large' });
    if (!(await reserve())) return refused();
    const lookCredit = creditProviderFor(v.baseUrl);
    // A photo is billed by its tiles, not its bytes: hold for a large one.
    const settleLook = await holdCredit(admin, {
      provider: lookCredit,
      micros: chatHoldMicros({ promptChars: 4000 * 3.5, maxOutputTokens: SURVEY_AGENT_PHOTO_LIMITS.maxOutputTokens, prices: v.prices }),
      app: 'survey-agent',
    });
    if (!settleLook) return json(429, { error: 'credit_used_up' });
    let lookSpent = 0;
    try {
      let res: Response;
      try {
        res = await fetch(`${v.baseUrl}/chat/completions`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${v.key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify(chatBodyFor(lookCredit, {
            model: v.model,
            messages: surveyAgentPhotoMessages(question, `data:${mime};base64,${String(body.image)}`, body.lang),
            temperature: 0.1,
            max_tokens: SURVEY_AGENT_PHOTO_LIMITS.maxOutputTokens,
          })),
        });
      } catch (err) {
        console.error('[survey-agent] photo call failed', err);
        return json(502, { error: 'model_unavailable' });
      }
      if (res.status === 429) return json(429, { error: 'busy_try_again', retry_after: null });
      if (res.status === 404 || (res.status === 400 && /model_not_found|decommissioned/.test(await res.clone().text()))) {
        console.error('[survey-agent] vision model missing', v.model);
        return json(501, { error: 'photos_not_set_up' });
      }
      if (!res.ok) {
        console.error('[survey-agent] photo error', res.status, (await res.text()).slice(0, 300));
        return json(502, { error: 'model_unavailable' });
      }
      const out = await res.json();
      const lookCost = surveyAgentCostMicros(out?.usage, v.prices);
      lookSpent = lookCost;
      await admin.rpc('record_survey_agent_usage', {
        p_user_id: user.id,
        p_input_tokens: Number(out?.usage?.prompt_tokens || 0),
        p_output_tokens: Number(out?.usage?.completion_tokens || 0),
        p_cost_micros: lookCost,
      });
      await countDaily('look', surveyAgentCappedTokens(out?.usage), 0, lookCost);
      const answer = String(out?.choices?.[0]?.message?.content || '').trim();
      return json(200, { text: answer, usage_left: usageLeft(1) });
    } finally {
      await settleLook(lookSpent);
    }
  }

  return json(400, { error: 'unknown_action' });
});
