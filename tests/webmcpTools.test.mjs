import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAgentTools, installWebMcp, makeAccessReader } from '../src/agent/webmcp.js';
import { checkAgentAccess } from '../src/agent/agentAccess.js';

const TIERS = {
  free: { features: ['basic_annotations', 'pdf_viewer', 'layers'] },
  pro: { features: ['basic_annotations', 'survey_tools', 'excel_export'] },
};

const viewer = (count = 5) => {
  const v = { page: 1, getPageCount: () => count, getCurrentPage: () => v.page, goToPage: (n) => { v.page = n; } };
  return v;
};
const tool = (tools, name) => tools.find((t) => t.name === name);
const open = async () => ({ signedIn: false });

test('get_open_document reports pages', async () => {
  const v = viewer(); v.page = 3;
  const get = tool(buildAgentTools({ getViewer: () => v, readAccess: open }), 'survey_get_open_document');
  assert.deepEqual(JSON.parse(await get.execute({})), { pageCount: 5, currentPage: 3 });
  assert.equal(get.annotations.readOnlyHint, true);
});

test('go_to_page moves and checks range', async () => {
  const v = viewer();
  const go = tool(buildAgentTools({ getViewer: () => v, readAccess: open }), 'survey_go_to_page');
  assert.match(await go.execute({ page: 4 }), /page 4 of 5/);
  assert.equal(v.page, 4);
  await assert.rejects(go.execute({ page: 9 }), /1 to 5/);
  await assert.rejects(go.execute({ page: 1.5 }));
});

test('no open document is a clear error', async () => {
  const get = tool(buildAgentTools({ getViewer: () => null, readAccess: open }), 'survey_get_open_document');
  await assert.rejects(get.execute({}), /No document/);
});

test('agent gets exactly the human role: viewer cannot do editor work', () => {
  assert.equal(checkAgentAccess({ minRole: 'viewer' }, { signedIn: true, role: 'viewer' }), null);
  assert.match(checkAgentAccess({ minRole: 'editor' }, { signedIn: true, role: 'viewer' }), /viewer.*needs editor/);
  assert.match(checkAgentAccess({ minRole: 'owner' }, { signedIn: true, role: 'editor' }), /needs owner/);
  assert.equal(checkAgentAccess({ minRole: 'editor' }, { signedIn: true, role: 'owner' }), null);
  assert.match(checkAgentAccess({ minRole: 'viewer' }, { signedIn: true, role: null }), /do not have access/);
  assert.match(checkAgentAccess({ minRole: 'viewer' }, { signedIn: false }), /Sign in/);
  assert.match(checkAgentAccess({ minRole: 'viewer' }, { signedIn: true, role: 'admin' }), /needs viewer/);
});

test('agent gets exactly the human plan: free cannot use Pro features', () => {
  assert.match(checkAgentAccess({ feature: 'excel_export' }, { signedIn: true, features: TIERS.free.features }), /plan/);
  assert.equal(checkAgentAccess({ feature: 'excel_export' }, { signedIn: true, features: TIERS.pro.features }), null);
  assert.equal(checkAgentAccess({ feature: 'excel_export' }, { signedIn: true, features: ['all'] }), null);
});

// A fake Supabase that answers like the real one for one signed-in user.
function fakeSupabase({ userId = 'u1', sub = null, role = null, rows = [] } = {}) {
  const calls = [];
  const query = (table) => {
    const q = {
      filters: [],
      select() { return q; },
      eq(k, v) { q.filters.push(['eq', k, v]); return q; },
      is(k, v) { q.filters.push(['is', k, v]); return q; },
      order() { return q; },
      limit() { calls.push({ table, filters: q.filters }); return Promise.resolve({ data: rows, error: null }); },
      maybeSingle() { return Promise.resolve({ data: table === 'user_subscriptions' ? sub : null, error: null }); },
    };
    return q;
  };
  return {
    calls,
    auth: { getSession: async () => ({ data: { session: userId ? { user: { id: userId } } : null } }) },
    from: query,
    rpc: async (name, args) => { calls.push({ rpc: name, args }); return { data: role, error: null }; },
  };
}

