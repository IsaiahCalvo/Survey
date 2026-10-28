// Survey agent memory (Nightly beta, plan 2026-10-27): names and note wording
// a project teaches the agent, kept in public.survey_agent_memory.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSurveyAgentToolbox } from '../src/agent/surveyAgentTools.js';
import { createAgentMemoryStore, learnedNameFor, memoryKey, rewordText } from '../src/agent/agentMemory.js';
import { SURVEY_AGENT_SYSTEM_PROMPT, SURVEY_AGENT_TOOL_NAMES, buildSurveyAgentTools } from '../supabase/functions/_shared/surveyAgentSpec.js';

// A tiny stand-in for the Supabase table: select / insert / update / delete
// with the unique (project, kind, folded heard) rule.
function fakeClient() {
  const rows = [];
  let n = 0;
  const client = {
    rows,
    from(table) {
      assert.equal(table, 'survey_agent_memory');
      const q = { filters: [], op: 'select', payload: null };
      const match = (r) => q.filters.every(([k, v]) => r[k] === v);
      const run = () => {
        if (q.op === 'insert') {
          const clash = rows.find((r) => r.project_id === q.payload.project_id && r.kind === q.payload.kind && memoryKey(r.heard) === memoryKey(q.payload.heard));
          if (clash) return { data: null, error: { message: 'duplicate key' } };
          n += 1;
          const row = { id: `r${n}`, created_at: `2026-10-27T00:00:0${n}Z`, ...q.payload };
          rows.push(row);
          return { data: row, error: null };
        }
        if (q.op === 'update') {
          const row = rows.find(match);
          Object.assign(row, q.payload);
          return { data: row, error: null };
        }
        if (q.op === 'delete') {
          for (let i = rows.length - 1; i >= 0; i -= 1) if (match(rows[i])) rows.splice(i, 1);
          return { data: null, error: null };
        }
        return { data: rows.filter(match), error: null };
      };
      const chain = {
        select: () => chain,
        insert: (payload) => { q.op = 'insert'; q.payload = payload; return chain; },
        update: (payload) => { q.op = 'update'; q.payload = payload; return chain; },
        delete: () => { q.op = 'delete'; return chain; },
        eq: (k, v) => { q.filters.push([k, v]); return chain; },
        order: () => chain,
        single: () => Promise.resolve(run()),
        then: (resolve, reject) => Promise.resolve(run()).then(resolve, reject),
      };
      return chain;
    },
  };
  return client;
}

const TEMPLATE = {
  name: 'Security',
  entities: [],
  modules: [{
    id: 'mod-1',
    name: 'Installation',
    categories: [{ id: 'cat-door', name: 'Door', checklist: [{ id: 'chk-frame', text: 'Frame installed' }, { id: 'chk-leaf', text: 'Door installed' }] }],
  }],
};

function setup({ projectId = 'proj-1', canEdit = true } = {}) {
  const markers = {
    m101: { name: 'D-1-01', moduleId: 'mod-1', categoryId: 'cat-door', checklistResponses: {}, note: { text: 'Door missing.' } },
    m103: { name: 'D-1-03', moduleId: 'mod-1', categoryId: 'cat-door', checklistResponses: {}, note: { text: 'Frame in, door MISSING. Missingness is a word.' } },
    m104: { name: 'D-1-04', moduleId: 'mod-1', categoryId: 'cat-door', checklistResponses: {}, note: { text: 'Door not installed.' } },
  };
  const bridge = {
    template: TEMPLATE,
    markers,
    documentId: 'doc-1',
    projectId,
    canEdit,
    setAnswers: (id, answers) => {
      const responses = { ...markers[id].checklistResponses };
      for (const a of answers) responses[a.checklistItemId] = { selection: a.value };
      markers[id] = { ...markers[id], checklistResponses: responses };
    },
    updateNote: (id, updater) => { markers[id] = { ...markers[id], note: updater(markers[id].note || {}) }; },
    restoreMarker: (id, snap) => { markers[id] = { ...markers[id], checklistResponses: snap.checklistResponses, note: snap.note }; },
  };
  const client = fakeClient();
  const memory = createAgentMemoryStore(client);
  const box = createSurveyAgentToolbox({ getBridge: () => bridge, memory });
  return { bridge, markers, client, memory, box };
}

