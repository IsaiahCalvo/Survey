import assert from 'node:assert/strict';
import fs from 'node:fs';
import test from 'node:test';
import { linkedRows } from '../src/suite/categoryLinks.js';
import { matchCategories } from '../src/suite/walkthruHandoff.js';

test('linkedRows names the matched Survey Category for each library link (#1741)', () => {
  const template = {
    id: 'tpl-1',
    modules: [
      {
        id: 'mod-sec',
        name: 'Security',
        categories: [
          { id: 'cat-door', name: 'Door', libraryEntryId: 'lib-door' },
          { id: 'cat-cam', name: 'Camera', libraryEntryId: 'lib-cam' },
        ],
      },
    ],
  };
  const usedTypes = [
    { id: 'nt-1', name: 'Quokka Sensor', library_entry_id: 'lib-door' },
    { id: 'nt-2', name: 'Wombat Camera', library_entry_id: 'lib-cam' },
    { id: 'nt-3', name: 'Unlinked Item', library_entry_id: null },
  ];
  const counts = new Map([
    ['nt-1', 1],
    ['nt-2', 3],
    ['nt-3', 2],
  ]);

  const match = matchCategories(usedTypes, template, 'mod-sec');
  const linked = linkedRows(match, usedTypes, counts, template, 'mod-sec');

  assert.deepEqual(linked, [
    {
      nodeTypeId: 'nt-1',
      name: 'Quokka Sensor',
      count: 1,
      categoryId: 'cat-door',
      categoryName: 'Door',
    },
    {
      nodeTypeId: 'nt-2',
      name: 'Wombat Camera',
      count: 3,
      categoryId: 'cat-cam',
      categoryName: 'Camera',
    },
  ]);
});

test('WalkthruHandoffDialog renders linked in the library as <Category> (#1741)', () => {
  const dialogSrc = fs.readFileSync(
    new URL('../src/home/WalkthruHandoffDialog.jsx', import.meta.url),
    'utf8',
  );
  assert.match(dialogSrc, /linkedRows\(match, usedTypes, nodeCount, template, moduleId\)/);
  assert.match(dialogSrc, /linked in the library as \$\{item\.categoryName\}/);
});

test('ProjectsFolderTree passes drilled project name to HubShell mobileTitle (#1739)', () => {
  const treeSrc = fs.readFileSync(
    new URL('../src/home/ProjectsFolderTree.jsx', import.meta.url),
    'utf8',
  );
  const shellSrc = fs.readFileSync(
    new URL('../src/home/HubShell.jsx', import.meta.url),
    'utf8',
  );
  const cssSrc = fs.readFileSync(
    new URL('../src/home/hub.css', import.meta.url),
    'utf8',
  );

  assert.match(
    treeSrc,
    /mobileTitle=\{mobileDrillProject \? \(mobileDrillProject\.name \|\| 'Untitled project'\) : null\}/,
  );
  assert.match(shellSrc, /<MobileRailNav mode=\{mobileNavMode\} title=\{mobileTitle \|\| title\}/);
  assert.match(shellSrc, /className="hub-title-mobile"/);
  assert.match(cssSrc, /\.survey-hub \.hub-title-mobile/);
});
