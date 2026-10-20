// The agent code a person was about to approve, kept for 10 minutes (the
// code's own life) while they sign up or sign in elsewhere.
const KEY = 'survey.pendingAgentCode';
const TTL_MS = 10 * 60 * 1000;

export function savePendingAgentCode(storage, code, now = Date.now()) {
  storage?.setItem(KEY, JSON.stringify({ code, at: now }));
}

export function readPendingAgentCode(storage, now = Date.now()) {
  try {
    const saved = JSON.parse(storage?.getItem(KEY) || 'null');
    if (saved && /^[A-Z0-9]{8}$/.test(saved.code) && now - saved.at < TTL_MS) return saved.code;
  } catch { /* bad value: ignore */ }
  return '';
}

export function clearPendingAgentCode(storage) {
  storage?.removeItem(KEY);
}

// Back from a sign-up email or Google at the front page with a fresh pending
// code: continue at /agent-link, carrying the sign-in data along.
export function agentLinkResumeUrl(location, storage, now = Date.now()) {
  if (!location || location.pathname !== '/') return null;
  const carriesAuth = /(?:^|[?&#])(code|access_token|token_hash|error_code)=/.test(`${location.search}${location.hash}`);
  if (!carriesAuth || !readPendingAgentCode(storage, now)) return null;
  return `/agent-link${location.search}${location.hash}`;
}
