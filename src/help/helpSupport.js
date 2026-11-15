// "Help & support" (Nightly flag 'help-menu', Drawboard Projects parity spec
// AE-12 / 17 / 19 / 20): the account menu's way to a short start guide, a
// fix for a stuck page, the site's questions page (which has our email), the
// status page and What's new. Our own words. Pure.

// The marketing site (scripts/build-marketing.mjs ORIGIN and its pages).
export const SITE_ORIGIN = 'https://surveytool.app';

export const HELP_LINKS = Object.freeze([
  Object.freeze({ id: 'faq', label: 'Questions and answers', note: 'Answers, and how to email us', path: '/faq' }),
  Object.freeze({ id: 'status', label: 'Service status', note: 'Is Survey up right now?', path: '/status' }),
  Object.freeze({ id: 'whats-new', label: "What's new", note: 'Recent changes', path: '/whats-new' }),
]);

export const START_STEPS = Object.freeze([
  Object.freeze({ title: 'Add a drawing', text: 'Upload a PDF, or bring one in from OneDrive, SharePoint or Google Drive.' }),
  Object.freeze({ title: 'Mark it up', text: 'Pick a tool on the top bar. Esc puts you back on Select.' }),
  Object.freeze({ title: 'Survey it', text: 'Drop survey markers and fill in their answers on site.' }),
  Object.freeze({ title: 'Link a sheet', text: 'Connect Excel or Google Sheets, and answers flow both ways with your field team.' }),
  Object.freeze({ title: 'Bring in your team', text: 'Invite people to a project so everyone works on the same drawings.' }),
]);

export const TROUBLE_TIPS = Object.freeze([
  'If a page looks stuck, reload Survey.',
  "Can't sign in? Close other Survey tabs, then sign in again.",
]);

/** A help link's full address. */
export function helpLinkUrl(link, origin = SITE_ORIGIN) {
  return `${String(origin || SITE_ORIGIN).replace(/\/+$/, '')}${link?.path || '/'}`;
}

/** The version line shown at the foot of the dialog. */
export function versionLine({ version, build } = {}) {
  const v = String(version || '').trim();
  const b = String(build || '').trim();
  return [v && v !== 'unknown' ? `Survey ${v}` : 'Survey', b && b !== 'unknown' ? `build ${b}` : null].filter(Boolean).join(', ');
}