test('plan is read live: canceled Pro counts as free', async () => {
  const read = makeAccessReader(fakeSupabase({ sub: { tier: 'pro', status: 'canceled' } }), TIERS);
  assert.deepEqual((await read()).features, TIERS.free.features);
  const readPro = makeAccessReader(fakeSupabase({ sub: { tier: 'pro', status: 'active' } }), TIERS);
  assert.equal((await readPro()).tier, 'pro');
});

test('document role comes from the server and gates the tool', async () => {
  const sb = fakeSupabase({ role: 'viewer' });
  const tools = buildAgentTools({ supabase: sb, readAccess: makeAccessReader(sb, TIERS) });
  const docId = '0b6f2a52-1d1f-4a35-9a43-1a2b3c4d5e6f';
  assert.deepEqual(JSON.parse(await tool(tools, 'survey_get_document_role').execute({ document_id: docId })), { role: 'viewer' });
  assert.deepEqual(sb.calls.at(-1), { rpc: 'get_my_document_role', args: { doc_id: docId } });
  await assert.rejects(tool(tools, 'survey_get_document_role').execute({ document_id: 'x; drop' }), /document id/);
  const none = fakeSupabase({ role: null });
  const noneTools = buildAgentTools({ supabase: none, readAccess: makeAccessReader(none, TIERS) });
  await assert.rejects(tool(noneTools, 'survey_get_document_role').execute({ document_id: docId }), /do not have access/);
});

test('signed-out agent cannot list anything', async () => {
  const sb = fakeSupabase({ userId: null });
  const tools = buildAgentTools({ supabase: sb, readAccess: makeAccessReader(sb, TIERS) });
  await assert.rejects(tool(tools, 'survey_list_documents').execute({}), /Sign in/);
  assert.equal(sb.calls.length, 0);
});

test('list_documents uses the user session and hides archived items', async () => {
  const sb = fakeSupabase({ rows: [{ id: 'd1', name: 'A.pdf' }] });
  const tools = buildAgentTools({ supabase: sb, readAccess: makeAccessReader(sb, TIERS) });
  assert.deepEqual(JSON.parse(await tool(tools, 'survey_list_documents').execute({})), [{ id: 'd1', name: 'A.pdf' }]);
  assert.deepEqual(sb.calls.at(-1).filters, [['eq', 'archived', false], ['is', 'user_archived_at', null]]);
  await assert.rejects(tool(tools, 'survey_list_documents').execute({ project_id: 'bad' }), /project id/);
});

test('install only when the browser offers WebMCP and not turned off', () => {
  assert.equal(installWebMcp({ document: {} }), null);
  const names = [];
  const win = { document: { modelContext: { registerTool: (t) => { names.push(t.name); assert.equal(t.access, undefined); } } }, localStorage: { getItem: () => null } };
  assert.ok(installWebMcp(win, { supabase: fakeSupabase(), tierLimits: TIERS }));
  assert.ok(names.includes('survey_go_to_page') && names.includes('survey_whoami'));
  const off = { ...win, localStorage: { getItem: () => 'off' } };
  assert.equal(installWebMcp(off), null);
});

const DOC_ID = '0b6f2a52-1d1f-4a35-9a43-1a2b3c4d5e6f';
const fakeDoc = (ready = true) => {
  const added = [];
  const edited = [];
  const deleted = [];
  const markers = {
    'm1': { id: 'm1', page: 1, name: 'Door D-117', bounds: { x: 10, y: 20, width: 40, height: 30 } },
  };
  return {
    added,
    edited,
    deleted,
    markers,
    documentId: DOC_ID,
    surveyReady: () => ready,
    getPageSize: (p) => (p === 1 ? { width: 612, height: 792 } : null),
    addSurveyMarker: (page, b) => added.push({ page, ...b }),
    listSurveyMarkers: () => Object.values(markers),
    getSurveyMarker: (id) => markers[id] || null,
    editSurveyMarker: (id, b) => { if (!markers[id]) return { ok: false }; edited.push({ id, ...b }); return { ok: true }; },
    deleteSurveyMarker: (id) => { if (!markers[id]) return { ok: false }; deleted.push(id); return { ok: true }; },
  };
};
const markerTools = (role, doc) => {
  const sb = fakeSupabase({ role });
  return tool(buildAgentTools({ supabase: sb, getDocument: () => doc, readAccess: makeAccessReader(sb, TIERS) }), 'survey_add_marker');
};
const box = { page: 1, x: 10, y: 20, width: 100, height: 50 };

