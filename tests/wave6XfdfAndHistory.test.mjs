import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { formatSurveyMarkerContents } from '../src/utils/pdfAnnotationsPdfLib.js';
import { buildSurveyMarkerUpdateHistoryRow } from '../src/services/surveyMarkerHistory.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '..');

test('formatSurveyMarkerContents labels entity and includes status and note (#1712)', () => {
  const text = formatSurveyMarkerContents({
    name: 'Lobby Cam Quokka',
    entityName: 'GC',
    tracking: { status: 'done' },
    note: { text: 'Zorvel roundtrip note' },
  });
  assert.equal(
    text,
    'Lobby Cam Quokka · Entity: GC · Status: Done · Note: Zorvel roundtrip note',
  );
  assert.equal(text.includes(', GC'), false);

  const nameOnly = formatSurveyMarkerContents({ name: 'Hallway AP' });
  assert.equal(nameOnly, 'Hallway AP');
});

test('buildSurveyMarkerUpdateHistoryRow produces audit-log row for note and tracking updates (#1713)', () => {
  const row = buildSurveyMarkerUpdateHistoryRow({
    markerId: 'marker-1',
    marker: { name: 'Lobby Cam Quokka', pageNumber: 2 },
    documentId: 'doc-1',
    userId: 'user-1',
    actorName: 'Alex',
    change: 'changed status to done',
    updatedAt: '2026-11-26T00:00:00.000Z',
  });
  assert.equal(row.event_type, 'survey_marker_updated');
  assert.equal(row.document_id, 'doc-1');
  assert.equal(row.annotation_id, 'marker-1');
  assert.equal(row.page_number, 2);
  assert.match(row.summary, /changed status to done/);
  assert.match(row.summary, /Lobby Cam Quokka/);
});

test('SurveySpacesRail records document history on marker note and tracking edits (#1713)', () => {
  const src = fs.readFileSync(path.join(repoRoot, 'src/SurveySpacesRail.jsx'), 'utf8');
  assert.match(src, /buildSurveyMarkerUpdateHistoryRow/);
  assert.match(src, /recordAndNotifyDocumentHistoryEvent/);
});
