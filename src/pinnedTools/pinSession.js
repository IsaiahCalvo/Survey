// Arming a pin (components/PinnedToolsDock.jsx; beta 'pinned-tools').
//
// A pin is its own copy of a tool, as in Drawboard PDF: arming the red 3 px
// pen pin draws red 3 px, and changing its colour or width in the settings
// row while it is armed changes THAT pin. The tool's own settings (what
// pressing Pen in the tool bar gives you) come back once you leave the pin for
// another tool.
//
// The viewer keeps one remembered setting per tool (PDFViewer
// readToolStyle / writeToolStyle), so a session borrows it: before the first
// pin of a tool is armed it saves the tool's own settings, writes the pin's,
// and when another tool is armed it writes the saved ones back. The line
// style is shared by every tool, so it is saved and put back too. A Cloud pin
// keeps its line settings under the Cloud key (PDFViewer paintPreferenceKey),
// which is saved separately ("cloud" vs "plain").
import { pinKind, pinStyleCovers, pinStyleFor, pinStylesEqual } from './pinnedTools.js';

const lineClass = (style) => (style?.lineStyle === 'cloud' ? 'cloud' : 'plain');

// How long a freshly armed pin waits for the viewer's settings to match it
// before treating what the viewer shows as the pin's own edit.
export const PIN_SETTLE_MS = 1000;

/** Arm `pin`. Returns the new session (or null when the viewer cannot). */
export function armPin(api, session, pin, now = Date.now()) {
  const kind = pinKind(pin?.kind);
  if (!api || !kind || typeof api.setActiveTool !== 'function') return session;
  const tool = kind.tool;
  let next = session;
  if (next && (next.owner !== api.__ownerToken || next.tool !== tool)) {
    endPinSession(next);
    next = null;
  }
  const canStyle = typeof api.readToolStyle === 'function' && typeof api.writeToolStyle === 'function';
  if (!next) {
    next = {
      tool,
      owner: api.__ownerToken,
      write: canStyle ? api.writeToolStyle : null,
      setLine: api.setToolLineBorderStyle || null,
      prevLine: api.lineBorderStyle || 'solid',
      snapshots: {},
    };
  }
  const hasStyle = Object.keys(pin.style || {}).length > 0;
  const cls = lineClass(pin.style);
  if (canStyle && hasStyle && !next.snapshots[cls]) {
    next = { ...next, snapshots: { ...next.snapshots, [cls]: api.readToolStyle(tool, cls === 'cloud' ? 'cloud' : 'solid') } };
  }
  next = { ...next, pinId: pin.id, armed: api.activeTool === tool, appliedAt: now, settled: false };
  if (canStyle && hasStyle) api.writeToolStyle(tool, pin.style);
  if (api.activeTool !== tool) api.setActiveTool(tool, { source: 'pinned-tool' });
  return next;
}

/** Put the tool's own settings back (the pin is left). */
export function endPinSession(session) {
  if (!session) return;
  try {
    for (const [cls, style] of Object.entries(session.snapshots || {})) {
      session.write?.(session.tool, { ...style, lineStyle: cls === 'cloud' ? 'cloud' : 'solid' });
    }
    if (Object.keys(session.snapshots || {}).length) session.setLine?.(session.prevLine);
  } catch {
    // The viewer that owned the session is gone; nothing to put back.
  }
}

/**
 * After the viewer republishes: is the session still alive? Returns
 * 'keep' or 'end'. A pin ends when another tool is armed, or when the viewer
 * changes (another document tab) — the old viewer gets its settings back.
 */
export function sessionStatus(session, api, now = Date.now()) {
  if (!session) return 'keep';
  if (!api || api.__ownerToken !== session.owner) return 'end';
  if (api.activeTool === session.tool) {
    session.armed = true;
    return 'keep';
  }
  if (session.armed) return 'end';
  // The tool never armed (the viewer refused it): give up after a while.
  return now - (session.appliedAt || 0) > PIN_SETTLE_MS * 2 ? 'end' : 'keep';
}

/**
 * The settings to save into the armed pin, or null. The viewer's remembered
 * settings for the tool ARE the pin's while it is armed, so a change there is
 * the user editing the pin (colour, width, line style in the settings row).
 */
export function pinEditFromViewer(session, pin, api, now = Date.now()) {
  if (!session || !pin || session.pinId !== pin.id || !api) return null;
  if (api.activeTool !== session.tool || typeof api.readToolStyle !== 'function') return null;
  if (Object.keys(pin.style || {}).length === 0) return null;
  const live = pinStyleFor(pin.kind, api.readToolStyle(session.tool));
  if (!session.settled) {
    // Wait until the viewer shows the pin's settings (it may add ones the
    // pin did not carry, such as opacity), or give up waiting after a while.
    if (pinStyleCovers(live, pin.style)) session.settled = true;
    else if (now - (session.appliedAt || 0) < PIN_SETTLE_MS) return null;
  }
  if (pinStylesEqual(live, pin.style)) {
    session.settled = true;
    return null;
  }
  session.settled = true;
  return live;
}

/** The settings a NEW pin of `kindId` starts with: the tool's own. */
export function startingStyleFor(api, session, kindId) {
  const kind = pinKind(kindId);
  if (!kind || typeof api?.readToolStyle !== 'function') return {};
  const cls = kind.lineStyle === 'cloud' ? 'cloud' : 'plain';
  // While a pin of this tool is armed the viewer holds the PIN's settings;
  // the tool's own are the ones the session saved.
  if (session && session.tool === kind.tool && session.snapshots?.[cls]) {
    return { ...session.snapshots[cls], lineStyle: kind.lineStyle || session.prevLine };
  }
  return api.readToolStyle(kind.tool, kind.lineStyle || (api.lineBorderStyle === 'cloud' ? 'solid' : api.lineBorderStyle));
}
