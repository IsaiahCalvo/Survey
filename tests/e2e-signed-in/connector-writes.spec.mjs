// End-to-end trial of the outside MCP connector's WRITE tools (survey-mcp,
// behind the off-by-default 'survey-connector-writes' flag): a real OAuth agent
// with write access calls set_answers over the function's JSON-RPC, as the
// person, and an ALREADY-OPEN browser client converges to the change — proving
// the server-side CRDT write path (KAL-531), not a plain row write. Also:
// a read-only agent is refused, and with the flag off the tool is gone.
import crypto from 'node:crypto';
import * as Y from 'yjs';
import { E2E_ACCOUNTS, E2E_DOCUMENT } from './accounts.mjs';
import { agentSignIn } from './agentAuth.mjs';
import { adminClient, apiClientFor, expect, functionUrl, openSampleDocument, signIn, test } from './helpers.mjs';
import { syncSurveyMarkersToDoc } from '../../supabase/functions/_shared/surveyMarkerDocSync.js';
import { bytesToPgHex } from '../../supabase/functions/_shared/pgBytea.js';

const FLAG = 'survey-connector-writes';
const RUN = crypto.randomBytes(3).toString('hex');
// set_answers validates against the item's template category, so the seeded
// marker must point at a real category + checklist, linked to the document.
const TEMPLATE_ID = `e2e00000-0000-4000-8000-0000000c${RUN}`;
const CATEGORY_ID = `e2e-cat-${RUN}`;
const CHECKLIST_ID = `e2e-chk-${RUN}`;

async function setFlag(mode) {
  const { error } = await adminClient().from('feature_flags').upsert({ key: FLAG, mode });
  if (error) throw new Error(`set flag ${mode}: ${error.message}`);
}

// Seed a one-category template (default Y / N / N/A answers) owned by the owner
// and link it to the document, so the marker's category resolves.
async function seedTemplate() {
  const owner = await apiClientFor(E2E_ACCOUNTS.owner);
  const { data: { user } } = await owner.auth.getUser();
  const admin = adminClient();
  const config = {
    modules: [{ id: `mod-${RUN}`, name: 'General', categories: [
      { id: CATEGORY_ID, name: 'Door', checklist: [{ id: CHECKLIST_ID, text: 'Locked?' }] },
    ] }],
    entities: [],
  };
  const tpl = await admin.from('templates').upsert({ id: TEMPLATE_ID, user_id: user.id, name: `E2E ${RUN}`, config });
  if (tpl.error) throw new Error(`seed template: ${tpl.error.message}`);
  const link = await admin.from('document_templates').upsert({ document_id: E2E_DOCUMENT.id, template_id: TEMPLATE_ID, linked_by: user.id });
  if (link.error) throw new Error(`link template: ${link.error.message}`);
}

// Seed one survey marker into the document's Yjs annotation doc through the
// real append path, as the owner — the same way the app writes.
async function seedMarker(itemId) {
  const owner = await apiClientFor(E2E_ACCOUNTS.owner);
  const doc = new Y.Doc();
  syncSurveyMarkersToDoc(doc, {
    [itemId]: { id: itemId, pageNumber: 1, bounds: { x: 10, y: 10, width: 40, height: 30 }, categoryId: CATEGORY_ID, name: `E2E ${itemId}`, checklistResponses: {} },
  });
  const { error } = await owner.rpc('append_annotation_update', {
    p_document_id: E2E_DOCUMENT.id, p_client_id: `seed-${itemId}`, p_client_seq: 1, p_data: bytesToPgHex(Y.encodeStateAsUpdate(doc)),
  });
  if (error) throw new Error(`seed marker: ${error.message}`);
}

// One JSON-RPC call to the survey-mcp function with a Bearer token.
async function mcp(token, method, params) {
  const res = await fetch(functionUrl('survey-mcp'), {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });
  return res.json();
}
const toolText = (reply) => String(reply?.result?.content?.[0]?.text ?? '');
const toolNames = (reply) => (reply?.result?.tools || []).map((t) => t.name);

