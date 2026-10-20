import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAgentTools, installWebMcp } from '../src/agent/webmcp.js';

const viewer = (count = 5) => {
  const v = { page: 1, getPageCount: () => count, getCurrentPage: () => v.page, goToPage: (n) => { v.page = n; } };
  return v;
};

test('get_open_document reports pages', async () => {
  const v = viewer(); v.page = 3;
  const [get] = buildAgentTools(() => v);
  assert.deepEqual(JSON.parse(await get.execute({})), { pageCount: 5, currentPage: 3 });
  assert.equal(get.annotations.readOnlyHint, true);
});

test('go_to_page moves and checks range', async () => {
  const v = viewer();
  const go = buildAgentTools(() => v)[1];
  assert.match(await go.execute({ page: 4 }), /page 4 of 5/);
  assert.equal(v.page, 4);
  await assert.rejects(go.execute({ page: 9 }), /1 to 5/);
  await assert.rejects(go.execute({ page: 1.5 }));
});

test('no open document is a clear error', async () => {
  const [get] = buildAgentTools(() => null);
  await assert.rejects(get.execute({}), /No document/);
});

test('install only when the browser offers WebMCP and not turned off', () => {
  assert.equal(installWebMcp({ document: {} }), null);
  const names = [];
  const win = { document: { modelContext: { registerTool: (t) => { names.push(t.name); } } }, localStorage: { getItem: () => null } };
  assert.ok(installWebMcp(win));
  assert.deepEqual(names, ['survey_get_open_document', 'survey_go_to_page']);
  const off = { ...win, localStorage: { getItem: () => 'off' } };
  assert.equal(installWebMcp(off), null);
});
