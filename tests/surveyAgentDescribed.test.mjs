import test from 'node:test';
import assert from 'node:assert/strict';
import { parseDescribedTarget, scoreDescribedTag, sheetFloorOf, tagParts } from '../src/agent/spokenTag.js';
import { findDescribedOnPages } from '../src/agent/planText.js';
import { createSurveyAgentToolbox } from '../src/agent/surveyAgentTools.js';
import { SURVEY_AGENT_SYSTEM_PROMPT, buildSurveyAgentTools } from '../supabase/functions/_shared/surveyAgentSpec.js';

// "Find camera 6 on the 4th floor" on a security drawing set: the person
// says the kind, the number and maybe the floor, never the whole tag or the
// wing. Tags below are made up in the shapes such sets use.

test('what a person says becomes a kind, a number and a floor', () => {
  assert.deepEqual(
    { ...parseDescribedTarget('Find camera 6 on the 4th floor') },
    { kind: 'camera', kindWord: 'camera', number: 6, floor: 4, wing: null, code: null },
  );
  const west = parseDescribedTarget('camera six fourth floor west');
  assert.equal(west.number, 6);
  assert.equal(west.floor, 4);
  assert.equal(west.wing, 'w');
  assert.equal(parseDescribedTarget('cam twelve').kind, 'camera');
  assert.equal(parseDescribedTarget('cam twelve').number, 12);
  assert.equal(parseDescribedTarget('door one seventeen').number, 117, 'spoken digits run together');
  assert.equal(parseDescribedTarget('camera four oh six').number, 406);
  assert.equal(parseDescribedTarget('camera on level three number 2').floor, 3);
  assert.equal(parseDescribedTarget('where is camera six on four').number, 6, 'a filler word ends a number');
  assert.equal(parseDescribedTarget('that one, camera 3').number, 3, '"that one" is not a number');
  const typed = parseDescribedTarget('C-4-06');
  assert.equal(typed.floor, 4);
  assert.equal(typed.number, 6);
  assert.equal(typed.code, 'c');
  assert.equal(parseDescribedTarget('the camera by the stairs'), null, 'no number, nothing to look for');
});

test('the floor can be in the tag, glued to the number, or only on the sheet', () => {
  const target = parseDescribedTarget('camera 6 on the 4th floor');
  for (const tag of ['C-4-06', 'C-4-6', '4W-CAM-06', 'CAM-4E-06', 'CAM-406', 'CCTV 4-06']) {
    assert.ok(scoreDescribedTag(target, tag) >= 0.9, `${tag} is camera 6 on floor 4`);
  }
  assert.equal(scoreDescribedTag(target, 'C-3-06'), 0, 'another floor in the tag');
  assert.equal(scoreDescribedTag(target, 'C-4-16'), 0, 'another number');
  assert.equal(scoreDescribedTag(target, 'D-4-06'), 0, 'a door, not a camera');
  assert.equal(scoreDescribedTag(target, 'C-06'), 0.65, 'no floor anywhere: maybe, but weaker');
  assert.ok(scoreDescribedTag(target, 'C-06', { pageFloor: 4 }) >= 0.9, 'a fourth floor sheet');
  assert.equal(scoreDescribedTag(target, 'C-06', { pageFloor: 3 }), 0, 'a third floor sheet');
  assert.ok(scoreDescribedTag(target, 'Camera 6', { pageFloor: 4 }) >= 0.9, 'an item named the long way');
  assert.ok(scoreDescribedTag(target, '06', { category: 'Camera', pageFloor: 4 }) >= 0.9, 'the category says camera');
  assert.equal(scoreDescribedTag(target, '06', { category: 'Door', pageFloor: 4 }), 0);
  // The number is the last group, never the floor group before it.
  assert.equal(scoreDescribedTag(parseDescribedTarget('camera 4 on the 6th floor'), 'C-4-06', { pageFloor: 4 }), 0);
  assert.equal(scoreDescribedTag(parseDescribedTarget('camera 4'), 'C-4-06'), 0);
  // A floor written in the tag wins over the sheet it sits on.
  assert.equal(scoreDescribedTag(target, 'C-3-06', { pageFloor: 4 }), 0, 'a third-floor tag on a fourth-floor sheet');
  const west = parseDescribedTarget('camera 6 fourth floor west');
  assert.ok(scoreDescribedTag(west, '4W-CAM-06') > scoreDescribedTag(west, '4E-CAM-06'), 'the wing said wins when both fit');
  assert.equal(scoreDescribedTag(west, '4E-CAM-06', { pageFloor: 4, pageWing: 'w' }), 0, 'an east tag on a west sheet is not the west camera');
  assert.ok(scoreDescribedTag(west, '4W-CAM-06', { pageFloor: 4, pageWing: 'e' }) > 0, 'a west tag on an east sheet still is');
  assert.ok(scoreDescribedTag(parseDescribedTarget('cam four oh six'), 'C-4-06') >= 0.8, '"four oh six" reads the groups together');
  assert.deepEqual(tagParts('4W-CAM-06'), { letters: ['w', 'cam'], digits: ['4', '06'] });
});

