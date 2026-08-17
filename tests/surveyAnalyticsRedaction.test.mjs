import test from 'node:test';
import assert from 'node:assert/strict';

import {
  classifyAnalyticsDelivery,
  isRetryableAnalyticsDelivery,
  redactAnalyticsString,
  resolveSurveyAnalyticsEndpoint,
  sanitizeAnalyticsProperties,
} from '../src/utils/surveyAnalytics.js';
import { readFileSync } from 'node:fs';

const analyticsSource = readFileSync(new URL('../src/utils/surveyAnalytics.js', import.meta.url), 'utf8');
const preloadSource = readFileSync(new URL('../src/preload.js', import.meta.url), 'utf8');
const electronMainSource = readFileSync(new URL('../src/electron-main.js', import.meta.url), 'utf8');

test('analytics string redaction removes URLs, credentials, identities, and file paths', () => {
  const input = [
    'Failed https://surveytool.app/file.pdf?token=secret-value&signature=signed-value',
    'for isaiah@example.com with Bearer bearer-secret-value',
    'jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjMifQ.signature',
    'key sk_live_51ABCdefGhiJKlmnoPQR',
    'at /Users/isaiah/Documents/Client Plan.pdf',
  ].join(' ');
  const redacted = redactAnalyticsString(input, 1_000);

  for (const secret of [
    'secret-value',
    'signed-value',
    'isaiah@example.com',
    'bearer-secret-value',
    'eyJhbGciOiJIUzI1NiJ9',
    'sk_live_51ABC',
    '/Users/isaiah',
    'Client Plan.pdf',
  ]) {
    assert.doesNotMatch(redacted, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
  assert.match(redacted, /\[url\]/);
  assert.match(redacted, /\[email\]/);
  assert.match(redacted, /\[token\]|\[key\]/);
  assert.match(redacted, /\[path\]|\[file\]/);
});

test('analytics property sanitization filters sensitive keys and redacts nested message values', () => {
  const sanitized = sanitizeAnalyticsProperties({
    stage: 'error',
    pageCount: 12,
    email: 'owner@example.com',
    nested: {
      message: 'download https://example.com/a.pdf?access_token=top-secret',
      filename: 'customer.pdf',
      cursorX: 44,
    },
  });

  assert.deepEqual(sanitized, {
    stage: 'error',
    pageCount: 12,
    nested: {
      message: 'download [url]',
      cursorX: 44,
    },
  });
});

test('production analytics defaults to the same-origin proxy without requiring a public key', () => {
  assert.match(analyticsSource, /const DEFAULT_ENDPOINT = '\/api\/analytics\/track'/);
  assert.doesNotMatch(analyticsSource, /VITE_AGENT_NATIVE_ANALYTICS_PUBLIC_KEY/);
  assert.doesNotMatch(analyticsSource, /x-agent-native-analytics-key/);
  assert.match(analyticsSource, /getSupabaseSession\('surveyAnalytics'\)/);
  assert.match(analyticsSource, /trackSurveyAnalytics\(\{ payload, accessToken \}\)/);
});

test('local and Tailscale shells use the hosted same-account proxy instead of a missing Vite route', () => {
  assert.equal(
    resolveSurveyAnalyticsEndpoint({ protocol: 'https:', hostname: 'surveytool.app' }),
    '/api/analytics/track',
  );
  assert.equal(
    resolveSurveyAnalyticsEndpoint({ protocol: 'http:', hostname: 'localhost' }),
    'https://surveytool.app/api/analytics/track',
  );
  assert.equal(
    resolveSurveyAnalyticsEndpoint({ protocol: 'https:', hostname: 'isaiahs-macbook-pro.taila0b324.ts.net' }),
    'https://surveytool.app/api/analytics/track',
  );
  assert.equal(
    resolveSurveyAnalyticsEndpoint({ protocol: 'file:', hostname: '' }),
    'https://surveytool.app/api/analytics/track',
  );
  assert.equal(
    resolveSurveyAnalyticsEndpoint(
      { protocol: 'https:', hostname: 'surveytool.app' },
      'https://attacker.invalid/collect',
    ),
    '/api/analytics/track',
  );
  assert.equal(
    resolveSurveyAnalyticsEndpoint(
      { protocol: 'http:', hostname: 'localhost' },
      'https://retired-collector.netlify.app/collect',
    ),
    'https://surveytool.app/api/analytics/track',
  );
  assert.equal(
    resolveSurveyAnalyticsEndpoint({ protocol: 'http:', hostname: 'surveytool.app', port: '' }),
    'https://surveytool.app/api/analytics/track',
  );
  assert.equal(
    resolveSurveyAnalyticsEndpoint({ protocol: 'https:', hostname: 'surveytool.app', port: '8443' }),
    'https://surveytool.app/api/analytics/track',
  );
  assert.doesNotMatch(analyticsSource, /VITE_AGENT_NATIVE_ANALYTICS_URL/);
});

test('analytics delivery rejects HTML fallbacks and collector-declined responses', () => {
  assert.deepEqual(classifyAnalyticsDelivery({
    ok: true,
    status: 200,
    contentType: 'text/html',
    body: '<!doctype html>',
  }), { ok: false, reason: 'unexpected_response', status: 200 });
  assert.deepEqual(classifyAnalyticsDelivery({
    ok: true,
    status: 202,
    contentType: 'application/json',
    body: { accepted: false },
  }), { ok: false, reason: 'collector_rejected', status: 202 });
  assert.deepEqual(classifyAnalyticsDelivery({
    ok: true,
    status: 202,
    contentType: 'application/json',
    body: { accepted: true },
  }), { ok: true, reason: null, status: 202 });
});

test('native auth, network, quota, and collector failures remain retryable', () => {
  assert.equal(isRetryableAnalyticsDelivery({ reason: 'authentication_required', status: 0 }), true);
  assert.equal(isRetryableAnalyticsDelivery({ reason: 'network_error', status: 0 }), true);
  assert.equal(isRetryableAnalyticsDelivery({ reason: 'http_error', status: 429 }), true);
  assert.equal(isRetryableAnalyticsDelivery({ reason: 'http_error', status: 503 }), true);
  assert.equal(isRetryableAnalyticsDelivery({ reason: 'collector_rejected', status: 202 }), true);
  assert.equal(isRetryableAnalyticsDelivery({ reason: 'unexpected_response', status: 200 }), false);
});

test('packaged Electron analytics uses authenticated main-process transport without Origin:null', () => {
  assert.match(preloadSource, /trackSurveyAnalytics: \(payload\) => ipcRenderer\.invoke\('analytics:track', payload\)/);
  assert.match(electronMainSource, /ipcMain\.handle\('analytics:track'/);
  assert.match(electronMainSource, /isTrustedElectronAnalyticsSender/);
  assert.match(electronMainSource, /mainWebContents: surveyMainWindow\?\.webContents/);
  assert.match(electronMainSource, /Authorization: `Bearer \$\{accessToken\}`/);
  assert.match(electronMainSource, /SURVEY_ANALYTICS_MAX_BYTES/);
  assert.doesNotMatch(electronMainSource, /Origin:\s*['"]null['"]/);
});

test('native crash events are acknowledged only after the hosted collector accepts them', () => {
  assert.match(analyticsSource, /if \(!result\.ok\) \{[\s\S]*survey:native-analytics-nack/);
  assert.match(analyticsSource, /type: 'survey:native-analytics-ack'/);
  assert.match(analyticsSource, /ids: \[id\]/);
  assert.doesNotMatch(analyticsSource, /ids: deliveredIds/);
});
