import test from 'node:test';
import assert from 'node:assert/strict';
import { planDescribedTurn, planOfflineTurn, runOfflineTurn } from '../src/agent/offlineHelper.js';
import { sheetFloorOf, templateKinds } from '../src/agent/spokenTag.js';
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

test('an entity by its exact name; "done" is asked, never guessed', () => {
  const { bridge } = fakeBridge();
  assert.deepEqual(planOfflineTurn('Mark D-118 commissioned', bridge).calls, [
    { name: 'set_entity', input: { item_id: 'm118', entity_id: 'ent-commissioned' } },
  ]);
  // "Done" could be either of this template's entities: ask, change nothing.
  assert.deepEqual(planOfflineTurn('Mark D-118 done', bridge), {
    ask: 'Which is "done" for D-118: Installed or Commissioned? Nothing changed.',
    pending: { itemId: 'm118', heard: 'done' },
  });
  assert.equal(planOfflineTurn('D-118 is finished', bridge).ask.startsWith('Which is "finished"'), true);
  // Not setting a state, or a line's words: left for the server.
  assert.equal(planOfflineTurn('D-118 done', bridge), null);
  assert.equal(planOfflineTurn('Mark D-118 damage', bridge), null);
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

// ---- Other trades: nothing in the rules knows security work. ----

const word = (text, x, y, height = 8) => ({ text, box: { x, y, width: text.length * height * 0.6, height } });
const sheet = (page, title, tags) => {
  const words = [...title.map((t, i) => word(t, 600 + i * 80, 560, 18)), ...tags.map((t, i) => word(t, 40 + i * 120, 100))];
  return { page, words, source: 'text', sheet: sheetFloorOf(words) };
};

const FIRE = {
  name: 'Fire alarm',
  answerSet: [{ value: 'Pass', tone: 'good' }, { value: 'Fail', tone: 'bad' }, { value: 'N/A', tone: 'neutral' }],
  entities: [{ id: 'e-rough', name: 'Rough-in' }, { id: 'e-trim', name: 'Trim' }, { id: 'e-tested', name: 'Tested' }],
  modules: [{
    id: 'fa',
    name: 'Fire alarm devices',
    categories: [
      { id: 'c-smoke', name: 'Smoke Detector', checklist: [{ id: 'l-head', text: 'Head installed' }, { id: 'l-base', text: 'Base wired' }, { id: 'l-cover', text: 'Dust cover removed' }] },
      { id: 'c-pull', name: 'Fire Alarm Pull Station', checklist: [{ id: 'l-mount', text: 'Mounted at 48 inches' }, { id: 'l-sign', text: 'Signage' }] },
      { id: 'c-horn', name: 'Horn Strobe', checklist: [{ id: 'l-cand', text: 'Candela set' }] },
    ],
  }, {
    id: 'hvac',
    name: 'Mechanical',
    categories: [{ id: 'c-vav', name: 'VAV Box', checklist: [{ id: 'l-damper', text: 'Damper works' }, { id: 'l-ctrl', text: 'Controller online' }] }],
  }],
};

function tradeBridge({ markers = {}, pages = [], currentModuleId = 'fa', ...rest } = {}) {
  let n = 0;
  const bridge = {
    template: FIRE,
    markers,
    documentId: 'doc-fa',
    canEdit: true,
    selectedMarkerId: null,
    currentModuleId,
    readSheets: async () => ({ pages, unreadPages: [] }),
    setAnswers: (id, answers) => {
      const responses = { ...markers[id].checklistResponses };
      for (const a of answers) responses[a.checklistItemId] = { selection: a.value };
      markers[id] = { ...markers[id], checklistResponses: responses };
    },
    setEntity: (id, entityId) => { markers[id] = { ...markers[id], entityId }; },
    updateNote: (id, updater) => { markers[id] = { ...markers[id], note: updater(markers[id].note || {}) }; },
    restoreMarker: (id, snap) => { markers[id] = { ...markers[id], ...snap }; },
    showMarker: () => {},
    createItem: (spec) => {
      n += 1;
      const id = `new-${n}`;
      markers[id] = { name: spec.name, moduleId: spec.moduleId, categoryId: spec.categoryId, pageNumber: spec.page, bounds: spec.bounds, checklistResponses: {} };
      return id;
    },
    getPageSize: () => ({ width: 1224, height: 792 }),
    ...rest,
  };
  const toolbox = createSurveyAgentToolbox({ getBridge: () => bridge, documentId: 'doc-fa' });
  return { bridge, toolbox, markers };
}

const marker = (name, categoryId, page, extra = {}) => ({ name, moduleId: categoryId === 'c-vav' ? 'hvac' : 'fa', categoryId, pageNumber: page, bounds: { x: 10, y: 10, width: 20, height: 20 }, checklistResponses: {}, ...extra });

test('kinds come from the project\'s own categories', () => {
  const kinds = templateKinds([{ name: 'Smoke Detector', tags: ['SD-3-04'] }, { name: 'Fire Alarm Pull Station' }, { name: 'VAV Box', tags: ['VAV-2-12'] }]);
  const smoke = kinds.find((k) => k.kind === 'smoke detector');
  assert.ok(smoke.words.includes('smoke detectors'));
  assert.ok(smoke.words.includes('detector'));
  assert.ok(smoke.codes.includes('sd'));
  const pull = kinds.find((k) => k.kind === 'fire alarm pull station');
  assert.ok(pull.words.includes('pull station'));
  assert.ok(pull.codes.includes('fapS'.toLowerCase()));
  assert.ok(kinds.find((k) => k.kind === 'vav box').codes.includes('vav'));
  // A tail two categories share is neither's.
  const two = templateKinds([{ name: 'Ceiling Speaker' }, { name: 'Wall Speaker' }]);
  assert.ok(two.every((k) => !k.words.includes('speaker')));
});

test('fire alarm: a described device by the floor in its tag, with Pass/Fail answers', async () => {
  const { bridge, toolbox, markers } = tradeBridge({
    markers: { a: marker('SD-3-04', 'c-smoke', 3), b: marker('SD-2-04', 'c-smoke', 2), h: marker('HS-3-04', 'c-horn', 3) },
  });
  const done = await runOfflineTurn({ text: 'Smoke detector 4 on the third floor, head installed pass, base wired fail', toolbox, bridge });
  assert.equal(done.changes.length, 1);
  assert.equal(markers.a.checklistResponses['l-head'].selection, 'Pass');
  assert.equal(markers.a.checklistResponses['l-base'].selection, 'Fail');
  assert.deepEqual(markers.b.checklistResponses, {});
  // Two fit with no floor said: ask, change nothing.
  const which = await runOfflineTurn({ text: 'smoke detector 4 head installed pass', toolbox, bridge });
  assert.deepEqual(which.changes, []);
  assert.match(which.reply, /More than one fits .*SD-2-04 \(page 2\), SD-3-04 \(page 3\)/);
});

test('fire alarm: "done" asks among this template\'s own stages', async () => {
  const { bridge, toolbox, markers } = tradeBridge({ markers: { a: marker('SD-3-04', 'c-smoke', 3) } });
  const asked = await runOfflineTurn({ text: 'Mark smoke detector 4 on the third floor done', toolbox, bridge });
  assert.equal(asked.reply, 'Which is "done" for SD-3-04: Rough-in, Trim or Tested? Nothing changed.');
  assert.equal(markers.a.entityId, undefined);
  const set = await runOfflineTurn({ text: 'Mark smoke detector 4 on the third floor tested', toolbox, bridge });
  assert.equal(set.changes.length, 1);
  assert.equal(markers.a.entityId, 'e-tested');
});

test('items brought from Walkthru or Plot: their own floor picks between twins', async () => {
  // Same tag on two floors; only the item's floor field tells them apart.
  const { bridge, toolbox, markers } = tradeBridge({
    currentModuleId: 'hvac',
    markers: { two: marker('VAV-12', 'c-vav', 1, { floor: 'Floor 2' }), three: marker('VAV-12', 'c-vav', 1, { floor: '3rd' }) },
  });
  const done = await runOfflineTurn({ text: 'VAV 12 second floor damper works yes', toolbox, bridge });
  assert.equal(done, null, '"yes" is not this template\'s answer: left for the server');
  const ok = await runOfflineTurn({ text: 'VAV box twelve on the second floor, damper works pass', toolbox, bridge });
  assert.equal(ok.changes.length, 1);
  assert.equal(markers.two.checklistResponses['l-damper'].selection, 'Pass');
  assert.deepEqual(markers.three.checklistResponses, {});
  const byCode = await runOfflineTurn({ text: 'VAV 12 third floor controller online fail', toolbox, bridge });
  assert.equal(markers.three.checklistResponses['l-ctrl'].selection, 'Fail');
  assert.equal(byCode.changes.length, 1);
});

test('a bare PDF: the tag on the plan becomes an item, then the answers go on it', async () => {
  const pages = [sheet(5, ['FIRST', 'FLOOR'], ['PS-1-07', 'PS-1-08']), sheet(6, ['SECOND', 'FLOOR'], ['PS-2-07'])];
  const { bridge, toolbox, markers } = tradeBridge({ pages });
  // No floor said: two tags fit, so it asks and adds nothing.
  const which = await planDescribedTurn('pull station 7 signage pass', bridge, toolbox);
  assert.match(which.ask, /More than one tag on the plan fits .*PS-1-07 \(page 5\).*PS-2-07 \(page 6\)/);
  assert.deepEqual(markers, {});
  const done = await runOfflineTurn({ text: 'Pull station 7 first floor, everything pass', toolbox, bridge });
  assert.equal(done.calls[0].name, 'create_item');
  const [id, made] = Object.entries(markers)[0];
  assert.equal(made.name, 'PS-1-07');
  assert.equal(made.categoryId, 'c-pull');
  assert.equal(made.pageNumber, 5);
  assert.equal(made.checklistResponses['l-mount'].selection, 'Pass');
  assert.equal(made.checklistResponses['l-sign'].selection, 'Pass');
  assert.equal(done.changes.length, 2);
  assert.match(done.reply, /^Added PS-1-07 \(Fire Alarm Pull Station\) on page 5\./);
  assert.doesNotMatch(done.reply, new RegExp(id));
  // Undo takes back the answers and the new item.
  toolbox.undo(done.changes);
  // Now it is an item: the next sentence finds it, not a second copy.
  markers.again = { ...made, checklistResponses: {} };
  delete markers[id];
  const next = await runOfflineTurn({ text: 'pull station 7 first floor signage fail', toolbox, bridge });
  assert.equal(next.calls[0].name, 'set_answers');
  assert.equal(markers.again.checklistResponses['l-sign'].selection, 'Fail');
});

test('a bare PDF with a kind two categories share: never guessed', async () => {
  const twins = {
    ...FIRE,
    modules: [{ id: 'fa', name: 'Fire', categories: [
      { id: 'x1', name: 'Smoke Detector', checklist: [{ id: 'l1', text: 'Head installed' }] },
      { id: 'x2', name: 'Smoke detectors', checklist: [{ id: 'l2', text: 'Head installed' }] },
    ] }],
  };
  const pages = [sheet(2, ['THIRD', 'FLOOR'], ['SD-3-09'])];
  const { bridge, toolbox, markers } = tradeBridge({ pages, template: twins });
  assert.equal(await runOfflineTurn({ text: 'smoke detector 9 third floor head installed pass', toolbox, bridge }), null);
  assert.deepEqual(markers, {});
});

test('with an item selected, "mark done" asks among the entities', () => {
  const { bridge } = fakeBridge({ selectedMarkerId: 'm118' });
  assert.equal(planOfflineTurn('mark done', bridge).ask, 'Which is "done" for D-118: Installed or Commissioned? Nothing changed.');
  assert.deepEqual(planOfflineTurn('mark commissioned', bridge).calls, [{ name: 'set_entity', input: { item_id: 'm118', entity_id: 'ent-commissioned' } }]);
});

// ---- What "done" means, asked once per project. ----

test('a state word the project taught is used; otherwise asked', () => {
  const { bridge } = fakeBridge();
  const learned = [{ kind: 'state', heard: 'Done', means: 'Commissioned' }];
  assert.deepEqual(planOfflineTurn('Mark D-118 done', bridge, { learned }).calls, [
    { name: 'set_entity', input: { item_id: 'm118', entity_id: 'ent-commissioned' } },
  ]);
  const asked = planOfflineTurn('Mark D-118 finished', bridge, { learned });
  assert.deepEqual(asked.pending, { itemId: 'm118', heard: 'finished' });
});

test('the answer to the question sets it and is remembered, saved later with no signal', async () => {
  const { bridge, markers } = fakeBridge({ projectId: 'proj-1' });
  const saved = [];
  const memory = {
    cached: () => saved,
    list: async () => saved,
    save: async () => { throw new Error('Failed to fetch'); },
    saveLater: (projectId, row) => { const r = { ...row, id: 'local-1', pending: true }; saved.push(r); return { row: r }; },
  };
  const toolbox = createSurveyAgentToolbox({ getBridge: () => bridge, documentId: 'doc-1', memory });
  const asked = await runOfflineTurn({ text: 'Mark D-118 done', toolbox, bridge, learned: saved });
  assert.match(asked.reply, /^Which is "done" for D-118: Installed or Commissioned\?/);
  const answered = await runOfflineTurn({ text: 'commissioned', toolbox, bridge, learned: saved, pending: asked.pending });
  assert.equal(markers.m118.entityId, 'ent-commissioned');
  assert.equal(answered.changes.length, 1);
  assert.match(answered.reply, /Saved on this device: "done" means Commissioned/);
  assert.deepEqual(saved.map((r) => [r.kind, r.heard, r.means]), [['state', 'done', 'Commissioned']]);
  // Next time, on another item, no question.
  const next = await runOfflineTurn({ text: 'Mark D-117 done', toolbox, bridge, learned: saved });
  assert.equal(markers.m117.entityId, 'ent-commissioned');
  assert.equal(next.changes.length, 1);
  // An answer that is no entity is not taken as one.
  assert.equal(await runOfflineTurn({ text: 'maybe', toolbox, bridge, learned: saved, pending: asked.pending }), null);
});

test('remember kind state takes only an entity of this template', async () => {
  const { bridge } = fakeBridge({ projectId: 'proj-1' });
  const rows = [];
  const memory = { cached: () => rows, list: async () => rows, save: async (p, row) => { const r = { ...row, id: 'r1' }; rows.push(r); return { row: r, before: null }; } };
  const toolbox = createSurveyAgentToolbox({ getBridge: () => bridge, documentId: 'doc-1', memory });
  assert.equal((await toolbox.run('remember', { kind: 'state', heard: 'done', means: 'Tested' })).isError, true);
  assert.equal((await toolbox.run('remember', { kind: 'state', heard: 'installed', means: 'Commissioned' })).isError, true);
  const ok = await toolbox.run('remember', { kind: 'state', heard: 'done', means: 'commissioned' });
  assert.equal(ok.isError, false);
  assert.deepEqual(rows[0], { kind: 'state', heard: 'done', means: 'Commissioned', id: 'r1' });
  // set_entity reads it too (the server agent's path).
  const set = await toolbox.run('set_entity', { item_id: 'm118', entity_id: 'done' });
  assert.equal(set.isError, false, set.content);
});

// ---- A device said by where it is. ----

const placed = (text, x, y, h = 10) => word(text, x, y, h);

test('by place: the item of that kind nearest a printed label, else ask', async () => {
  const pages = [{
    page: 3,
    source: 'text',
    words: [placed('THIRD', 600, 760, 18), placed('FLOOR', 680, 760, 18), placed('STAIR', 100, 100), placed('2', 140, 100), placed('LOBBY', 800, 500), placed('CORRIDOR', 400, 300)],
  }].map((p) => ({ ...p, sheet: sheetFloorOf(p.words) }));
  const box = (x, y) => ({ x, y, width: 20, height: 20 });
  const { bridge, toolbox, markers } = tradeBridge({
    pages,
    markers: {
      a: marker('SD-3-01', 'c-smoke', 3, { bounds: box(120, 120) }),
      b: marker('SD-3-02', 'c-smoke', 3, { bounds: box(790, 470) }),
      c: marker('SD-3-03', 'c-smoke', 3, { bounds: box(380, 280) }),
      d: marker('SD-3-04', 'c-smoke', 3, { bounds: box(440, 330) }),
      h: marker('HS-3-01', 'c-horn', 3, { bounds: box(805, 505) }),
    },
  });
  const byLobby = await runOfflineTurn({ text: 'the smoke detector by the lobby, head installed pass', toolbox, bridge });
  assert.equal(byLobby.changes.length, 1);
  assert.equal(markers.b.checklistResponses['l-head'].selection, 'Pass');
  const byStair = await runOfflineTurn({ text: 'smoke detector next to stair 2 base wired fail', toolbox, bridge });
  assert.equal(byStair.changes.length, 1);
  assert.equal(markers.a.checklistResponses['l-base'].selection, 'Fail');
  // Plural said, singular printed: "stairs" is STAIR.
  const found = JSON.parse((await toolbox.run('find_described', { description: 'the smoke detector by the stairs' })).content);
  assert.equal(found.by_place, true);
  assert.deepEqual(found.items.filter((i) => i.clear).map((i) => i.name), ['SD-3-01']);
  // Two about as near the corridor label: ask.
  const which = await runOfflineTurn({ text: 'smoke detector in the corridor head installed pass', toolbox, bridge });
  assert.deepEqual(which.changes, []);
  assert.match(which.reply, /More than one fits .*SD-3-03.*SD-3-04/);
  // No such label, or a free sentence: left for the server.
  assert.equal(await runOfflineTurn({ text: 'smoke detector by the kitchen head installed pass', toolbox, bridge }), null);
  assert.equal(await runOfflineTurn({ text: 'the smoke detector by the lobby looks loose', toolbox, bridge }), null);
});

test('by place on a bare PDF: the printed tag nearest the label becomes the item', async () => {
  const pages = [{
    page: 5,
    source: 'text',
    words: [placed('FIRST', 600, 760, 18), placed('FLOOR', 680, 760, 18), placed('EXIT', 100, 100), placed('PS-1-07', 120, 130), placed('PS-1-08', 900, 600)],
  }].map((p) => ({ ...p, sheet: sheetFloorOf(p.words) }));
  const { bridge, toolbox, markers } = tradeBridge({ pages });
  const done = await runOfflineTurn({ text: 'pull station by the exit signage pass', toolbox, bridge });
  assert.equal(done.calls[0].name, 'create_item');
  const made = Object.values(markers)[0];
  assert.equal(made.name, 'PS-1-07');
  assert.equal(made.checklistResponses['l-sign'].selection, 'Pass');
});

// ---- Scanned sheets. ----

test('a scanned sheet is read on the device, then the tag is found', async () => {
  const scanned = sheet(7, ['SECOND', 'FLOOR'], ['PS-2-03']);
  let readable = false;
  const recognized = [];
  const { bridge, toolbox, markers } = tradeBridge({
    readSheets: async () => (readable ? { pages: [scanned], unreadPages: [] } : { pages: [], unreadPages: [7, 8] }),
    recognizePage: async (page) => { recognized.push(page); if (page === 7) readable = true; return page === 7; },
    getCurrentPage: () => 7,
  });
  const done = await runOfflineTurn({ text: 'pull station 3 second floor signage pass', toolbox, bridge });
  assert.deepEqual(recognized, [7, 8]);
  assert.equal(done.calls[0].name, 'create_item');
  assert.equal(Object.values(markers)[0].name, 'PS-2-03');
  // The tool on its own: nothing left to read.
  const again = await toolbox.run('read_scanned_pages', { pages: null });
  assert.equal(again.content, 'Every page already has text to read.');
});
