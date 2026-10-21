// The annotation agent's tool contract, shared by the app (src/agent/
// annotationTools.js builds the WebMCP tools and attaches the executors that
// run on the open document) and the voice edge function (which puts these
// schemas on the model's tool list). Plain JS with no runtime imports so Deno,
// Vite and node tests all load the same file. Mirrors surveyAgentSpec.js.
//
// These are the "normal" annotations — text notes, shapes, highlights and
// callouts — not Survey markers (those live in surveyAgentSpec.js). Every tool
// writes through the same path a human tap uses, so sync, Excel and the
// person's role all apply, and one Undo takes a change back.

import { agentToolNamesForTools } from './annotationToolCatalog.js';

// Feature flag that gates the whole set. Ships off; the single source of
// truth for both the app and the voice server.
export const ANNOTATION_AGENT_FLAG = 'annotation-agent';

// Each spec is the canonical shape: name, description, a JSON-schema for the
// arguments (inputSchema), optional read-only/untrusted hints, the access gate
// and documentScoped. The WebMCP layer uses inputSchema as-is; the voice
// server reads inputSchema as the model function's `parameters`.
export function buildAnnotationToolSpecs() {
  const shapeSpec = ({ shape, word }) => ({
    name: `survey_add_${shape}`,
    description: `Draw a ${word} on the open PDF from a page box: the top-left corner (PDF points from the top-left of the page), a width and a height. Optionally a hex stroke color, a hex fill color (left out = no fill) and a stroke width. Needs editor or owner access.`,
    inputSchema: {
      type: 'object',
      properties: {
        page: { type: 'integer', minimum: 1 },
        x: { type: 'number', minimum: 0 },
        y: { type: 'number', minimum: 0 },
        width: { type: 'number', exclusiveMinimum: 0 },
        height: { type: 'number', exclusiveMinimum: 0 },
        stroke_color: { type: 'string', description: 'Hex outline color like #111827 (optional).' },
        fill_color: { type: 'string', description: 'Hex fill color (optional; left out = no fill).' },
        stroke_width: { type: 'number', exclusiveMinimum: 0, description: 'Outline width in points (default 2).' },
      },
      required: ['page', 'x', 'y', 'width', 'height'],
    },
    access: { signIn: true, minRole: 'editor' },
    documentScoped: true,
  });
  const specs = [
    {
      name: 'survey_list_annotations',
      description: 'List the normal annotations on the open PDF (text notes, shapes, highlights — not Survey markers): id, page, type, text and box. Use an id with survey_edit_text_note or survey_delete_annotation.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      access: { minRole: 'viewer' },
      documentScoped: true,
    },
    {
      name: 'survey_add_text_note',
      description: 'Add a text note (a text box) to the open PDF. Give the page, the top-left corner (PDF points from the top-left of the page), the text, and optionally a wrap width and hex color. The box fits its text. Needs editor or owner access.',
      inputSchema: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1 },
          x: { type: 'number', minimum: 0 },
          y: { type: 'number', minimum: 0 },
          text: { type: 'string', description: 'The note text.' },
          width: { type: 'number', minimum: 24, description: 'Wrap width in PDF points (default 160).' },
          color: { type: 'string', description: 'Hex text color like #111827 (optional).' },
        },
        required: ['page', 'x', 'y', 'text'],
      },
      access: { signIn: true, minRole: 'editor' },
      documentScoped: true,
    },
    {
      name: 'survey_edit_text_note',
      description: 'Change the text of a text note by id (from survey_list_annotations). The box re-fits to the new text. Needs editor or owner access, and only a note the person could edit by hand changes.',
      inputSchema: {
        type: 'object',
        properties: {
          annotation_id: { type: 'string' },
          text: { type: 'string', description: 'The new text.' },
        },
        required: ['annotation_id', 'text'],
      },
      access: { signIn: true, minRole: 'editor' },
      documentScoped: true,
    },
    {
      name: 'survey_delete_annotation',
      description: 'Delete a normal annotation (text note, shape, highlight or callout — not a Survey marker, which has survey_delete_marker) by id. Because this is hard to take back, it does NOTHING unless confirm is true, which the agent should set only after the person has agreed. One Undo restores it. Needs editor or owner access.',
      inputSchema: {
        type: 'object',
        properties: {
          annotation_id: { type: 'string' },
          confirm: { type: 'boolean', description: 'Leave false (or unset) to check first; set true only after the person has agreed to delete.' },
        },
        required: ['annotation_id'],
      },
      access: { signIn: true, minRole: 'editor' },
      documentScoped: true,
    },
    shapeSpec({ shape: 'rectangle', word: 'rectangle' }),
    shapeSpec({ shape: 'ellipse', word: 'ellipse' }),
    {
      name: 'survey_add_line',
      description: 'Draw a straight line (or arrow) on the open PDF between two page points (PDF points from the top-left of the page). Set arrow true for an arrowhead. Optionally a hex stroke color and stroke width. Needs editor or owner access.',
      inputSchema: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1 },
          x1: { type: 'number', minimum: 0 },
          y1: { type: 'number', minimum: 0 },
          x2: { type: 'number', minimum: 0 },
          y2: { type: 'number', minimum: 0 },
          arrow: { type: 'boolean', description: 'true draws an arrow (arrowhead at the end point); default false.' },
          stroke_color: { type: 'string', description: 'Hex line color like #111827 (optional).' },
          stroke_width: { type: 'number', exclusiveMinimum: 0, description: 'Line width in points (default 2).' },
        },
        required: ['page', 'x1', 'y1', 'x2', 'y2'],
      },
      access: { signIn: true, minRole: 'editor' },
      documentScoped: true,
    },
    {
      name: 'survey_add_polygon',
      description: 'Draw a polygon (closed) or polyline (open) on the open PDF from a list of page points (PDF points from the top-left). closed defaults to true (polygon); pass false for an open polyline. A polygon needs 3+ points, a polyline 2+. Optionally a hex stroke color, hex fill color (polygon only) and stroke width. Needs editor or owner access.',
      inputSchema: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1 },
          points: {
            type: 'array',
            minItems: 2,
            items: {
              type: 'object',
              properties: { x: { type: 'number', minimum: 0 }, y: { type: 'number', minimum: 0 } },
              required: ['x', 'y'],
            },
          },
          closed: { type: 'boolean', description: 'true (default) = filled-capable polygon; false = open polyline.' },
          stroke_color: { type: 'string', description: 'Hex outline color like #111827 (optional).' },
          fill_color: { type: 'string', description: 'Hex fill color for a closed polygon (optional; left out = no fill).' },
          stroke_width: { type: 'number', exclusiveMinimum: 0, description: 'Outline width in points (default 2).' },
        },
        required: ['page', 'points'],
      },
      access: { signIn: true, minRole: 'editor' },
      documentScoped: true,
    },
    {
      name: 'survey_add_callout',
      description: 'Add a callout: a text box with a leader line pointing at a spot on the page. Give the page, the text, the point the arrow should point at (arrow_x/arrow_y, PDF points from the top-left), and the text box top-left (box_x/box_y). Optionally a box width, a hex outline color and a hex fill color. Needs editor or owner access.',
      inputSchema: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1 },
          text: { type: 'string', description: 'The callout text.' },
          arrow_x: { type: 'number', minimum: 0, description: 'X of the point the leader arrow points at.' },
          arrow_y: { type: 'number', minimum: 0, description: 'Y of the point the leader arrow points at.' },
          box_x: { type: 'number', minimum: 0, description: 'X of the text box top-left corner.' },
          box_y: { type: 'number', minimum: 0, description: 'Y of the text box top-left corner.' },
          box_width: { type: 'number', exclusiveMinimum: 0, description: 'Text box width in points (default 120).' },
          stroke_color: { type: 'string', description: 'Hex outline/leader color like #1e293b (optional).' },
          fill_color: { type: 'string', description: 'Hex box fill color (optional; default transparent).' },
        },
        required: ['page', 'text', 'arrow_x', 'arrow_y', 'box_x', 'box_y'],
      },
      access: { signIn: true, minRole: 'editor' },
      documentScoped: true,
    },
    {
      name: 'survey_add_highlight',
      description: 'Highlight a run of text on a page. Give the page and the exact words to highlight (search_text); Survey finds them in the page text and highlights them. Matching ignores case and extra spaces, and a phrase that wraps across lines still matches. Optionally a hex color and an opacity (0-100). If the same words appear more than once, occurrence (1-based) picks which one. Needs editor or owner access.',
      inputSchema: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1 },
          search_text: { type: 'string', description: 'The words to highlight, as they read on the page.' },
          color: { type: 'string', description: 'Hex highlight color like #f4d35e (optional).' },
          opacity: { type: 'number', minimum: 0, maximum: 100, description: 'Highlight opacity, 0-100 (optional).' },
          occurrence: { type: 'integer', minimum: 1, description: 'Which match to highlight when the text repeats, 1-based (default 1).' },
        },
        required: ['page', 'search_text'],
      },
      access: { signIn: true, minRole: 'editor' },
      documentScoped: true,
    },
    {
      name: 'survey_edit_callout',
      description: 'Edit a callout by id (from survey_list_annotations): change its text and/or its colors. Give at least one of text, stroke_color (outline/leader) or fill_color. A text change re-fits the box. Needs editor or owner access, and only a callout the person could edit by hand changes.',
      inputSchema: {
        type: 'object',
        properties: {
          annotation_id: { type: 'string' },
          text: { type: 'string', description: 'The new callout text (optional).' },
          stroke_color: { type: 'string', description: 'Hex outline/leader color like #1e293b (optional).' },
          fill_color: { type: 'string', description: 'Hex box fill color (optional).' },
        },
        required: ['annotation_id'],
      },
      access: { signIn: true, minRole: 'editor' },
      documentScoped: true,
    },
    {
      name: 'survey_recolor_highlight',
      description: 'Change a highlight\'s color and/or opacity by id (from survey_list_annotations). Give at least one of color (hex) or opacity (0-100). Recolors the whole highlighted run. Needs editor or owner access, and only a highlight the person could edit by hand changes.',
      inputSchema: {
        type: 'object',
        properties: {
          annotation_id: { type: 'string' },
          color: { type: 'string', description: 'Hex highlight color like #f4d35e (optional).' },
          opacity: { type: 'number', minimum: 0, maximum: 100, description: 'Highlight opacity, 0-100 (optional).' },
        },
        required: ['annotation_id'],
      },
      access: { signIn: true, minRole: 'editor' },
      documentScoped: true,
    },
  ];
  // The tool list itself comes from the markup tool catalog: these specs only
  // supply each named tool's schema and wording.
  const byName = new Map(specs.map((spec) => [spec.name, spec]));
  return agentToolNamesForTools().map((name) => {
    const spec = byName.get(name);
    if (!spec) throw new Error(`annotationAgentSpec: no schema for catalog agent tool ${name}`);
    return spec;
  });
}

export const ANNOTATION_TOOL_SPECS = Object.freeze(buildAnnotationToolSpecs());

export const ANNOTATION_TOOL_NAMES = Object.freeze(ANNOTATION_TOOL_SPECS.map((t) => t.name));
