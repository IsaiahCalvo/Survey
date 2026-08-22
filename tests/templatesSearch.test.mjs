import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Live proof: debug/scenarios/e2e-templates-search.spec.mjs
// Unique leftovers after template-list + checklist item reorder:
// list Search (templateMatchesSearch), mobile content Search
// (templateContentSearch), Edit-modules Search modules (modSearch).
// Distinct from PDF find and leftover-18.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

const templateMatchesSearch = (template, query) => {
  if (!query) return true;
  const haystack = [
    template.name,
    ...(template.modules || []).flatMap((mod) => [
      mod.name,
      ...(mod.categories || []).flatMap((cat) => [
        cat.name,
        ...(cat.items || []).map((item) => item.text || item.lastKnownLabel),
      ]),
    ]),
    ...(template.roster || []).map((entity) => entity.role),
  ];
  return haystack.some((value) => String(value || '').toLowerCase().includes(query));
};

const SEED = [
  {
    id: 't1',
    name: 'Security Walk-Through',
    modules: [
      {
        name: 'Installation Phase',
        categories: [
          { name: 'Cameras', items: [{ text: 'Is the camera cable pulled?' }, { text: 'Is the camera installed?' }] },
          { name: 'Doors', items: [{ text: 'Is the door roughed in?' }, { text: 'Are the door devices installed?' }] },
        ],
      },
      {
        name: 'Commissioning Phase',
        categories: [
          { name: 'Cameras', items: [{ text: 'Camera tested and online?' }] },
        ],
      },
    ],
    roster: [{ role: 'GC' }, { role: 'Subcontractor' }, { role: '100% Complete' }],
  },
  {
    id: 't2',
    name: 'MEP As-Built Markup',
    modules: [
      {
        name: 'Equipment',
        categories: [
          { name: 'AHU Equipment', items: [{ text: 'Tags updated?' }] },
        ],
      },
    ],
    roster: [{ role: 'MEP' }, { role: 'Architect' }],
  },
];

const namesFor = (query) => SEED.filter((t) => templateMatchesSearch(t, query.trim().toLowerCase())).map((t) => t.name);

