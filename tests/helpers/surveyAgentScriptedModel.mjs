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
  // On the plan but not in the survey: offer, or add when asked.
  'D-119 cables are pulled': { find: 'D-119', onPlan: { tag: 'D-119', categoryName: 'Door' } },
  'Add door D-119 from the plan, the lock is installed': {
    find: 'D-119', onPlan: { tag: 'D-119', category: 'cat-door', add: true }, answers: { lock: 'Y' },
  },
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
  if (!plan.find) return reply('I can only help with survey items.');
  const lastCall = turn.filter((m) => m.role === 'assistant').at(-1)?.tool_calls?.[0]?.function?.name;
  const lastResult = turn.filter((m) => m.role === 'tool').at(-1)?.content;
  const writesOn = (itemId) => {
    const calls = [];
    if (plan.answers) {
      calls.push(callTool(2, 'set_answers', {
        item_id: itemId,
        answers: Object.entries(plan.answers).map(([id, value]) => ({ checklist_item_id: id, value })),
      }));
    }
    if (plan.note) calls.push(callTool(3, 'add_note', { item_id: itemId, text: plan.note }));
    if (plan.entity) calls.push(callTool(4, 'set_entity', { item_id: itemId, entity_id: plan.entity }));
    return calls.length ? reply('', calls) : reply('Done.');
  };
  if (!lastCall) return reply('', [callTool(1, 'find_items', { query: plan.find, category_id: null })]);
  if (lastCall === 'find_items') {
    const top = JSON.parse(lastResult).matches[0];
    if (!top && plan.onPlan) return reply('', [callTool(5, 'find_on_plan', { text: plan.onPlan.tag })]);
    if (plan.tryBad) {
      if (!top) return reply('I could not find that item, so I changed nothing.');
      return reply('', [callTool(2, 'set_answers', { item_id: top.id, answers: [{ checklist_item_id: 'flying', value: 'flying' }] })]);
    }
    if (!top) throw new Error(`no match for "${plan.find}"`);
    return writesOn(top.id);
  }
  if (lastCall === 'find_on_plan') {
    const spot = JSON.parse(lastResult).matches[0];
    if (!spot) return reply(`${plan.onPlan.tag} is not in the survey or on the plan.`);
    if (!plan.onPlan.add) return reply(`${plan.onPlan.tag} is not in the survey yet, but it is on page ${spot.page}. Add it as a ${plan.onPlan.categoryName}?`);
    return reply('', [callTool(6, 'create_item', {
      name: plan.onPlan.tag, category_id: plan.onPlan.category, plan_match_id: spot.id, entity_id: null,
    })]);
  }
  if (lastCall === 'create_item') {
    const created = /id (\S+?)\.$/.exec(lastResult)?.[1];
    if (!created) throw new Error(`create_item failed: ${lastResult}`);
    return writesOn(created);
  }
  return reply('Done.');
}
