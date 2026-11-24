import test from 'node:test';
import assert from 'node:assert/strict';
import { planOfflineTurn, runOfflineTurn } from '../src/agent/offlineHelper.js';
import { createSurveyAgentToolbox } from '../src/agent/surveyAgentTools.js';
import { hearLocally, prepareLocalHearing, startDeviceHearing } from '../src/agent/deviceHearing.js';

const TEMPLATE = {
  name: 'Security',
  answerSet: [{ value: 'Y', tone: 'good' }, { value: 'N', tone: 'bad' }, { value: 'N/A', tone: 'neutral' }],
  entities: [{ id: 'ent-installed', name: 'Installed' }, { id: 'ent-commissioned', name: 'Commissioned' }],
  modules: [{
    id: 'mod-1',
    name: 'Installation',
    categories: [{
      id: 'cat-door',
      name: 'Door',
      checklist: [
        { id: 'chk-cable', text: 'Cables pulled' },
        { id: 'chk-reader', text: 'Card reader installed' },
        { id: 'chk-lock', text: 'Lock installed' },
        { id: 'chk-power', text: 'Power at the door' },
        { id: 'chk-damage', text: 'No damage' },
        { id: 'chk-old', text: 'Old item', archived: true },
        { id: 'chk-count', text: 'Screws', kind: 'number' },
      ],
    }],
  }, {
    id: 'mod-2',
    name: 'Commissioning',
    categories: [{ id: 'cat-door-2', name: 'Door', checklist: [{ id: 'chk-online', text: 'Reader online' }] }],
  }],
};

function fakeBridge(overrides = {}) {
  const markers = {
    m117: { name: 'D-117', moduleId: 'mod-1', categoryId: 'cat-door', checklistResponses: {}, note: { text: 'Existing.' } },
    m118: { name: 'D-118', moduleId: 'mod-1', categoryId: 'cat-door', checklistResponses: {} },
    c117: { name: 'D-117', moduleId: 'mod-2', categoryId: 'cat-door-2', checklistResponses: {} },
  };
  const calls = [];
  const bridge = {
    template: TEMPLATE,
    markers,
    documentId: 'doc-1',
    canEdit: true,
    selectedMarkerId: null,
    currentModuleId: 'mod-1',
    setAnswers: (id, answers) => {
      calls.push(['setAnswers', id, answers]);
      const responses = { ...markers[id].checklistResponses };
      for (const a of answers) responses[a.checklistItemId] = { selection: a.value };
      markers[id] = { ...markers[id], checklistResponses: responses };
    },
    setEntity: (id, entityId) => { markers[id] = { ...markers[id], entityId }; },
    updateNote: (id, updater) => { markers[id] = { ...markers[id], note: updater(markers[id].note || {}) }; },
    restoreMarker: (id, snap) => { markers[id] = { ...markers[id], ...snap }; },
    showMarker: (id) => calls.push(['show', id]),
    ...overrides,
  };
  return { bridge, calls, markers };
}

const answersOf = (plan) => plan?.calls?.[0]?.input;

test('answers by item name, line words and spoken answer', () => {
  const { bridge } = fakeBridge();
  const plan = planOfflineTurn('D-117 lock installed yes, card reader installed no', bridge);
  assert.deepEqual(plan.calls, [{
    name: 'set_answers',
    input: { item_id: 'm117', answers: [{ checklist_item_id: 'chk-lock', value: 'Y' }, { checklist_item_id: 'chk-reader', value: 'N' }], all_lines: null },
  }]);
  // Spoken numbers, the category before the name, articles and filler words.
  assert.deepEqual(answersOf(planOfflineTurn('Door D one eighteen, power at door is not applicable', bridge)), {
    item_id: 'm118', answers: [{ checklist_item_id: 'chk-power', value: 'N/A' }], all_lines: null,
  });
  // A line that starts with "no" is a line, not an answer.
  assert.deepEqual(answersOf(planOfflineTurn('D-118 no damage yes', bridge)).answers, [{ checklist_item_id: 'chk-damage', value: 'Y' }]);
});

test('the same name in two modules: the one in the open module', () => {
  const { bridge } = fakeBridge();
  assert.equal(answersOf(planOfflineTurn('D-117 cables pulled yes', bridge)).item_id, 'm117');
  const elsewhere = fakeBridge({ currentModuleId: null }).bridge;
  assert.equal(planOfflineTurn('D-117 cables pulled yes', elsewhere), null);
});

