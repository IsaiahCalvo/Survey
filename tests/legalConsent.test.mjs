// The Terms agree box and the AI notice are promises the privacy policy and
// terms make (legal/ai-review.md, "Status"): keep them wired.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AI_NOTICE_VERSION, TERMS_VERSION, PRIVACY_VERSION, hasAiConsent, termsAcceptance } from '../src/legal/legalVersions.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('AI consent counts only for the current notice version', () => {
  assert.equal(hasAiConsent(null), false);
  assert.equal(hasAiConsent({ user_metadata: {} }), false);
  assert.equal(hasAiConsent({ user_metadata: { ai_assistant_consent: { version: 'old', at: '2026-01-01' } } }), false);
  assert.equal(hasAiConsent({ user_metadata: { ai_assistant_consent: { version: AI_NOTICE_VERSION, at: '2026-11-02T00:00:00Z' } } }), true);
});

test('terms acceptance records both page dates and when', () => {
  const at = new Date('2026-11-02T12:00:00Z');
  assert.deepEqual(termsAcceptance(at), { terms: TERMS_VERSION, privacy: PRIVACY_VERSION, at: at.toISOString() });
});

test('sign-up needs the agree box and stores the acceptance', () => {
  const modal = read('src/components/AuthModal.jsx');
  assert.match(modal, /if \(!agreedToTerms\)/);
  assert.match(modal, /terms_accepted: termsAcceptance\(\)/);
  assert.match(modal, /href="\/terms\.html"/);
  assert.match(modal, /href="\/privacy\.html"/);
});

test('the agent sends nothing until the AI notice is allowed', () => {
  const panel = read('src/components/SurveyAgentPanel.jsx');
  assert.match(panel, /const ready = status\?\.enabled && !status\?\.over_cap && aiConsented;/);
  assert.match(panel, /ai_assistant_consent: \{ version: AI_NOTICE_VERSION/);
});

test('the pages name the operator and carry no placeholders', () => {
  for (const page of ['public/privacy.html', 'public/terms.html']) {
    const html = read(page);
    assert.match(html, /Kal Voe LLC/);
    assert.doesNotMatch(html, /\[(?:date|state|confirm|mailing address|period)[^\]]*\]/i, `${page} has a placeholder`);
    assert.doesNotMatch(html, /awaiting legal review/i);
  }
});
