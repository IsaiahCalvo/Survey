import test from 'node:test';
import { deepStrictEqual, equal } from 'node:assert/strict';

import { scopeHistoryStateForCrdtRestore } from '../src/utils/crdtHistoryScope.js';

test('P1-10: CRDT restore keeps live annotations and callouts', () => {
  const currentState = {
    annotationsByPage: { 1: { objects: [{ data: { id: 'teammate' } }] } },
    callouts: [{ id: 'live-callout' }],
    surveyMarkers: { stale: true },
    spaces: [{ id: 'old' }],
  };
  const targetState = {
    annotationsByPage: { 1: { objects: [] } },
    callouts: [],
    surveyMarkers: { restored: true },
    spaces: [{ id: 'new' }],
    pendingSurveyMarkerUi: { pendingSurveyMarker: null },
  };

  const scoped = scopeHistoryStateForCrdtRestore({ currentState, targetState });

  deepStrictEqual(scoped.annotationsByPage, currentState.annotationsByPage);
  deepStrictEqual(scoped.callouts, currentState.callouts);
  deepStrictEqual(scoped.surveyMarkers, targetState.surveyMarkers);
  deepStrictEqual(scoped.spaces, targetState.spaces);
  equal(scoped.pendingSurveyMarkerUi.pendingSurveyMarker, null);
});
