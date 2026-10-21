// The in-memory survey and the pass/fail check for the Survey agent test set
// (tests/fixtures/survey-agent-eval.json), shared by the live run
// (scripts/survey-agent-eval.mjs) and the scripted-model test.
import { findTagOnPages } from '../src/agent/planText.js';

export function memoryBridge(fixture) {
  const markers = JSON.parse(JSON.stringify(fixture.markers));
  for (const m of Object.values(markers)) m.checklistResponses = {};
  const pages = Object.entries(fixture.plan?.pages || {}).map(([page, words]) => ({ page: Number(page), words, source: 'text' }));
  let added = 0;
  return {
    template: fixture.template,
    markers,
    canEdit: true,
    setAnswers: (id, list) => { for (const a of list) markers[id].checklistResponses[a.checklistItemId] = { selection: a.value }; },
    setEntity: (id, entityId) => { markers[id].entityId = entityId; },
    updateNote: (id, updater) => { markers[id].note = updater(markers[id].note || {}); },
    uploadMedia: async () => { throw new Error('no media in the test set'); },
    addMediaRefs: () => {},
    restoreMarker: () => {},
    showMarker: () => {},
    findOnPlan: async (text) => ({ matches: findTagOnPages(text, pages), unreadPages: [] }),
    getPageSize: () => fixture.plan?.pageSize || null,
    createItem: ({ name, moduleId, categoryId, entityId, page, bounds }) => {
      added += 1;
      const id = `new-${added}`;
      markers[id] = { name, moduleId, categoryId, entityId, pageNumber: page, bounds, checklistResponses: {}, created: true };
      return id;
    },
    deleteMarker: (id) => { delete markers[id]; },
  };
}

/** What is wrong with the survey after a case, as a list of problems (empty when it passed). */
export function evalProblems(bridge, changes, expect) {
  const problems = [];
  const created = Object.values(bridge.markers).filter((m) => m.created);
  if (expect.noChanges && changes.length) problems.push(`expected no changes, got: ${changes.map((c) => c.label).join(' | ')}`);
  const wantCreated = Object.keys(expect.created || {});
  for (const m of created) {
    if (!wantCreated.includes(m.name)) problems.push(`added ${m.name}, which was not asked for`);
  }
  for (const [name, want] of Object.entries(expect.created || {})) {
    const m = created.find((c) => c.name === name);
    if (!m) { problems.push(`${name} was not added`); continue; }
    if (want.category && m.categoryId !== want.category) problems.push(`${name} category: want ${want.category}, got ${m.categoryId}`);
    if (want.page && m.pageNumber !== want.page) problems.push(`${name} page: want ${want.page}, got ${m.pageNumber}`);
    for (const [item, value] of Object.entries(want.answers || {})) {
      const got = m.checklistResponses[item]?.selection || null;
      if (got !== value) problems.push(`${name} ${item}: want ${value}, got ${got}`);
    }
  }
  for (const [id, want] of Object.entries(expect)) {
    if (id === 'noChanges' || id === 'created') continue;
    const m = bridge.markers[id];
    for (const [item, value] of Object.entries(want.answers || {})) {
      const got = m.checklistResponses[item]?.selection || null;
      if (got !== value) problems.push(`${m.name} ${item}: want ${value}, got ${got}`);
    }
    for (const text of want.noteIncludes || []) {
      if (!String(m.note?.text || '').toLowerCase().includes(text.toLowerCase())) problems.push(`${m.name} note missing "${text}"`);
    }
    if (want.entity && m.entityId !== want.entity) problems.push(`${m.name} entity: want ${want.entity}, got ${m.entityId || null}`);
  }
  return problems;
}
