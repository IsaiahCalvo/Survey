// Tester reports, batch C/D (Nov 25): #1650 and #1659.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as Y from 'yjs';
import { textMarkupHitPath } from '../src/utils/pdfTextMarkup.js';
import { guardClosedIdbStore, isClosedIdbError } from '../src/services/annotationDocSync.js';

const LAYER = readFileSync(new URL('../src/components/SVGAnnotationLayer.jsx', import.meta.url), 'utf8');

test('#1650: a multi-line highlight takes clicks on its word runs, not the box round them', () => {
  const quad = (x, y) => ({ x1: x, y1: y, x2: x + 50, y2: y, x3: x, y3: y + 10, x4: x + 50, y4: y + 10 });
  const highlight = { data: { type: 'text-markup', quads: [quad(10, 10), quad(900, 700)] } };
  const d = textMarkupHitPath(highlight);
  assert.equal((d.match(/M /g) || []).length, 2, 'one closed shape per word run');
  assert.match(d, /M 10 10 L 60 10 L 60 20 L 10 20 Z/);
  assert.equal(textMarkupHitPath({ type: 'rect', data: {} }), null);
  assert.equal(textMarkupHitPath({ data: { type: 'text-markup', quads: [] } }), null);
  // The generic bbox hit rect is skipped for a text markup.
  assert.match(LAYER, /\{!textMarkupHitPath\(renderObj\) && <rect\n\s+x=\{bbox\.left\}/);
});

test('#1659: a closed device copy never throws into the edit that carried the change', () => {
  const doc = new Y.Doc();
  let calls = 0;
  const provider = {
    doc,
    _storeUpdate: () => {
      calls += 1;
      const error = new Error("Failed to execute 'transaction' on 'IDBDatabase': The database connection is closing.");
      error.name = 'InvalidStateError';
      throw error;
    },
  };
  doc.on('update', provider._storeUpdate);
  const warn = console.warn;
  console.warn = () => {};
  try {
    guardClosedIdbStore(provider, doc);
    assert.doesNotThrow(() => doc.getMap('marks').set('a', 1));
    assert.doesNotThrow(() => doc.getMap('marks').set('b', 2));
  } finally {
    console.warn = warn;
  }
  assert.equal(calls, 2, 'the store still runs: a reopened copy keeps saving');
  assert.equal(doc.getMap('marks').get('b'), 2);
  assert.equal(isClosedIdbError(new TypeError('x')), false);
  // Any other store failure still surfaces.
  const other = new Y.Doc();
  const failing = { doc: other, _storeUpdate: () => { throw new TypeError('boom'); } };
  other.on('update', failing._storeUpdate);
  guardClosedIdbStore(failing, other);
  assert.throws(() => other.getMap('m').set('x', 1), /boom/);
});
