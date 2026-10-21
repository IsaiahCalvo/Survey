// The OAuth 2.1 sign-in an outside AI agent makes (public/auth.md): register,
// send the person to the consent page, answer it, swap the code for tokens.
import crypto from 'node:crypto';
import { expect } from './helpers.mjs';

const API = () => process.env.E2E_SUPABASE_URL;
const KEY = () => process.env.E2E_SUPABASE_ANON_KEY;
export const REDIRECT = 'http://127.0.0.1:8976/callback';

export async function registerAgent(name) {
  const res = await fetch(`${API()}/auth/v1/oauth/clients/register`, {
    method: 'POST',
    headers: { apikey: KEY(), 'content-type': 'application/json' },
    body: JSON.stringify({
      client_name: name, redirect_uris: [REDIRECT], token_endpoint_auth_method: 'none',
      grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
    }),
  });
  const body = await res.json();
  expect(body.client_id, JSON.stringify(body)).toBeTruthy();
  return body.client_id;
}

export const tokenRequest = (params) => fetch(`${API()}/auth/v1/oauth/token`, {
  method: 'POST',
  headers: { apikey: KEY(), 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams(params),
}).then((r) => r.json());

/** The agent's whole sign-in, with the person answering on the consent page. */
export async function agentSignIn(page, account, name, answer = 'Allow') {
  const clientId = await registerAgent(name);
  const verifier = crypto.randomBytes(48).toString('base64url');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const state = crypto.randomBytes(12).toString('hex');
  let callback = null;
  await page.route(`${REDIRECT}**`, (route) => { callback = new URL(route.request().url()); return route.fulfill({ body: 'Done' }); });

  await page.goto(`${API()}/auth/v1/oauth/authorize?${new URLSearchParams({
    response_type: 'code', client_id: clientId, redirect_uri: REDIRECT,
    code_challenge: challenge, code_challenge_method: 'S256', state, scope: 'email',
  })}`);
  await expect(page).toHaveURL(/\/oauth\/consent\?authorization_id=/);
  await expect(page.getByText('Sign in or create a free account')).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Sign in or sign up' }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
  await dialog.getByLabel('Email').fill(account.email);
  await dialog.getByLabel('Password').fill(account.password);
  await dialog.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(page.getByText('wants to use Survey as you')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText(name)).toBeVisible();
  await page.getByRole('button', { name: answer, exact: true }).click();
  await expect.poll(() => callback, { timeout: 20_000 }).not.toBeNull();
  expect(callback.searchParams.get('state')).toBe(state);
  if (answer !== 'Allow') return { clientId, error: callback.searchParams.get('error') };

  const tok = await tokenRequest({
    grant_type: 'authorization_code', code: callback.searchParams.get('code'),
    redirect_uri: REDIRECT, client_id: clientId, code_verifier: verifier,
  });
  expect(tok.access_token, JSON.stringify(tok)).toBeTruthy();
  return { clientId, tok };
}

