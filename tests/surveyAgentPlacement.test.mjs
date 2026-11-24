// Isaiah, Nov 24: "Camera 80 is on pages 6 and 33. The correct answer is 6,
// because 6 is the floor plan; 33 is the schedule." Each sheet gets a kind
// from its own words, a device goes on the project's placement sheets (the
// floor plan by default), and when that does not pick one the person gets a
// choice card. Nothing here is named after one customer's drawings.
import test from 'node:test';
import assert from 'node:assert/strict';
import { placementFromWords, placementWords, sheetKindOf, spotOf, tableTagWords } from '../src/agent/sheetKind.js';
import { readDocumentSheets } from '../src/agent/planText.js';
import { sheetFloorOf } from '../src/agent/spokenTag.js';
import { createSurveyAgentToolbox, placementOf, placementPick } from '../src/agent/surveyAgentTools.js';
import { SURVEY_AGENT_SYSTEM_PROMPT, buildSurveyAgentTools } from '../supabase/functions/_shared/surveyAgentSpec.js';

const word = (text, x, y, height = 8) => ({ text, box: { x, y, width: text.length * height * 0.6, height } });
const title = (texts, y = 740) => texts.map((t, i) => word(t, 900 + i * 90, y, 20));

// A floor plan: tags scattered over the sheet, a big title.
const floorPlan = (tags = []) => [
  ...title(['THIRD', 'FLOOR', 'PLAN']),
  ...['C-3-10', 'C-3-11', 'C-3-12', 'D-301', 'D-302', 'WAP-3-1'].map((t, i) => word(t, 80 + ((i * 197) % 700), 90 + ((i * 131) % 500))),
  ...tags,
  word('SEE', 40, 760, 6), word('SCHEDULE', 60, 760, 6), word('ON', 110, 760, 6), word('E-501', 125, 760, 6),
];
// A schedule: tags stacked in a column, with a row of words beside each.
const schedule = (tags = []) => [
  ...title(['CAMERA', 'SCHEDULE']),
  ...Array.from({ length: 12 }, (_, i) => [word(`C-3-${String(i + 1).padStart(2, '0')}`, 60, 100 + i * 14), word('FIXED', 140, 100 + i * 14), word('DOME', 180, 100 + i * 14)]).flat(),
  ...tags,
];

test('a sheet is a floor plan, a schedule or a riser from its own words', () => {
  assert.equal(sheetKindOf(floorPlan()).kind, 'floor plan');
  assert.equal(sheetKindOf(schedule()).kind, 'schedule');
  assert.equal(sheetKindOf([...title(['SECURITY', 'RISER', 'DIAGRAM']), word('MDF', 100, 100), word('IDF-3', 300, 100)]).kind, 'riser');
  assert.equal(sheetKindOf([...title(['MOUNTING', 'DETAILS'])]).kind, 'detail');
  assert.equal(sheetKindOf([...title(['SYMBOL', 'LEGEND'])]).kind, 'legend');
  // A table of tags with no title still reads as a schedule.
  assert.equal(sheetKindOf(schedule().slice(2)).kind, 'schedule');
  // Words that say nothing: no guess.
  assert.equal(sheetKindOf([word('NOTES', 10, 10), word('1.', 10, 30)]).kind, null);
  assert.equal(sheetKindOf([]).kind, null);
});

test('small print naming another sheet does not change the title', () => {
  // "SEE SCHEDULE ON E-501" in small print on a floor plan.
  assert.equal(sheetKindOf(floorPlan()).kind, 'floor plan');
  const riserNote = [...floorPlan(), word('RISER', 200, 770, 6), word('DIAGRAM', 230, 770, 6)];
  assert.equal(sheetKindOf(riserNote).kind, 'floor plan');
});

test('a tag in a table column is a table row; one on the drawing is not', () => {
  const words = [...floorPlan(), ...schedule().slice(2).map((w) => ({ ...w, box: { ...w.box, x: w.box.x + 1000 } }))];
  const table = tableTagWords(words);
  const row = words.find((w) => w.text === 'C-3-05' && w.box.x > 1000);
  const loose = words.find((w) => w.text === 'D-301');
  assert.equal(spotOf(row.box, table), 'table');
  assert.equal(spotOf(loose.box, table), 'drawing');
});

test('a placement rule from plain words', () => {
  assert.deepEqual(placementFromWords('floor plan, schedule and riser'), ['floor plan', 'schedule', 'riser']);
  assert.deepEqual(placementFromWords('mark it everywhere'), ['floor plan', 'schedule', 'riser']);
  assert.deepEqual(placementFromWords('just the plans'), ['floor plan']);
  assert.deepEqual(placementFromWords('banana'), []);
  assert.equal(placementWords(['floor plan']), 'the floor plan');
  assert.equal(placementWords(['floor plan', 'schedule', 'riser']), 'the floor plan, schedule and riser');
  assert.deepEqual(placementOf([]), { kinds: ['floor plan'], saved: false });
  assert.deepEqual(placementOf([{ kind: 'placement', heard: 'sheets', means: 'floor plan, schedule' }]), { kinds: ['floor plan', 'schedule'], saved: true });
});

test('the rule picks the floor plan, and a schedule row only when asked for', () => {
  const plan = { id: 'plan-1', page: 6, sheet: 'floor plan' };
  const row = { id: 'plan-2', page: 33, sheet: 'schedule', spot: 'table row' };
  const odd = { id: 'plan-3', page: 40 };
  assert.deepEqual(placementPick([plan, row], ['floor plan']).picked.map((m) => m.id), ['plan-1']);
  assert.deepEqual(placementPick([plan, row], ['floor plan', 'schedule']).picked.map((m) => m.id), ['plan-1', 'plan-2']);
  assert.deepEqual(placementPick([plan, row, odd], ['floor plan']).unknown.map((m) => m.id), ['plan-3']);
});