test('editor and owner agents can add a marker', async () => {
  for (const role of ['editor', 'owner']) {
    const doc = fakeDoc();
    assert.match(await markerTools(role, doc).execute(box), /Added/);
    assert.deepEqual(doc.added, [{ page: 1, x: 10, y: 20, width: 100, height: 50 }]);
  }
});

test('viewer agent cannot add a marker, and nothing is written', async () => {
  const doc = fakeDoc();
  await assert.rejects(markerTools('viewer', doc).execute(box), /viewer.*needs editor/);
  await assert.rejects(markerTools(null, doc).execute(box), /do not have access/);
  assert.equal(doc.added.length, 0);
});

test('marker must fit the page and needs survey mode', async () => {
  const doc = fakeDoc();
  await assert.rejects(markerTools('editor', doc).execute({ ...box, x: 600 }), /fit inside/);
  await assert.rejects(markerTools('editor', doc).execute({ ...box, page: 2 }), /not in the open document/);
  await assert.rejects(markerTools('editor', doc).execute({ ...box, width: 1 }), /fit inside/);
  await assert.rejects(markerTools('editor', fakeDoc(false)).execute(box), /Survey mode/);
  assert.equal(doc.added.length, 0);
});

test('agent cannot pick another document id to borrow its role', async () => {
  const doc = fakeDoc();
  const sb = fakeSupabase({ role: 'editor' });
  const add = tool(buildAgentTools({ supabase: sb, getDocument: () => doc, readAccess: makeAccessReader(sb, TIERS) }), 'survey_add_marker');
  await add.execute({ ...box, document_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' });
  assert.deepEqual(sb.calls.at(-1), { rpc: 'get_my_document_role', args: { doc_id: DOC_ID } });
});

const markerTool = (role, doc, name) => {
  const sb = fakeSupabase({ role });
  return tool(buildAgentTools({ supabase: sb, getDocument: () => doc, readAccess: makeAccessReader(sb, TIERS) }), name);
};

test('any role can list the markers on the plan', async () => {
  for (const role of ['viewer', 'editor', 'owner']) {
    const doc = fakeDoc();
    const list = JSON.parse(await markerTool(role, doc, 'survey_list_markers').execute({}));
    assert.deepEqual(list, [{ id: 'm1', page: 1, name: 'Door D-117', bounds: { x: 10, y: 20, width: 40, height: 30 } }]);
  }
  assert.equal(tool(buildAgentTools({ getDocument: () => fakeDoc(), readAccess: open }), 'survey_list_markers').annotations.readOnlyHint, true);
});

test('editor and owner agents can move a marker; viewer cannot', async () => {
  for (const role of ['editor', 'owner']) {
    const doc = fakeDoc();
    assert.match(await markerTool(role, doc, 'survey_edit_marker').execute({ marker_id: 'm1', x: 5, y: 5, width: 60, height: 40 }), /Moved/);
    assert.deepEqual(doc.edited, [{ id: 'm1', x: 5, y: 5, width: 60, height: 40 }]);
  }
  const doc = fakeDoc();
  await assert.rejects(markerTool('viewer', doc, 'survey_edit_marker').execute({ marker_id: 'm1', x: 5, y: 5, width: 60, height: 40 }), /viewer.*needs editor/);
  assert.equal(doc.edited.length, 0);
});

test('editing checks the box fits the page, the marker exists, and survey mode', async () => {
  const doc = fakeDoc();
  const edit = (args) => markerTool('editor', doc, 'survey_edit_marker').execute(args);
  await assert.rejects(edit({ marker_id: 'm1', x: 600, y: 5, width: 60, height: 40 }), /fit inside/);
  await assert.rejects(edit({ marker_id: 'm1', x: 5, y: 5, width: 1, height: 40 }), /fit inside/);
  await assert.rejects(edit({ marker_id: 'nope', x: 5, y: 5, width: 60, height: 40 }), /No marker/);
  await assert.rejects(markerTool('editor', fakeDoc(false), 'survey_edit_marker').execute({ marker_id: 'm1', x: 5, y: 5, width: 60, height: 40 }), /Survey mode/);
  assert.equal(doc.edited.length, 0);
});

test('delete needs confirm:true and editor access, and nothing goes without it', async () => {
  const doc = fakeDoc();
  const del = (args) => markerTool('editor', doc, 'survey_delete_marker').execute(args);
  assert.match(await del({ marker_id: 'm1' }), /Not deleted.*confirm: true/s);
  assert.equal(doc.deleted.length, 0);
  assert.match(await del({ marker_id: 'm1', confirm: false }), /Not deleted/);
  assert.equal(doc.deleted.length, 0);
  assert.match(await del({ marker_id: 'm1', confirm: true }), /Deleted Door D-117/);
  assert.deepEqual(doc.deleted, ['m1']);
});

test('viewer agent cannot delete a marker, confirm or not', async () => {
  const doc = fakeDoc();
  await assert.rejects(markerTool('viewer', doc, 'survey_delete_marker').execute({ marker_id: 'm1', confirm: true }), /viewer.*needs editor/);
  await assert.rejects(markerTool(null, doc, 'survey_delete_marker').execute({ marker_id: 'm1', confirm: true }), /do not have access/);
  assert.equal(doc.deleted.length, 0);
});

test('delete of a missing marker is a clear error', async () => {
  const doc = fakeDoc();
  await assert.rejects(markerTool('owner', doc, 'survey_delete_marker').execute({ marker_id: 'gone', confirm: true }), /No marker/);
  assert.equal(doc.deleted.length, 0);
});

test('a marker the person may not change reports a refusal, not a false success', async () => {
  // The in-app gate silently drops another author's or a locked marker; the
  // bridge returns {ok:false} so the agent is never told a change happened.
  const denied = { ...fakeDoc(), editSurveyMarker: () => ({ ok: false, reason: 'not-allowed' }), deleteSurveyMarker: () => ({ ok: false, reason: 'not-allowed' }) };
  await assert.rejects(markerTool('editor', denied, 'survey_edit_marker').execute({ marker_id: 'm1', x: 5, y: 5, width: 60, height: 40 }), /belongs to someone else/);
  await assert.rejects(markerTool('editor', denied, 'survey_delete_marker').execute({ marker_id: 'm1', confirm: true }), /belongs to someone else/);
  const locked = { ...fakeDoc(), editSurveyMarker: () => ({ ok: false, reason: 'locked' }) };
  await assert.rejects(markerTool('owner', locked, 'survey_edit_marker').execute({ marker_id: 'm1', x: 5, y: 5, width: 60, height: 40 }), /locked/);
});

// --- Annotation write tools (behind the annotation-agent flag) --------------

const fakeAnnoDoc = () => {
  const notes = {
    a1: { id: 'a1', page: 1, type: 'Textbox', text: 'hi', box: { x: 10, y: 10, width: 160, height: 24 } },
  };
  const addedNotes = [];
  const editedNotes = [];
  const deletedNotes = [];
  const addedShapes = [];
  return {
    ...fakeDoc(),
    notes,
    addedNotes,
    editedNotes,
    deletedNotes,
    addedShapes,
    listAnnotations: () => Object.values(notes).map(({ id, page, type, text, box }) => ({ id, page, type, text, box })),
    findAnnotation: (id) => (notes[id] ? { page: notes[id].page, index: 0, obj: notes[id] } : null),
    addTextNote: (args) => { addedNotes.push(args); return { ok: true }; },
    editTextNote: (id, patch) => { if (!notes[id]) return { ok: false, reason: 'not-found' }; editedNotes.push({ id, ...patch }); return { ok: true }; },
    deleteAnnotation: (id) => { if (!notes[id]) return { ok: false, reason: 'not-found' }; deletedNotes.push(id); return { ok: true }; },
    addShape: (args) => { addedShapes.push(args); return { ok: true, id: 's1' }; },
    addLine: (args) => { addedShapes.push({ kind: 'line', ...args }); return { ok: true, id: 'l1' }; },
    addPolygon: (args) => { addedShapes.push({ kind: 'poly', ...args }); return { ok: true, id: 'p1' }; },
    addCallout: (args) => { addedShapes.push({ kind: 'callout', ...args }); return { ok: true, id: 'c1' }; },
    addHighlight: async (args) => { addedShapes.push({ kind: 'highlight', ...args }); return { ok: true, id: 'h1' }; },
  };
};
const annoTools = (role, doc) => {
  const sb = fakeSupabase({ role });
  return buildAgentTools({ supabase: sb, getDocument: () => doc, readAccess: makeAccessReader(sb, TIERS), includeAnnotationTools: true });
};
const annoTool = (role, doc, name) => tool(annoTools(role, doc), name);

test('annotation tools are absent unless the flag turns them on', () => {
  const off = buildAgentTools({ getDocument: () => fakeAnnoDoc(), readAccess: open });
  assert.equal(tool(off, 'survey_add_text_note'), undefined);
  assert.equal(tool(off, 'survey_list_annotations'), undefined);
  const on = buildAgentTools({ getDocument: () => fakeAnnoDoc(), readAccess: open, includeAnnotationTools: true });
  assert.ok(tool(on, 'survey_add_text_note') && tool(on, 'survey_list_annotations'));
});

test('any role can list annotations; it is read-only', async () => {
  for (const role of ['viewer', 'editor', 'owner']) {
    const doc = fakeAnnoDoc();
    const list = JSON.parse(await annoTool(role, doc, 'survey_list_annotations').execute({}));
    assert.deepEqual(list, [{ id: 'a1', page: 1, type: 'Textbox', text: 'hi', box: { x: 10, y: 10, width: 160, height: 24 } }]);
  }
  assert.equal(annoTool('viewer', fakeAnnoDoc(), 'survey_list_annotations').annotations.readOnlyHint, true);
});

test('editor and owner agents can add a text note; viewer cannot', async () => {
  for (const role of ['editor', 'owner']) {
    const doc = fakeAnnoDoc();
    assert.match(await annoTool(role, doc, 'survey_add_text_note').execute({ page: 1, x: 10, y: 20, text: 'note' }), /Added a text note/);
    assert.equal(doc.addedNotes.length, 1);
    assert.equal(doc.addedNotes[0].text, 'note');
  }
  const doc = fakeAnnoDoc();
  await assert.rejects(annoTool('viewer', doc, 'survey_add_text_note').execute({ page: 1, x: 10, y: 20, text: 'note' }), /viewer.*needs editor/);
  await assert.rejects(annoTool(null, doc, 'survey_add_text_note').execute({ page: 1, x: 10, y: 20, text: 'note' }), /do not have access/);
  assert.equal(doc.addedNotes.length, 0);
});

test('adding a note checks empty text, the page, and off-page placement', async () => {
  const doc = fakeAnnoDoc();
  const add = (args) => annoTool('editor', doc, 'survey_add_text_note').execute(args);
  await assert.rejects(add({ page: 1, x: 10, y: 20, text: '   ' }), /empty/);
  await assert.rejects(add({ page: 2, x: 10, y: 20, text: 'x' }), /not in the open document/);
  await assert.rejects(add({ page: 1, x: 10, y: 10000, text: 'x' }), /inside the page/);
  await assert.rejects(add({ page: 1, x: 700, y: 20, text: 'x' }), /inside the page/);
  assert.equal(doc.addedNotes.length, 0);
  const offPage = { ...fakeAnnoDoc(), addTextNote: () => ({ ok: false, reason: 'off-page' }) };
  await assert.rejects(annoTool('editor', offPage, 'survey_add_text_note').execute({ page: 1, x: 10, y: 20, text: 'x' }), /inside the page/);
});

test('editor can change a note; refusals come through, not false success', async () => {
  const doc = fakeAnnoDoc();
  assert.match(await annoTool('editor', doc, 'survey_edit_text_note').execute({ annotation_id: 'a1', text: 'new' }), /Changed/);
  assert.deepEqual(doc.editedNotes, [{ id: 'a1', text: 'new' }]);
  await assert.rejects(annoTool('editor', doc, 'survey_edit_text_note').execute({ annotation_id: 'gone', text: 'x' }), /No annotation/);
  await assert.rejects(annoTool('editor', doc, 'survey_edit_text_note').execute({ annotation_id: 'a1', text: ' ' }), /empty/);
  await assert.rejects(annoTool('viewer', doc, 'survey_edit_text_note').execute({ annotation_id: 'a1', text: 'x' }), /viewer.*needs editor/);
  const denied = { ...fakeAnnoDoc(), editTextNote: () => ({ ok: false, reason: 'not-allowed' }) };
  await assert.rejects(annoTool('editor', denied, 'survey_edit_text_note').execute({ annotation_id: 'a1', text: 'x' }), /belongs to someone else or is locked/);
  const notText = { ...fakeAnnoDoc(), editTextNote: () => ({ ok: false, reason: 'not-a-text-note' }) };
  await assert.rejects(annoTool('editor', notText, 'survey_edit_text_note').execute({ annotation_id: 'a1', text: 'x' }), /not a text note/);
});

test('delete annotation needs confirm:true and editor access', async () => {
  const doc = fakeAnnoDoc();
  const del = (args) => annoTool('editor', doc, 'survey_delete_annotation').execute(args);
  assert.match(await del({ annotation_id: 'a1' }), /Not deleted.*confirm: true/s);
  assert.equal(doc.deletedNotes.length, 0);
  assert.match(await del({ annotation_id: 'a1', confirm: false }), /Not deleted/);
  assert.equal(doc.deletedNotes.length, 0);
  assert.match(await del({ annotation_id: 'a1', confirm: true }), /Deleted annotation a1/);
  assert.deepEqual(doc.deletedNotes, ['a1']);
  await assert.rejects(annoTool('editor', fakeAnnoDoc(), 'survey_delete_annotation').execute({ annotation_id: 'gone', confirm: true }), /No annotation/);
  await assert.rejects(annoTool('viewer', fakeAnnoDoc(), 'survey_delete_annotation').execute({ annotation_id: 'a1', confirm: true }), /viewer.*needs editor/);
});

test('delete annotation surfaces a gate refusal instead of a false success', async () => {
  const denied = { ...fakeAnnoDoc(), deleteAnnotation: () => ({ ok: false, reason: 'not-allowed' }) };
  await assert.rejects(annoTool('owner', denied, 'survey_delete_annotation').execute({ annotation_id: 'a1', confirm: true }), /belongs to someone else or is locked/);
});

test('shape tools follow the flag, and only editor/owner can add one', async () => {
  const off = buildAgentTools({ getDocument: () => fakeAnnoDoc(), readAccess: open });
  assert.equal(tool(off, 'survey_add_rectangle'), undefined);
  assert.equal(tool(off, 'survey_add_ellipse'), undefined);
  for (const name of ['survey_add_rectangle', 'survey_add_ellipse']) {
    for (const role of ['editor', 'owner']) {
      const doc = fakeAnnoDoc();
      assert.match(await annoTool(role, doc, name).execute({ page: 1, x: 10, y: 20, width: 100, height: 50 }), /Added a (rectangle|ellipse)/);
      assert.equal(doc.addedShapes.length, 1);
    }
    const doc = fakeAnnoDoc();
    await assert.rejects(annoTool('viewer', doc, name).execute({ page: 1, x: 10, y: 20, width: 100, height: 50 }), /viewer.*needs editor/);
    await assert.rejects(annoTool(null, doc, name).execute({ page: 1, x: 10, y: 20, width: 100, height: 50 }), /do not have access/);
    assert.equal(doc.addedShapes.length, 0);
  }
});

test('a shape must fit the page, and the right builder shape is used', async () => {
  const doc = fakeAnnoDoc();
  const rect = (args) => annoTool('editor', doc, 'survey_add_rectangle').execute(args);
  await assert.rejects(rect({ page: 1, x: 10, y: 20, width: 700, height: 50 }), /fit inside the page/);
  await assert.rejects(rect({ page: 1, x: 10, y: 780, width: 50, height: 50 }), /fit inside the page/);
  await assert.rejects(rect({ page: 2, x: 10, y: 20, width: 50, height: 50 }), /not in the open document/);
  assert.equal(doc.addedShapes.length, 0);
  await rect({ page: 1, x: 10, y: 20, width: 50, height: 50 });
  assert.equal(doc.addedShapes.at(-1).shape, 'rect');
  await annoTool('editor', doc, 'survey_add_ellipse').execute({ page: 1, x: 10, y: 20, width: 50, height: 50 });
  assert.equal(doc.addedShapes.at(-1).shape, 'ellipse');
});

test('a shape save blocked by a locked sibling is reported', async () => {
  const blocked = { ...fakeAnnoDoc(), addShape: () => ({ ok: false, reason: 'locked' }) };
  await assert.rejects(annoTool('editor', blocked, 'survey_add_rectangle').execute({ page: 1, x: 10, y: 20, width: 50, height: 50 }), /locked annotation on that page blocked/);
});

test('line tool: flag, role, bounds, arrow flag, and short-line refusal', async () => {
  assert.equal(tool(buildAgentTools({ getDocument: () => fakeAnnoDoc(), readAccess: open }), 'survey_add_line'), undefined);
  const doc = fakeAnnoDoc();
  assert.match(await annoTool('editor', doc, 'survey_add_line').execute({ page: 1, x1: 10, y1: 10, x2: 200, y2: 120, arrow: true }), /Added a arrow/);
  assert.equal(doc.addedShapes.at(-1).arrow, true);
  await assert.rejects(annoTool('viewer', doc, 'survey_add_line').execute({ page: 1, x1: 10, y1: 10, x2: 20, y2: 20 }), /viewer.*needs editor/);
  await assert.rejects(annoTool('editor', doc, 'survey_add_line').execute({ page: 1, x1: 10, y1: 10, x2: 9000, y2: 20 }), /inside the page/);
  await assert.rejects(annoTool('editor', doc, 'survey_add_line').execute({ page: 2, x1: 10, y1: 10, x2: 20, y2: 20 }), /not in the open document/);
  const shortLine = { ...fakeAnnoDoc(), addLine: () => ({ ok: false, reason: 'too-small' }) };
  await assert.rejects(annoTool('editor', shortLine, 'survey_add_line').execute({ page: 1, x1: 10, y1: 10, x2: 11, y2: 10 }), /too short/);
});

test('polygon tool: flag, role, point bounds, min points, and open/closed', async () => {
  assert.equal(tool(buildAgentTools({ getDocument: () => fakeAnnoDoc(), readAccess: open }), 'survey_add_polygon'), undefined);
  const doc = fakeAnnoDoc();
  const tri = [{ x: 10, y: 10 }, { x: 100, y: 10 }, { x: 50, y: 90 }];
  assert.match(await annoTool('editor', doc, 'survey_add_polygon').execute({ page: 1, points: tri }), /Added a polygon/);
  assert.equal(doc.addedShapes.at(-1).closed, true);
  assert.match(await annoTool('editor', doc, 'survey_add_polygon').execute({ page: 1, points: [{ x: 10, y: 10 }, { x: 100, y: 10 }], closed: false }), /Added a polyline/);
  assert.equal(doc.addedShapes.at(-1).closed, false);
  await assert.rejects(annoTool('editor', doc, 'survey_add_polygon').execute({ page: 1, points: [{ x: 10, y: 10 }, { x: 100, y: 10 }] }), /at least 3/);
  await assert.rejects(annoTool('editor', doc, 'survey_add_polygon').execute({ page: 1, points: [{ x: 10, y: 10 }, { x: 9000, y: 10 }, { x: 50, y: 90 }] }), /inside the page/);
  await assert.rejects(annoTool('viewer', doc, 'survey_add_polygon').execute({ page: 1, points: tri }), /viewer.*needs editor/);
});

test('callout tool: flag, role, empty text, and page bounds', async () => {
  assert.equal(tool(buildAgentTools({ getDocument: () => fakeAnnoDoc(), readAccess: open }), 'survey_add_callout'), undefined);
  const doc = fakeAnnoDoc();
  const args = { page: 1, text: 'see here', arrow_x: 100, arrow_y: 100, box_x: 160, box_y: 60 };
  assert.match(await annoTool('editor', doc, 'survey_add_callout').execute(args), /Added a callout/);
  assert.equal(doc.addedShapes.at(-1).kind, 'callout');
  assert.equal(doc.addedShapes.at(-1).text, 'see here');
  await assert.rejects(annoTool('editor', doc, 'survey_add_callout').execute({ ...args, text: '  ' }), /empty/);
  await assert.rejects(annoTool('editor', doc, 'survey_add_callout').execute({ ...args, arrow_x: 9000 }), /inside the page/);
  await assert.rejects(annoTool('editor', doc, 'survey_add_callout').execute({ ...args, page: 2 }), /not in the open document/);
  await assert.rejects(annoTool('viewer', doc, 'survey_add_callout').execute(args), /viewer.*needs editor/);
});

test('highlight tool: flag, role, empty text, passes through, and reason codes', async () => {
  assert.equal(tool(buildAgentTools({ getDocument: () => fakeAnnoDoc(), readAccess: open }), 'survey_add_highlight'), undefined);
  const doc = fakeAnnoDoc();
  assert.match(await annoTool('editor', doc, 'survey_add_highlight').execute({ page: 1, search_text: 'General Notes' }), /Highlighted "General Notes" on page 1/);
  assert.equal(doc.addedShapes.at(-1).kind, 'highlight');
  assert.equal(doc.addedShapes.at(-1).searchText, 'General Notes');
  // Optional color/opacity/occurrence reach the bridge.
  await annoTool('editor', doc, 'survey_add_highlight').execute({ page: 1, search_text: 'x', color: '#abcdef', opacity: 40, occurrence: 2 });
  assert.equal(doc.addedShapes.at(-1).color, '#abcdef');
  assert.equal(doc.addedShapes.at(-1).opacity, 40);
  assert.equal(doc.addedShapes.at(-1).occurrence, 2);
  await assert.rejects(annoTool('editor', doc, 'survey_add_highlight').execute({ page: 1, search_text: '  ' }), /empty/);
  await assert.rejects(annoTool('editor', doc, 'survey_add_highlight').execute({ page: 2, search_text: 'x' }), /not in the open document/);
  await assert.rejects(annoTool('viewer', doc, 'survey_add_highlight').execute({ page: 1, search_text: 'x' }), /viewer.*needs editor/);
  const noMatch = { ...fakeAnnoDoc(), addHighlight: async () => ({ ok: false, reason: 'no-match' }) };
  await assert.rejects(annoTool('editor', noMatch, 'survey_add_highlight').execute({ page: 1, search_text: 'nope' }), /Could not find that text/);
  const noText = { ...fakeAnnoDoc(), addHighlight: async () => ({ ok: false, reason: 'no-text' }) };
  await assert.rejects(annoTool('editor', noText, 'survey_add_highlight').execute({ page: 1, search_text: 'x' }), /no readable text/);
  const locked = { ...fakeAnnoDoc(), addHighlight: async () => ({ ok: false, reason: 'locked' }) };
  await assert.rejects(annoTool('editor', locked, 'survey_add_highlight').execute({ page: 1, search_text: 'x' }), /locked annotation on that page blocked/);
});

test('a save blocked by a locked sibling is reported, not a false success', async () => {
  // handleSaveAnnotationsWithTextMarkupAtomicity returns {lockedBlocked:true}
  // and writes nothing when a group holds a locked mark; the bridge turns that
  // into reason:'locked' so the agent is never told the write happened.
  const addBlocked = { ...fakeAnnoDoc(), addTextNote: () => ({ ok: false, reason: 'locked' }) };
  await assert.rejects(annoTool('editor', addBlocked, 'survey_add_text_note').execute({ page: 1, x: 10, y: 20, text: 'x' }), /locked annotation on that page blocked/);
  const editBlocked = { ...fakeAnnoDoc(), editTextNote: () => ({ ok: false, reason: 'locked' }) };
  await assert.rejects(annoTool('editor', editBlocked, 'survey_edit_text_note').execute({ annotation_id: 'a1', text: 'x' }), /locked annotation blocked the change/);
  const delBlocked = { ...fakeAnnoDoc(), deleteAnnotation: () => ({ ok: false, reason: 'locked' }) };
  await assert.rejects(annoTool('owner', delBlocked, 'survey_delete_annotation').execute({ annotation_id: 'a1', confirm: true }), /locked annotation blocked the delete/);
});
