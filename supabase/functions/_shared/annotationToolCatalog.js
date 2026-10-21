// The one list of markup tools. Every markup tool appears here once: its id
// (the armed-tool id the viewer uses), its label, the tool-bar group it sits
// in, and the annotation-agent tools (annotationAgentSpec.js) that make or
// change its marks. The tool bar's tool -> group table (src/utils/
// markToolGroup.js) and the agent's tool list are both derived from it, and a
// custom kit picks which tools show with filterToolsForKit.
//
// Plain JS with no imports so Deno (the voice edge function), Vite and node
// tests all load the same file. App code imports it via
// src/annotation/toolCatalog.js.

export const ANNOTATION_TOOL_CATALOG = Object.freeze([
  { id: 'pen', label: 'Pen', group: 'draw', agentTools: [] },
  { id: 'highlighter', label: 'Highlighter', group: 'draw', agentTools: [] },
  { id: 'text-highlight', label: 'Text highlight', group: 'draw', agentTools: ['survey_add_highlight', 'survey_recolor_highlight'] },
  { id: 'eraser', label: 'Eraser', group: 'draw', agentTools: [] },
  { id: 'rect', label: 'Rectangle', group: 'shape', agentTools: ['survey_add_rectangle'] },
  { id: 'ellipse', label: 'Ellipse', group: 'shape', agentTools: ['survey_add_ellipse'] },
  { id: 'polygon', label: 'Polygon', group: 'shape', agentTools: ['survey_add_polygon'] },
  { id: 'polyline', label: 'Polyline', group: 'shape', agentTools: ['survey_add_polygon'] },
  { id: 'line', label: 'Line', group: 'shape', agentTools: ['survey_add_line'] },
  { id: 'arrow', label: 'Arrow', group: 'shape', agentTools: ['survey_add_line'] },
  { id: 'counter', label: 'Counter', group: 'shape', agentTools: [] },
  { id: 'text', label: 'Text box', group: 'review', agentTools: ['survey_add_text_note', 'survey_edit_text_note'] },
  { id: 'callout', label: 'Callout', group: 'review', agentTools: ['survey_add_callout', 'survey_edit_callout'] },
  // KAL-407: the Symbols tool sits in the Text group's row.
  { id: 'symbol', label: 'Symbols', group: 'review', agentTools: [] },
].map((tool) => Object.freeze({ ...tool, agentTools: Object.freeze([...tool.agentTools]) })));

// Agent tools that work across every markup kind (not owned by one tool).
// Listed before / after the per-tool agent tools respectively.
export const GENERAL_AGENT_TOOLS_BEFORE = Object.freeze(['survey_list_annotations']);
export const GENERAL_AGENT_TOOLS_AFTER = Object.freeze(['survey_delete_annotation']);

/** Tool id -> tool-bar group, from the catalog. */
export function toolGroupByTool(catalog = ANNOTATION_TOOL_CATALOG) {
  const out = {};
  for (const tool of catalog) out[tool.id] = tool.group;
  return out;
}

/** The agent tool names the given tools need, catalog order, no repeats,
 * framed by the general tools. */
export function agentToolNamesForTools(tools = ANNOTATION_TOOL_CATALOG) {
  const names = [...GENERAL_AGENT_TOOLS_BEFORE];
  for (const tool of tools) {
    for (const name of tool.agentTools || []) if (!names.includes(name)) names.push(name);
  }
  for (const name of GENERAL_AGENT_TOOLS_AFTER) if (!names.includes(name)) names.push(name);
  return names;
}

/**
 * The tools a kit shows. `kit.markupTools` is an allowlist of tool ids; a kit
 * with no allowlist (missing, or not an array) shows every tool. Unknown ids
 * are ignored; catalog order is kept. Pure.
 */
export function filterToolsForKit(catalog = ANNOTATION_TOOL_CATALOG, kit) {
  const allow = kit?.markupTools;
  if (!Array.isArray(allow)) return [...catalog];
  const wanted = new Set(allow);
  return catalog.filter((tool) => wanted.has(tool.id));
}
