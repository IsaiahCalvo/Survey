import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  APP_CSP,
  MARKETING_CSP,
  TEAMS_CSP,
  headersForPath,
} from '../functions/_lib/securityHeaders.js';
import { onRequest as middleware } from '../functions/_middleware.js';
import { onRequest as onedriveOpen } from '../functions/api/onedrive-open.js';
import { onRequest as analyticsTrack } from '../functions/api/analytics/track.js';

const root = path.resolve(process.cwd());
const vercel = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));

function vercelCspMatching(predicate) {
  for (const rule of vercel.headers) {
    if (!predicate(rule.source)) continue;
    const csp = rule.headers.find((h) => h.key === 'Content-Security-Policy');
    if (csp) return csp.value;
  }
  return null;
}

test('Cloudflare Pages CSP policies match vercel.json byte-for-byte (#1685)', () => {
  const vercelAppCsp = vercelCspMatching((s) => s.includes('(?!') && s.includes('welcome|features'));
  const vercelMarketingCsp = vercelCspMatching((s) => !s.includes('(?!') && s.includes('welcome|features'));
  const vercelTeamsCsp = vercelCspMatching((s) => s === '/teams(/.*)?');

  assert.equal(APP_CSP, vercelAppCsp);
  assert.equal(MARKETING_CSP, vercelMarketingCsp);
  assert.equal(TEAMS_CSP, vercelTeamsCsp);
});

test('Cloudflare Pages header routing separates app, marketing, teams, assets, and well-known', () => {
  const app = headersForPath('/');
  assert.equal(app['X-Frame-Options'], 'DENY');
  assert.equal(app['Content-Security-Policy'], APP_CSP);

  const pricing = headersForPath('/pricing');
  assert.equal(pricing['X-Frame-Options'], 'DENY');
  assert.equal(pricing['Content-Security-Policy'], MARKETING_CSP);

  const lookalike = headersForPath('/toolsx');
  assert.equal(lookalike['Content-Security-Policy'], APP_CSP);

  const teams = headersForPath('/teams/tab');
  assert.equal(teams['X-Frame-Options'], undefined);
  assert.equal(teams['Content-Security-Policy'], TEAMS_CSP);

  const asset = headersForPath('/assets/app-123.js');
  assert.equal(asset['Cache-Control'], 'public, max-age=31536000, immutable');

  const aasa = headersForPath('/.well-known/apple-app-site-association');
  assert.equal(aasa['Content-Type'], 'application/json');
});

test('Cloudflare Pages middleware redirects /privacy and /terms and serves SPA fallback for app routes', async () => {
  const privacyRes = await middleware({
    request: new Request('https://surveytool.app/privacy'),
    env: {},
    next: async () => new Response('not called', { status: 500 }),
  });
  assert.equal(privacyRes.status, 301);
  assert.equal(privacyRes.headers.get('location'), 'https://surveytool.app/privacy.html');

  const spaRes = await middleware({
    request: new Request('https://surveytool.app/agent-link'),
    env: {
      ASSETS: {
        fetch: async (req) => {
          assert.equal(new URL(req.url).pathname, '/index.html');
          return new Response('<html>app</html>', {
            status: 200,
            headers: { 'Content-Type': 'text/html' },
          });
        },
      },
    },
    next: async () => new Response('missing', { status: 404 }),
  });
  assert.equal(spaRes.status, 200);
  assert.equal(spaRes.headers.get('Content-Security-Policy'), APP_CSP);
});

test('Kal Voe serves the suite at the apex root and leaves the Survey root alone', async () => {
  const next = async () => new Response('Survey app');
  const env = {
    ASSETS: {
      fetch: async (request) => {
        assert.equal(new URL(request.url).pathname, '/kal-voe/');
        return new Response('Kal Voe Suite');
      },
    },
  };
  const apex = await middleware({ request: new Request('https://kalvoe.com/?utm_source=test'), env, next });
  assert.equal(await apex.text(), 'Kal Voe Suite');
  assert.equal(apex.headers.get('Content-Security-Policy'), MARKETING_CSP);

  const survey = await middleware({ request: new Request('https://surveytool.app/'), env, next });
  assert.equal(await survey.text(), 'Survey app');
  assert.equal(survey.headers.get('Content-Security-Policy'), APP_CSP);
});

test('Kal Voe redirects www and the old suite path, and sends sign-up to Survey', async () => {
  const fetchRoute = (url) => middleware({ request: new Request(url), env: {} });

  const www = await fetchRoute('https://www.kalvoe.com/pricing?utm_source=test');
  assert.equal(www.status, 308);
  assert.equal(www.headers.get('location'), 'https://kalvoe.com/pricing?utm_source=test');

  const oldSuitePath = await fetchRoute('https://kalvoe.com/kal-voe/?utm_source=test');
  assert.equal(oldSuitePath.status, 308);
  assert.equal(oldSuitePath.headers.get('location'), 'https://kalvoe.com/?utm_source=test');

  const signUp = await fetchRoute('https://kalvoe.com/?signup=1');
  assert.equal(signUp.status, 302);
  assert.equal(signUp.headers.get('location'), 'https://surveytool.app/?signup=1');
});

test('Cloudflare Pages /api/onedrive-open redirects valid Microsoft Graph items with 303', async () => {
  const form = new URLSearchParams({
    items: JSON.stringify([
      'https://graph.microsoft.com/v1.0/drives/drive-123/items/item-456',
    ]),
  });
  const res = await onedriveOpen({
    request: new Request('https://surveytool.app/api/onedrive-open', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
    }),
  });
  assert.equal(res.status, 303);
  assert.equal(res.headers.get('location'), '/?open-onedrive=drive-123&item=item-456');
  assert.equal(res.headers.get('cache-control'), 'no-store');
});

test('Cloudflare Pages /api/analytics/track enforces origin allowlist and returns 503 when unconfigured', async () => {
  const denied = await analyticsTrack({
    request: new Request('https://surveytool.app/api/analytics/track', {
      method: 'POST',
      headers: { Origin: 'https://evil.example' },
      body: JSON.stringify({ event: 'app_open' }),
    }),
    env: {},
  });
  assert.equal(denied.status, 403);

  const unconfigured = await analyticsTrack({
    request: new Request('https://surveytool.app/api/analytics/track', {
      method: 'POST',
      headers: { Origin: 'https://survey-preview.pages.dev' },
      body: JSON.stringify({ event: 'app_open' }),
    }),
    env: {},
  });
  assert.equal(unconfigured.status, 503);
  assert.equal(unconfigured.headers.get('access-control-allow-origin'), 'https://survey-preview.pages.dev');
});
