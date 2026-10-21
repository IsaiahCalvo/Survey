// Which free tool brought someone to Survey. The /tools pages are used signed
// out, and Survey's analytics only takes events from signed-in people, so the
// steps wait in this browser and go out once the person is signed in. Only the
// tool id and times are kept: never a file name or anything from the file.
const KEY = 'survey-free-tool-funnel';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;
// Clock slack between this device and the server's account timestamp.
const SLACK_MS = 5 * 60 * 1000;

function localStore() {
  try { return globalThis.localStorage || null; } catch { return null; }
}

function read(storage, now) {
  try {
    const entry = JSON.parse(storage?.getItem(KEY) || 'null');
    if (!entry?.tool || typeof entry.at !== 'number' || now - entry.at > MAX_AGE_MS) return null;
    return entry;
  } catch {
    return null;
  }
}

// step: 'result' (the tool made a file) or 'opened' (Open in Survey).
export function noteFreeToolStep(step, tool, storage = localStore(), now = Date.now()) {
  if (!storage || !tool) return;
  const prev = read(storage, now);
  const entry = prev?.tool === tool ? prev : { tool, at: now };
  entry[step] = now;
  try { storage.setItem(KEY, JSON.stringify(entry)); } catch { /* storage full or blocked */ }
}

// The event to send for a signed-in person, or null. Taking it clears it, so
// each visit to a tool is counted once.
export function takeFreeToolFunnel(user, storage = localStore(), now = Date.now()) {
  if (!storage || !user?.id) return null;
  const entry = read(storage, now);
  try { storage.removeItem(KEY); } catch { /* blocked */ }
  if (!entry) return null;
  const created = Date.parse(user.created_at || '');
  const newAccount = Number.isFinite(created) && created >= entry.at - SLACK_MS;
  return {
    event: newAccount ? 'free_tool_signup' : 'free_tool_used_signed_in',
    properties: {
      tool: entry.tool,
      madeFile: Boolean(entry.result),
      openedInSurvey: Boolean(entry.opened),
      ...(newAccount ? { minutesToSignup: Math.max(0, Math.round((created - entry.at) / 60000)) } : {}),
    },
  };
}