const TEMPLATE = {
  name: 'Security',
  answerSet: [{ value: 'Y' }, { value: 'N' }],
  modules: [{ id: 'mod-i', name: 'Installation', categories: [{ id: 'cat-cam', name: 'Camera', checklist: [{ id: 'i-cable', text: 'Cable Pulled' }, { id: 'i-cam', text: 'Camera Installed' }] }] }],
};

function memoryStore(rows = []) {
  return {
    rows,
    cached: () => rows,
    list: async () => rows,
    save: async (_project, row) => {
      const before = rows.find((r) => r.kind === row.kind && r.heard === row.heard) || null;
      const saved = { id: `r${rows.length + 1}`, ...row };
      if (before) rows.splice(rows.indexOf(before), 1, saved); else rows.push(saved);
      return { row: saved, before };
    },
  };
}

// Camera 80 on page 6 (floor plan) and page 33 (schedule), as on Isaiah's set.
async function cameraEightyBox({ rows = [] } = {}) {
  const docPages = {
    6: floorPlan([word('C-80', 420, 300)]),
    33: schedule([word('C-80', 60, 100 + 12 * 14), word('FIXED', 140, 100 + 12 * 14)]),
  };
  const doc = { getPageCount: () => 33, getPageWords: async (page) => (docPages[page] ? { words: docPages[page], source: 'text' } : { words: [], source: 'none' }) };
  const markers = {};
  const memory = memoryStore(rows);
  const bridge = {
    template: TEMPLATE,
    markers,
    documentId: 'doc-1',
    projectId: 'proj-1',
    canEdit: true,
    currentModuleId: 'mod-i',
    readSheets: () => readDocumentSheets(doc, sheetFloorOf),
    getPageSize: () => ({ width: 1224, height: 792 }),
  };
  return { box: createSurveyAgentToolbox({ getBridge: () => bridge, memory }), memory };
}

test('Camera 80: the floor plan is used without asking, and the schedule row says what it is', async () => {
  const { box } = await cameraEightyBox();
  const res = await box.run('find_described', { description: 'camera 80', kind: 'camera', number: 80, floor: null, wing: null });
  assert.equal(res.isError, false, res.content);
  const body = JSON.parse(res.content);
  const byPage = Object.fromEntries(body.plan.map((m) => [m.page, m]));
  assert.equal(byPage[6].sheet, 'floor plan');
  assert.equal(byPage[33].sheet, 'schedule');
  assert.equal(byPage[33].spot, 'table row');
  assert.equal(body.placement.rule, 'the floor plan');
  assert.deepEqual(body.placement.use, [byPage[6].id]);
  // The fields the offline helper reads are still there.
  for (const m of body.plan) for (const key of ['id', 'page', 'text', 'score']) assert.ok(key in m, key);
});

test('a project that wants the schedule too gets both, still without asking', async () => {
  const { box } = await cameraEightyBox({ rows: [{ id: 'r1', kind: 'placement', heard: 'sheets', means: 'floor plan, schedule' }] });
  const body = JSON.parse((await box.run('find_described', { description: 'camera 80', kind: 'camera', number: 80, floor: null, wing: null })).content);
  assert.equal(body.placement.rule, 'the floor plan and schedule');
  assert.deepEqual(body.placement.use.length, 2);
  const ctx = JSON.parse((await box.run('get_survey_context', {})).content);
  assert.equal(ctx.placement, 'the floor plan and schedule');
});

test('when the rule picks nothing, the agent offers a choice card and can remember the answer', async () => {
  const { box, memory } = await cameraEightyBox({ rows: [{ id: 'r1', kind: 'placement', heard: 'sheets', means: 'riser' }] });
  const body = JSON.parse((await box.run('find_described', { description: 'camera 80', kind: 'camera', number: 80, floor: null, wing: null })).content);
  assert.deepEqual(body.placement.use, []);
  const asked = await box.run('ask_which_page', { plan_match_ids: body.plan.map((m) => m.id), question: 'Page 6 or 33?' });
  assert.equal(asked.isError, false, asked.content);
  assert.deepEqual(asked.choice.options.map((o) => [o.page, o.sheet]), [[6, 'floor plan'], [33, 'schedule']]);
  assert.equal(asked.choice.canRemember, true);
  assert.equal((await box.run('ask_which_page', { plan_match_ids: [body.plan[0].id] })).isError, true, 'one page is no choice');

  const saved = await box.run('remember', { kind: 'placement', heard: 'sheets', means: 'floor plan and schedule' });
  assert.equal(saved.isError, false, saved.content);
  assert.equal(memory.rows[0].means, 'floor plan, schedule');
  assert.ok(saved.change?.memory, 'one Undo takes it back');
  assert.equal((await box.run('remember', { kind: 'placement', heard: 'sheets', means: 'banana' })).isError, true);
});

test('the model is told the placement rule and has the choice tool', () => {
  assert.match(SURVEY_AGENT_SYSTEM_PROMPT, /floor plan by default/);
  assert.match(SURVEY_AGENT_SYSTEM_PROMPT, /ask_which_page/);
  const tools = buildSurveyAgentTools(['Y', 'N']);
  const remember = tools.find((t) => t.function.name === 'remember');
  assert.ok(remember.function.parameters.properties.kind.enum.includes('placement'));
  assert.ok(tools.some((t) => t.function.name === 'ask_which_page'));
  assert.ok(!buildSurveyAgentTools(['Y'], { webmcp: true }).some((t) => t.function.name === 'ask_which_page'), 'not for browser agents');
});
