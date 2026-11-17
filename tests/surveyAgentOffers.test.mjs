// KAL-529: the Survey agent offers to grow the template (a new checklist
// line or category) on a Yes / No card, and writes notes as sentences or
// bullets. Nightly only (flag agent-template-offers).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSurveyAgentToolbox } from '../src/agent/surveyAgentTools.js';
import { runSurveyAgentTurn } from '../src/agent/surveyAgentClient.js';
import {
  SURVEY_AGENT_NOTE_STYLES,
  SURVEY_AGENT_TOOL_NAMES,
  buildSurveyAgentTools,
  surveyAgentSystemMessages,
} from '../supabase/functions/_shared/surveyAgentSpec.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

const TEMPLATE = {
  name: 'Security',
  answerSet: [{ value: 'Y', tone: 'good' }, { value: 'N', tone: 'bad' }, { value: 'N/A', tone: 'neutral' }],
  modules: [{
    id: 'mod-1',
    name: 'Installation',
    categories: [{
      id: 'cat-door',
      name: 'Door',
      checklist: [
        { id: 'chk-lock', text: 'Lock installed' },
        { id: 'chk-power', text: 'Power at the door', archived: true },
      ],
    }],
  }],
};

function bridgeWith(overrides = {}) {
  return {
    template: TEMPLATE,
    markers: {
      m117: { name: 'D-117', moduleId: 'mod-1', categoryId: 'cat-door', checklistResponses: {} },
    },
    documentId: 'doc-1',
    canEdit: true,
    canEditTemplate: true,
    currentModuleId: 'mod-1',
    addChecklistLine: async () => 'item-new',
    addCategory: async () => ({}),
    ...overrides,
  };
}

const boxFor = (bridge, offered = new Set()) => createSurveyAgentToolbox({ getBridge: () => bridge, offered });

test('the offer tools are sent only when offers are on, never to WebMCP', () => {
  const names = (opts) => buildSurveyAgentTools(['Y', 'N'], opts).map((t) => t.function.name);
  assert.ok(!names({}).includes('offer_checklist_line'));
  assert.ok(!SURVEY_AGENT_TOOL_NAMES.includes('offer_category'));
  assert.ok(names({ offers: true }).includes('offer_checklist_line'));
  assert.ok(names({ offers: true }).includes('offer_category'));
  assert.ok(!names({ offers: true, webmcp: true }).includes('offer_checklist_line'));
  const line = buildSurveyAgentTools(['Y', 'N'], { offers: true }).find((t) => t.function.name === 'offer_checklist_line');
  assert.deepEqual(line.function.parameters.properties.answer.enum, ['Y', 'N', null]);
  assert.deepEqual(line.function.parameters.required, ['category_id', 'text', 'item_id', 'answer']);
});

test('note style: bullets adds one system note; sentences adds none', () => {
  assert.deepEqual([...SURVEY_AGENT_NOTE_STYLES], ['sentences', 'bullets']);
  assert.equal(surveyAgentSystemMessages('en').length, 1);
  assert.equal(surveyAgentSystemMessages('en', { noteStyle: 'sentences' }).length, 1);
  const bullets = surveyAgentSystemMessages('en', { noteStyle: 'bullets' });
  assert.equal(bullets.length, 2);
  assert.match(bullets[1].content, /bullet/i);
  assert.equal(surveyAgentSystemMessages('es', { noteStyle: 'bullets' }).length, 3);
});

test('"no power" on a Door: one offer, with the answer for this door', async () => {
  const offered = new Set();
  const box = boxFor(bridgeWith(), offered);
  const res = await box.run('offer_checklist_line', { category_id: 'cat-door', text: 'Power at door', item_id: 'm117', answer: 'N' });
  assert.equal(res.isError, false, res.content);
  assert.match(res.content, /Yes \/ No card/);
  assert.deepEqual(res.offer, {
    kind: 'line',
    documentId: 'doc-1',
    moduleId: 'mod-1',
    categoryId: 'cat-door',
    categoryName: 'Door',
    text: 'Power at door',
    itemId: 'm117',
    itemName: 'D-117',
    answer: 'N',
  });
  // Once per chat, even worded a little differently.
  const again = await boxFor(bridgeWith(), offered).run('offer_checklist_line', { category_id: 'cat-door', text: 'power at the door.', item_id: null, answer: null });
  assert.equal(again.isError, true);
  assert.match(again.content, /already offered/);
});

test('no offer for a line the category already has, a wrong answer or a wrong item', async () => {
  const box = boxFor(bridgeWith());
  const have = await box.run('offer_checklist_line', { category_id: 'cat-door', text: 'Lock installed', item_id: null, answer: null });
  assert.equal(have.isError, true);
  assert.match(have.content, /already has the line "Lock installed" \(id chk-lock\)/);
  const badAnswer = await box.run('offer_checklist_line', { category_id: 'cat-door', text: 'Closer', item_id: 'm117', answer: 'Maybe' });
  assert.equal(badAnswer.isError, true);
  const badCategory = await box.run('offer_checklist_line', { category_id: 'cat-x', text: 'Closer', item_id: null, answer: null });
  assert.equal(badCategory.isError, true);
});

