import { E2E_ACCOUNTS, E2E_DOCUMENT, E2E_PROJECT } from './accounts.mjs';
import {
  adminClient,
  clientFromPageSession,
  expect,
  openSampleDocument,
  signIn,
  test,
} from './helpers.mjs';

const viewOnlyBanner = (page) => page.getByText('View-only access', { exact: true });

test('owner sees the sample document in Documents and opens it with full access', async ({ page }) => {
  await signIn(page, E2E_ACCOUNTS.owner);
  const row = page.getByText(E2E_DOCUMENT.name, { exact: true }).first();
  await expect(row).toBeVisible();
  await expect(page.getByText(E2E_PROJECT.name).first()).toBeVisible();

  await openSampleDocument(page);
  await expect(viewOnlyBanner(page)).toHaveCount(0);

  const client = await clientFromPageSession(page);
  const { data: role, error } = await client.rpc('get_my_document_role', { doc_id: E2E_DOCUMENT.id });
  expect(error).toBeNull();
  expect(role).toBe('owner');
});

test('editor opens the shared document without the view-only notice', async ({ page }) => {
  await signIn(page, E2E_ACCOUNTS.editor);
  await openSampleDocument(page);
  await expect(viewOnlyBanner(page)).toHaveCount(0);

  const client = await clientFromPageSession(page);
  const { data: role, error } = await client.rpc('get_my_document_role', { doc_id: E2E_DOCUMENT.id });
  expect(error).toBeNull();
  expect(role).toBe('editor');
});

test('viewer can open the shared document but cannot edit it', async ({ page }) => {
  await signIn(page, E2E_ACCOUNTS.viewer);
  await openSampleDocument(page);
  await expect(viewOnlyBanner(page).first()).toBeVisible();
  await expect(page.getByText("You have view-only access to this document.", { exact: false }).first()).toBeVisible();

  // The server enforces it too: with the session the UI sign-in produced, a
  // write to the document matches no row (RLS) and changes nothing.
  const client = await clientFromPageSession(page);
  const { data: role } = await client.rpc('get_my_document_role', { doc_id: E2E_DOCUMENT.id });
  expect(role).toBe('viewer');
  const { data: updated, error } = await client
    .from('documents')
    .update({ name: 'viewer-was-here.pdf' })
    .eq('id', E2E_DOCUMENT.id)
    .select('id');
  expect(error).toBeNull();
  expect(updated).toEqual([]);

  const { data: row } = await adminClient().from('documents').select('name').eq('id', E2E_DOCUMENT.id).single();
  expect(row.name).toBe(E2E_DOCUMENT.name);
});
