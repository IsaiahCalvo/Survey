// Kal Voe suite words on screen (KAL-591): behind the Nightly 'suite' flag,
// Markup reads Annotation, sorting Tags read Labels and a Survey Marker's
// name reads Tag. Stable keeps the old words; code and stored values keep
// their names.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { FEATURE_FLAGS } from '../src/featureFlags.js';
import { SUITE_WORDS, labelCellName, suiteWord } from '../src/suite/suiteWords.js';

const read = (rel) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8');

test('the suite flag is a Nightly beta flag with an off row', () => {
  assert.equal(FEATURE_FLAGS.suite.stage, 'beta');
  assert.match(read('supabase/migrations/20261115190000_suite_flag.sql'), /\('suite', 'off',/);
});

test('flag off: every word stays as it was', () => {
  for (const old of Object.keys(SUITE_WORDS)) assert.equal(suiteWord(old, false), old);
  assert.equal(labelCellName(['A', 'B'], false), 'Tags: A, B. Edit tags');
});

test('flag on: the agreed suite words', () => {
  assert.equal(suiteWord('Markups', true), 'Annotations');
  assert.equal(suiteWord('Markup layers', true), 'Annotation layers');
  assert.equal(suiteWord('Export markup (XFDF)', true), 'Export annotations (XFDF)');
  assert.equal(suiteWord('Tags', true), 'Labels');
  assert.equal(suiteWord('Add tags…', true), 'Add labels…');
  assert.equal(suiteWord('Name', true), 'Tag');
  assert.equal(suiteWord('Survey Marker name', true), 'Survey Marker tag');
  assert.equal(labelCellName(['A', 'B'], true), 'Labels: A, B. Edit labels');
  // Words outside the list pass through.
  assert.equal(suiteWord('Pages', true), 'Pages');
  // No suite word says Markup or calls a sorting word a Tag.
  for (const word of Object.values(SUITE_WORDS)) {
    assert.doesNotMatch(word, /markup/i, word);
    assert.doesNotMatch(word, /\btags\b/i, word);
  }
});

test('screens that said Markup or Tags go through suiteWord', () => {
  const sites = {
    'src/PDFSidebar.jsx': /label: suiteWord\('Markups'\)/,
    'src/sidebar/LayersPanel.jsx': /suiteWord\('Markup layers'\)/,
    'src/components/PrintPanel.jsx': /suiteWord\('Markups'\)/,
    'src/mobile/MobilePdfViewerChrome.jsx': /markups: suiteWord\('Markups'\)/,
    'src/AppShell.jsx': /label: suiteWord\('Export markup \(XFDF\)'\)/,
    'src/home/DocumentsLedger.jsx': /tags: suiteWord\('Tags'\)/,
    'src/home/HomeLibraryBits.jsx': /labelCellName\(tags\)/,
    'src/markLibrary/MarkLibraryPanel.jsx': /suiteWord\('Group by tag'\)/,
    'src/markLibrary/MarkLibrarySaveDialog.jsx': /suiteWord\('Tags \(comma between them\)'\)/,
    'src/projectItems/ProjectItemsPanel.jsx': /suiteWord\('Tags'\)/,
    'src/components/SurveyMarkerPlacementDialog.jsx': /suiteWord\('Survey Marker name'\)/,
    'src/SurveySpacesRail.jsx': /return suiteWord\('Item name'\)/,
  };
  for (const [file, re] of Object.entries(sites)) assert.match(read(file), re, file);
});

test('the Survey agent says annotation, not markup', () => {
  const spec = read('supabase/functions/_shared/surveyAgentSpec.js');
  assert.match(spec, /- Annotation tools \(call open_markup_tools first/);
  assert.doesNotMatch(spec, /The markup tools come/);
  assert.match(read('src/agent/surveyAgentTools.js'), /'The annotation tools are ready\.'/);
});

test('Excel headers keep their names, so old workbooks still import', () => {
  assert.match(read('src/services/buildScopeImportPlans.js'), /const SYSTEM_HEADERS = \['Row ID', 'Changed By', 'Changed Date', 'Item', 'Entity', 'Notes'\];/);
});

test('CONTEXT.md carries the suite words', () => {
  const ctx = read('CONTEXT.md');
  for (const heading of ['### Annotation', '### Labels', '### Tag']) assert.ok(ctx.includes(heading), heading);
});
