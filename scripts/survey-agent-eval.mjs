// Runs the Survey agent test set (tests/fixtures/survey-agent-eval.json)
// against a real model, with the same prompt, tools and in-app tool code the
// app uses, on an in-memory survey. Prints pass/fail per case.
//   GROQ_API_KEY=... node scripts/survey-agent-eval.mjs
//   SURVEY_AGENT_BASE_URL=... SURVEY_AGENT_API_KEY=... SURVEY_AGENT_MODEL=... node scripts/survey-agent-eval.mjs
// Or through a deployed survey-agent function, signed in as a tester:
//   SURVEY_AGENT_FUNCTION_URL=https://<ref>.supabase.co/functions/v1/survey-agent \
//   SURVEY_AGENT_JWT=<access token> SUPABASE_ANON_KEY=... node scripts/survey-agent-eval.mjs
import { readFile } from 'node:fs/promises';
import { createSurveyAgentToolbox } from '../src/agent/surveyAgentTools.js';
import { runSurveyAgentTurn } from '../src/agent/surveyAgentClient.js';
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
const model = process.env.SURVEY_AGENT_MODEL || SURVEY_AGENT_DEFAULT_PROVIDER.model;
const fixture = JSON.parse(await readFile(new URL('../tests/fixtures/survey-agent-eval.json', import.meta.url), 'utf8'));
const answerValues = fixture.template.answerSet.map((a) => a.value);

function memoryBridge() {
  const markers = JSON.parse(JSON.stringify(fixture.markers));
  for (const m of Object.values(markers)) m.checklistResponses = {};
  return {
    template: fixture.template,
    markers,
    canEdit: true,
    setAnswers: (id, list) => { for (const a of list) markers[id].checklistResponses[a.checklistItemId] = { selection: a.value }; },
    setEntity: (id, entityId) => { markers[id].entityId = entityId; },
    updateNote: (id, updater) => { markers[id].note = updater(markers[id].note || {}); },
    uploadMedia: async () => { throw new Error('no media in the test set'); },
    addMediaRefs: () => {},
    restoreMarker: () => {},
    showMarker: () => {},
  };
}

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
  const message = out.choices?.[0]?.message || {};
  return { message: { content: message.content || '', tool_calls: message.tool_calls || [] } };
}

function check(bridge, changes, expect) {
  const problems = [];
  if (expect.noChanges && changes.length) problems.push(`expected no changes, got: ${changes.map((c) => c.label).join(' | ')}`);
  for (const [id, want] of Object.entries(expect)) {
    if (id === 'noChanges') continue;
    const m = bridge.markers[id];
    for (const [item, value] of Object.entries(want.answers || {})) {
      const got = m.checklistResponses[item]?.selection || null;
      if (got !== value) problems.push(`${m.name} ${item}: want ${value}, got ${got}`);
    }
    for (const text of want.noteIncludes || []) {
      if (!String(m.note?.text || '').toLowerCase().includes(text.toLowerCase())) problems.push(`${m.name} note missing "${text}"`);
    }
    if (want.entity && m.entityId !== want.entity) problems.push(`${m.name} entity: want ${want.entity}, got ${m.entityId || null}`);
  }
  return problems;
}

let passed = 0;
for (const c of fixture.cases) {
  const bridge = memoryBridge();
  const toolbox = createSurveyAgentToolbox({ getBridge: () => bridge });
  const started = Date.now();
  try {
    const out = await runSurveyAgentTurn({ userText: c.say, call, toolbox, answerValues });
    const problems = check(bridge, out.changes, c.expect);
    if (!problems.length) passed += 1;
    console.log(`${problems.length ? 'FAIL' : 'pass'}  ${((Date.now() - started) / 1000).toFixed(1)}s  "${c.say}"`);
    for (const p of problems) console.log(`        ${p}`);
    console.log(`        reply: ${out.reply.replace(/\s+/g, ' ').slice(0, 160)}`);
  } catch (err) {
    console.log(`ERROR "${c.say}": ${err.message}`);
  }
}
console.log(`\n${passed}/${fixture.cases.length} passed with ${functionUrl ? 'the deployed survey-agent function' : model}`);
process.exit(passed === fixture.cases.length ? 0 : 1);
