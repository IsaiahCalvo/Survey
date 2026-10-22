// The viewer's tool-switch diagnostic (PDFViewer: one capture a second after
// switching to Select or Eraser, read back by the Save Log handler) walks
// every mark on the page with a document-wide querySelectorAll, a
// getBoundingClientRect and a getComputedStyle each, and serializes every
// mounted SVG layer's markup into window.__diagBuffer. On a sheet with ~670
// marks that is a 300-400 ms freeze, landing just as the user starts to drag
// the mark they picked. It is a debugging harness, so it only runs when the
// debug switch is on: window.__APP_DEBUG (the appDebug logging switch) or
// window.__DIAG_TOOL_SWITCH.
export const TOOL_SWITCH_DIAG_TOOLS = Object.freeze(['eraser', 'select']);

export function shouldCaptureToolSwitchDiag(activeTool, win = typeof window !== 'undefined' ? window : null) {
  if (!TOOL_SWITCH_DIAG_TOOLS.includes(activeTool)) return false;
  if (!win) return false;
  return win.__APP_DEBUG === true || win.__DIAG_TOOL_SWITCH === true;
}
