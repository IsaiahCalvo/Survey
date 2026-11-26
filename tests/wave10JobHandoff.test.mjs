import test from 'node:test';
import assert from 'node:assert/strict';
import { matchCategories, singularizeCategoryName } from '../src/suite/walkthruHandoff.js';
import {
  linkRows,
  linksToSave,
  loadSavedJobCategoryLinks,
  saveJobCategoryLinks,
  startingPicks,
} from '../src/suite/categoryLinks.js';
import { jobToWalk, normalizeJobFloorLabel } from '../src/suite/jobPackage.js';

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
  };
}

const template = {
  id: 't1',
  modules: [{
    id: 'm1',
    categories: [
      { id: 'c-cam', name: 'Camera' },
      { id: 'c-door', name: 'Door' },
      { id: 'c-intercom', name: 'Intercom' },
      { id: 'c-box', name: 'Box' },
      { id: 'c-battery', name: 'Battery' },
    ],
  }],
};

test('#1617: Plot plural block names (Cameras/Doors/Intercoms) auto-match singular Survey template categories when allowPlural is on', () => {
  assert.equal(singularizeCategoryName('Cameras'), 'camera');
  assert.equal(singularizeCategoryName('Doors'), 'door');
  assert.equal(singularizeCategoryName('Intercoms'), 'intercom');
  assert.equal(singularizeCategoryName('Boxes'), 'box');
  assert.equal(singularizeCategoryName('Batteries'), 'battery');

  const plotTypes = [
    { id: 'name:Cameras', name: 'Cameras' },
    { id: 'name:Doors', name: 'Doors' },
    { id: 'name:Intercoms', name: 'Intercoms' },
  ];

  // Default (Walkthru): strict exact-name rule stays unchanged.
  const strict = matchCategories(plotTypes, template, 'm1');
  assert.deepEqual(strict.nameMatches, []);
  assert.equal(strict.missing.length, 3);

  // Plot job file (allowPlural: true): auto-matches unambiguous singular/plural names.
  const plural = matchCategories(plotTypes, template, 'm1', { allowPlural: true });
  assert.deepEqual(plural.nameMatches, [
    { nodeTypeId: 'name:Cameras', categoryId: 'c-cam', name: 'Cameras' },
    { nodeTypeId: 'name:Doors', categoryId: 'c-door', name: 'Doors' },
    { nodeTypeId: 'name:Intercoms', categoryId: 'c-intercom', name: 'Intercoms' },
  ]);
  assert.deepEqual(plural.missing, []);
  assert.deepEqual(startingPicks(linkRows(plural)), {
    'name:Cameras': 'c-cam',
    'name:Doors': 'c-door',
    'name:Intercoms': 'c-intercom',
  });
});

test('#1603: confirmed Plot job-file Category links are remembered and auto-linked on re-add', () => {
  const storage = memoryStorage();
  const plotTypes = [
    { id: 'name:CCTV Units', name: 'CCTV Units' },
    { id: 'name:Entry Gates', name: 'Entry Gates' },
  ];
  const firstMatch = matchCategories(plotTypes, template, 'm1', { allowPlural: true });
  const rows = linkRows(firstMatch);
  const picks = { 'name:CCTV Units': 'c-cam', 'name:Entry Gates': 'c-door' };
  const toSave = linksToSave(rows, picks, template, 'm1');
  const outcome = saveJobCategoryLinks('t1', 'm1', toSave, storage);
  assert.equal(outcome.saved.length, 2);
  assert.deepEqual(outcome.notSaved, []);

  // Re-adding the same job file loads the saved links and matches automatically without asking again.
  const savedLinks = loadSavedJobCategoryLinks('t1', 'm1', storage);
  const secondMatch = matchCategories(plotTypes, template, 'm1', { allowPlural: true, savedLinks });
  assert.deepEqual(secondMatch.linked, {
    'name:CCTV Units': 'c-cam',
    'name:Entry Gates': 'c-door',
  });
  assert.deepEqual(secondMatch.nameMatches, []);
  assert.deepEqual(secondMatch.missing, []);
});

test('#1598: Survey jobToWalk normalizes legacy numeric Plot floor codes (1000 -> R, 1.5 -> M1, -0.5 -> LL, -1 -> P1)', () => {
  assert.equal(normalizeJobFloorLabel('1000'), 'R');
  assert.equal(normalizeJobFloorLabel('1.5'), 'M1');
  assert.equal(normalizeJobFloorLabel('-0.5'), 'LL');
  assert.equal(normalizeJobFloorLabel('0'), 'G');
  assert.equal(normalizeJobFloorLabel('-1'), 'P1');
  assert.equal(normalizeJobFloorLabel('R'), 'R');
  assert.equal(normalizeJobFloorLabel('Level 2'), 'Level 2');

  const walk = jobToWalk({
    format: 'kalvoe.job',
    version: 1,
    sourceApp: 'plot',
    job: { suiteJobId: 'j1', name: 'South Amboy' },
    pages: [
      { pageId: 'B05', file: 'pages/B05.pdf', pageIndex: 0, floor: '1000', title: 'B05' },
      { pageId: 'B06', file: 'pages/B06.pdf', pageIndex: 1, floor: '1.5', title: 'B06' },
    ],
    items: [
      { suiteId: 'd1', tag: 'C-R-01', library: { categoryName: 'Cameras' }, pageId: 'B05', position: { x: 0.2, y: 0.2 }, floor: '1000' },
      { suiteId: 'd2', tag: 'D-M1-01', library: { categoryName: 'Doors' }, pageId: 'B06', position: { x: 0.5, y: 0.5 }, floor: '1.5' },
    ],
  }, []);

  assert.equal(walk.floors[0].nodes[0].floor_label, 'R');
  assert.equal(walk.floors[1].nodes[0].floor_label, 'M1');
});
