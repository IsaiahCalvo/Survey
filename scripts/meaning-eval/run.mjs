// Runs each case through the real turn loop (the app's toolbox and
// runSurveyAgentTurn, the edge function's prompt and tools) against Groq,
// on a pretend survey, and scores what the survey holds afterwards.
//
//   GROQ_API_KEY=... node scripts/meaning-eval/run.mjs [--max-calls 25] [--max-tokens 100000]
//     [--model openai/gpt-oss-120b] [--cases id,id] [--out file.jsonl]
//   node scripts/meaning-eval/run.mjs --dry   (no key: a scripted model, to check the harness)
//
// The key's org shares its daily token cap with production, so a run stops
// at --max-calls model calls or --max-tokens tokens, whichever comes first.
import { appendFileSync, writeFileSync } from 'node:fs';
import { createSurveyAgentToolbox } from '../../src/agent/surveyAgentTools.js';
import { runSurveyAgentTurn } from '../../src/agent/surveyAgentClient.js';
import { answerSetFor } from '../../src/services/answerSets.js';
import {
  SURVEY_AGENT_LIMITS, buildSurveyAgentTools, markupOpenInTurn, sanitizeAgentMessages, surveyAgentCappedTokens, surveyAgentSystemMessages,
} from '../../supabase/functions/_shared/surveyAgentSpec.js';
import { CASES, grade, startMarkers, templateFor } from './cases.mjs';

const args = process.argv.slice(2);
const opt = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const dry = args.includes('--dry');
const maxCalls = Number(opt('max-calls', 25));
const maxTokens = Number(opt('max-tokens', 100_000));
const model = opt('model', 'openai/gpt-oss-120b');
const only = opt('cases', '') ? new Set(opt('cases', '').split(',')) : null;
const out = opt('out', `meaning-eval-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.jsonl`);
const key = process.env.GROQ_API_KEY;
if (!dry && !key) { console.error('Set GROQ_API_KEY (for example: set -a; . ./.env.eval; set +a).'); process.exit(1); }

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let calls = 0;
let tokens = 0;
let allTokens = 0;
class OutOfBudget extends Error {}

async function groq(body) {
  const clean = sanitizeAgentMessages(body.messages);
  if (clean.error) throw new Error(`bad messages: ${clean.error}`);
  const request = {
    model,
    messages: [...surveyAgentSystemMessages(body.lang), ...clean.messages],
    tools: buildSurveyAgentTools(body.answer_values, { markupOpen: markupOpenInTurn(clean.messages) }),
    tool_choice: 'auto',
    temperature: 0.2,
    max_tokens: SURVEY_AGENT_LIMITS.maxOutputTokens,
  };
  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (calls >= maxCalls || tokens >= maxTokens) throw new OutOfBudget();
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    });
    if (res.status === 429) {
      const text = await res.text();
      if (/per day|TPD|RPD/i.test(text)) throw new OutOfBudget();
      const wait = Math.min(65, Number(res.headers.get('retry-after')) || 20);
      console.log(`  per-minute limit, waiting ${wait}s`);
      await sleep(wait * 1000);
      continue;
    }
    calls += 1;
    const data = await res.json();
    if (!res.ok) throw new Error(`Groq ${res.status}: ${JSON.stringify(data).slice(0, 300)}`);
    // Groq's caps skip a cached prompt prefix, so the budget does too.
    tokens += surveyAgentCappedTokens(data.usage);
    allTokens += data.usage?.total_tokens || 0;
    return { message: data.choices?.[0]?.message || {} };
  }
  throw new Error('kept hitting the per-minute limit');
}

// --dry: answers every case with one set_answers call, all lines Y.
function scripted() {
  let step = 0;
  return async (body) => {
    calls += 1;
    step += 1;
    if (step % 2) {
      const said = body.messages.find((m) => m.role === 'user')?.content || '';
      return { message: { content: '', tool_calls: [{ id: `t${step}`, function: { name: 'set_answers', arguments: JSON.stringify({ item_name: said.match(/D-1-1\d/)?.[0] || 'D-1-17', all_lines: 'Y' }) } }] } };
    }
    return { message: { content: 'Done.' } };
  };
}

function bridgeFor(c) {
  const markers = startMarkers();
  return {
    template: templateFor(c), markers, documentId: 'doc', canEdit: true, selectedMarkerId: null, currentModuleId: c.module,
    setAnswers: (id, answers) => {
      const r = { ...markers[id].checklistResponses };
      for (const a of answers) {
        if (a.value == null) delete r[a.checklistItemId];
        else r[a.checklistItemId] = { selection: a.value };
      }
      markers[id] = { ...markers[id], checklistResponses: r };
    },
    updateNote: (id, fn) => { markers[id] = { ...markers[id], note: fn(markers[id].note || {}) }; },
    restoreMarker: (id, snap) => { markers[id] = { ...markers[id], checklistResponses: snap.checklistResponses, note: snap.note }; },
    setEntity: () => {}, showMarker: () => {},
    findOnPlan: () => null, findAllOnPlan: () => [], getCurrentPage: () => 1, getPageSize: () => null,
  };
}

writeFileSync(out, '');
const results = [];
const call = dry ? scripted() : groq;
for (const c of CASES) {
  if (only && !only.has(c.id)) continue;
  const b = bridgeFor(c);
  const toolbox = createSurveyAgentToolbox({ getBridge: () => b });
  const before = calls;
  let turn;
  try {
    turn = await runSurveyAgentTurn({
      userText: c.said, call, toolbox, lang: c.lang || 'en',
      answerValues: answerSetFor(b.template).map((a) => a.value),
    });
  } catch (err) {
    if (err instanceof OutOfBudget) { console.log(`Stopped at the budget: ${calls} calls, ${tokens} tokens.`); break; }
    turn = { reply: `ERROR ${err.message}`, changes: [], history: [] };
  }
  const asked = /\?/.test(turn.reply || '') && !(turn.changes || []).length;
  const verdict = grade(c, b.markers, { asked });
  const row = {
    id: c.id, module: c.module, said: c.said, ok: verdict.ok, fails: verdict.fails, reply: turn.reply,
    tools: (turn.history || []).flatMap((m) => (m.tool_calls || []).map((t) => `${t.function.name} ${t.function.arguments}`)),
    calls: calls - before,
  };
  results.push(row);
  appendFileSync(out, `${JSON.stringify(row)}\n`);
  console.log(`${row.ok ? 'PASS' : 'FAIL'} ${c.id}: "${c.said}"${row.ok ? '' : `\n    ${row.fails.join('\n    ')}\n    reply: ${row.reply}`}`);
}
const passed = results.filter((r) => r.ok).length;
console.log(`\n${passed}/${results.length} right, ${calls} model calls, ${tokens} capped tokens (${allTokens} with cached), model ${dry ? 'scripted' : model}. Saved ${out}.`);
