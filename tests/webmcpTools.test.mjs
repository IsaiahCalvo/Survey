import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAgentTools, installWebMcp, pickActiveViewer } from '../src/agent/webmcp.js';

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

test('tools drive the tab on screen, not the last registered viewer', async () => {
  const hidden = viewer(4);
  hidden.page = 2;
  hidden.isActive = () => false;
  const shown = viewer(9);
  shown.page = 7;
  shown.isActive = () => true;
  const [get, go] = buildAgentTools(() => pickActiveViewer([hidden, shown]));
  assert.deepEqual(JSON.parse(await get.execute({})), { pageCount: 9, currentPage: 7 });
  assert.match(await go.execute({ page: 3 }), /page 3 of 9/);
  assert.equal(shown.page, 3);
  assert.equal(hidden.page, 2);
  assert.equal(pickActiveViewer([shown, hidden]), shown);
  assert.equal(pickActiveViewer([hidden, hidden]), null);
});

test('go_to_page does not claim success when the viewer cannot move', async () => {
  const v = viewer();
  v.goToPage = () => false;
  const go = buildAgentTools(() => v)[1];
  await assert.rejects(go.execute({ page: 3 }), /still opening/);
  assert.equal(v.page, 1);
});

test('page tools stay inside the active Space', async () => {
  const v = viewer(10);
  v.page = 5;
  v.getVisiblePages = () => [2, 5, 8];
  const [get, go] = buildAgentTools(() => v);
  assert.deepEqual(JSON.parse(await get.execute({})), { pageCount: 3, currentPage: 2 });
  assert.match(await go.execute({ page: 3 }), /page 3 of 3/);
  assert.equal(v.page, 8);
  await assert.rejects(go.execute({ page: 4 }), /1 to 3/);
  v.getVisiblePages = () => [];
  assert.deepEqual(JSON.parse(await get.execute({})), { pageCount: 0, currentPage: 0 });
  await assert.rejects(go.execute({ page: 1 }), /no pages/);
});