test('a taught name finds its item: "D101" is D-1-01', async () => {
  const { box, client, markers } = setup();
  const saved = await box.run('remember', { kind: 'name', heard: 'D101', means: 'D-1-01' });
  assert.equal(saved.isError, false, saved.content);
  assert.match(saved.content, /"D101" means D-1-01/);
  assert.deepEqual(client.rows.map((r) => [r.project_id, r.kind, r.heard, r.means]), [['proj-1', 'name', 'D101', 'D-1-01']]);
  // Said the old way, it lands on D-1-01.
  const set = await box.run('set_answers', { item_name: 'd 101', answers: [{ checklist_item_id: 'chk-frame', value: 'Y' }] });
  assert.equal(set.isError, false, set.content);
  assert.equal(markers.m101.checklistResponses['chk-frame'].selection, 'Y');
  // A phrase works too, and the context lists both.
  await box.run('remember', { kind: 'name', heard: 'third door on the first floor', means: 'D-1-03' });
  const found = JSON.parse((await box.run('find_items', { query: 'Third door on the first floor', category_id: null })).content);
  assert.equal(found.matches[0].name, 'D-1-03');
  const ctx = JSON.parse((await box.run('get_survey_context', {})).content);
  assert.deepEqual(ctx.learned, { names: [['D101', 'D-1-01'], ['third door on the first floor', 'D-1-03']], wording: [] });
});

test('a name must point at a real item, and its own name is refused', async () => {
  const { box, client } = setup();
  const missing = await box.run('remember', { kind: 'name', heard: 'D9', means: 'D-9-99' });
  assert.equal(missing.isError, true);
  const own = await box.run('remember', { kind: 'name', heard: 'D-1-01', means: 'D-1-01' });
  assert.equal(own.isError, true);
  assert.equal(client.rows.length, 0);
});

test('the same heard replaces the old meaning, and Undo puts it back', async () => {
  const { box, client, memory } = setup();
  await box.run('remember', { kind: 'name', heard: 'D101', means: 'D-1-01' });
  const again = await box.run('remember', { kind: 'name', heard: 'd-101', means: 'D-1-03' });
  assert.match(again.content, /Replaced "D-1-01"/);
  assert.equal(client.rows.length, 1);
  assert.equal(client.rows[0].means, 'D-1-03');
  box.undo([again.change]);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(client.rows[0].means, 'D-1-01');
  assert.equal(learnedNameFor(memory.cached('proj-1'), 'D 101'), 'D-1-01');
});

test('wording: remember, tidy older notes whole-word, Undo puts the notes back', async () => {
  const { box, client, markers } = setup();
  const saved = await box.run('remember', { kind: 'wording', heard: 'missing', means: 'not installed' });
  assert.equal(saved.isError, false, saved.content);
  assert.equal(client.rows[0].kind, 'wording');
  const tidy = await box.run('tidy_notes', { from: 'missing', to: 'not installed' });
  assert.match(tidy.content, /in 2 notes/);
  assert.equal(markers.m101.note.text, 'Door not installed.');
  assert.equal(markers.m103.note.text, 'Frame in, door NOT INSTALLED. Missingness is a word.'.replace('NOT INSTALLED', 'Not installed'));
  assert.equal(markers.m104.note.text, 'Door not installed.');
  const result = box.undo(tidy.changes);
  assert.equal(result.reverted, 2);
  assert.equal(markers.m101.note.text, 'Door missing.');
  // A photo added after the rewording keeps the note as it is now.
  const again = await box.run('tidy_notes', { from: 'missing', to: 'not installed' });
  markers.m101 = { ...markers.m101, note: { ...markers.m101.note, media: [{ id: 'photo-1' }] } };
  box.undo(again.changes);
  assert.equal(markers.m101.note.text, 'Door not installed.');
  assert.deepEqual(markers.m101.note.media, [{ id: 'photo-1' }]);
  const none = await box.run('tidy_notes', { from: 'absent', to: 'not installed' });
  assert.match(none.content, /nothing changed/);
});