const word = (text, x, y, height = 8) => ({ text, box: { x, y, width: text.length * height * 0.6, height } });

test("a sheet's floor comes from its title, big text first", () => {
  const title = [word('FOURTH', 600, 560, 18), word('FLOOR', 680, 560, 18), word('PLAN', 740, 560, 18), word('-', 790, 560, 18), word('WEST', 800, 560, 18)];
  assert.deepEqual(sheetFloorOf(title), { floor: 4, wing: 'w' });
  assert.deepEqual(sheetFloorOf([word('LEVEL', 10, 10), word('4', 50, 10)]), { floor: 4, wing: null });
  assert.deepEqual(sheetFloorOf([word('4TH', 10, 10), word('FLOOR', 40, 10)]), { floor: 4, wing: null });
  // A note naming another floor in small print does not move the title's floor.
  const noted = [...title, word('SEE', 10, 10, 6), word('3RD', 30, 10, 6), word('FLOOR', 50, 10, 6)];
  assert.equal(sheetFloorOf(noted).floor, 4);
  assert.deepEqual(sheetFloorOf([word('KEY', 1, 1)]), { floor: null, wing: null });
});

const sheet = (page, floorWords, tags) => ({
  page,
  words: [
    ...floorWords.map((t, i) => word(t, 600 + i * 70, 560, 18)),
    ...tags.map((t, i) => word(t, 40 + i * 80, 100 + i * 40)),
  ],
});

test('tags on the sheets that fit, best first, joined across words', () => {
  const pages = [
    sheet(8, ['THIRD', 'FLOOR'], ['C-06', 'C-07']),
    sheet(9, ['FOURTH', 'FLOOR', 'WEST'], ['C-05', 'C-06', 'D-06']),
    { page: 10, words: [word('FOURTH', 600, 560, 18), word('FLOOR', 670, 560, 18), word('C-', 40, 100), word('06', 52, 100)] },
    // A door split the same way: its "06" is not a camera of its own.
    { page: 11, words: [word('FOURTH', 600, 560, 18), word('FLOOR', 670, 560, 18), word('D-', 40, 100), word('06', 52, 100)] },
    // Camera 6 split after its floor: its "C-4-" alone is not camera 4.
    { page: 12, words: [word('FOURTH', 600, 560, 18), word('FLOOR', 670, 560, 18), word('C-4-', 40, 100), word('06', 59.2, 100)] },
  ];
  const target = parseDescribedTarget('camera 6 on the 4th floor');
  const found = findDescribedOnPages(target, pages, { score: scoreDescribedTag, sheetOf: sheetFloorOf });
  assert.deepEqual(found.map((m) => [m.page, m.text]), [[12, 'C-4- 06'], [9, 'C-06'], [10, 'C- 06']]);
  const four = findDescribedOnPages(parseDescribedTarget('camera 4 on the 4th floor'), pages, { score: scoreDescribedTag, sheetOf: sheetFloorOf });
  assert.deepEqual(four, []);
  assert.equal(found[0].sheetFloor, 4);
});

const TEMPLATE = {
  name: 'Security',
  answerSet: [{ value: 'Y' }, { value: 'N' }, { value: 'N/A' }],
  entities: [{ id: 'ent-gc', name: 'GC' }, { id: 'ent-done', name: '100% Complete' }],
  modules: [
    {
      id: 'mod-install',
      name: 'Installation',
      categories: [{ id: 'cat-cam-i', name: 'Camera', checklist: [{ id: 'i-cable', text: 'Cable Pulled' }, { id: 'i-stub', text: 'Stub-ups' }, { id: 'i-cam', text: 'Camera Installed' }] }],
    },
    {
      id: 'mod-cx',
      name: 'Commissioning',
      categories: [{ id: 'cat-cam-c', name: 'Camera', checklist: [{ id: 'c-ip', text: "Camera IP'd" }, { id: 'c-aim', text: 'Camera Aimed' }, { id: 'c-label', text: 'Camera Labeled' }] }],
    },
  ],
};

