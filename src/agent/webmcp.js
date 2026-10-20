// WebMCP: lets an AI agent in the user's own browser (Chrome's WebMCP) use
// Survey through named tools instead of clicking around the page. The agent
// acts as the signed-in user, so tools can only do what the user already can.
// Off unless the browser offers document.modelContext (Chrome flag or origin
// trial) and the user has not turned it off with localStorage
// 'survey.webmcp' = 'off'.

const viewers = new Set();

// The viewer calls this on mount. AppShell keeps every visited tab mounted
// behind display:none, so the handle on screen is the one with isActive.
export function registerAgentViewer(handle) {
  viewers.add(handle);
  return () => viewers.delete(handle);
}

// Prefer the tab the user can see. A missing isActive flag still counts as
// on-screen so a single unmarked viewer keeps working.
export function pickActiveViewer(handles) {
  let last = null;
  for (const viewer of handles) {
    const flag = viewer?.isActive;
    const active = typeof flag === 'function' ? flag() : flag !== false;
    if (active) last = viewer;
  }
  return last;
}

function activeViewer() {
  return pickActiveViewer(viewers);
}

function text(value) {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function spacePages(viewer) {
  const pages = viewer.getVisiblePages?.();
  return Array.isArray(pages) ? pages : null;
}

function agentPageCount(viewer) {
  const pages = spacePages(viewer);
  return pages ? pages.length : viewer.getPageCount();
}

function agentCurrentPage(viewer) {
  const physical = viewer.getCurrentPage();
  const pages = spacePages(viewer);
  if (!pages) return physical;
  const index = pages.indexOf(physical);
  return index >= 0 ? index + 1 : 0;
}

function agentTargetPage(viewer, n) {
  const pages = spacePages(viewer);
  return pages ? pages[n - 1] : n;
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
        return text({ pageCount: agentPageCount(viewer), currentPage: agentCurrentPage(viewer) });
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
        const count = agentPageCount(viewer);
        const n = Number(page);
        if (count < 1) {
          throw new Error('The active Space has no pages.');
        }
        if (!Number.isInteger(n) || n < 1 || n > count) {
          throw new Error(`Page must be a whole number from 1 to ${count}.`);
        }
        const target = agentTargetPage(viewer, n);
        if (target == null) {
          throw new Error(`Page must be a whole number from 1 to ${count}.`);
        }
        if (viewer.goToPage(target) === false) {
          throw new Error('The document is still opening. Try again in a moment.');
        }
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
