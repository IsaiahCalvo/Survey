import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  resolveCommittedCalloutText,
  shouldDeleteBlankCalloutOnCommit,
} from '../src/utils/calloutBlankCommit.js';

test('new blank callout commit is eligible for blank cleanup', () => {
  assert.equal(shouldDeleteBlankCalloutOnCommit({
    isNewCallout: true,
    committedText: '   ',
  }), true);
});

test('existing blank callout commit is not eligible for blank cleanup', () => {
  assert.equal(shouldDeleteBlankCalloutOnCommit({
    isNewCallout: false,
    committedText: '',
  }), false);
});

test('existing callout preserves prior text when edit synthesis returns blank', () => {
  assert.equal(resolveCommittedCalloutText({
    isNewCallout: false,
    editedText: '',
    synthesizedText: '',
    originalText: 'Existing note',
  }), 'Existing note');
});

test('new callout keeps typed text', () => {
  assert.equal(resolveCommittedCalloutText({
    isNewCallout: true,
    editedText: 'Typed',
    synthesizedText: 'Typed',
    originalText: '',
  }), 'Typed');
});
