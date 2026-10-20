// WebMCP: lets an AI agent in the user's own browser (Chrome's WebMCP) use
// Survey through named tools instead of clicking around the page. The agent
// acts as the signed-in user: every tool passes checkAgentAccess (same role,
// same plan as the human) and every request carries the human's sign-in, so
// the database's own rules still apply. Off unless the browser offers
// document.modelContext (Chrome flag or origin trial) and the user has not
// turned it off with localStorage 'survey.webmcp' = 'off'.
import { checkAgentAccess, planFeatures } from './agentAccess.js';

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

export function buildAgentTools({ getViewer = activeViewer, supabase = null, readAccess = async () => ({ signedIn: false }) } = {}) {
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
  ];
  return tools.map((tool) => ({
    ...tool,
    execute: async (args = {}, options) => {
      const ctx = await readAccess(args);
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
  for (const { access: _access, ...tool } of buildAgentTools({ supabase: deps.supabase, readAccess })) {
    Promise.resolve(modelContext.registerTool(tool, { signal: controller.signal }))
      .catch((err) => console.warn('[webmcp] could not add tool', tool.name, err));
  }
  return controller;
}
