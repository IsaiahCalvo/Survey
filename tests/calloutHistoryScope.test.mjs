import test from 'node:test';
import { deepStrictEqual } from 'node:assert/strict';

import {
  scopeHistoryStateForCalloutRestore,
} from '../src/utils/calloutHistoryScope.js';

test('callout undo create removes only the current user callout and preserves other user callouts', () => {
  const targetState = {
    callouts: [
      { id: 'foreign-existing', text: 'keep', meta: { authorId: 'user-b' } },
    ],
  };
  const currentState = {
    callouts: [
      { id: 'foreign-existing', text: 'keep', meta: { authorId: 'user-b' } },
      { id: 'mine-new', text: 'remove on undo', meta: { authorId: 'user-a' } },
      { id: 'foreign-after-checkpoint', text: 'must survive', meta: { authorId: 'user-b' } },
    ],
  };

  const scoped = scopeHistoryStateForCalloutRestore({
    currentState,
    targetState,
    meta: { reason: 'callouts:create', context: { calloutId: 'mine-new' } },
    userId: 'user-a',
  });

  deepStrictEqual(scoped.callouts.map((c) => c.id), ['foreign-existing', 'foreign-after-checkpoint']);
});

test('callout redo create restores only current user callout and does not edit another user callout', () => {
  const currentState = {
    callouts: [
      { id: 'foreign-existing', text: 'keep current', meta: { authorId: 'user-b' } },
    ],
  };
  const targetState = {
    callouts: [
      { id: 'foreign-existing', text: 'old snapshot value', meta: { authorId: 'user-b' } },
      { id: 'mine-new', text: 'restore on redo', meta: { authorId: 'user-a' } },
    ],
  };

  const scoped = scopeHistoryStateForCalloutRestore({
    currentState,
    targetState,
    meta: { reason: 'callouts:create', context: { calloutId: 'mine-new' } },
    userId: 'user-a',
  });

  deepStrictEqual(scoped.callouts, [
    { id: 'foreign-existing', text: 'keep current', meta: { authorId: 'user-b' } },
    { id: 'mine-new', text: 'restore on redo', meta: { authorId: 'user-a' } },
  ]);
});

test('callout undo delete restores only current user deleted callouts from mixed snapshots', () => {
  const currentState = {
    callouts: [
      { id: 'foreign-survivor', text: 'current foreign', meta: { authorId: 'user-b' } },
    ],
  };
  const targetState = {
    callouts: [
      { id: 'foreign-survivor', text: 'old foreign', meta: { authorId: 'user-b' } },
      { id: 'mine-deleted', text: 'restore me', meta: { authorId: 'user-a' } },
      { id: 'foreign-deleted', text: 'do not restore', meta: { authorId: 'user-b' } },
    ],
  };

  const scoped = scopeHistoryStateForCalloutRestore({
    currentState,
    targetState,
    meta: { reason: 'callouts:delete', context: { calloutIds: ['mine-deleted', 'foreign-deleted'] } },
    userId: 'user-a',
  });

  deepStrictEqual(scoped.callouts, [
    { id: 'foreign-survivor', text: 'current foreign', meta: { authorId: 'user-b' } },
    { id: 'mine-deleted', text: 'restore me', meta: { authorId: 'user-a' } },
  ]);
});

test('callout undo update does not edit another user callout', () => {
  const currentState = {
    callouts: [
      { id: 'foreign-callout', text: 'foreign current', meta: { authorId: 'user-b' } },
    ],
  };
  const targetState = {
    callouts: [
      { id: 'foreign-callout', text: 'foreign old snapshot', meta: { authorId: 'user-b' } },
    ],
  };

  const scoped = scopeHistoryStateForCalloutRestore({
    currentState,
    targetState,
    meta: { reason: 'callouts:update', context: { calloutId: 'foreign-callout' } },
    userId: 'user-a',
  });

  deepStrictEqual(scoped.callouts, [
    { id: 'foreign-callout', text: 'foreign current', meta: { authorId: 'user-b' } },
  ]);
});

