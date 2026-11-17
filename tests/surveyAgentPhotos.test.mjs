// KAL-532: the Survey agent answers a question about a photo (Nightly flag
// agent-photo-questions), counts turns and take-backs per prompt version for
// people who opted in, and shows staff each account's agent cost.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSurveyAgentToolbox } from '../src/agent/surveyAgentTools.js';
import { runSurveyAgentTurn } from '../src/agent/surveyAgentClient.js';
import {
  SURVEY_AGENT_FEEDBACK_EVENTS,
  SURVEY_AGENT_PHOTO_LIMITS,
  SURVEY_AGENT_PROMPT_VERSION,
  SURVEY_AGENT_TOOL_NAMES,
  buildSurveyAgentTools,
  surveyAgentPhotoMessages,
} from '../supabase/functions/_shared/surveyAgentSpec.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

const TEMPLATE = {
  name: 'Security',
  modules: [{ id: 'mod-1', name: 'Installation', categories: [{ id: 'cat-door', name: 'Door', checklist: [{ id: 'chk-lock', text: 'Lock installed' }] }] }],
};
const photoRef = (n) => ({ id: `p${n}`, kind: 'photo', path: `doc-1/m117/p${n}.jpg` });

function bridgeWith(overrides = {}) {
  const read = [];
  const bridge = {
    template: TEMPLATE,
    markers: {
      m117: { name: 'D-117', moduleId: 'mod-1', categoryId: 'cat-door', checklistResponses: {} },
      m118: { name: 'D-118', moduleId: 'mod-1', categoryId: 'cat-door', checklistResponses: {} },
    },
    documentId: 'doc-1',
    canEdit: true,
    photosOf: (id) => (id === 'm117' ? [photoRef(1), photoRef(2)] : []),
    readMedia: async (ref) => { read.push(ref.id); return new Blob([ref.id], { type: 'image/jpeg' }); },
    ...overrides,
  };
  return { bridge, read };
}

test('ask_about_photo is sent only with photos on, never to WebMCP', () => {
  const names = (opts) => buildSurveyAgentTools(['Y', 'N'], opts).map((t) => t.function.name);
  assert.ok(!SURVEY_AGENT_TOOL_NAMES.includes('ask_about_photo'));
  assert.ok(names({ photos: true }).includes('ask_about_photo'));
  assert.ok(!names({ photos: true, webmcp: true }).includes('ask_about_photo'));
  const tool = buildSurveyAgentTools([], { photos: true }).find((t) => t.function.name === 'ask_about_photo');
  assert.deepEqual(tool.function.parameters.required, ['item_id', 'photo', 'attachment_id', 'question']);
});

test('the photo message carries the question and the image, and stays short', () => {
  const [system, user] = surveyAgentPhotoMessages('Is the reader mounted?', 'data:image/jpeg;base64,AAAA');
  assert.match(system.content, /only from what the photo shows/);
  assert.deepEqual(user.content[0], { type: 'text', text: 'Is the reader mounted?' });
  assert.deepEqual(user.content[1], { type: 'image_url', image_url: { url: 'data:image/jpeg;base64,AAAA' } });
  assert.match(surveyAgentPhotoMessages('x', 'd', 'es')[0].content, /Spanish/);
  assert.ok(SURVEY_AGENT_PHOTO_LIMITS.maxImageBytes <= 1_500_000);
});

test('the newest photo by default, or the one asked for', async () => {
  const { bridge, read } = bridgeWith();
  const asked = [];
  const box = createSurveyAgentToolbox({
    getBridge: () => bridge,
    askPhoto: async ({ blob, question }) => { asked.push([await blob.text(), question]); return 'Yes, the reader is mounted.'; },
  });
  const newest = await box.run('ask_about_photo', { item_id: 'm117', photo: null, attachment_id: null, question: 'Is the reader mounted?' });
  assert.equal(newest.isError, false, newest.content);
  assert.deepEqual(JSON.parse(newest.content), { photo: 'photo 2 of 2 on D-117', answer: 'Yes, the reader is mounted.' });
  const first = await box.run('ask_about_photo', { item_id: 'm117', photo: 1, attachment_id: null, question: 'What does the label say?' });
  assert.equal(JSON.parse(first.content).photo, 'photo 1 of 2 on D-117');
  assert.deepEqual(read, ['p2', 'p1']);
  assert.deepEqual(asked.map((a) => a[0]), ['p2', 'p1']);
});

