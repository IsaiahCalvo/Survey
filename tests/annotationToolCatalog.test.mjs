import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ANNOTATION_TOOL_CATALOG, agentToolNamesForTools, filterToolsForKit, toolGroupByTool,
} from '../src/annotation/toolCatalog.js';
import { ANNOTATION_TOOL_NAMES, ANNOTATION_TOOL_SPECS } from '../supabase/functions/_shared/annotationAgentSpec.js';
import { TOOL_GROUP_BY_TOOL } from '../src/utils/markToolGroup.js';

test('catalog lists each tool once with id, label and group', () => {
  const ids = ANNOTATION_TOOL_CATALOG.map((t) => t.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const t of ANNOTATION_TOOL_CATALOG) {
    assert.ok(t.id && t.label && t.group, JSON.stringify(t));
    assert.ok(Array.isArray(t.agentTools));
  }
});

test('tool bar groups come from the catalog (unchanged table)', () => {
  assert.deepEqual(TOOL_GROUP_BY_TOOL, toolGroupByTool());
  assert.deepEqual({ ...TOOL_GROUP_BY_TOOL }, {
    pen: 'draw', highlighter: 'draw', 'text-highlight': 'draw', eraser: 'draw',
    rect: 'shape', ellipse: 'shape', polygon: 'shape', polyline: 'shape', line: 'shape', arrow: 'shape', counter: 'shape',
    text: 'review', callout: 'review', symbol: 'review',
  });
});

test('agent spec tool list is derived from the catalog', () => {
  assert.deepEqual([...ANNOTATION_TOOL_NAMES], agentToolNamesForTools(ANNOTATION_TOOL_CATALOG));
  assert.equal(new Set(ANNOTATION_TOOL_NAMES).size, ANNOTATION_TOOL_NAMES.length);
  assert.equal(ANNOTATION_TOOL_SPECS.length, 12);
  for (const spec of ANNOTATION_TOOL_SPECS) assert.ok(spec.inputSchema && spec.description);
});

test('filterToolsForKit: no allowlist shows all; allowlist filters in catalog order', () => {
  assert.deepEqual(filterToolsForKit(ANNOTATION_TOOL_CATALOG, undefined), [...ANNOTATION_TOOL_CATALOG]);
  assert.deepEqual(filterToolsForKit(ANNOTATION_TOOL_CATALOG, { id: 'k' }), [...ANNOTATION_TOOL_CATALOG]);
  const picked = filterToolsForKit(ANNOTATION_TOOL_CATALOG, { markupTools: ['callout', 'pen', 'nope'] });
  assert.deepEqual(picked.map((t) => t.id), ['pen', 'callout']);
  assert.deepEqual(filterToolsForKit(ANNOTATION_TOOL_CATALOG, { markupTools: [] }), []);
  assert.deepEqual(agentToolNamesForTools(picked),
    ['survey_list_annotations', 'survey_add_callout', 'survey_edit_callout', 'survey_delete_annotation']);
});
