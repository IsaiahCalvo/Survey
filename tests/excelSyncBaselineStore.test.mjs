// Stage 0 — durable Excel-sync baseline persistence.
//
// The baseline survives reload so a genuinely-synced survey doesn't fail-closed
// to "not synced". Still fails closed when nothing is stored.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  baselineKey,
  loadBaseline,
  saveBaseline,
  clearBaseline,
} from '../src/services/excelSyncBaselineStore.js';

function makeFakeStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  };
}

test('baselineKey requires both ids', () => {
  assert.equal(baselineKey('doc1', 'tpl1'), 'excelSyncBaseline:doc1::tpl1');
  assert.equal(baselineKey(null, 'tpl1'), null);
  assert.equal(baselineKey('doc1', null), null);
});

test('save then load round-trips the hash', () => {
  const s = makeFakeStorage();
  saveBaseline('doc1', 'tpl1', 'abc123', s);
  assert.equal(loadBaseline('doc1', 'tpl1', s), 'abc123');
});

test('load returns null when nothing stored (fail closed)', () => {
  const s = makeFakeStorage();
  assert.equal(loadBaseline('doc1', 'tpl1', s), null);
});

test('different document or template does not share a baseline', () => {
  const s = makeFakeStorage();
  saveBaseline('doc1', 'tpl1', 'hashA', s);
  assert.equal(loadBaseline('doc2', 'tpl1', s), null);
  assert.equal(loadBaseline('doc1', 'tpl2', s), null);
});

test('clear removes the stored baseline', () => {
  const s = makeFakeStorage();
  saveBaseline('doc1', 'tpl1', 'hashA', s);
  clearBaseline('doc1', 'tpl1', s);
  assert.equal(loadBaseline('doc1', 'tpl1', s), null);
});

test('save is a no-op without a usable key or hash (never throws)', () => {
  const s = makeFakeStorage();
  saveBaseline(null, 'tpl1', 'h', s);
  saveBaseline('doc1', 'tpl1', '', s);
  assert.equal(s._map.size, 0);
});