test('a photo added in the chat can be asked about too', async () => {
  const { bridge } = bridgeWith();
  const attachments = new Map([['att-1', { file: new Blob(['att'], { type: 'image/png' }), kind: 'photo', name: 'IMG_1.png' }], ['att-2', { file: new Blob(['x']), kind: 'file', name: 'spec.pdf' }]]);
  const box = createSurveyAgentToolbox({ getBridge: () => bridge, attachments, askPhoto: async () => 'Two cables.' });
  const res = await box.run('ask_about_photo', { item_id: null, photo: null, attachment_id: 'att-1', question: 'How many cables?' });
  assert.deepEqual(JSON.parse(res.content), { photo: 'IMG_1.png', answer: 'Two cables.' });
  assert.equal((await box.run('ask_about_photo', { item_id: null, photo: null, attachment_id: 'att-2', question: 'q' })).isError, true);
});

test('plain refusals: no photos, a wrong number, both or neither given, photos off', async () => {
  const { bridge } = bridgeWith();
  const box = createSurveyAgentToolbox({ getBridge: () => bridge, askPhoto: async () => 'x' });
  assert.match((await box.run('ask_about_photo', { item_id: 'm118', photo: null, attachment_id: null, question: 'q' })).content, /D-118 has no photos/);
  assert.match((await box.run('ask_about_photo', { item_id: 'm117', photo: 3, attachment_id: null, question: 'q' })).content, /has 2 photos; say which, 1 to 2/);
  assert.equal((await box.run('ask_about_photo', { item_id: 'm117', photo: null, attachment_id: 'att-1', question: 'q' })).isError, true);
  assert.equal((await box.run('ask_about_photo', { item_id: null, photo: null, attachment_id: null, question: 'q' })).isError, true);
  const off = createSurveyAgentToolbox({ getBridge: () => bridge });
  assert.match((await off.run('ask_about_photo', { item_id: 'm117', photo: null, attachment_id: null, question: 'q' })).content, /not on here/);
});

test('a turn sends photos when on and returns the prompt version', async () => {
  const { bridge } = bridgeWith();
  const sent = [];
  const out = await runSurveyAgentTurn({
    userText: 'hi',
    call: async (body) => { sent.push(body); return { message: { content: 'Hi.' }, prompt_version: SURVEY_AGENT_PROMPT_VERSION }; },
    toolbox: createSurveyAgentToolbox({ getBridge: () => bridge }),
    answerValues: ['Y', 'N'],
    photos: true,
  });
  assert.equal(sent[0].photos, true);
  assert.equal(out.promptVersion, SURVEY_AGENT_PROMPT_VERSION);
  assert.match(SURVEY_AGENT_PROMPT_VERSION, /^p-[0-9a-f]{8}$/);
  assert.deepEqual([...SURVEY_AGENT_FEEDBACK_EVENTS], ['changed', 'undo', 'voice_undo']);
});

test('wiring: flag, edge function, migration, panel, rail, staff page, Settings', () => {
  assert.equal(FEATURE_FLAGS['agent-photo-questions'].stage, 'beta');
  const fn = readFileSync(new URL('../supabase/functions/survey-agent/index.ts', import.meta.url), 'utf8');
  assert.match(fn, /action: s\.enum\(\['status', 'transcribe', 'turn', 'speak', 'look', 'feedback'\]\)/);
  assert.match(fn, /if \(action === 'look'\)/);
  // Learning loop: only with "Help improve Survey" on.
  assert.match(fn, /improve_survey_opt_in\?\.on !== true\) return json\(200, \{ recorded: false \}\)/);
  assert.match(fn, /prompt_version: SURVEY_AGENT_PROMPT_VERSION/);
  assert.match(fn, /photos: body\.photos === true && Boolean\(visionModel\(\)\)/);
  const sql = readFileSync(new URL('../supabase/migrations/20261117180000_survey_agent_phase6.sql', import.meta.url), 'utf8');
  assert.match(sql, /check \(kind in \('turn', 'transcribe', 'speak', 'look'\)\)/);
  assert.match(sql, /\('agent-photo-questions', 'off'/);
  assert.match(sql, /where public\.is_feature_flag_admin\(\)/);
  assert.doesNotMatch(sql, /drop table|delete from|truncate/i);
  const panel = readFileSync(new URL('../src/components/SurveyAgentPanel.jsx', import.meta.url), 'utf8');
  assert.match(panel, /action: 'look'/);
  assert.match(panel, /sendFeedbackRef\.current\('undo', entry\.promptVersion\)/);
  const rail = readFileSync(new URL('../src/SurveySpacesRail.jsx', import.meta.url), 'utf8');
  assert.match(rail, /photosOf: \(annotationId\) =>/);
  const flags = readFileSync(new URL('../src/home/FeatureFlagsPage.jsx', import.meta.url), 'utf8');
  assert.match(flags, /staff_survey_agent_usage/);
  assert.match(flags, /staff_survey_agent_feedback/);
  const settings = readFileSync(new URL('../src/components/AccountSettings.jsx', import.meta.url), 'utf8');
  assert.match(settings, /data-agent-allowance/);
});

