// A scripted stand-in for the model on the live test set
// (tests/fixtures/survey-agent-eval.json): for each case it does what a good
// model should. Stateless, so a fake model server can use it too.
import { readFileSync } from 'node:fs';
import { buildSurveyAgentTools } from '../../supabase/functions/_shared/surveyAgentSpec.js';

const fixture = JSON.parse(readFileSync(new URL('../fixtures/survey-agent-eval.json', import.meta.url), 'utf8'));
const answerValues = fixture.template.answerSet.map((a) => a.value);
const toolNames = new Set(buildSurveyAgentTools(answerValues).map((t) => t.function.name));
const ALL_DOOR = ['door-installed', 'cables', 'reader', 'lock', 'hardware'];

// What a good model would do for each case: what it searches for, then the
// writes it makes on the top match. A case with no find never touches items.
export const PLANS = {
  'D-117, the door is not installed': { find: 'D-117', answers: { 'door-installed': 'N' } },
  'Door one seventeen card reader is installed': { find: 'door one seventeen', answers: { reader: 'Y' } },
  'D117 cables are pulled but the card reader is missing': { find: 'D117', answers: { cables: 'Y', reader: 'N' } },
  "D-118 everything's installed but we don't have power": {
    find: 'D-118', answers: Object.fromEntries(ALL_DOOR.map((id) => [id, 'Y'])), note: 'No power at the door.',
  },
  'camera twelve is mounted but not online yet': { find: 'camera twelve', answers: { 'cam-mounted': 'Y', 'cam-online': 'N' } },
  'D 201 lock installed, mark it subcontractor': { find: 'D 201', answers: { lock: 'Y' }, entity: 'ent-sub' },
  // A careless model would try to write "flying"; the tools must refuse it.
  'Door 36 unicorn, mark it as flying': { find: 'Door 36', tryBad: true },
  "uh so like, D-117, hardware's not there, it's just the frame and, um, wires hanging out": { find: 'D-117', answers: { hardware: 'N' } },
  'D-118 add a note: ceiling tile missing above the door': { find: 'D-118', note: 'Ceiling tile missing above the door.' },
  "what's the weather today": {},
};

const reply = (content, calls = []) => ({ content, tool_calls: calls });
const callTool = (n, name, args) => {
  if (!toolNames.has(name)) throw new Error(`scripted a tool the model is not offered: ${name}`);
  return { id: `call_${n}`, type: 'function', function: { name, arguments: JSON.stringify(args) } };
};

/** The assistant message a good model would send next, given the conversation (no system message). */
export function scriptedReply(messages) {
  const said = [...messages].reverse().find((m) => m.role === 'user')?.content;
  const plan = PLANS[said];
  if (!plan) throw new Error(`no plan for "${said}"`);
  const turn = messages.slice(messages.lastIndexOf(messages.findLast((m) => m.role === 'user')) + 1);
  const toolResults = turn.filter((m) => m.role === 'tool');
  if (!plan.find) return reply('I can only help with survey items.');
  if (!toolResults.length) return reply('', [callTool(1, 'find_items', { query: plan.find, category_id: null })]);
  if (toolResults.length > 1 || turn.at(-2)?.tool_calls?.[0]?.function?.name !== 'find_items') return reply('Done.');
  const { matches } = JSON.parse(toolResults[0].content);
  const top = matches[0];
  if (plan.tryBad) {
    if (!top) return reply('I could not find that item, so I changed nothing.');
    return reply('', [callTool(2, 'set_answers', { item_id: top.id, answers: [{ checklist_item_id: 'flying', value: 'flying' }] })]);
  }
  if (!top) throw new Error(`no match for "${plan.find}"`);
  const calls = [];
  if (plan.answers) {
    calls.push(callTool(2, 'set_answers', {
      item_id: top.id,
      answers: Object.entries(plan.answers).map(([id, value]) => ({ checklist_item_id: id, value })),
    }));
  }
  if (plan.note) calls.push(callTool(3, 'add_note', { item_id: top.id, text: plan.note }));
  if (plan.entity) calls.push(callTool(4, 'set_entity', { item_id: top.id, entity_id: plan.entity }));
  return reply('', calls);
}