test('templateMatchesSearch matches name, module, category, item, entity; empty and case', () => {
  const editor = read('src/home/TemplatesEditor.jsx');
  const start = editor.indexOf('const templateMatchesSearch = (template, query) => {');
  assert.ok(start > 0, 'templateMatchesSearch');
  const block = editor.slice(start, editor.indexOf('const restrictSortableToHorizontalAxis', start));
  assert.match(block, /if \(!query\) return true;/);
  assert.match(block, /template\.name/);
  assert.match(block, /mod\.name/);
  assert.match(block, /cat\.name/);
  assert.match(block, /item\.text \|\| item\.lastKnownLabel/);
  assert.match(block, /entity\.role/);
  assert.match(block, /toLowerCase\(\)\.includes\(query\)/);
  assert.doesNotMatch(block, /mutateTpl/);
  assert.doesNotMatch(block, /file\.id/);

  assert.match(editor, /const q = search\.trim\(\)\.toLowerCase\(\);/);
  assert.match(editor, /return rich\.filter\(\(template\) => templateMatchesSearch\(template, q\)\)/);
  assert.match(editor, /placeholder="Search templates\.\.\."/);
  assert.match(editor, /placeholder=\{mobileTemplateOpen \? 'Search template\.\.\.' : 'Search templates\.\.\.'\}/);
  assert.match(editor, /value=\{mobileTemplateOpen \? templateContentSearch : search\}/);
  assert.match(editor, /dismissActionSelector="\[data-drag-rearrange-row\]"/);
  assert.match(editor, /dismissActionSelector=\{mobileTemplateOpen/);
  assert.match(editor, /placeholder="Search modules\.\.\."/);
  assert.match(editor, /if \(!modEdit\) setModSearch\(''\)/);
  assert.doesNotMatch(editor, /PRINT_PANEL_ENABLED/);
  assert.doesNotMatch(editor, /stampTool/);
  assert.doesNotMatch(editor, /Note-Link/);

  assert.deepEqual(namesFor(''), ['Security Walk-Through', 'MEP As-Built Markup']);
  assert.deepEqual(namesFor('   '), ['Security Walk-Through', 'MEP As-Built Markup']);
  assert.deepEqual(namesFor('security'), ['Security Walk-Through']);
  assert.deepEqual(namesFor('SECURITY'), ['Security Walk-Through']);
  assert.deepEqual(namesFor('ahu'), ['MEP As-Built Markup']);
  assert.deepEqual(namesFor('architect'), ['MEP As-Built Markup']);
  assert.deepEqual(namesFor('camera cable'), ['Security Walk-Through']);
  assert.deepEqual(namesFor('xyzzy'), []);
  assert.deepEqual(namesFor('phase'), ['Security Walk-Through']);
});

test('mobile content search and module search stay local and do not dirty', () => {
  const editor = read('src/home/TemplatesEditor.jsx');

  const content = editor.slice(
    editor.indexOf('const templateQuery = templateContentSearch.trim().toLowerCase();'),
    editor.indexOf('/* New Category is an explicit action'),
  );
  assert.match(content, /visibleCats\.filter\(\(cat\) => \[/);
  assert.match(content, /cat\.name/);
  assert.match(content, /item\.text \|\| item\.lastKnownLabel/);
  assert.match(content, /tpl\.roster\.filter\(\(entity\) => String\(entity\.role \|\| ''\)\.toLowerCase\(\)\.includes\(templateQuery\)\)/);
  assert.doesNotMatch(content, /mutateTpl/);
  assert.doesNotMatch(content, /markEdited/);

  const modal = editor.slice(
    editor.indexOf('{/* Edit modules modal */}'),
    editor.indexOf('{/* Move/Copy modal */}'),
  );
  assert.match(modal, /const moduleQuery = modSearch\.trim\(\)\.toLowerCase\(\);/);
  assert.match(modal, /mods\.filter\(\(mod\) => \(mod\.name \|\| ''\)\.toLowerCase\(\)\.includes\(moduleQuery\)\)/);
  assert.match(modal, /No modules match your search\./);
  assert.match(modal, /placeholder="Search modules\.\.\."/);
  assert.doesNotMatch(modal, /markEdited/);

  assert.match(editor, /setTemplateContentSearch\(''\)/);
  assert.match(editor, /const \[search, setSearch\] = useState\(''\)/);
  assert.match(editor, /const \[modSearch, setModSearch\] = useState\(''\)/);
  assert.match(editor, /const \[templateContentSearch, setTemplateContentSearch\] = useState\(''\)/);

  assert.match(editor, /onChange=\{setSearch\}/);
  assert.match(editor, /onChange=\{mobileTemplateOpen \? setTemplateContentSearch : setSearch\}/);
  assert.doesNotMatch(editor, /setSearch\(.*mutateTpl/);

  const preview = read('src/home/HubPreview.jsx');
  assert.match(preview, /Security Walk-Through/);
  assert.match(preview, /MEP As-Built Markup/);
  assert.match(preview, /AHU Equipment/);
  assert.match(preview, /Is the camera cable pulled\?/);
  assert.doesNotMatch(preview, /VITE_DEV_AUTO_LOGIN/);
});

test('Move/Copy stays a dead stub; search is not PDF find', () => {
  const editor = read('src/home/TemplatesEditor.jsx');
  const moveAt = editor.indexOf('{/* Move/Copy modal */}');
  assert.ok(moveAt > 0, 'Move/Copy modal exists');
  const move = editor.slice(moveAt);
  assert.match(move, /onClick=\{closeMoveModal\}/);
  assert.match(move, />Copy<\/button>/);
  assert.match(move, />Move<\/button>/);
  assert.doesNotMatch(move, /mutateTpl/);
  assert.doesNotMatch(move, /onExportSpaceCSV/);
  assert.doesNotMatch(move, /Copy to Spaces/);

  assert.doesNotMatch(editor, /onFindTextMatches/);
  assert.doesNotMatch(editor, /SearchTextPanel/);
  assert.doesNotMatch(editor, /PRINT_PANEL_ENABLED/);
  assert.doesNotMatch(editor, /stampTool/);
  assert.doesNotMatch(editor, /Note-Link/);
});
