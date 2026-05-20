import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSurveyMarkerRow,
  mapSurveyMarkerRowToLocalAnnotation,
} from '../src/services/documentSurveyMarkerMapper.js';

describe('document survey marker mapper', () => {
  it('persists survey-region metadata in annotation_data because document_annotations has no region_id column', () => {
    const row = buildSurveyMarkerRow({
      documentId: 'doc-1',
      userId: 'user-1',
      annotationId: 'highlight-1',
      annotation: {
        pageNumber: 4,
        bounds: { x: 10, y: 20, width: 30, height: 40 },
        moduleId: 'module-1',
        spaceId: 'space-1',
        regionId: 'region-1',
        color: '#ffee00',
      },
    });

    assert.equal(row.document_id, 'doc-1');
    assert.equal(row.annotation_id, 'highlight-1');
    assert.equal(row.module_id, 'module-1');
    // A Survey Marker never persists a standalone space_id, even if one is
    // present on the in-memory annotation.
    assert.equal(row.space_id, null);
    assert.equal(row.annotation_data.regionId, 'region-1');
    assert.equal(row.annotation_data.scope, 'survey-region');
    assert.equal(row.annotation_type, 'survey-marker');
  });

  it('hydrates survey-region metadata from annotation_data on reload', () => {
    const local = mapSurveyMarkerRowToLocalAnnotation({
      id: 'row-1',
      annotation_id: 'highlight-1',
      user_id: 'user-1',
      last_modified_by: 'user-1',
      page_number: 4,
      bounds: { x: 10, y: 20, width: 30, height: 40 },
      category_id: 'cat-1',
      module_id: 'module-1',
      space_id: 'space-1',
      name: 'Pump',
      notes: { text: 'note' },
      checklist_responses: {},
      color: '#ffee00',
      opacity: 0.3,
      version: 2,
      updated_at: '2026-05-11T00:00:00.000Z',
      annotation_data: {
        regionId: 'region-1',
        scope: 'survey-region',
      },
    });

    assert.equal(local.annotationId, 'highlight-1');
    assert.equal(local.moduleId, 'module-1');
    // A stray space_id on the row is ignored — Survey Markers are scoped by
    // module + region only.
    assert.equal(local.spaceId, undefined);
    assert.equal(local.regionId, 'region-1');
  });
});
