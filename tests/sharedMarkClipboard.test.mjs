import test from 'node:test';
import assert from 'node:assert/strict';
import {
  familyClipboardForDocument,
  readSharedClipboard,
  resetSharedClipboard,
  subscribeSharedClipboard,
  writeSharedClipboard,
} from '../src/utils/sharedMarkClipboard.js';
import { FEATURE_FLAGS } from '../src/featureFlags.js';

test('one shared clipboard remembers where it came from', () => {
  resetSharedClipboard();
  let calls = 0;
  const stop = subscribeSharedClipboard(() => { calls += 1; });
  writeSharedClipboard('annotation', { object: { type: 'rect' } }, 'doc-a');
  assert.equal(readSharedClipboard('annotation').documentId, 'doc-a');
  assert.equal(readSharedClipboard('annotation').value.object.type, 'rect');
  const same = readSharedClipboard('annotation').value;
  writeSharedClipboard('annotation', same, 'doc-a');
  assert.equal(calls, 1);
  stop();
  resetSharedClipboard();
  assert.equal(readSharedClipboard('annotation').value, null);
});

test('Survey Markers paste only back into their own document', () => {
  const clipboard = { items: [{ kind: 'mark' }, { kind: 'marker' }, { kind: 'callout' }], origin: { left: 0, top: 0 } };
  const entry = { value: clipboard, documentId: 'doc-a' };
  assert.equal(familyClipboardForDocument(entry, 'doc-a'), clipboard);
  assert.deepEqual(familyClipboardForDocument(entry, 'doc-b').items.map((i) => i.kind), ['mark', 'callout']);
  assert.equal(familyClipboardForDocument({ value: { items: [{ kind: 'marker' }] }, documentId: 'doc-a' }, 'doc-b'), null);
  assert.equal(familyClipboardForDocument({ value: null, documentId: null }, 'doc-b'), null);
});

test('the flag is a Nightly beta', () => {
  assert.equal(FEATURE_FLAGS['paste-across-documents']?.stage, 'beta');
});
