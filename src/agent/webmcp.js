// WebMCP: lets an AI agent in the user's own browser (Chrome's WebMCP) use
// Survey through named tools instead of clicking around the page. The agent
// acts as the signed-in user: every tool passes checkAgentAccess (same role,
// same plan as the human) and every request carries the human's sign-in, so
// the database's own rules still apply. Off unless the browser offers
// document.modelContext (Chrome flag or origin trial) and the user has not
// turned it off with localStorage 'survey.webmcp' = 'off'.
import { checkAgentAccess, planFeatures } from './agentAccess.js';
import { buildSurveyAgentTools } from '../../supabase/functions/_shared/surveyAgentSpec.js';
import { createSurveyAgentToolbox } from './surveyAgentTools.js';
import { isFeatureOn } from '../featureFlags.js';

// General-annotation agent write tools (text notes, later shapes/callouts) ship
// behind this flag, off by default; see src/featureFlags.js and the migration.
export const ANNOTATION_AGENT_FLAG = 'annotation-agent';

// The Survey agent's item tools (KAL-527), offered to browser agents too:
// same names with a survey_ prefix, same writes as the in-app agent chat.
// Files can only be attached from the chat, so attach_media is left out.
const SURVEY_ITEM_TOOLS = {
  get_survey_context: { name: 'survey_get_context', access: { minRole: 'viewer' }, readOnly: true },
  find_items: { name: 'survey_find_items', access: { minRole: 'viewer' }, readOnly: true },
  get_item: { name: 'survey_get_item', access: { minRole: 'viewer' }, readOnly: true },
  set_answers: { name: 'survey_set_answers', access: { signIn: true, minRole: 'editor' } },
  add_note: { name: 'survey_add_note', access: { signIn: true, minRole: 'editor' } },
  set_entity: { name: 'survey_set_entity', access: { signIn: true, minRole: 'editor' } },
  show_item: { name: 'survey_show_item', access: { minRole: 'viewer' }, readOnly: true },
  find_on_plan: { name: 'survey_find_on_plan', access: { minRole: 'viewer' }, readOnly: true },
  create_item: { name: 'survey_create_item', access: { signIn: true, minRole: 'editor' } },
};

// A browser agent cannot know the open template's answers up front, so the
// answer is any string here; the tool checks it against the template.
function withoutAnswerEnum(schema) {
  return JSON.parse(JSON.stringify(schema), (key, value) => (key === 'enum' ? undefined : value));
}

function surveyItemTools(toolbox) {
  return buildSurveyAgentTools([])
    .filter((t) => SURVEY_ITEM_TOOLS[t.function.name])
    .map(({ function: fn }) => {
      const meta = SURVEY_ITEM_TOOLS[fn.name];
      return {
        name: meta.name,
        description: `${fn.description} Needs Survey mode open with a template.`,
        inputSchema: withoutAnswerEnum(fn.parameters),
        annotations: meta.readOnly ? { readOnlyHint: true, untrustedContentHint: true } : {},
        access: meta.access,
        documentScoped: true,
        execute: async (args) => {
          const { document_id: _doc, ...input } = args || {};
          const result = await toolbox.run(fn.name, input);
          if (result.isError) throw new Error(result.content);
          return result.content;
        },
      };
    });
}

const viewers = new Set();

// The viewer calls this on mount; the newest still-mounted viewer answers.
export function registerAgentViewer(handle) {
  viewers.add(handle);
  return () => viewers.delete(handle);
}

function activeViewer() {
  let last = null;
  for (const v of viewers) last = v;
  return last;
}

const documents = new Set();

// The active PDF tab registers here so agents can change its document.
export function registerAgentDocument(handle) {
  documents.add(handle);
  return () => documents.delete(handle);
}

function activeDocument() {
  let last = null;
  for (const d of documents) last = d;
  return last;
}

// The open document's handle (the last one registered), for the Survey agent.
export const activeAgentDocument = activeDocument;

