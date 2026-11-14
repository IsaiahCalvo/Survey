/* Survey as a Microsoft Teams tab (Drawboard Projects parity IN-28).
   The Teams app (teams-app/manifest.json) opens <site>/teams inside Teams.
   There, and only there, Survey loads Microsoft's Teams library and tells
   Teams the page is ready; Teams shows nothing until it hears that. Web,
   desktop and phone builds never load the library.

   Sign-in inside Teams: Google and Microsoft sign-in leave the page for
   their own sites, which refuse to open inside Teams, so those buttons hide
   there (accountPlatform.isGoogleSignInHidden) and email sign-in stays. */

export const TEAMS_PATH = '/teams';

function readTeamsTab(win) {
  try {
    if (!win?.location) return false;
    const path = String(win.location.pathname || '').replace(/\/+$/, '');
    return path === TEAMS_PATH && win.self !== win.top;
  } catch {
    return false;
  }
}

// Read once at load: the app later rewrites the address bar.
const AT_LOAD = typeof window !== 'undefined' ? readTeamsTab(window) : false;

/** True when this page was opened as Survey's tab inside Teams. */
export function isTeamsTab(win) {
  return win ? readTeamsTab(win) : AT_LOAD;
}

/**
 * Tell Teams the tab is ready. Resolves to the Teams context ({ theme,
 * locale, hostName }) or null when this is not a Teams tab or Teams does not
 * answer. `load` is for tests.
 */
export async function startTeamsTab({ win = typeof window !== 'undefined' ? window : null, load = () => import('@microsoft/teams-js'), timeoutMs = 8000 } = {}) {
  if (!win || !isTeamsTab(win)) return null;
  try {
    const { app } = await load();
    let timer;
    await Promise.race([
      app.initialize(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Teams did not answer')), timeoutMs); }),
    ]).finally(() => clearTimeout(timer));
    try { app.notifySuccess(); } catch { /* Teams already shows the page */ }
    const ctx = await app.getContext().catch(() => null);
    const out = {
      theme: ctx?.app?.theme || null,
      locale: ctx?.app?.locale || null,
      hostName: ctx?.app?.host?.name || null,
    };
    try { win.document.documentElement.dataset.teamsTab = out.theme || 'default'; } catch { /* no DOM */ }
    return out;
  } catch (err) {
    console.warn('[teams] tab not started', err?.message || err);
    return null;
  }
}
