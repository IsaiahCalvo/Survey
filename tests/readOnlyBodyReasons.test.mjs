import test from 'node:test';
import assert from 'node:assert/strict';

import { JSDOM } from 'jsdom';
import { claimBodyReadOnly } from '../src/utils/readOnlyBodyReasons.js';

for (const order of [
  ['lock', 'permission'],
  ['permission', 'lock'],
]) {
  test(`body read-only claims survive overlap activated ${order.join(' then ')}`, () => {
    const dom = new JSDOM('<!doctype html><body></body>');
    const releases = new Map();
    for (const reason of order) {
      releases.set(reason, claimBodyReadOnly(Symbol(reason), dom.window.document));
    }
    assert.equal(dom.window.document.body.getAttribute('data-readonly'), 'true');

    releases.get(order[0])();
    assert.equal(
      dom.window.document.body.getAttribute('data-readonly'),
      'true',
      'clearing one reason must preserve the other',
    );
    releases.get(order[1])();
    assert.equal(dom.window.document.body.getAttribute('data-readonly'), null);
    dom.window.close();
  });
}

test('central read-only claims preserve a pre-existing unmanaged claimant', () => {
  const dom = new JSDOM('<!doctype html><body data-readonly="true"></body>');
  const release = claimBodyReadOnly(Symbol('known-reason'), dom.window.document);
  release();
  assert.equal(dom.window.document.body.getAttribute('data-readonly'), 'true');
  dom.window.close();
});
