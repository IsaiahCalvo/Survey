// Shared helpers for the signed-in E2E specs. Every spec signs in through the
// real AuthModal (email + password) against the local stack.
import { test as base, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { E2E_DOCUMENT } from './accounts.mjs';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost']);

// Every page gets a context that cannot reach the internet: the dev build
// posts analytics to the production host, and nothing in this suite may touch
// production. Local Vite + local Supabase only.
export const test = base.extend({
  context: async ({ context }, use) => {
    await context.route(
      (url) => !['data:', 'blob:'].includes(url.protocol) && !LOCAL_HOSTS.has(url.hostname),
      (route) => route.abort('blockedbyclient'),
    );
    await use(context);
  },
});
export { expect };

/** Sign in through the app's own sign-in dialog and wait for the profile chip. */
export async function signIn(page, account) {
  await page.goto('/', { waitUntil: 'domcontentloaded' });
  const dialog = page.getByRole('dialog', { name: 'Welcome back' });
  await expect(dialog).toBeVisible({ timeout: 60_000 });
  await dialog.getByLabel('Email').fill(account.email);
  await dialog.getByLabel('Password').fill(account.password);
  await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(profileChip(page, account)).toBeVisible();
}

/** The bottom-left profile chip ("<name>" + "Synced · <plan>"). */
export function profileChip(page, account) {
  // The hub renders the chip once per shell; only one is on screen.
  return page.getByRole('button', { name: 'Open account menu' })
    .filter({ visible: true })
    .filter({ hasText: account.label })
    .first();
}

/** Open the seeded sample document from the Documents list. */
export async function openSampleDocument(page) {
  await page.getByText(E2E_DOCUMENT.name, { exact: true }).first().click();
  await page.getByRole('button', { name: 'Open file' }).click();
  await expect(page.getByRole('button', { name: `Close ${E2E_DOCUMENT.name}` })).toBeVisible();
  // The PDF page itself has rendered (pdf.js text layer of the fixture).
  await expect(page.getByText('Type your name in the box:')).toBeVisible({ timeout: 60_000 });
}

/**
 * A Supabase client authenticated with the session the browser got from the
 * UI sign-in (read from the app's own auth storage), for server-side probes.
 */
export async function clientFromPageSession(page) {
  const session = await page.evaluate(() => {
    const key = Object.keys(window.localStorage).find((name) => /^sb-.*-auth-token$/.test(name));
    return key ? JSON.parse(window.localStorage.getItem(key)) : null;
  });
  if (!session?.access_token) throw new Error('[E2E_SIGNED_IN] no Supabase session in the page after sign-in');
  return createClient(process.env.E2E_SUPABASE_URL, process.env.E2E_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${session.access_token}` } },
  });
}

/** Service-role client for test setup/teardown only (local stack). */
export function adminClient() {
  return createClient(process.env.E2E_SUPABASE_URL, process.env.E2E_SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * A Supabase client signed in as a seeded local-stack account through the
 * auth API, for database-level probes that need no browser (RLS sweeps).
 * Pass null for a signed-out client.
 */
export async function apiClientFor(account) {
  const client = createClient(process.env.E2E_SUPABASE_URL, process.env.E2E_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  if (!account) return client;
  const { error } = await client.auth.signInWithPassword({ email: account.email, password: account.password });
  if (error) throw new Error(`[E2E_SIGNED_IN] sign-in ${account.email}: ${error.message}`);
  return client;
}