test('all lines, a note, show and undo', () => {
  const { bridge } = fakeBridge();
  assert.deepEqual(answersOf(planOfflineTurn('D-117 everything yes', bridge)), { item_id: 'm117', answers: null, all_lines: 'Y' });
  assert.deepEqual(planOfflineTurn('D-118 note no power at the door, call the GC', bridge).calls, [
    { name: 'add_note', input: { item_id: 'm118', text: 'No power at the door, call the GC' } },
  ]);
  assert.deepEqual(planOfflineTurn('D one seventeen', bridge).calls, [{ name: 'show_item', input: { item_id: 'm117' } }]);
  assert.deepEqual(planOfflineTurn('Undo that', bridge).calls, [{ name: 'undo_last_turn', input: {} }]);
});

test('an entity by its exact name; "done" is not guessed', () => {
  const { bridge } = fakeBridge();
  assert.deepEqual(planOfflineTurn('Mark D-118 commissioned', bridge).calls, [
    { name: 'set_entity', input: { item_id: 'm118', entity_id: 'ent-commissioned' } },
  ]);
  // "Done" could be Installed or Commissioned: the server's agent asks.
  assert.equal(planOfflineTurn('Mark D-118 done', bridge), null);
});

test('with no name, the selected item is used', () => {
  const { bridge } = fakeBridge({ selectedMarkerId: 'm118' });
  assert.deepEqual(answersOf(planOfflineTurn('lock installed yes', bridge)), {
    item_id: 'm118', answers: [{ checklist_item_id: 'chk-lock', value: 'Y' }], all_lines: null,
  });
  // A name said wins over the selection.
  assert.equal(answersOf(planOfflineTurn('D-117 lock installed yes', bridge)).item_id, 'm117');
});

test('anything not read exactly is left for the server', () => {
  const { bridge } = fakeBridge();
  for (const said of [
    'D-117 the lock looks fine',          // no answer word
    'D-117 lock yes',                     // not the line's words
    'D-119 lock installed yes',           // no such item
    'lock installed yes',                 // no item and none selected
    'D-117 lock installed yes D-118 lock installed no', // two items
    'D-117 lock installed yes lock installed no',       // one line twice
    'D-117 screws 12',                    // a typed line: the server reads it
    'D-117 old item yes',                 // archived line
    'how many doors are left',
    '',
  ]) {
    assert.equal(planOfflineTurn(said, bridge), null, said);
  }
  assert.equal(planOfflineTurn('D-117 lock installed yes', { markers: bridge.markers }), null);
});

test('runs through the agent tools: written once, with an undo', async () => {
  const { bridge, calls, markers } = fakeBridge();
  const toolbox = createSurveyAgentToolbox({ getBridge: () => bridge, documentId: 'doc-1' });
  const done = await runOfflineTurn({ text: 'D-117 lock installed yes', toolbox, bridge });
  assert.equal(done.reply, 'Set 1 answer on D-117.');
  assert.deepEqual(calls[0], ['setAnswers', 'm117', [{ checklistItemId: 'chk-lock', value: 'Y' }]]);
  assert.equal(done.changes.length, 1);
  assert.equal(markers.m117.checklistResponses['chk-lock'].selection, 'Y');
  toolbox.undo(done.changes);
  assert.equal(markers.m117.checklistResponses['chk-lock'], undefined);

  const note = await runOfflineTurn({ text: 'D-117 note no power', toolbox, bridge });
  assert.equal(note.changes.length, 1);
  assert.equal(markers.m117.note.text, 'Existing.\nNo power');
});

test('a tool that refuses before any change leaves the message waiting', async () => {
  const { bridge } = fakeBridge({ canEdit: false });
  const toolbox = createSurveyAgentToolbox({ getBridge: () => bridge, documentId: 'doc-1' });
  assert.equal(await runOfflineTurn({ text: 'D-117 lock installed yes', toolbox, bridge }), null);
  assert.equal(await runOfflineTurn({ text: 'gibberish', toolbox, bridge }), null);
});

test('offline speech pack: used once ready, asked for when it can be fetched', async () => {
  let installs = 0;
  class Ready {
    static async available(opts) { assert.deepEqual(opts, { langs: ['en-US'], processLocally: true }); return 'available'; }
    start() {}
    abort() {}
  }
  assert.equal(await prepareLocalHearing('en-US', Ready), true);
  const hearing = startDeviceHearing({ Recognition: Ready, lang: 'en-US' });
  assert.ok(hearing);
  const rec = new Ready();
  assert.equal(hearLocally(rec, 'en-US'), true);
  assert.equal(rec.processLocally, true);
  hearing.stop();

  class Fetchable {
    static async available() { return 'downloadable'; }
    static async install() { installs += 1; return true; }
  }
  assert.equal(await prepareLocalHearing('es-US', Fetchable), false);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(installs, 1);
  // Ready from the next start once fetched.
  assert.equal(await prepareLocalHearing('es-US', Fetchable), true);

  class Old { start() {} }
  assert.equal(await prepareLocalHearing('en-US', Old), false);
  const plain = new Old();
  assert.equal(hearLocally(plain, 'en-US'), false);
  assert.equal(plain.processLocally, undefined);
});
