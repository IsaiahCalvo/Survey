import path from 'node:path';
import { IMPLEMENTED_TOOL_IDS, TOOL_MATRIX } from './constants.mjs';

const normalizeTool = (value) => String(value || '').trim().toLowerCase();

export function parseCli(argv) {
  const requested = [];
  let browser = 'chromium';
  let baseUrl = process.env.MOBILE_QA_BASE_URL || null;
  let outputDir = process.env.MOBILE_QA_OUT_DIR
    ? path.resolve(process.env.MOBILE_QA_OUT_DIR)
    : path.resolve('.playwright-mcp', 'mobile-annotations');
  let headful = process.env.HEADFUL === '1';
  let help = false;
  let listTools = false;
  let viewerReadyBudgetMs = Number(process.env.MOBILE_VIEWER_READY_BUDGET_MS || 15_000);

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const takeValue = (name) => {
      const inline = arg.startsWith(`${name}=`) ? arg.slice(name.length + 1) : null;
      if (inline !== null) return inline;
      index += 1;
      if (index >= argv.length) throw new Error(`${name} requires a value`);
      return argv[index];
    };

    if (arg === '--help' || arg === '-h') help = true;
    else if (arg === '--list-tools') listTools = true;
    else if (arg === '--headful') headful = true;
    else if (arg === '--tool' || arg.startsWith('--tool=')) {
      requested.push(...takeValue('--tool').split(',').map(normalizeTool).filter(Boolean));
    } else if (arg === '--browser' || arg.startsWith('--browser=')) browser = takeValue('--browser');
    else if (arg === '--base-url' || arg.startsWith('--base-url=')) baseUrl = takeValue('--base-url');
    else if (arg === '--output-dir' || arg.startsWith('--output-dir=')) outputDir = path.resolve(takeValue('--output-dir'));
    else if (arg === '--viewer-ready-budget-ms' || arg.startsWith('--viewer-ready-budget-ms=')) {
      viewerReadyBudgetMs = Number(takeValue('--viewer-ready-budget-ms'));
    }
    else throw new Error(`Unknown option: ${arg}`);
  }

  if (!['chromium', 'webkit'].includes(browser)) {
    throw new Error(`Unsupported browser "${browser}". Use chromium or webkit.`);
  }
  if (!Number.isFinite(viewerReadyBudgetMs) || viewerReadyBudgetMs <= 0) {
    throw new Error('--viewer-ready-budget-ms must be a positive number');
  }

  const tools = requested.length === 0 || requested.includes('all')
    ? [...IMPLEMENTED_TOOL_IDS]
    : [...new Set(requested)];
  const knownIds = new Set(TOOL_MATRIX.map((row) => row.id));
  const unknown = tools.filter((tool) => !knownIds.has(tool));
  const planned = tools.filter((tool) => knownIds.has(tool) && !IMPLEMENTED_TOOL_IDS.includes(tool));
  if (unknown.length) throw new Error(`Unknown tool filter: ${unknown.join(', ')}`);
  if (planned.length) throw new Error(`Tool lifecycle not implemented yet: ${planned.join(', ')}`);

  return { baseUrl, browser, headful, help, listTools, outputDir, tools, viewerReadyBudgetMs };
}

export function printHelp() {
  console.log(`Usage: npm run test:mobile-annotations -- [options]

Options:
  --tool <id[,id]>       Run selected lifecycle rows (default: ready rows)
  --list-tools           Print ready/planned lifecycle rows
  --browser <name>       chromium (trusted CDP touch) or webkit (pointer fallback)
  --base-url <url>       Reuse an existing Vite server
  --output-dir <path>    Screenshots, timings, and JSON result
  --viewer-ready-budget-ms <ms>
                         Maximum cold open to painted page (default: 15000)
  --headful              Show the Playwright browser
  --help                 Show this help`);
}