test('delete:batch undo restores only current user deleted callouts', () => {
  const currentState = {
    callouts: [
      { id: 'foreign-survivor', text: 'current foreign', meta: { authorId: 'user-b' } },
    ],
  };
  const targetState = {
    callouts: [
      { id: 'foreign-survivor', text: 'old foreign', meta: { authorId: 'user-b' } },
      { id: 'mine-deleted', text: 'restore me', meta: { authorId: 'user-a' } },
      { id: 'foreign-deleted', text: 'do not restore', meta: { authorId: 'user-b' } },
    ],
  };

  const scoped = scopeHistoryStateForCalloutRestore({
    currentState,
    targetState,
    meta: { reason: 'delete:batch', context: { calloutIds: ['mine-deleted', 'foreign-deleted'] } },
    userId: 'user-a',
  });

  deepStrictEqual(scoped.callouts, [
    { id: 'foreign-survivor', text: 'current foreign', meta: { authorId: 'user-b' } },
    { id: 'mine-deleted', text: 'restore me', meta: { authorId: 'user-a' } },
  ]);
});

test('delete:batch undo does not edit or remove unrelated other-user callouts', () => {
  const currentState = {
    callouts: [
      { id: 'foreign-unrelated', text: 'current value', meta: { authorId: 'user-b' } },
    ],
  };
  const targetState = {
    callouts: [
      { id: 'foreign-unrelated', text: 'old snapshot value', meta: { authorId: 'user-b' } },
      { id: 'mine-deleted', text: 'restore me', meta: { authorId: 'user-a' } },
    ],
  };

  const scoped = scopeHistoryStateForCalloutRestore({
    currentState,
    targetState,
    meta: { reason: 'delete:batch', context: { calloutIds: ['mine-deleted'] } },
    userId: 'user-a',
  });

  deepStrictEqual(scoped.callouts, [
    { id: 'foreign-unrelated', text: 'current value', meta: { authorId: 'user-b' } },
    { id: 'mine-deleted', text: 'restore me', meta: { authorId: 'user-a' } },
  ]);
});

test('delete:batch redo removes only current user callouts involved in the batch', () => {
  const currentState = {
    callouts: [
      { id: 'mine-deleted', text: 'remove me again', meta: { authorId: 'user-a' } },
      { id: 'foreign-deleted', text: 'foreign must stay', meta: { authorId: 'user-b' } },
      { id: 'foreign-unrelated', text: 'current value', meta: { authorId: 'user-b' } },
    ],
  };
  const targetState = {
    callouts: [
      { id: 'foreign-unrelated', text: 'old snapshot value', meta: { authorId: 'user-b' } },
    ],
  };

  const scoped = scopeHistoryStateForCalloutRestore({
    currentState,
    targetState,
    meta: { reason: 'delete:batch', context: { calloutIds: ['mine-deleted', 'foreign-deleted'] } },
    userId: 'user-a',
  });

  deepStrictEqual(scoped.callouts, [
    { id: 'foreign-deleted', text: 'foreign must stay', meta: { authorId: 'user-b' } },
    { id: 'foreign-unrelated', text: 'current value', meta: { authorId: 'user-b' } },
  ]);
});

test('callout undo update replaces owned callout from target snapshot', () => {
  const currentState = {
    callouts: [
      { id: 'mine', text: 'edited', meta: { authorId: 'user-a' } },
      { id: 'other', text: 'keep', meta: { authorId: 'user-b' } },
    ],
  };
  const targetState = {
    callouts: [
      { id: 'mine', text: 'original', meta: { authorId: 'user-a' } },
      { id: 'other', text: 'old other', meta: { authorId: 'user-b' } },
    ],
  };

  const scoped = scopeHistoryStateForCalloutRestore({
    currentState,
    targetState,
    meta: { reason: 'callouts:update', context: { calloutId: 'mine' } },
    userId: 'user-a',
  });

  deepStrictEqual(scoped.callouts, [
    { id: 'mine', text: 'original', meta: { authorId: 'user-a' } },
    { id: 'other', text: 'keep', meta: { authorId: 'user-b' } },
  ]);
});
