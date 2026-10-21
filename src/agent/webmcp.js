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
import { ANNOTATION_AGENT_FLAG } from '../../supabase/functions/_shared/annotationAgentSpec.js';
import { buildAnnotationTools } from './annotationTools.js';
import { isFeatureOn } from '../featureFlags.js';

// General-annotation agent write tools (text notes, shapes, highlights,
// callouts) ship behind this flag, off by default; see src/featureFlags.js and
// the migration. The flag name, the tool schemas and the executors all live in
// the shared annotation spec + annotationTools.js so the voice edge function
// describes the same tools; this file only splices them in and gates on the flag.
export { ANNOTATION_AGENT_FLAG };

// The Survey agent's item tools (KAL-527), offered to browser agents too:
// same names with a survey_ prefix, same writes as the in-app agent chat.
// attach_media is left out (its files come from the chat); a browser agent
// attaches a photo through survey_add_photo instead, which takes base64.
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
  add_photo: { name: 'survey_add_photo', access: { signIn: true, minRole: 'editor' } },
  export_summary: { name: 'survey_export', access: { minRole: 'viewer' }, readOnly: true },
};

// A browser agent cannot know the open template's answers up front, so the
// answer is any string here; the tool checks it against the template.
function withoutAnswerEnum(schema) {
  return JSON.parse(JSON.stringify(schema), (key, value) => (key === 'enum' ? undefined : value));
}

function surveyItemTools(toolbox) {
  return buildSurveyAgentTools([], { webmcp: true })
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
    ...(includeAnnotationTools ? buildAnnotationTools({ getDocument, text }) : []),
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
