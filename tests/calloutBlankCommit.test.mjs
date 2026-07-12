import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isBlankCalloutText,
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

test('existing callout keeps prior text when editedText is null and synthesis is blank', () => {
  assert.equal(resolveCommittedCalloutText({
    isNewCallout: false,
    editedText: null,
    synthesizedText: '',
    originalText: 'Kept note',
  }), 'Kept note');
});

test('existing callout prefers prior text when editedText is null even if synthesis is non-blank', () => {
  assert.equal(resolveCommittedCalloutText({
    isNewCallout: false,
    editedText: null,
    synthesizedText: 'synth',
    originalText: 'Prior note',
  }), 'Prior note');
});

test('existing callout accepts non-string synthesis as blank and returns it when no prior text', () => {
  assert.equal(resolveCommittedCalloutText({
    isNewCallout: false,
    editedText: undefined,
    synthesizedText: 12,
    originalText: null,
  }), '');
});

test('isBlankCalloutText treats non-strings as blank', () => {
  assert.equal(isBlankCalloutText(null), true);
  assert.equal(isBlankCalloutText('  note  '), false);
});