function bridgeWith(markers, extra = {}) {
  const calls = [];
  const bridge = {
    template: TEMPLATE,
    markers,
    documentId: 'doc-1',
    canEdit: true,
    currentModuleId: 'mod-install',
    setAnswers: (id, answers) => {
      calls.push(['setAnswers', id, answers.map((a) => `${a.checklistItemId}=${a.value}`).join(',')]);
      const responses = { ...markers[id].checklistResponses };
      for (const a of answers) responses[a.checklistItemId] = { selection: a.value };
      markers[id] = { ...markers[id], checklistResponses: responses };
    },
    setEntity: (id, entityId) => { markers[id] = { ...markers[id], entityId }; },
    updateNote: (id, updater) => { markers[id] = { ...markers[id], note: updater(markers[id].note || {}) }; },
    restoreMarker: (id, snap) => { markers[id] = { ...markers[id], checklistResponses: snap.checklistResponses, note: snap.note, entityId: snap.entityId }; },
    deleteMarker: (id) => { calls.push(['delete', id]); delete markers[id]; },
    showMarker: (id) => calls.push(['show', id]),
    showPlace: (page, box) => calls.push(['place', page, box.x]),
    getPageSize: () => ({ width: 1224, height: 792 }),
    ...extra,
  };
  return { bridge, calls };
}

test('find_described finds the item, then the plan tag, without the wing or whole tag', async () => {
  const pages = [
    { ...sheet(9, ['FOURTH', 'FLOOR', 'WEST'], ['C-05', 'C-06', 'C-07']), source: 'text' },
    { ...sheet(12, ['THIRD', 'FLOOR'], ['C-06']), source: 'text' },
  ].map((p) => ({ ...p, sheet: sheetFloorOf(p.words) }));
  const markers = {
    m25: { name: 'C-4-25', moduleId: 'mod-install', categoryId: 'cat-cam-i', pageNumber: 9, bounds: { x: 1, y: 1, width: 5, height: 5 }, checklistResponses: {} },
  };
  const { bridge, calls } = bridgeWith(markers, { readSheets: async () => ({ pages, unreadPages: [3] }) });
  const box = createSurveyAgentToolbox({ getBridge: () => bridge });
  const res = await box.run('find_described', { description: 'find camera 6 on the 4th floor', kind: 'camera', number: 6, floor: 4, wing: null });
  assert.equal(res.isError, false);
  const body = JSON.parse(res.content);
  assert.deepEqual(body.items, []);
  assert.deepEqual(body.plan.map((m) => [m.page, m.text]), [[9, 'C-06']]);
  assert.equal(body.pages_without_text, 1);
  const shown = await box.run('show_on_plan', { plan_match_id: body.plan[0].id });
  assert.equal(shown.isError, false);
  assert.deepEqual(calls.at(-1), ['place', 9, pages[0].words.find((w) => w.text === 'C-06').box.x]);

  // Once it is an item, the item comes back (and the plan tag says so).
  markers.m6 = { name: 'C-06', moduleId: 'mod-install', categoryId: 'cat-cam-i', pageNumber: 9, bounds: { x: 110, y: 130, width: 40, height: 20 }, checklistResponses: {} };
  const again = JSON.parse((await box.run('find_described', { description: 'camera six fourth floor', kind: null, number: null, floor: null, wing: null })).content);
  assert.deepEqual(again.items.map((i) => i.name), ['C-06']);
  assert.equal(again.items[0].sheet_floor, 4);
  assert.equal(again.plan[0].already_item.id, 'm6');
  assert.equal((await box.run('find_described', { description: 'the camera by the stairs' })).isError, true);
});

