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
//   SURVEY_AGENT_BASE_URL / SURVEY_AGENT_API_KEY / SURVEY_AGENT_MODEL: any
//     other provider (Cloudflare Workers AI, OpenRouter, a paid model later).
//   SURVEY_AGENT_PRICE_IN / SURVEY_AGENT_PRICE_OUT: USD per million tokens
//     (default 0, free tier). SURVEY_AGENT_MONTHLY_CAP_USD (default 5) and
//     SURVEY_AGENT_MONTHLY_REQUEST_CAP (default 3000) per person.
//   SURVEY_AGENT_TESTERS: comma-separated emails allowed in while testing.
//   SURVEY_AGENT_OPEN: 'true' also lets in paid plans.
//   OPENAI_API_KEY: optional, speech to text when there is no Groq key.
// Actions: status | turn | transcribe.
import { createClient } from 'npm:@supabase/supabase-js@2.110.8';
import {
  SURVEY_AGENT_DEFAULT_PROVIDER,
  SURVEY_AGENT_LIMITS,
  SURVEY_AGENT_SYSTEM_PROMPT,
  buildSurveyAgentTools,
  sanitizeAgentMessages,
  surveyAgentCostMicros,
} from '../_shared/surveyAgentSpec.js';

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

function modelProvider() {
  const key = Deno.env.get('SURVEY_AGENT_API_KEY') || Deno.env.get('GROQ_API_KEY');
  if (!key) return null;
  const custom = Boolean(Deno.env.get('SURVEY_AGENT_API_KEY'));
  return {
    key,
    baseUrl: (Deno.env.get('SURVEY_AGENT_BASE_URL') || (custom ? '' : SURVEY_AGENT_DEFAULT_PROVIDER.baseUrl)).replace(/\/$/, ''),
    model: Deno.env.get('SURVEY_AGENT_MODEL') || SURVEY_AGENT_DEFAULT_PROVIDER.model,
    prices: { input: envNumber('SURVEY_AGENT_PRICE_IN', 0), output: envNumber('SURVEY_AGENT_PRICE_OUT', 0) },
  };
}

function transcriber() {
  const groq = Deno.env.get('GROQ_API_KEY');
  if (groq) return { url: 'https://api.groq.com/openai/v1/audio/transcriptions', key: groq, model: 'whisper-large-v3-turbo', microsPerSecond: 12 };
  const openai = Deno.env.get('OPENAI_API_KEY');
  if (openai) return { url: 'https://api.openai.com/v1/audio/transcriptions', key: openai, model: 'gpt-4o-mini-transcribe', microsPerSecond: 50 };
  return null;
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
  let body: Record<string, unknown> = {};
  try { body = JSON.parse(raw || '{}'); } catch { return json(400, { error: 'bad_json' }); }
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
  const overCap = Number(usage?.cost_micros || 0) >= capMicros()
    || Number(usage?.requests || 0) >= envNumber('SURVEY_AGENT_MONTHLY_REQUEST_CAP', 3000);
  const provider = modelProvider();
  const modelReady = Boolean(provider?.baseUrl);

  if (action === 'status') {
    return json(200, {
      enabled: allowed && modelReady,
      reason: !allowed ? 'not_enabled_for_you' : !modelReady ? 'not_set_up' : overCap ? 'monthly_cap_reached' : null,
      transcription: Boolean(transcriber()),
      over_cap: overCap,
    });
  }
  if (!allowed) return json(403, { error: 'not_enabled_for_you' });
  if (overCap) return json(429, { error: 'monthly_cap_reached' });

  if (action === 'transcribe') {
    const t = transcriber();
    if (!t) return json(501, { error: 'transcription_not_set_up' });
    const mime = String(body.mime || '').split(';')[0].trim().toLowerCase();
    if (!AUDIO_TYPES.has(mime)) return json(400, { error: 'unsupported_audio' });
    let bytes: Uint8Array<ArrayBuffer>;
    try { bytes = decodeBase64(String(body.audio || '')); } catch { return json(400, { error: 'bad_audio' }); }
    if (!bytes.length || bytes.length > MAX_AUDIO_BYTES) return json(413, { error: 'audio_too_large' });
    const hints = (Array.isArray(body.hints) ? body.hints : [])
      .filter((h) => typeof h === 'string').map((h) => h.slice(0, 40)).slice(0, 60).join(', ');
    const form = new FormData();
    const ext = mime.split('/')[1].replace('x-', '').replace('mpeg', 'mp3');
    form.append('file', new Blob([bytes], { type: mime }), `clip.${ext}`);
    form.append('model', t.model);
    form.append('response_format', 'json');
    if (hints) form.append('prompt', `Construction site survey. Names: ${hints}.`);
    const res = await fetch(t.url, { method: 'POST', headers: { Authorization: `Bearer ${t.key}` }, body: form });
    if (!res.ok) {
      console.error('[survey-agent] transcription failed', res.status, (await res.text()).slice(0, 300));
      return json(502, { error: 'transcription_failed' });
    }
    const out = await res.json();
    const seconds = Math.min(600, Math.max(1, Number(body.duration_ms || 0) / 1000 || bytes.length / 4000));
    await admin.rpc('record_survey_agent_usage', {
      p_user_id: user.id, p_input_tokens: 0, p_output_tokens: 0, p_cost_micros: Math.ceil(seconds * t.microsPerSecond),
    });
    return json(200, { text: String(out?.text || '').trim() });
  }

  if (action === 'turn') {
    if (!provider?.baseUrl) return json(503, { error: 'not_set_up' });
    const clean = sanitizeAgentMessages(body.messages);
    if (clean.error) return json(400, { error: clean.error });
    let res: Response;
    try {
      res = await fetch(`${provider.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${provider.key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: provider.model,
          messages: [{ role: 'system', content: SURVEY_AGENT_SYSTEM_PROMPT }, ...(clean.messages || [])],
          tools: buildSurveyAgentTools(body.answer_values),
          tool_choice: 'auto',
          temperature: 0.2,
          max_tokens: SURVEY_AGENT_LIMITS.maxOutputTokens,
        }),
      });
    } catch (err) {
      console.error('[survey-agent] model call failed', err);
      return json(502, { error: 'model_unavailable' });
    }
    if (res.status === 429) return json(429, { error: 'busy_try_again' });
    if (!res.ok) {
      console.error('[survey-agent] model error', res.status, (await res.text()).slice(0, 500));
      return json(502, { error: 'model_unavailable' });
    }
    const out = await res.json();
    const choice = out?.choices?.[0] || {};
    const message = choice.message || {};
    await admin.rpc('record_survey_agent_usage', {
      p_user_id: user.id,
      p_input_tokens: Number(out?.usage?.prompt_tokens || 0),
      p_output_tokens: Number(out?.usage?.completion_tokens || 0),
      p_cost_micros: surveyAgentCostMicros(out?.usage, provider.prices),
    });
    return json(200, {
      message: {
        content: typeof message.content === 'string' ? message.content : '',
        tool_calls: Array.isArray(message.tool_calls) ? message.tool_calls : [],
      },
      finish_reason: choice.finish_reason || null,
    });
  }

  return json(400, { error: 'unknown_action' });
});
