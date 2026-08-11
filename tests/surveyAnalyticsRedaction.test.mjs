import test from 'node:test';
import assert from 'node:assert/strict';

import {
  redactAnalyticsString,
  sanitizeAnalyticsProperties,
} from '../src/utils/surveyAnalytics.js';
import { readFileSync } from 'node:fs';

const analyticsSource = readFileSync(new URL('../src/utils/surveyAnalytics.js', import.meta.url), 'utf8');

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
  assert.doesNotMatch(
    analyticsSource,
    /if \(!analyticsPublicKey \|\| typeof window === 'undefined'/,
  );
  assert.match(analyticsSource, /if \(analyticsPublicKey\) \{[\s\S]*x-agent-native-analytics-key/);
});