test('answers for the Commissioning lines go to the same camera in Commissioning, added on the same spot', async () => {
  const markers = {
    m6: { name: 'C-4-06', moduleId: 'mod-install', categoryId: 'cat-cam-i', pageNumber: 9, bounds: { x: 100, y: 120, width: 30, height: 30 }, checklistResponses: {} },
  };
  const created = [];
  const { bridge, calls } = bridgeWith(markers, {
    // Like the app: the new item shows up a moment later, after a render.
    createItem: (spec) => {
      created.push(spec);
      setTimeout(() => { markers.mcx = { name: spec.name, moduleId: spec.moduleId, categoryId: spec.categoryId, pageNumber: spec.page, bounds: spec.bounds, checklistResponses: {} }; }, 30);
      return 'mcx';
    },
  });
  const box = createSurveyAgentToolbox({ getBridge: () => bridge });
  const res = await box.run('set_answers', {
    item_id: 'm6',
    all_lines: 'Y',
    answers: [{ checklist_item_id: 'c-ip', value: 'Y' }, { checklist_item_id: 'c-aim', value: 'N' }, { checklist_item_id: 'c-label', value: 'N' }],
    note: 'Hit by a ladder.',
  });
  assert.equal(res.isError, false, res.content);
  assert.deepEqual(created, [{ name: 'C-4-06', moduleId: 'mod-cx', categoryId: 'cat-cam-c', entityId: null, page: 9, bounds: { x: 100, y: 120, width: 30, height: 30 } }]);
  assert.deepEqual(calls.filter((c) => c[0] === 'setAnswers'), [
    ['setAnswers', 'mcx', 'c-ip=Y,c-aim=N,c-label=N'],
    ['setAnswers', 'm6', 'i-cable=Y,i-stub=Y,i-cam=Y'],
  ]);
  assert.match(res.content, /Set 3 answers and a note on C-4-06\. Set 3 Commissioning answers on C-4-06\./);
  assert.equal(markers.m6.note.text, 'Hit by a ladder.');
  assert.equal(res.changes.length, 3, 'own answers, the added item, its answers');

  // A second time the Commissioning item exists: nothing is added.
  const twice = await box.run('set_answers', { item_id: 'm6', answers: [{ checklist_item_id: 'c-aim', value: 'Y' }] });
  assert.equal(twice.isError, false);
  assert.equal(created.length, 1);
  assert.equal(markers.mcx.checklistResponses['c-aim'].selection, 'Y');

  // One Undo takes the turn back. c-aim was changed again since, so it and
  // the Commissioning item holding it stay.
  assert.equal(box.undo(res.changes).kept, 2);
  assert.equal(markers.mcx.checklistResponses['c-aim'].selection, 'Y');
  assert.deepEqual(markers.m6.checklistResponses, {});
});

test('a line from no module of this item is still refused', async () => {
  const markers = { m6: { name: 'C-4-06', moduleId: 'mod-install', categoryId: 'cat-cam-i', checklistResponses: {} } };
  const { bridge } = bridgeWith(markers);
  const box = createSurveyAgentToolbox({ getBridge: () => bridge });
  const res = await box.run('set_answers', { item_id: 'm6', answers: [{ checklist_item_id: 'nope', value: 'Y' }] });
  assert.equal(res.isError, true);
  const off = await box.run('set_answers', { item_id: 'm6', answers: [{ checklist_item_id: 'c-ip', value: 'Y' }] });
  assert.equal(off.isError, true, 'not on the plan, so no Commissioning item can be added');
  assert.match(off.content, /not on the plan/);
});

test('the model is told how to find by description and to fill other modules in one call', () => {
  const names = buildSurveyAgentTools(['Y', 'N']).map((t) => t.function.name);
  assert.ok(names.includes('find_described'));
  assert.ok(names.includes('show_on_plan'));
  assert.match(SURVEY_AGENT_SYSTEM_PROMPT, /find_described/);
  assert.match(SURVEY_AGENT_SYSTEM_PROMPT, /Never ask for the wing or the full tag/);
  assert.match(SURVEY_AGENT_SYSTEM_PROMPT, /another module/);
  assert.match(SURVEY_AGENT_SYSTEM_PROMPT, /100% Complete/);
});

test('find_described keeps same-named devices on different floors, and folds module copies', async () => {
  const markers = {
    a: { name: 'C-06', moduleId: 'mod-install', categoryId: 'cat-cam-i', pageNumber: 3 },
    b: { name: 'C-06', moduleId: 'mod-install', categoryId: 'cat-cam-i', pageNumber: 4 },
    c: { name: 'C-06', moduleId: 'mod-cx', categoryId: 'cat-cam-c', pageNumber: 4 },
  };
  const { bridge } = bridgeWith(markers, { readSheets: async () => ({ pages: [], unreadPages: [3, 4] }) });
  const toolbox = createSurveyAgentToolbox({ getBridge: () => bridge });
  const res = await toolbox.run('find_described', { description: 'camera 6', kind: 'camera', number: 6, floor: null, wing: null });
  const ids = JSON.parse(res.content).items.map((m) => m.id).sort();
  assert.deepEqual(ids, ['a', 'b'], 'both floors stay; the Commissioning copy of b folds into it');
});

