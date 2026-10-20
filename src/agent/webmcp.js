// WebMCP: lets an AI agent in the user's own browser (Chrome's WebMCP) use
// Survey through named tools instead of clicking around the page. The agent
// acts as the signed-in user, so tools can only do what the user already can.
// Off unless the browser offers document.modelContext (Chrome flag or origin
// trial) and the user has not turned it off with localStorage
// 'survey.webmcp' = 'off'.

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

export function buildAgentTools(getViewer = activeViewer) {
  const need = () => {
    const viewer = getViewer();
    if (!viewer) throw new Error('No document is open in Survey.');
    return viewer;
  };
  return [
    {
      name: 'survey_get_open_document',
      description: 'Get the PDF open in Survey: page count and the page on screen.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
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
}

export function installWebMcp(win = typeof window !== 'undefined' ? window : undefined) {
  const modelContext = win?.document?.modelContext;
  if (!modelContext || typeof modelContext.registerTool !== 'function') return null;
  try {
    if (win.localStorage?.getItem('survey.webmcp') === 'off') return null;
  } catch { /* storage blocked: stay on */ }
  const controller = new AbortController();
  for (const tool of buildAgentTools()) {
    Promise.resolve(modelContext.registerTool(tool, { signal: controller.signal }))
      .catch((err) => console.warn('[webmcp] could not add tool', tool.name, err));
  }
  return controller;
}
