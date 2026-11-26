import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildWalkMarkers } from '../src/suite/walkthruHandoff.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

test('buildWalkMarkers scales dot markers on large architectural sheets while keeping 12pt on Letter sheets (#1722)', () => {
  const template = {
    modules: [{ id: 'm1', categories: [{ id: 'c1', name: 'Camera' }] }],
    entities: [{ id: 'e1', name: 'GC', color: '#2563eb' }],
  };
  const nodeTypes = [{ id: 'nt1', name: 'Camera' }];
  const nodes = [{ id: 'n1', page_index: 0, x_pct: 0.5, y_pct: 0.5, node_type_id: 'nt1', title: 'Lobby Cam' }];

  const archD = buildWalkMarkers({
    nodes,
    nodeTypes,
    template,
    moduleId: 'm1',
    categoryFor: { nt1: 'c1' },
    pageSize: () => ({ width: 2592, height: 1728, rotation: 0 }),
    newId: () => 'mk-archd',
  });
  assert.ok(archD.markers['mk-archd'].bounds.width >= 40, 'ARCH D dot marker should scale up for tappability');

  const letter = buildWalkMarkers({
    nodes,
    nodeTypes,
    template,
    moduleId: 'm1',
    categoryFor: { nt1: 'c1' },
    pageSize: () => ({ width: 612, height: 792, rotation: 0 }),
    newId: () => 'mk-letter',
  });
  assert.ok(letter.markers['mk-letter'].bounds.width <= 14, 'Letter sheet keeps compact default dot size');
});

test('SVGAnnotationLayer uses finger-sized tap slop to select existing Survey markers instead of dropping duplicates (#1722)', () => {
  const src = fs.readFileSync(path.join(repoRoot, 'src/components/SVGAnnotationLayer.jsx'), 'utf8');
  assert.match(src, /const hitPad = e\.pointerType === 'touch' \? 16 : 6;/);
  assert.match(src, /setSelectedSurveyMarkerId\?\.\(hitMarkerId\);/);
});