test.afterEach(async () => {
  await setFlag('off');
  // Cascades the document_templates link.
  await adminClient().from('templates').delete().eq('id', TEMPLATE_ID);
});

test('a write-scope agent sets an answer through the connector, and an open client converges', async ({ page, browser }) => {
  const itemId = `surveyMarker-${RUN}-ok`;
  const checklistItemId = CHECKLIST_ID;
  await seedTemplate();
  await seedMarker(itemId);
  await setFlag('on');

  // Do the agent's OAuth in its own context so the app page stays a clean,
  // separately-signed-in client (the consent page signs the person in too).
  const agentCtx = await browser.newContext();
  let tok;
  try {
    ({ tok } = await agentSignIn(await agentCtx.newPage(), E2E_ACCOUNTS.owner, `Writer agent ${RUN}`, 'Allow', { write: true }));
  } finally {
    await agentCtx.close();
  }

  // The owner has the document open — the concurrently-open client.
  await signIn(page, E2E_ACCOUNTS.owner);
  await openSampleDocument(page);

  // The write tools are offered (flag on + write scope), and the write lands.
  expect(toolNames(await mcp(tok.access_token, 'tools/list'))).toContain('set_answers');
  const reply = await mcp(tok.access_token, 'tools/call', {
    name: 'set_answers',
    arguments: { document_id: E2E_DOCUMENT.id, item_id: itemId, answers: [{ checklist_item_id: checklistItemId, value: 'N' }] },
  });
  expect(reply?.result?.isError, toolText(reply)).toBeFalsy();
  expect(toolText(reply)).toMatch(/"changed": ?true/);

  // The open client merged the WAL update and re-projected it to the mirror
  // (the connector write never touches document_annotations itself).
  const admin = adminClient();
  await expect.poll(async () => {
    const { data } = await admin.from('document_annotations')
      .select('checklist_responses').eq('document_id', E2E_DOCUMENT.id).eq('annotation_id', itemId).maybeSingle();
    return data?.checklist_responses?.[checklistItemId]?.selection ?? null;
  }, { timeout: 30_000 }).toBe('N');
});

test('a read-only agent is refused the write, and never sees the tool', async ({ page }) => {
  const itemId = `surveyMarker-${RUN}-ro`;
  await seedMarker(itemId);
  await setFlag('on');
  const { tok } = await agentSignIn(page, E2E_ACCOUNTS.owner, `Read-only agent ${RUN}`); // no write scope

  expect(toolNames(await mcp(tok.access_token, 'tools/list'))).not.toContain('set_answers');
  const reply = await mcp(tok.access_token, 'tools/call', {
    name: 'set_answers',
    arguments: { document_id: E2E_DOCUMENT.id, item_id: itemId, answers: [{ checklist_item_id: `cl-${RUN}`, value: 'N' }] },
  });
  expect(reply?.result?.isError).toBe(true);
  expect(toolText(reply)).toMatch(/can only read/i);

  // Nothing was written.
  const { data } = await adminClient().from('document_annotations')
    .select('checklist_responses').eq('document_id', E2E_DOCUMENT.id).eq('annotation_id', itemId).maybeSingle();
  expect(data?.checklist_responses?.[`cl-${RUN}`]).toBeUndefined();
});

test('with the flag off, even a write-scope agent has no write tool and is refused', async ({ page }) => {
  await setFlag('off');
  const { tok } = await agentSignIn(page, E2E_ACCOUNTS.owner, `Flag-off agent ${RUN}`, 'Allow', { write: true });

  expect(toolNames(await mcp(tok.access_token, 'tools/list'))).not.toContain('set_answers');
  const reply = await mcp(tok.access_token, 'tools/call', {
    name: 'set_answers',
    arguments: { document_id: E2E_DOCUMENT.id, item_id: `surveyMarker-${RUN}-off`, answers: [{ checklist_item_id: 'c', value: 'N' }] },
  });
  expect(reply?.result?.isError).toBe(true);
  expect(toolText(reply)).toMatch(/not turned on/i);
});
