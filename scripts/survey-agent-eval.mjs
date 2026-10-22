// Runs the Survey agent test set (tests/fixtures/survey-agent-eval.json)
// against a real model, with the same prompt, tools and in-app tool code the
// app uses, on an in-memory survey. Prints pass/fail per case.
//   GROQ_API_KEY=... node scripts/survey-agent-eval.mjs
//   SURVEY_AGENT_BASE_URL=... SURVEY_AGENT_API_KEY=... SURVEY_AGENT_MODEL=... node scripts/survey-agent-eval.mjs
// Bake-off: several models on one test set, with pass rate, time and cost:
//   GROQ_API_KEY=... SURVEY_AGENT_MODELS=openai/gpt-oss-20b,openai/gpt-oss-120b \
//   SURVEY_AGENT_EVAL_FIXTURE=tests/fixtures/survey-agent-eval-floors.json node scripts/survey-agent-eval.mjs
// Or through a deployed survey-agent function, signed in as a tester:
//   SURVEY_AGENT_FUNCTION_URL=https://<ref>.supabase.co/functions/v1/survey-agent \
//   SURVEY_AGENT_JWT=<access token> SUPABASE_ANON_KEY=... node scripts/survey-agent-eval.mjs
import { readFile } from 'node:fs/promises';
import { createSurveyAgentToolbox } from '../src/agent/surveyAgentTools.js';
import { runSurveyAgentTurn } from '../src/agent/surveyAgentClient.js';
import { evalProblems, memoryBridge } from './surveyAgentEvalShared.mjs';
import {
  SURVEY_AGENT_DEFAULT_PROVIDER,
  SURVEY_AGENT_LIMITS,
  SURVEY_AGENT_SYSTEM_PROMPT,
  buildSurveyAgentTools,
  sanitizeAgentMessages,
} from '../supabase/functions/_shared/surveyAgentSpec.js';

const functionUrl = process.env.SURVEY_AGENT_FUNCTION_URL;
const key = process.env.SURVEY_AGENT_API_KEY || process.env.GROQ_API_KEY;
if (functionUrl && !process.env.SURVEY_AGENT_JWT) {
  console.error('Set SURVEY_AGENT_JWT to a signed-in tester\'s access token.');
  process.exit(2);
}
if (!functionUrl && !key) {
  console.error('Set GROQ_API_KEY (or SURVEY_AGENT_API_KEY with SURVEY_AGENT_BASE_URL).');
  process.exit(2);
}
const baseUrl = (process.env.SURVEY_AGENT_BASE_URL || SURVEY_AGENT_DEFAULT_PROVIDER.baseUrl).replace(/\/$/, '');
const models = (process.env.SURVEY_AGENT_MODELS || process.env.SURVEY_AGENT_MODEL || SURVEY_AGENT_DEFAULT_PROVIDER.model)
  .split(',').map((m) => m.trim()).filter(Boolean);
const fixturePath = process.env.SURVEY_AGENT_EVAL_FIXTURE
  ? new URL(process.env.SURVEY_AGENT_EVAL_FIXTURE, `file://${process.cwd()}/`)
  : new URL('../tests/fixtures/survey-agent-eval.json', import.meta.url);
const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
// Dollars per million tokens (in, out), for the cost column. Groq list
// prices, October 2026; a model not listed shows tokens only.
const PRICES = {
  'openai/gpt-oss-120b': [0.15, 0.60],
  'openai/gpt-oss-20b': [0.075, 0.30],
};
let model = models[0];
const usage = { in: 0, out: 0 };
const answerValues = fixture.template.answerSet.map((a) => a.value);

async function callFunction(payload) {
  const res = await fetch(functionUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.SURVEY_AGENT_JWT}`,
      apikey: process.env.SUPABASE_ANON_KEY || '',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`survey-agent ${res.status}: ${(await res.text()).slice(0, 300)}`);
  return res.json();
}

async function call(payload) {
  if (functionUrl) return callFunction(payload);
  const clean = sanitizeAgentMessages(payload.messages);
  if (clean.error) throw new Error(`invalid conversation: ${clean.error}`);
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'system', content: SURVEY_AGENT_SYSTEM_PROMPT }, ...clean.messages],
      tools: buildSurveyAgentTools(payload.answer_values),
      tool_choice: 'auto',
      temperature: 0.2,
      max_tokens: SURVEY_AGENT_LIMITS.maxOutputTokens,
    }),
  });
  if (!res.ok) throw new Error(`model ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const out = await res.json();
  usage.in += out.usage?.prompt_tokens || 0;
  usage.out += out.usage?.completion_tokens || 0;
  const message = out.choices?.[0]?.message || {};
  return { message: { content: message.content || '', tool_calls: message.tool_calls || [] } };
}

const summary = [];
for (model of models) {
  let passed = 0;
  usage.in = 0; usage.out = 0;
  const startedAll = Date.now();
  if (models.length > 1) console.log(`\n== ${model}`);
  for (const c of fixture.cases) {
    const bridge = memoryBridge(fixture);
    const toolbox = createSurveyAgentToolbox({ getBridge: () => bridge });
    const started = Date.now();
    try {
      const out = await runSurveyAgentTurn({ userText: c.say, call, toolbox, answerValues });
      const problems = evalProblems(bridge, out.changes, c.expect);
      if (!problems.length) passed += 1;
      console.log(`${problems.length ? 'FAIL' : 'pass'}  ${((Date.now() - started) / 1000).toFixed(1)}s  "${c.say}"`);
      for (const p of problems) console.log(`        ${p}`);
      console.log(`        reply: ${out.reply.replace(/\s+/g, ' ').slice(0, 160)}`);
    } catch (err) {
      console.log(`ERROR "${c.say}": ${err.message}`);
    }
  }
  const price = PRICES[model];
  const perTurn = price ? ((usage.in * price[0] + usage.out * price[1]) / 1e6) / fixture.cases.length : null;
  summary.push({ model: functionUrl ? 'deployed survey-agent function' : model, passed, of: fixture.cases.length,
    secondsPerTurn: ((Date.now() - startedAll) / 1000 / fixture.cases.length).toFixed(1),
    tokensPerTurn: Math.round((usage.in + usage.out) / fixture.cases.length),
    dollarsPerThousandTurns: perTurn == null ? 'n/a' : (perTurn * 1000).toFixed(2) });
  console.log(`\n${passed}/${fixture.cases.length} passed with ${functionUrl ? 'the deployed survey-agent function' : model}`);
  if (functionUrl) break;
}
if (summary.length > 1 || process.env.SURVEY_AGENT_MODELS) console.table(summary);
process.exit(summary.every((r) => r.passed === r.of) ? 0 : 1);