test('forget removes a saved name; Undo brings it back', async () => {
  const { box, client } = setup();
  await box.run('remember', { kind: 'name', heard: 'D101', means: 'D-1-01' });
  const gone = await box.run('forget', { heard: 'd101' });
  assert.equal(gone.isError, false, gone.content);
  assert.equal(client.rows.length, 0);
  box.undo([gone.change]);
  await new Promise((r) => setTimeout(r, 10));
  assert.deepEqual(client.rows.map((r) => r.heard), ['D101']);
  assert.equal((await box.run('forget', { heard: 'nothing' })).isError, true);
});

test('Undo of a remember still works after the row was removed and put back', async () => {
  const { box, client, memory } = setup();
  const saved = await box.run('remember', { kind: 'wording', heard: 'missing', means: 'not installed' });
  const row = memory.cached('proj-1')[0];
  await memory.remove('proj-1', row.id);
  await memory.restore('proj-1', row);
  assert.notEqual(client.rows[0].id, row.id);
  box.undo([saved.change]);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(client.rows.length, 0);
});

test('no project or a viewer: nothing is learned', async () => {
  const noProject = setup({ projectId: null });
  assert.match((await noProject.box.run('remember', { kind: 'wording', heard: 'missing', means: 'not installed' })).content, /not in a project/);
  const ctx = JSON.parse((await noProject.box.run('get_survey_context', {})).content);
  assert.equal(ctx.learned, undefined);
  const viewer = setup({ canEdit: false });
  assert.equal((await viewer.box.run('remember', { kind: 'wording', heard: 'missing', means: 'not installed' })).isError, true);
  assert.equal(viewer.client.rows.length, 0);
});

test('rewordText keeps whole words and a capital first letter', () => {
  assert.equal(rewordText('Missing door; door missing', 'missing', 'not installed'), 'Not installed door; door not installed');
  assert.equal(rewordText('missingness', 'missing', 'not installed'), 'missingness');
  assert.equal(rewordText('door not  put in', 'not put in', 'not installed'), 'door not installed');
});

test('the model gets remember, forget and tidy_notes; browser agents do not', () => {
  for (const name of ['remember', 'forget', 'tidy_notes']) {
    assert.ok(SURVEY_AGENT_TOOL_NAMES.includes(name), name);
    assert.ok(!buildSurveyAgentTools([], { webmcp: true }).some((t) => t.function.name === name), `${name} is not for WebMCP`);
  }
  assert.match(SURVEY_AGENT_SYSTEM_PROMPT, /call remember/);
  assert.match(SURVEY_AGENT_SYSTEM_PROMPT, /tidy_notes/);
});

test('the table: project roles read and write, outside agents never write, rows capped', () => {
  const sql = readFileSync(new URL('../supabase/migrations/20261028020000_survey_agent_memory.sql', import.meta.url), 'utf8');
  assert.match(sql, /enable row level security/);
  assert.match(sql, /for select to authenticated\s+using \(public\.user_can_access_project\(project_id, 'viewer'\)\)/);
  for (const op of ['insert', 'update', 'delete']) {
    assert.match(sql, new RegExp(`for ${op} to authenticated[\\s\\S]*?not public\\.is_agent_session\\(\\) and public\\.user_can_access_project\\(project_id, 'editor'\\)`), op);
  }
  assert.match(sql, /references public\.projects \(id\) on delete cascade/);
  assert.match(sql, />= 500/);
});

test('the panel and rail wire the store and the project', () => {
  const panel = readFileSync(new URL('../src/components/SurveyAgentPanel.jsx', import.meta.url), 'utf8');
  assert.equal((panel.match(/memory: agentMemory/g) || []).length, 2, 'both toolboxes get the store');
  const rail = readFileSync(new URL('../src/SurveySpacesRail.jsx', import.meta.url), 'utf8');
  assert.match(rail, /projectId: pdfFile\?\.projectId \|\| null/);
});