function text(value) {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// What the signed-in human may do, read fresh for each call so a downgrade or
// a removed share applies to the agent at once.
export function makeAccessReader(supabase, tierLimits) {
  return async (args = {}) => {
    const { data } = await supabase.auth.getSession();
    const userId = data?.session?.user?.id || null;
    if (!userId) return { signedIn: false, features: [] };
    const { data: sub } = await supabase.from('user_subscriptions')
      .select('tier, status').eq('user_id', userId).maybeSingle();
    const tier = sub && ['active', 'trialing'].includes(sub.status) ? sub.tier : 'free';
    let role = null;
    if (args.document_id) {
      if (!UUID.test(String(args.document_id))) throw new Error('document_id must be a document id.');
      const { data: r } = await supabase.rpc('get_my_document_role', { doc_id: args.document_id });
      role = r || null;
    }
    return { signedIn: true, userId, tier, features: planFeatures(tier, tierLimits), role };
  };
}

export function buildAgentTools({ getViewer = activeViewer, getDocument = activeDocument, supabase = null, readAccess = async () => ({ signedIn: false }), surveyToolbox = createSurveyAgentToolbox(), includeAnnotationTools = false } = {}) {
  const need = () => {
    const viewer = getViewer();
    if (!viewer) throw new Error('No document is open in Survey.');
    return viewer;
  };
  const tools = [
    {
      name: 'survey_whoami',
      description: 'Who the agent is acting for in Survey: signed in or not, and the plan. Agents get the same plan and document roles as this user.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
      access: {},
      execute: async (_args, ctx) => text({ signedIn: !!ctx.signedIn, plan: ctx.tier || null, features: ctx.features || [] }),
    },
    {
      name: 'survey_list_projects',
      description: 'List the Survey projects this user can see (own and shared).',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      access: { signIn: true },
      execute: async () => {
        const { data, error } = await supabase.from('projects')
          .select('id, name, updated_at').eq('archived', false).is('user_archived_at', null)
          .order('updated_at', { ascending: false }).limit(200);
        if (error) throw new Error('Could not list projects.');
        return text(data || []);
      },
    },
    {
      name: 'survey_list_documents',
      description: 'List the PDFs this user can see, newest first. Optionally only one project.',
      inputSchema: {
        type: 'object',
        properties: { project_id: { type: 'string', description: 'Only documents in this project.' } },
      },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      access: { signIn: true },
      execute: async ({ project_id } = {}) => {
        let q = supabase.from('documents')
          .select('id, name, project_id, page_count, updated_at')
          .eq('archived', false).is('user_archived_at', null);
        if (project_id) {
          if (!UUID.test(String(project_id))) throw new Error('project_id must be a project id.');
          q = q.eq('project_id', project_id);
        }
        const { data, error } = await q.order('updated_at', { ascending: false }).limit(200);
        if (error) throw new Error('Could not list documents.');
        return text(data || []);
      },
    },
    {
      name: 'survey_get_document_role',
      description: "This user's role on a document: owner, editor or viewer. The agent has the same role.",
      inputSchema: {
        type: 'object',
        properties: { document_id: { type: 'string' } },
        required: ['document_id'],
      },
      annotations: { readOnlyHint: true },
      access: { minRole: 'viewer' },
      execute: async (_args, ctx) => text({ role: ctx.role }),
    },
    {
      name: 'survey_get_open_document',
      description: 'Get the PDF open in Survey: page count and the page on screen.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
      access: {},
      execute: async () => {
        const viewer = need();
        return text({ pageCount: viewer.getPageCount(), currentPage: viewer.getCurrentPage() });
      },
    },
    {
      name: 'survey_go_to_page',
      description: 'Scroll the open PDF in Survey to a page (1 is the first page).',
      inputSchema: {
        type: 'object',
        properties: { page: { type: 'integer', minimum: 1, description: 'Page number, from 1.' } },
        required: ['page'],
      },
      access: {},
      execute: async ({ page } = {}) => {
        const viewer = need();
        const count = viewer.getPageCount();
        const n = Number(page);
        if (!Number.isInteger(n) || n < 1 || n > count) {
          throw new Error(`Page must be a whole number from 1 to ${count}.`);
        }
        viewer.goToPage(n);
        return `Went to page ${n} of ${count}.`;
      },
    },
    {
      name: 'survey_add_marker',
      description: 'Add a Survey marker box to the open PDF, in the selected survey module. Needs survey mode on with a template chosen, and editor or owner access. Coordinates are PDF points from the top-left of the page.',
      inputSchema: {
        type: 'object',
        properties: {
          page: { type: 'integer', minimum: 1 },
          x: { type: 'number', minimum: 0 },
          y: { type: 'number', minimum: 0 },
          width: { type: 'number', exclusiveMinimum: 2 },
          height: { type: 'number', exclusiveMinimum: 2 },
        },
        required: ['page', 'x', 'y', 'width', 'height'],
      },
      access: { signIn: true, minRole: 'editor' },
      documentScoped: true,
      execute: async ({ page, x, y, width, height }, _ctx) => {
        const doc = getDocument();
        if (!doc.surveyReady()) throw new Error('Turn on Survey mode and pick a template first.');
        const size = doc.getPageSize(Number(page));
        if (!size) throw new Error('That page is not in the open document.');
        const box = [x, y, width, height].map(Number);
        if (box.some((n) => !Number.isFinite(n)) || box[2] <= 2 || box[3] <= 2
          || box[0] < 0 || box[1] < 0 || box[0] + box[2] > size.width || box[1] + box[3] > size.height) {
          throw new Error(`The box must fit inside the page (${size.width} x ${size.height} points).`);
        }
        doc.addSurveyMarker(Number(page), { x: box[0], y: box[1], width: box[2], height: box[3] });
        return `Added a Survey marker on page ${page}.`;
      },
    },
    {
      name: 'survey_list_markers',
      description: 'List the Survey markers on the open PDF: id, page, name and box. Use an id with survey_edit_marker or survey_delete_marker, or with the survey_* item tools.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true, untrustedContentHint: true },
      access: { minRole: 'viewer' },
      documentScoped: true,
      execute: async () => {
        const doc = getDocument();
        return text(typeof doc.listSurveyMarkers === 'function' ? doc.listSurveyMarkers() : []);
      },
    },
    {
      name: 'survey_edit_marker',
      description: 'Move or resize a Survey marker box on the open PDF. Give the marker id (from survey_list_markers or survey_find_items) and the new box. Needs editor or owner access, and only a marker the person could move by hand changes. Coordinates are PDF points from the top-left of the page.',
      inputSchema: {
        type: 'object',
        properties: {
          marker_id: { type: 'string' },
          x: { type: 'number', minimum: 0 },
          y: { type: 'number', minimum: 0 },
          width: { type: 'number', exclusiveMinimum: 2 },
          height: { type: 'number', exclusiveMinimum: 2 },
        },
        required: ['marker_id', 'x', 'y', 'width', 'height'],
      },
      access: { signIn: true, minRole: 'editor' },
      documentScoped: true,
      execute: async ({ marker_id: markerId, x, y, width, height }) => {
        const doc = getDocument();
        if (!doc.surveyReady()) throw new Error('Turn on Survey mode and pick a template first.');
        const marker = doc.getSurveyMarker?.(markerId);
        if (!marker || !marker.page) throw new Error(`No marker with id ${markerId} on the plan. Use survey_list_markers.`);
        const size = doc.getPageSize(Number(marker.page));
        if (!size) throw new Error('That marker’s page is not in the open document.');
        const b = [x, y, width, height].map(Number);
        if (b.some((n) => !Number.isFinite(n)) || b[2] <= 2 || b[3] <= 2
          || b[0] < 0 || b[1] < 0 || b[0] + b[2] > size.width || b[1] + b[3] > size.height) {
          throw new Error(`The box must fit inside the page (${size.width} x ${size.height} points).`);
        }
        const res = doc.editSurveyMarker(markerId, { x: b[0], y: b[1], width: b[2], height: b[3] });
        if (res?.reason === 'locked') throw new Error('That marker is locked, so it cannot be moved.');
        if (res?.reason === 'not-allowed') throw new Error('This person cannot change that marker (it belongs to someone else), so nothing was moved.');
        if (!res?.ok) throw new Error('Could not edit that marker.');
        return `Moved the marker on page ${marker.page}.`;
      },
    },
    {
      name: 'survey_delete_marker',
      description: 'Delete a Survey marker from the open PDF. It also clears that item’s answers; the marker is kept in trash for 30 days and there is one Undo. Because this is hard to take back, it does NOTHING unless confirm is true, which the agent should set only after the person has agreed. Needs editor or owner access.',
      inputSchema: {
        type: 'object',
        properties: {
          marker_id: { type: 'string' },
          confirm: { type: 'boolean', description: 'Leave false (or unset) to check first; set true only after the person has agreed to delete.' },
        },
        required: ['marker_id'],
      },
      access: { signIn: true, minRole: 'editor' },
      documentScoped: true,
      execute: async ({ marker_id: markerId, confirm }) => {
        const doc = getDocument();
        const marker = doc.getSurveyMarker?.(markerId);
        if (!marker) throw new Error(`No marker with id ${markerId}. Use survey_list_markers.`);
        const label = marker.name || 'this marker';
        if (confirm !== true) {
          return `Not deleted. Ask the person to confirm, then call again with confirm: true to remove "${label}"${marker.page ? ` on page ${marker.page}` : ''}.`;
        }
        const res = doc.deleteSurveyMarker(markerId);
        if (res?.reason === 'not-allowed') throw new Error('This person cannot delete that marker (it belongs to someone else), so nothing was deleted.');
        if (!res?.ok) throw new Error('Could not delete that marker.');
        return `Deleted ${label}. It is in the trash for 30 days, and the last change can be undone.`;
      },
    },
    ...(includeAnnotationTools ? [
      {
        name: 'survey_list_annotations',
        description: 'List the normal annotations on the open PDF (text notes, shapes, highlights — not Survey markers): id, page, type, text and box. Use an id with survey_edit_text_note or survey_delete_annotation.',
        inputSchema: { type: 'object', properties: {} },
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        access: { minRole: 'viewer' },
        documentScoped: true,
        execute: async () => {
          const doc = getDocument();
          return text(typeof doc.listAnnotations === 'function' ? doc.listAnnotations() : []);
        },
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
        execute: async ({ page, x, y, text: noteText, width, color }) => {
          const doc = getDocument();
          if (!String(noteText || '').trim()) throw new Error('The note text is empty.');
          const size = doc.getPageSize(Number(page));
          if (!size) throw new Error('That page is not in the open document.');
          if (Number(x) < 0 || Number(y) < 0 || Number(x) >= size.width || Number(y) >= size.height) {
            throw new Error(`The note must start inside the page (${size.width} x ${size.height} points).`);
          }
          const res = doc.addTextNote({ page: Number(page), x: Number(x), y: Number(y), width: width == null ? undefined : Number(width), text: String(noteText), color });
          if (res?.reason === 'off-page') throw new Error(`The note must start inside the page (${size.width} x ${size.height} points).`);
          if (res?.reason === 'locked') throw new Error('A locked annotation on that page blocked the save, so the note was not added.');
          if (!res?.ok) throw new Error('Could not add the note.');
          return `Added a text note on page ${page}.`;
        },
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
        execute: async ({ annotation_id: annotationId, text: noteText }) => {
          const doc = getDocument();
          if (!String(noteText || '').trim()) throw new Error('The note text is empty.');
          const res = doc.editTextNote(annotationId, { text: String(noteText) });
          if (res?.reason === 'not-found') throw new Error(`No annotation with id ${annotationId}. Use survey_list_annotations.`);
          if (res?.reason === 'not-a-text-note') throw new Error('That annotation is not a text note, so its text cannot be changed.');
          if (res?.reason === 'not-allowed') throw new Error('This person cannot change that note (it belongs to someone else or is locked), so nothing changed.');
          if (res?.reason === 'locked') throw new Error('A locked annotation blocked the change, so nothing changed.');
          if (!res?.ok) throw new Error('Could not edit that note.');
          return 'Changed the note text.';
        },
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
        execute: async ({ annotation_id: annotationId, confirm }) => {
          const doc = getDocument();
          const found = typeof doc.findAnnotation === 'function' ? doc.findAnnotation(annotationId) : null;
          if (!found) throw new Error(`No annotation with id ${annotationId}. Use survey_list_annotations.`);
          if (confirm !== true) {
            return `Not deleted. Ask the person to confirm, then call again with confirm: true to remove annotation ${annotationId}.`;
          }
          const res = doc.deleteAnnotation(annotationId);
          if (res?.reason === 'not-found') throw new Error(`No annotation with id ${annotationId}.`);
          if (res?.reason === 'not-allowed') throw new Error('This person cannot delete that annotation (it belongs to someone else or is locked), so nothing was deleted.');
          if (res?.reason === 'locked') throw new Error('A locked annotation blocked the delete, so nothing was removed.');
          if (!res?.ok) throw new Error('Could not delete that annotation.');
          return `Deleted annotation ${annotationId}. One Undo restores it.`;
        },
      },
      ...[
        { shape: 'rectangle', builderShape: 'rect', word: 'rectangle' },
        { shape: 'ellipse', builderShape: 'ellipse', word: 'ellipse' },
      ].map(({ shape, builderShape, word }) => ({
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
        execute: async ({ page, x, y, width, height, stroke_color: strokeColor, fill_color: fillColor, stroke_width: strokeWidth }) => {
          const doc = getDocument();
          const size = doc.getPageSize(Number(page));
          if (!size) throw new Error('That page is not in the open document.');
          if (!(Number(width) > 0) || !(Number(height) > 0)
            || Number(x) < 0 || Number(y) < 0
            || Number(x) + Number(width) > size.width || Number(y) + Number(height) > size.height) {
            throw new Error(`The ${word} must fit inside the page (${size.width} x ${size.height} points).`);
          }
          const res = doc.addShape({ page: Number(page), shape: builderShape, x: Number(x), y: Number(y), width: Number(width), height: Number(height), strokeColor, fillColor, strokeWidth: strokeWidth == null ? undefined : Number(strokeWidth) });
          if (res?.reason === 'off-page' || res?.reason === 'too-small') throw new Error(`The ${word} must fit inside the page (${size.width} x ${size.height} points).`);
          if (res?.reason === 'locked') throw new Error(`A locked annotation on that page blocked the save, so the ${word} was not added.`);
          if (!res?.ok) throw new Error(`Could not add the ${word}.`);
          return `Added a ${word} on page ${page}.`;
        },
      })),
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
        execute: async ({ page, x1, y1, x2, y2, arrow, stroke_color: strokeColor, stroke_width: strokeWidth }) => {
          const doc = getDocument();
          const size = doc.getPageSize(Number(page));
          if (!size) throw new Error('That page is not in the open document.');
          const inPage = (px, py) => Number(px) >= 0 && Number(py) >= 0 && Number(px) <= size.width && Number(py) <= size.height;
          if (!inPage(x1, y1) || !inPage(x2, y2)) throw new Error(`Both ends must be inside the page (${size.width} x ${size.height} points).`);
          const res = doc.addLine({ page: Number(page), x1: Number(x1), y1: Number(y1), x2: Number(x2), y2: Number(y2), arrow: arrow === true, strokeColor, strokeWidth: strokeWidth == null ? undefined : Number(strokeWidth) });
          if (res?.reason === 'too-small') throw new Error('The line is too short to draw (make the two points at least a few points apart).');
          if (res?.reason === 'off-page') throw new Error(`Both ends must be inside the page (${size.width} x ${size.height} points).`);
          if (res?.reason === 'locked') throw new Error('A locked annotation on that page blocked the save, so the line was not added.');
          if (!res?.ok) throw new Error('Could not add the line.');
          return `Added a ${arrow === true ? 'arrow' : 'line'} on page ${page}.`;
        },
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
        execute: async ({ page, points, closed, stroke_color: strokeColor, fill_color: fillColor, stroke_width: strokeWidth }) => {
          const doc = getDocument();
          const size = doc.getPageSize(Number(page));
          if (!size) throw new Error('That page is not in the open document.');
          if (!Array.isArray(points) || points.some((p) => !p || !(Number(p.x) >= 0) || !(Number(p.y) >= 0) || Number(p.x) > size.width || Number(p.y) > size.height)) {
            throw new Error(`Every point must be inside the page (${size.width} x ${size.height} points).`);
          }
          const minimum = closed === false ? 2 : 3;
          if (points.length < minimum) throw new Error(`A ${closed === false ? 'polyline needs at least 2' : 'polygon needs at least 3'} points.`);
          const res = doc.addPolygon({ page: Number(page), points, closed: closed !== false, strokeColor, fillColor, strokeWidth: strokeWidth == null ? undefined : Number(strokeWidth) });
          if (res?.reason === 'too-few-points') throw new Error(`A ${closed === false ? 'polyline needs at least 2' : 'polygon needs at least 3'} points.`);
          if (res?.reason === 'off-page') throw new Error(`Every point must be inside the page (${size.width} x ${size.height} points).`);
          if (res?.reason === 'locked') throw new Error('A locked annotation on that page blocked the save, so the shape was not added.');
          if (!res?.ok) throw new Error('Could not add the shape.');
          return `Added a ${closed === false ? 'polyline' : 'polygon'} on page ${page}.`;
        },
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
        execute: async ({ page, text: calloutText, arrow_x: arrowX, arrow_y: arrowY, box_x: boxX, box_y: boxY, box_width: boxWidth, stroke_color: strokeColor, fill_color: fillColor }) => {
          const doc = getDocument();
          if (!String(calloutText || '').trim()) throw new Error('The callout text is empty.');
          const size = doc.getPageSize(Number(page));
          if (!size) throw new Error('That page is not in the open document.');
          const inPage = (px, py) => Number(px) >= 0 && Number(py) >= 0 && Number(px) <= size.width && Number(py) <= size.height;
          if (!inPage(arrowX, arrowY) || !inPage(boxX, boxY)) throw new Error(`The arrow point and the box corner must be inside the page (${size.width} x ${size.height} points).`);
          const res = doc.addCallout({ page: Number(page), text: String(calloutText), arrowX: Number(arrowX), arrowY: Number(arrowY), boxX: Number(boxX), boxY: Number(boxY), boxWidth: boxWidth == null ? undefined : Number(boxWidth), strokeColor, fillColor });
          if (res?.reason === 'empty') throw new Error('The callout text is empty.');
          if (res?.reason === 'off-page') throw new Error(`The arrow point and the box corner must be inside the page (${size.width} x ${size.height} points).`);
          if (!res?.ok) throw new Error('Could not add the callout.');
          return `Added a callout on page ${page}.`;
        },
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
        execute: async ({ page, search_text: searchText, color, opacity, occurrence }) => {
          const doc = getDocument();
          if (!String(searchText || '').trim()) throw new Error('The text to highlight is empty.');
          const size = doc.getPageSize(Number(page));
          if (!size) throw new Error('That page is not in the open document.');
          const res = await doc.addHighlight({ page: Number(page), searchText: String(searchText), color, opacity: opacity == null ? undefined : Number(opacity), occurrence: occurrence == null ? undefined : Number(occurrence) });
          if (res?.reason === 'empty') throw new Error('The text to highlight is empty.');
          if (res?.reason === 'no-text') throw new Error('That page has no readable text to highlight. A scanned page needs text recognition run on it first.');
          if (res?.reason === 'no-match') throw new Error('Could not find that text on the page. Check the words and the page number.');
          if (res?.reason === 'locked') throw new Error('A locked annotation on that page blocked the save, so the highlight was not added.');
          if (!res?.ok) throw new Error('Could not add the highlight.');
          return `Highlighted "${searchText}" on page ${page}.`;
        },
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
        execute: async ({ annotation_id: annotationId, text: calloutText, stroke_color: strokeColor, fill_color: fillColor }) => {
          const doc = getDocument();
          if (calloutText == null && !strokeColor && !fillColor) throw new Error('Give the new text, a stroke_color or a fill_color.');
          const res = doc.editCallout(annotationId, { text: calloutText, strokeColor, fillColor });
          if (res?.reason === 'not-found') throw new Error(`No callout with id ${annotationId}. Use survey_list_annotations.`);
          if (res?.reason === 'empty') throw new Error('Nothing to change: give the new text, a stroke_color or a fill_color.');
          if (res?.reason === 'not-allowed') throw new Error('This person cannot change that callout (it belongs to someone else or is locked), so nothing changed.');
          if (res?.reason === 'locked') throw new Error('That callout is locked, so nothing changed.');
          if (!res?.ok) throw new Error('Could not edit that callout.');
          return 'Changed the callout.';
        },
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
        execute: async ({ annotation_id: annotationId, color, opacity }) => {
          const doc = getDocument();
          if (color == null && opacity == null) throw new Error('Give a color or an opacity to change.');
          const res = doc.recolorHighlight(annotationId, { color, opacity: opacity == null ? undefined : Number(opacity) });
          if (res?.reason === 'not-found') throw new Error(`No annotation with id ${annotationId}. Use survey_list_annotations.`);
          if (res?.reason === 'not-a-highlight') throw new Error('That annotation is not a highlight, so it cannot be recolored.');
          if (res?.reason === 'empty' || res?.reason === 'no-change') throw new Error('Give a color or an opacity to change.');
          if (res?.reason === 'not-allowed') throw new Error('This person cannot change that highlight (it belongs to someone else or is locked), so nothing changed.');
          if (res?.reason === 'locked') throw new Error('A locked annotation blocked the change, so nothing changed.');
          if (!res?.ok) throw new Error('Could not recolor that highlight.');
          return 'Changed the highlight.';
        },
      },
    ] : []),
    ...surveyItemTools(surveyToolbox),
  ];
  return tools.map((tool) => ({
    ...tool,
    execute: async (args = {}, options) => {
      if (tool.documentScoped) {
        const doc = getDocument();
        if (!doc) throw new Error('No document is open in Survey.');
        // A file never saved to the cloud belongs to this person alone.
        args = { ...args, document_id: doc.documentId || undefined };
      }
      const ctx = await readAccess(args);
      if (tool.documentScoped && !args.document_id && ctx.signedIn) ctx.role = 'owner';
      const denied = checkAgentAccess(tool.access, ctx);
      if (denied) throw new Error(denied);
      return tool.execute(args, ctx, options);
    },
  }));
}

export function installWebMcp(win = typeof window !== 'undefined' ? window : undefined, deps = {}) {
  const modelContext = win?.document?.modelContext;
  if (!modelContext || typeof modelContext.registerTool !== 'function') return null;
  try {
    if (win.localStorage?.getItem('survey.webmcp') === 'off') return null;
  } catch { /* storage blocked: stay on */ }
  const readAccess = deps.supabase ? makeAccessReader(deps.supabase, deps.tierLimits) : undefined;
  const controller = new AbortController();
  const includeAnnotationTools = isFeatureOn(ANNOTATION_AGENT_FLAG);
  for (const { access: _access, documentScoped: _scoped, ...tool } of buildAgentTools({ supabase: deps.supabase, readAccess, includeAnnotationTools })) {
    Promise.resolve(modelContext.registerTool(tool, { signal: controller.signal }))
      .catch((err) => console.warn('[webmcp] could not add tool', tool.name, err));
  }
  return controller;
}