test('someone who cannot edit the template is never offered anything', async () => {
  for (const bridge of [
    bridgeWith({ canEditTemplate: false }),
    bridgeWith({ canEdit: false }),
    bridgeWith({ addChecklistLine: undefined }),
  ]) {
    const box = boxFor(bridge);
    const ctx = JSON.parse((await box.run('get_survey_context', {})).content);
    assert.equal(ctx.template_editable, false);
    const res = await box.run('offer_checklist_line', { category_id: 'cat-door', text: 'Power at door', item_id: null, answer: null });
    assert.equal(res.isError, true);
    assert.match(res.content, /cannot change the template/);
    assert.equal(res.offer, undefined);
  }
  // Offers off (no offered set): the context says nothing about it.
  const off = createSurveyAgentToolbox({ getBridge: () => bridgeWith() });
  assert.equal(JSON.parse((await off.run('get_survey_context', {})).content).template_editable, undefined);
  assert.equal((await off.run('offer_category', { name: 'Intercom' })).isError, true);
});

test('offer_category: into the open module, once, not a name it already has', async () => {
  const offered = new Set();
  const box = boxFor(bridgeWith(), offered);
  const res = await box.run('offer_category', { name: 'Intercom' });
  assert.equal(res.isError, false, res.content);
  assert.deepEqual(res.offer, { kind: 'category', documentId: 'doc-1', moduleId: 'mod-1', moduleName: 'Installation', name: 'Intercom' });
  assert.equal((await box.run('offer_category', { name: 'intercom' })).isError, true);
  assert.match((await box.run('offer_category', { name: 'door' })).content, /already has the category Door/);
});

test('a turn collects offers and sends offers and note style to the server', async () => {
  const bridge = bridgeWith();
  const sent = [];
  let step = 0;
  const call = async (body) => {
    sent.push(body);
    step += 1;
    if (step === 1) {
      return { message: { content: null, tool_calls: [{ id: 't1', function: { name: 'offer_checklist_line', arguments: JSON.stringify({ category_id: 'cat-door', text: 'Power at door', item_id: 'm117', answer: 'N' }) } }] } };
    }
    return { message: { content: 'I noted no power. Want a Power at door line? Tap Yes.' } };
  };
  const out = await runSurveyAgentTurn({
    userText: 'D-117 has no power',
    call,
    toolbox: boxFor(bridge),
    answerValues: ['Y', 'N', 'N/A'],
    offers: true,
    noteStyle: 'bullets',
  });
  assert.equal(out.offers.length, 1);
  assert.equal(out.offers[0].text, 'Power at door');
  assert.equal(sent[0].offers, true);
  assert.equal(sent[0].note_style, 'bullets');
  // Off: neither goes to the server.
  const plain = await runSurveyAgentTurn({
    userText: 'hi',
    call: async (body) => { sent.push(body); return { message: { content: 'Hi.' } }; },
    toolbox: boxFor(bridge),
    answerValues: ['Y', 'N', 'N/A'],
  });
  assert.deepEqual(plain.offers, []);
  assert.equal(sent.at(-1).offers, undefined);
  assert.equal(sent.at(-1).note_style, undefined);
});

test('wiring: Nightly flag, edge function, rail bridge, PDFViewer handler, panel card', () => {
  assert.equal(FEATURE_FLAGS['agent-template-offers'].stage, 'beta');
  const fn = readFileSync(new URL('../supabase/functions/survey-agent/index.ts', import.meta.url), 'utf8');
  assert.match(fn, /offers: s\.boolean\(\{ optional: true \}\)/);
  assert.match(fn, /note_style: s\.enum\(\[\.\.\.SURVEY_AGENT_NOTE_STYLES\]/);
  assert.match(fn, /offers: body\.offers === true/);
  assert.match(fn, /noteStyle: body\.note_style/);
  const rail = readFileSync(new URL('../src/SurveySpacesRail.jsx', import.meta.url), 'utf8');
  assert.match(rail, /canEditTemplate:[^\n]*\n[^\n]*sharedFrom\.canEdit/);
  assert.match(rail, /addChecklistLine: \(moduleId, categoryId, text\) => addChecklistItemToCurrentTemplate/);
  const viewer = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
  assert.match(viewer, /addChecklistItemToCurrentTemplate: handleAddChecklistItemToCurrentTemplate/);
  const panel = readFileSync(new URL('../src/components/SurveyAgentPanel.jsx', import.meta.url), 'utf8');
  assert.match(panel, /data-testid="survey-agent-offer"/);
  assert.match(panel, /offered: offersOn \? offeredRef\.current : null/);
});
