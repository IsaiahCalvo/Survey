// KAL-24 regression lock — survey marker subscription must expose and call
// an onSubscribed catch-up hook, and App.jsx must pass one that re-fetches
// and merges missed inserts. Without this, marks created on another client
// during the hydrate-vs-subscribe gap silently vanish until manual refresh.

import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import assert from 'node:assert/strict';

const SERVICE_SOURCE = readFileSync(
  new URL('../src/services/documentAnnotationService.js', import.meta.url),
  'utf8'
);
const APP_SOURCE = readFileSync(
  new URL('../src/App.jsx', import.meta.url),
  'utf8'
);

test('subscribeToDocumentAnnotations destructures onSubscribed from callbacks', () => {
  assert.match(
    SERVICE_SOURCE,
    /const \{[^}]*\bonSubscribed\b[^}]*\} = callbacks/s,
    'subscribeToDocumentAnnotations must accept an onSubscribed callback'
  );
});

test('subscribeToDocumentAnnotations fires onSubscribed when channel becomes live', () => {
  assert.match(
    SERVICE_SOURCE,
    /status === 'SUBSCRIBED'[^}]*onSubscribed[^}]*\(\)/s,
    'subscribeToDocumentAnnotations must invoke onSubscribed when status === "SUBSCRIBED"'
  );
});

test('App.jsx passes an onSubscribed catch-up callback to the survey marker subscription', () => {
  // The catch-up callback must re-call loadAnnotationsFromSupabase inside the
  // subscription wiring and merge into setSurveyMarkers. Locking just the
  // presence of an onSubscribed property next to the other survey marker
  // callbacks is enough to fail loudly on accidental removal; the wiring is
  // documented inline at the call site.
  assert.match(
    APP_SOURCE,
    /subscribeToDocumentAnnotations\(documentId,\s*\{[\s\S]*?onSubscribed:\s*\(\)\s*=>\s*\{[\s\S]*?loadAnnotationsFromSupabase\(documentId\)[\s\S]*?\}/,
    'App.jsx must pass an onSubscribed callback that re-runs loadAnnotationsFromSupabase'
  );
});

test('App.jsx catch-up callback merges insert-only into setSurveyMarkers', () => {
  // Insert-only merge protects unflushed local edits from being stomped by
  // the catch-up snapshot. A future change that swaps to a destructive
  // replace must update this test deliberately.
  assert.match(
    APP_SOURCE,
    /survey-marker catch-up rehydrate added missed inserts/,
    'App.jsx must keep the insert-only merge log so future readers see the merge semantics'
  );
});