test("another floor's same-named item in the other module is not this camera's copy", async () => {
  const markers = {
    m6: { name: 'C-06', moduleId: 'mod-install', categoryId: 'cat-cam-i', pageNumber: 4, bounds: { x: 100, y: 120, width: 30, height: 30 }, checklistResponses: {} },
    cx3: { name: 'C-06', moduleId: 'mod-cx', categoryId: 'cat-cam-c', pageNumber: 3, bounds: { x: 100, y: 120, width: 30, height: 30 }, checklistResponses: {} },
  };
  const created = [];
  const { bridge, calls } = bridgeWith(markers, {
    createItem: (spec) => {
      created.push(spec);
      markers.cx4 = { name: spec.name, moduleId: spec.moduleId, categoryId: spec.categoryId, pageNumber: spec.page, bounds: spec.bounds, checklistResponses: {} };
      return 'cx4';
    },
  });
  const box = createSurveyAgentToolbox({ getBridge: () => bridge });
  const res = await box.run('set_answers', { item_id: 'm6', answers: [{ checklist_item_id: 'c-ip', value: 'Y' }] });
  assert.equal(res.isError, false, res.content);
  assert.equal(created.length, 1, 'added on page 4, beside the camera');
  assert.deepEqual(calls.filter((c) => c[0] === 'setAnswers'), [['setAnswers', 'cx4', 'c-ip=Y']]);
  assert.deepEqual(markers.cx3.checklistResponses, {}, 'the third-floor camera is untouched');
});

const THREE_MODULES = {
  ...TEMPLATE,
  modules: [
    ...TEMPLATE.modules,
    { id: 'mod-punch', name: 'Punch', categories: [{ id: 'cat-cam-p', name: 'Camera', checklist: [{ id: 'p-fix', text: 'Fixed' }] }] },
  ],
};

test('when one other module cannot take its answers, no module is written', async () => {
  const markers = {
    m6: { name: 'C-06', moduleId: 'mod-install', categoryId: 'cat-cam-i', pageNumber: 4, bounds: { x: 100, y: 120, width: 30, height: 30 }, checklistResponses: {} },
    cx: { name: 'C-06', moduleId: 'mod-cx', categoryId: 'cat-cam-c', pageNumber: 4, bounds: { x: 100, y: 120, width: 30, height: 30 }, checklistResponses: {} },
  };
  // No createItem: Punch has no item and none can be added.
  const { bridge, calls } = bridgeWith(markers, { template: THREE_MODULES });
  const box = createSurveyAgentToolbox({ getBridge: () => bridge });
  const res = await box.run('set_answers', { item_id: 'm6', answers: [{ checklist_item_id: 'c-ip', value: 'Y' }, { checklist_item_id: 'p-fix', value: 'Y' }] });
  assert.equal(res.isError, true);
  assert.match(res.content, /no Punch item/);
  assert.deepEqual(calls.filter((c) => c[0] === 'setAnswers'), [], 'Commissioning was not written first');
});

test('if adding an item fails after another module was written, that write can still be undone', async () => {
  const markers = {
    m6: { name: 'C-06', moduleId: 'mod-install', categoryId: 'cat-cam-i', pageNumber: 4, bounds: { x: 100, y: 120, width: 30, height: 30 }, checklistResponses: {} },
    cx: { name: 'C-06', moduleId: 'mod-cx', categoryId: 'cat-cam-c', pageNumber: 4, bounds: { x: 100, y: 120, width: 30, height: 30 }, checklistResponses: {} },
  };
  const { bridge } = bridgeWith(markers, { template: THREE_MODULES, createItem: () => null });
  const box = createSurveyAgentToolbox({ getBridge: () => bridge });
  const res = await box.run('set_answers', { item_id: 'm6', answers: [{ checklist_item_id: 'c-ip', value: 'Y' }, { checklist_item_id: 'p-fix', value: 'Y' }] });
  assert.match(res.content, /Could not add C-06 to Punch\. Nothing else changed\./);
  assert.equal(markers.cx.checklistResponses['c-ip'].selection, 'Y');
  const changes = res.changes || [res.change];
  assert.ok(changes.length >= 1, 'the Commissioning write comes back for Undo');
  box.undo(changes);
  assert.deepEqual(markers.cx.checklistResponses, {});
});
