import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// 390 checklist Y/N/N-A is parked: no compiled-in / surveyTransitionE2E
// template has checklist items, and there is no DEV seed hook for them.
// Next unique leftover: notes Photo/Video attach (not text notes).
// Live proof: debug/scenarios/e2e-survey-checklist-or-next.spec.mjs

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('compiled-in surveyTransitionE2E seeds have no checklist items and no checklist seed hook', () => {
  const route = read('src/DevTestRoute.jsx');
  const kal = route.slice(
    route.indexOf('const makeKal436Modules'),
    route.indexOf('const surveyTransitionE2ETemplates'),
  );
  assert.match(kal, /name: 'Walls'/);
  assert.match(kal, /name: 'Doors'/);
  assert.doesNotMatch(kal, /checklist\s*:/);

  const seeds = route.slice(
    route.indexOf('const surveyTransitionE2ETemplates'),
    route.indexOf('const SURVEY_TEMPLATE_WORKFLOW_STORAGE_KEY'),
  );
  assert.match(seeds, /name: 'KAL-436 Preservation Template'/);
  assert.match(seeds, /name: 'Survey Entities Template'/);
  assert.match(seeds, /name: 'Empty Module Template'/);
  assert.match(seeds, /name: 'Two Category Template'/);
  assert.doesNotMatch(seeds, /checklist\s*:/);
  assert.doesNotMatch(seeds, /checklistItems:/);
  assert.doesNotMatch(seeds, /text: '/);

  const rail = read('src/SurveySpacesRail.jsx');
  assert.match(rail, /window\.__e2eSurveyMarkers = \{/);
  assert.doesNotMatch(rail, /__e2eSurveyChecklist/);
  assert.doesNotMatch(rail, /__e2eChecklist/);
  assert.doesNotMatch(rail, /__e2eSurveyTemplates/);

  const empty = rail.slice(
    rail.indexOf('className="mobile-survey-detail-checklist"'),
    rail.indexOf('Choose category first'),
  );
  assert.match(empty, /No checklist items/);
  assert.match(empty, /applyChecklistResponseSelection/);
  assert.match(empty, /aria-label=\{\`\$\{item\.text\} \$\{option\}\`\}/);
});

test('desktop Note dialog and 390 notes editor share Photo/Video attach writes', () => {
  const viewer = read('src/PDFViewer.jsx');
  const dialog = viewer.slice(
    viewer.indexOf('{/* Note Dialog */}'),
    viewer.indexOf('setNoteDialogContent({ text: \'\', photos: [], videos: [] }); // Clear dialog content'),
  );
  assert.match(dialog, /Upload photos/);
  assert.match(dialog, /Upload videos/);
  assert.match(dialog, /accept="image\/\*"/);
  assert.match(dialog, /accept="video\/\*"/);
  assert.match(dialog, /photos: \[\.\.\.prev\.photos, \.\.\.photos\]/);
  assert.match(dialog, /videos: \[\.\.\.prev\.videos, \.\.\.videos\]/);
  assert.match(dialog, /note: newNote/);
  assert.doesNotMatch(dialog, /addHistoryCheckpoint\(/);
  assert.doesNotMatch(dialog, /applyChecklistResponseSelection/);

  const rail = read('src/SurveySpacesRail.jsx');
  const mobile = rail.slice(
    rail.indexOf('const addMobileNoteMedia = (kind, fileList) => {'),
    rail.indexOf('const surveyMarkerRowActionStyle = {'),
  );
  assert.match(mobile, /if \(!files\.length\) return;/);
  assert.match(mobile, /reader\.readAsDataURL\(file\)/);
  assert.match(mobile, /name: file\.name, dataUrl:/);

  const editor = rail.slice(
    rail.indexOf('className="mobile-survey-notes-attach-header"'),
    rail.indexOf('className="mobile-survey-notes-footer"'),
  );
  assert.match(editor, /<span>Photo<\/span>/);
  assert.match(editor, /<span>Video<\/span>/);
  assert.match(editor, /addMobileNoteMedia\('photos'/);
  assert.match(editor, /addMobileNoteMedia\('videos'/);
  assert.match(editor, /aria-label=\{\`Remove \$\{photo\?\.name \|\| 'photo'\}\`\}/);
  assert.match(editor, /aria-label=\{\`Remove \$\{video\?\.name \|\| 'video'\}\`\}/);
  assert.match(editor, /No attachments\./);
  assert.doesNotMatch(editor, /applyChecklistResponseSelection/);

  const railFull = read('src/SurveySpacesRail.jsx');
  assert.match(railFull, /const noteHasContent = \(note\) => Boolean\(/);
  assert.match(railFull, /Array\.isArray\(note\?\.photos\) && note\.photos\.length/);
  assert.match(railFull, /noteHasContent\(surveyMarkers\[annotationId\]\?\.note\)/);
  assert.doesNotMatch(
    railFull.slice(
      railFull.indexOf('aria-label={noteHasContent'),
      railFull.indexOf('aria-label={noteHasContent') + 180,
    ),
    /note\?\.text \? "Edit item notes"/,
  );
});

test('390 checklist empty-state is not Photo/Video; leftover-18 unplaced-rows stay parked', () => {
  const rail = read('src/SurveySpacesRail.jsx');
  const detail = rail.slice(
    rail.indexOf('className="mobile-survey-detail-check-header"'),
    rail.indexOf('Choose category first'),
  );
  assert.match(detail, /No checklist items/);
  assert.doesNotMatch(detail, /<span>Photo<\/span>/);
  assert.doesNotMatch(detail, /Upload photos/);

  const unplaced = rail.slice(
    rail.indexOf('{/* KAL-292 — rows the linked Excel sent'),
    rail.indexOf('{/* Panel Content */}'),
  );
  assert.match(unplaced, /ExcelUnplacedRows/);
  assert.match(unplaced, /surveyUnplacedRows/);
  assert.doesNotMatch(unplaced, /Upload photos/);
  assert.doesNotMatch(unplaced, /applyChecklistResponseSelection/);
});
