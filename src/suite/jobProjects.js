// KAL-779: the Projects this device sent a Plot job into. A Project's header
// offers "Send back to Plot" only for these; every Project's menu still has
// it (a job sent in on another device, or before this list existed).
const KEY = 'survey.suite.jobProjects';
const MAX = 200;

function read(storage) {
  try {
    const list = JSON.parse(storage?.getItem(KEY) || '[]');
    return Array.isArray(list) ? list.filter((id) => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

/** @param {string} projectId */
export function rememberJobProject(projectId, storage = globalThis.localStorage) {
  if (!projectId) return;
  const list = read(storage).filter((id) => id !== projectId);
  list.unshift(String(projectId));
  try { storage?.setItem(KEY, JSON.stringify(list.slice(0, MAX))); } catch { /* private mode */ }
}

/** @param {string} projectId */
export function isJobProject(projectId, storage = globalThis.localStorage) {
  return Boolean(projectId) && read(storage).includes(String(projectId));
}
