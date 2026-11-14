/* Survey as a Microsoft Teams tab (Drawboard Projects parity IN-28).
   The Teams app (teams-app/manifest.json) opens <site>/teams inside Teams.
   There, and only there, Survey loads Microsoft's Teams library and tells
   Teams the page is ready; Teams shows nothing until it hears that. Web,
   desktop and phone builds never load the library.

   Sign-in inside Teams: Google and Microsoft sign-in leave the page for
   their own sites, which refuse to open inside Teams, so those buttons hide
   there (accountPlatform.isGoogleSignInHidden) and email sign-in stays.

   Adding Survey to a channel or chat opens <site>/teams/config first: the
   person picks a project, list or drawing (TeamsPinPanel) and Teams saves a
   tab that opens it (teamsPin.js). */

import { TEAMS_CONFIG_PATH } from './teamsPin.js';

export const TEAMS_PATH = '/teams';

function framedPath(win) {
  try {
    if (!win?.location || win.self === win.top) return null;
    return String(win.location.pathname || '').replace(/\/+$/, '');
  } catch {
    return null;
  }
}

const readTeamsTab = (win) => {
  const path = framedPath(win);
  return path === TEAMS_PATH || path === TEAMS_CONFIG_PATH;
};
const readTeamsConfig = (win) => framedPath(win) === TEAMS_CONFIG_PATH;

// Read once at load: the app later rewrites the address bar.
const AT_LOAD = typeof window !== 'undefined' ? readTeamsTab(window) : false;
const CONFIG_AT_LOAD = typeof window !== 'undefined' ? readTeamsConfig(window) : false;

/** True when this page was opened as Survey's tab (or its setup page) inside Teams. */
export function isTeamsTab(win) {
  return win ? readTeamsTab(win) : AT_LOAD;
}

/** True when Teams opened the page to set up a new channel or chat tab. */
export function isTeamsConfig(win) {
  return win ? readTeamsConfig(win) : CONFIG_AT_LOAD;
}

// The Teams library once it has said hello, for the setup page.
let teamsReady = null;

/**
 * Tell Teams the tab is ready. Resolves to the Teams context ({ theme,
 * locale, hostName }) or null when this is not a Teams tab or Teams does not
 * answer. `load` is for tests.
 */
export function startTeamsTab(opts = {}) {
  const run = runTeamsTab(opts);
  teamsReady = run;
  return run.then((out) => out && out.context);
}

async function runTeamsTab({ win = typeof window !== 'undefined' ? window : null, load = () => import('@microsoft/teams-js'), timeoutMs = 8000 } = {}) {
  if (!win || !isTeamsTab(win)) return null;
  try {
    const lib = await load();
    const { app } = lib;
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
    return { lib, context: out };
  } catch (err) {
    console.warn('[teams] tab not started', err?.message || err);
    return null;
  }
}

/**
 * The setup page's link to Teams: `setChoice(config | null)` tells Teams
 * whether Save can be pressed and what to save (a pinnedTabConfig result).
 * Resolves to null when Teams never said hello.
 */
export async function connectTeamsConfig() {
  const ready = teamsReady ? await teamsReady : null;
  const pages = ready?.lib?.pages;
  if (!pages?.config) return null;
  let current = null;
  pages.config.registerOnSaveHandler((saveEvent) => {
    if (!current) { saveEvent.notifyFailure('Pick a project first'); return; }
    Promise.resolve(pages.config.setConfig(current))
      .then(() => saveEvent.notifySuccess())
      .catch((err) => saveEvent.notifyFailure(String(err?.message || err)));
  });
  pages.config.setValidityState(false);
  return {
    setChoice(config) {
      current = config || null;
      pages.config.setValidityState(Boolean(current));
    },
  };
}