test('what is left on one floor, or of one kind', async () => {
  const template = {
    name: 'Security',
    modules: [{ id: 'mod-1', name: 'Installation', categories: [
      { id: 'cat-door', name: 'Door', checklist: [{ id: 'chk-lock', text: 'Lock installed' }] },
      { id: 'cat-cam', name: 'Camera', checklist: [{ id: 'chk-aim', text: 'Aimed' }] },
    ] }],
  };
  const { bridge } = bridgeWith({
    template,
    getCurrentPage: () => 1,
    markers: {
      d1: { name: 'D-101', moduleId: 'mod-1', categoryId: 'cat-door', pageNumber: 1, floor: 'Level 1', checklistResponses: {} },
      d2: { name: 'D-201', moduleId: 'mod-1', categoryId: 'cat-door', pageNumber: 2, floor: '2nd Floor', checklistResponses: { 'chk-lock': { selection: 'Y' } } },
      d3: { name: 'D-202', moduleId: 'mod-1', categoryId: 'cat-door', pageNumber: 3, floor: 'Floor 2', checklistResponses: {} },
      c1: { name: 'C-201', moduleId: 'mod-1', categoryId: 'cat-cam', pageNumber: 2, floor: '2', checklistResponses: {} },
    },
  });
  const box = createSurveyAgentToolbox({ getBridge: () => bridge });
  const run = async (args) => JSON.parse((await box.run('survey_status', { page: null, all_pages: false, category_id: null, floor: null, ...args })).content);
  const floor2 = await run({ floor: 'floor 2' });
  assert.equal(floor2.scope, 'floor floor 2');
  assert.equal(floor2.items, 3, 'Floor 2, 2nd Floor and 2 are one floor, across pages');
  assert.equal(floor2.done, 1);
  const doors = await run({ floor: '2', category_id: 'cat-door' });
  assert.equal(doors.scope, 'floor 2, Door');
  assert.deepEqual(doors.not_started.names, ['D-202']);
  assert.equal((await run({ category_id: 'cat-cam', all_pages: true })).items, 1);
  assert.equal((await run({})).items, 1, 'no filter: the page on screen, as before');
  assert.match((await box.run('survey_status', { page: null, all_pages: false, category_id: 'cat-x', floor: null })).content, /No category cat-x/);
  const bare = createSurveyAgentToolbox({ getBridge: () => bridgeWith().bridge });
  assert.match((await bare.run('survey_status', { page: null, all_pages: true, category_id: null, floor: '2' })).content, /No item in this survey has a floor set/);
});

test('"export the summary": walk_summary asks the app to save it at once', async () => {
  const { bridge } = bridgeWith();
  const box = createSurveyAgentToolbox({ getBridge: () => bridge });
  const saved = await box.run('walk_summary', { scope: 'all', page: null, save: true });
  assert.equal(saved.summary.save, true);
  assert.match(saved.summary.text, /D-117|Door/);
  const shown = await box.run('walk_summary', { scope: 'all', page: null, save: false });
  assert.equal(shown.summary.save, undefined);
  const spec = buildSurveyAgentTools(['Y', 'N']);
  assert.deepEqual(spec.find((t) => t.function.name === 'survey_status').function.parameters.required, ['page', 'all_pages', 'category_id', 'floor']);
  assert.ok(spec.find((t) => t.function.name === 'walk_summary').function.parameters.required.includes('save'));
  const panel = readFileSync(new URL('../src/components/SurveyAgentPanel.jsx', import.meta.url), 'utf8');
  assert.match(panel, /if \(result\.summary\?\.save\) saveSummaryRef\.current\?\.\(result\.summary\)/);
});
