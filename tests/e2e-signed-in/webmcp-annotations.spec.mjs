// End-to-end trial of the agent annotation-write tools (behind the
// annotation-agent flag) over the REAL WebMCP surface: a fake
// document.modelContext captures the tools the app registers, exactly as a
// WebMCP-capable browser would, and the spec drives them as the signed-in
// person would — list, add each kind, edit, delete, undo — on desktop and
// phone sizes, and checks a viewer's agent is refused the writes.
//
// The write tools are WebMCP-only (in-browser, as the signed-in person); the
// outside "link with a code" agent has read tools only (see
// agent-access.spec.mjs). So "the agent" here is the person's own browser
// session, and "refusal for a viewer" is the role gate.
import { E2E_ACCOUNTS } from './accounts.mjs';
import { expect, openSampleDocument, signIn, test } from './helpers.mjs';

// Install a capturing modelContext and turn the flag on BEFORE the app boots,
// so installWebMcp (main.jsx, gated on document.modelContext) registers the
// annotation tools into our capture.
async function armWebMcp(page) {
  await page.addInitScript(() => {
    try { window.localStorage.setItem('survey.flag.annotation-agent', '1'); } catch { /* ignore */ }
    const tools = [];
    window.__webmcpTools = tools;
    Object.defineProperty(document, 'modelContext', {
      configurable: true,
      value: {
        registerTool: (tool) => {
          const i = tools.findIndex((t) => t.name === tool.name);
          if (i >= 0) tools[i] = tool; else tools.push(tool);
          return { unregister() {} };
        },
      },
    });
  });
}

// Call a captured WebMCP tool by name and return its (string) result.
async function callTool(page, name, args = {}) {
  return page.evaluate(async ([n, a]) => {
    const tool = (window.__webmcpTools || []).find((t) => t.name === n);
    if (!tool) throw new Error(`tool ${n} not registered`);
    return tool.execute(a);
  }, [name, args]);
}

// Same, but expect a thrown refusal; return its message.
async function callToolExpectError(page, name, args = {}) {
  return page.evaluate(async ([n, a]) => {
    const tool = (window.__webmcpTools || []).find((t) => t.name === n);
    if (!tool) throw new Error(`tool ${n} not registered`);
    try { await tool.execute(a); return { ok: true }; }
    catch (err) { return { ok: false, message: String(err?.message || err) }; }
  }, [name, args]);
}

async function listAnnotations(page) {
  const raw = await callTool(page, 'survey_list_annotations');
  return JSON.parse(raw);
}

async function waitForTools(page) {
  await expect.poll(
    () => page.evaluate(() => (window.__webmcpTools || []).map((t) => t.name)),
    { timeout: 30_000 },
  ).toContain('survey_add_text_note');
}

test('editor agent: list, add each kind, edit, delete and undo over WebMCP', async ({ page }) => {
  await armWebMcp(page);
  await signIn(page, E2E_ACCOUNTS.editor);
  await openSampleDocument(page);
  await waitForTools(page);

  const before = await listAnnotations(page);
  const startCount = before.length;

  // Add each kind. Coordinates are small so they sit inside the fixture page.
  expect(await callTool(page, 'survey_add_text_note', { page: 1, x: 40, y: 40, text: 'Agent note' })).toMatch(/Added a text note/);
  expect(await callTool(page, 'survey_add_rectangle', { page: 1, x: 60, y: 60, width: 80, height: 40 })).toMatch(/Added a rectangle/);
  expect(await callTool(page, 'survey_add_ellipse', { page: 1, x: 60, y: 120, width: 80, height: 40 })).toMatch(/Added a ellipse/);
  expect(await callTool(page, 'survey_add_line', { page: 1, x1: 40, y1: 180, x2: 160, y2: 180, arrow: true })).toMatch(/Added a(n)? (arrow|line)/);
  expect(await callTool(page, 'survey_add_polygon', { page: 1, points: [{ x: 40, y: 200 }, { x: 90, y: 230 }, { x: 60, y: 270 }] })).toMatch(/Added a polygon/);
  expect(await callTool(page, 'survey_add_callout', { page: 1, text: 'Agent callout', arrow_x: 200, arrow_y: 200, box_x: 230, box_y: 180 })).toMatch(/Added a callout/);
  expect(await callTool(page, 'survey_add_highlight', { page: 1, search_text: 'Type your name' })).toMatch(/Highlighted/);

  const afterAdds = await listAnnotations(page);
  // Text note, 2 shapes, line, polygon and highlight list as normal annotations
  // (callouts have their own structure and may not appear in this list).
  expect(afterAdds.length).toBeGreaterThanOrEqual(startCount + 6);

  // Edit a text note: find the one we added and change its text.
  const note = afterAdds.find((a) => a.type === 'Textbox' && /Agent note/.test(a.text || ''));
  expect(note, 'added text note is listed').toBeTruthy();
  expect(await callTool(page, 'survey_edit_text_note', { annotation_id: note.id, text: 'Agent note edited' })).toMatch(/Changed the note text/);
  const afterEdit = await listAnnotations(page);
  expect(afterEdit.find((a) => a.id === note.id)?.text).toMatch(/Agent note edited/);

  // Delete that note: confirm-first, then for real.
  expect(await callTool(page, 'survey_delete_annotation', { annotation_id: note.id })).toMatch(/Not deleted/);
  expect(await callTool(page, 'survey_delete_annotation', { annotation_id: note.id, confirm: true })).toMatch(/Deleted annotation/);
  expect((await listAnnotations(page)).some((a) => a.id === note.id)).toBe(false);

  // Undo restores the delete (one Undo).
  await page.keyboard.press('Control+z');
  await expect.poll(async () => (await listAnnotations(page)).some((a) => a.id === note.id)).toBe(true);
});

test('viewer agent is refused every annotation write', async ({ page }) => {
  await armWebMcp(page);
  await signIn(page, E2E_ACCOUNTS.viewer);
  await openSampleDocument(page);
  await waitForTools(page);

  // Reading is allowed.
  const list = await listAnnotations(page);
  expect(Array.isArray(list)).toBe(true);

  // Every write throws an access refusal — never a silent success.
  for (const [name, args] of [
    ['survey_add_text_note', { page: 1, x: 40, y: 40, text: 'nope' }],
    ['survey_add_rectangle', { page: 1, x: 60, y: 60, width: 40, height: 40 }],
    ['survey_add_callout', { page: 1, text: 'nope', arrow_x: 100, arrow_y: 100, box_x: 130, box_y: 90 }],
    ['survey_add_highlight', { page: 1, search_text: 'Type your name' }],
  ]) {
    const res = await callToolExpectError(page, name, args);
    expect(res.ok, `${name} should be refused`).toBe(false);
  }
});

test('phone size: the agent can still add and the write lands', async ({ page }) => {
  // Open at desktop width (the mobile Documents-list open flow is the Mobile
  // web thread's surface, not what this trial checks), then shrink to a phone
  // viewport before driving the tool, so the agent write runs at phone size.
  await armWebMcp(page);
  await signIn(page, E2E_ACCOUNTS.editor);
  await openSampleDocument(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await waitForTools(page);

  const before = (await listAnnotations(page)).length;
  expect(await callTool(page, 'survey_add_text_note', { page: 1, x: 40, y: 40, text: 'Phone note' })).toMatch(/Added a text note/);
  await expect.poll(async () => (await listAnnotations(page)).length).toBeGreaterThan(before);
});
