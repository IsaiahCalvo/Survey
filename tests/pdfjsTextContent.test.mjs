import test from 'node:test';
import assert from 'node:assert/strict';

import { readPdfjsTextContent } from '../src/utils/pdfjsTextContent.js';

test('reads pdf.js text chunks without ReadableStream async iteration', async () => {
  const chunks = [
    { value: { items: [{ str: 'one' }], styles: { f1: { fontFamily: 'Arial' } }, lang: 'en' }, done: false },
    { value: { items: [{ str: 'two' }], styles: { f2: { fontFamily: 'Helvetica' } }, lang: null }, done: false },
    { done: true },
  ];
  const page = {
    streamTextContent: () => ({
      getReader: () => ({ read: async () => chunks.shift() }),
    }),
  };

  const result = await readPdfjsTextContent(page);

  assert.equal(result.lang, 'en');
  assert.deepEqual(result.items.map((item) => item.str), ['one', 'two']);
  assert.deepEqual(Object.keys(result.styles), ['f1', 'f2']);
});
