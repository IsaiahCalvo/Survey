import test from 'node:test';
import assert from 'node:assert/strict';
import { resolvePropertiesPanelShape } from '../src/components/propertiesPanelShape.js';

test('plain rect resolves to kind=rect, borderStyle=solid', () => {
  const r = resolvePropertiesPanelShape({ type: 'rect', stroke: '#000', strokeWidth: 1, data: {} });
  assert.equal(r.kind, 'rect');
  assert.equal(r.borderStyle, 'solid');
  assert.equal(r.cloudIntensity, undefined);
});

test('plain polygon resolves to kind=polygon, borderStyle=solid (no crash on missing cloud metadata)', () => {
  const p = resolvePropertiesPanelShape({
    type: 'polygon', stroke: '#000', strokeWidth: 1,
    points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 10 }],
    data: {}
  });
  assert.equal(p.kind, 'polygon');
  assert.equal(p.borderStyle, 'solid');
});

test('plain polyline resolves to kind=polyline, borderStyle=solid (no crash on missing cloud metadata)', () => {
  const pl = resolvePropertiesPanelShape({
    type: 'polyline', stroke: '#000', strokeWidth: 1,
    points: [{ x: 0, y: 0 }, { x: 10, y: 0 }],
    data: {}
  });
  assert.equal(pl.kind, 'polyline');
  assert.equal(pl.borderStyle, 'solid');
});

test('cloud rectangle resolves to kind=rect, borderStyle=cloud, cloudIntensity preserved', () => {
  const cr = resolvePropertiesPanelShape({
    type: 'rect', stroke: '#ff0000', strokeWidth: 2,
    data: { pdfCloudIntensity: 2 }
  });
  assert.equal(cr.kind, 'rect');
  assert.equal(cr.borderStyle, 'cloud');
  assert.equal(cr.cloudIntensity, 2);
});

test('cloud polygon resolves to kind=polygon, borderStyle=cloud', () => {
  const cp = resolvePropertiesPanelShape({
    type: 'polygon', stroke: '#000', strokeWidth: 1,
    points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 5, y: 10 }],
    data: { pdfCloudIntensity: 3 }
  });
  assert.equal(cp.kind, 'polygon');
  assert.equal(cp.borderStyle, 'cloud');
  assert.equal(cp.cloudIntensity, 3);
});

test('dashed rect (strokeDashArray non-empty) resolves to borderStyle=dashed', () => {
  const dr = resolvePropertiesPanelShape({
    type: 'rect', stroke: '#000', strokeWidth: 1,
    strokeDashArray: [6, 4],
    data: {}
  });
  assert.equal(dr.kind, 'rect');
  assert.equal(dr.borderStyle, 'dashed');
});

test('line resolves to kind=line, borderStyle=solid when no dash array', () => {
  const ln = resolvePropertiesPanelShape({ type: 'line', stroke: '#000', strokeWidth: 1, data: {} });
  assert.equal(ln.kind, 'line');
  assert.equal(ln.borderStyle, 'solid');
});

test('null/undefined annotation returns kind=unknown', () => {
  assert.equal(resolvePropertiesPanelShape(null).kind, 'unknown');
  assert.equal(resolvePropertiesPanelShape(undefined).kind, 'unknown');
});
