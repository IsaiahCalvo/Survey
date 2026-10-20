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

test('list_projects hides user-Archive but keeps downgrade-archived rows', async () => {
  const sb = fakeSupabase({ rows: [{ id: 'p1', name: 'Job' }] });
  const tools = buildAgentTools({ supabase: sb, readAccess: makeAccessReader(sb, TIERS) });
  assert.deepEqual(JSON.parse(await tool(tools, 'survey_list_projects').execute({})), [{ id: 'p1', name: 'Job' }]);
  assert.deepEqual(sb.calls.at(-1).filters, [['is', 'user_archived_at', null]]);
});

test('install only when the browser offers WebMCP and not turned off', () => {
  assert.equal(installWebMcp({ document: {} }), null);
  const names = [];
  const win = { document: { modelContext: { registerTool: (t) => { names.push(t.name); assert.equal(t.access, undefined); } } }, localStorage: { getItem: () => null } };
  assert.ok(installWebMcp(win, { supabase: fakeSupabase(), tierLimits: TIERS }));
  assert.ok(names.includes('survey_go_to_page') && names.includes('survey_whoami'));
  const off = { ...win, localStorage: { getItem: () => 'off' } };
  assert.equal(installWebMcp(off), null);
  const offlineNames = [];
  const offline = { document: { modelContext: { registerTool: (t) => { offlineNames.push(t.name); } } }, localStorage: { getItem: () => null } };
  assert.ok(installWebMcp(offline));
  assert.ok(offlineNames.includes('survey_get_open_document') && offlineNames.includes('survey_go_to_page'));
});
