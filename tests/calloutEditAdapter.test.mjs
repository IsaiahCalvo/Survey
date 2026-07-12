// tests/calloutEditAdapter.test.mjs
// Wave 0 scaffold for CALL-10 adapter round-trip precision.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  toFabricGroup,
  fromFabricGroup,
  sanitizeFontFamily,
} from '../src/utils/calloutEditAdapter.js';

const reactCallout = {
  id: 'rt-1',
  pageNumber: 1,
  arrowTip: { x: 0.5, y: 0.5 },
  knee: { x: 0.3, y: 0.3 },
  textBoxPosition: { x: 0.1, y: 0.1 },
  textBoxWidth: 0.2,
  textBoxHeight: 0.05,
  text: 'hello world',
  style: {
    borderColor: '#1e293b',
    fillColor: '#ffffff',
    lineThickness: 2,
    fontSize: 14,
    fontFamily: 'Arial',
    fontColor: '#1e293b',
    bold: false,
    borderOpacity: 1,
    fillOpacity: 1,
  },
};

const pageSize = { width: 1000, height: 800 };
const TOL = 1e-6;

test('toFabricGroup stores original React id on group', () => {
  const group = toFabricGroup(reactCallout, pageSize);
  assert.equal(group.reactCalloutId, 'rt-1');
});

test('toFabricGroup+fromFabricGroup round-trip preserves arrowTip within tolerance', () => {
  const group = toFabricGroup(reactCallout, pageSize);
  const back = fromFabricGroup(group, pageSize, reactCallout);
  assert.ok(Math.abs(back.arrowTip.x - reactCallout.arrowTip.x) < TOL);
  assert.ok(Math.abs(back.arrowTip.y - reactCallout.arrowTip.y) < TOL);
});

test('toFabricGroup+fromFabricGroup round-trip preserves knee within tolerance', () => {
  const group = toFabricGroup(reactCallout, pageSize);
  const back = fromFabricGroup(group, pageSize, reactCallout);
  assert.ok(Math.abs(back.knee.x - reactCallout.knee.x) < TOL);
  assert.ok(Math.abs(back.knee.y - reactCallout.knee.y) < TOL);
});

test('toFabricGroup+fromFabricGroup round-trip preserves textBox coords within tolerance', () => {
  const group = toFabricGroup(reactCallout, pageSize);
  const back = fromFabricGroup(group, pageSize, reactCallout);
  assert.ok(Math.abs(back.textBoxPosition.x - reactCallout.textBoxPosition.x) < TOL);
  assert.ok(Math.abs(back.textBoxPosition.y - reactCallout.textBoxPosition.y) < TOL);
  assert.ok(Math.abs(back.textBoxWidth - reactCallout.textBoxWidth) < TOL);
  assert.ok(Math.abs(back.textBoxHeight - reactCallout.textBoxHeight) < TOL);
});

test('toFabricGroup+fromFabricGroup preserves text exactly', () => {
  const group = toFabricGroup(reactCallout, pageSize);
  const back = fromFabricGroup(group, pageSize, reactCallout);
  assert.equal(back.text, 'hello world');
});

test('10-cycle round-trip has no accumulating drift', () => {
  let current = { ...reactCallout };
  for (let i = 0; i < 10; i++) {
    const group = toFabricGroup(current, pageSize);
    current = fromFabricGroup(group, pageSize, current);
  }
  assert.ok(Math.abs(current.arrowTip.x - reactCallout.arrowTip.x) < TOL);
  assert.ok(Math.abs(current.knee.y - reactCallout.knee.y) < TOL);
  assert.ok(Math.abs(current.textBoxWidth - reactCallout.textBoxWidth) < TOL);
});

test('sanitizeFontFamily strips CSS fallback stack to first token', () => {
  assert.equal(sanitizeFontFamily('Inter, Arial, sans-serif'), 'Inter');
});

test('sanitizeFontFamily strips quotes from quoted names', () => {
  assert.equal(sanitizeFontFamily('"Helvetica Neue", Arial'), 'Helvetica Neue');
});

test('sanitizeFontFamily returns "Arial" for null', () => {
  assert.equal(sanitizeFontFamily(null), 'Arial');
});

test('sanitizeFontFamily returns "Arial" for undefined', () => {
  assert.equal(sanitizeFontFamily(undefined), 'Arial');
});

test('sanitizeFontFamily trims whitespace', () => {
  assert.equal(sanitizeFontFamily('   Times New Roman  '), 'Times New Roman');
});

test('callout lifecycle diag + alternate fabric child shapes', () => {
  const originalWindow = globalThis.window;
  const logs = [];
  const originalLog = console.log;
  console.log = (...args) => logs.push(args.join(' '));
  globalThis.window = { __CALLOUT_LIFECYCLE_DIAG: true };
  try {
    const group = toFabricGroup({
      ...reactCallout,
      isPdfImported: true,
      pdfAnnotationId: 'pdf-1',
    }, pageSize);
    assert.ok(logs.some((l) => l.includes('CalloutLifecycle state->edit')));

    const viaGetObjects = fromFabricGroup({
      getObjects: () => group.objects,
    }, pageSize, reactCallout);
    assert.equal(viaGetObjects.text, 'hello world');

    const viaPrivate = fromFabricGroup({
      _objects: group.objects,
    }, pageSize, reactCallout);
    assert.equal(viaPrivate.text, 'hello world');

    const legacyParts = group.objects.map((child) => {
      if (child?.data?.calloutPart === 'textBox') {
        return { ...child, data: { ...child.data, calloutPart: 'text' } };
      }
      return child;
    });
    const viaLegacy = fromFabricGroup({ objects: legacyParts }, pageSize, reactCallout);
    assert.equal(viaLegacy.text, 'hello world');

    const typeOnly = group.objects.map((child) => {
      if (child?.data?.calloutPart === 'textBox' || child?.type === 'textbox') {
        const { data, ...rest } = child;
        return { ...rest, type: 'textbox', text: child.text };
      }
      return { ...child, data: { ...(child.data || {}), calloutPart: 'line1' } };
    });
    const viaType = fromFabricGroup({ objects: typeOnly }, pageSize, reactCallout);
    assert.equal(viaType.text, 'hello world');
    assert.ok(logs.some((l) => l.includes('CalloutLifecycle edit->commit')));

    const emptyChildren = fromFabricGroup({}, pageSize, reactCallout);
    assert.equal(typeof emptyChildren.text, 'string');
  } finally {
    console.log = originalLog;
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});
