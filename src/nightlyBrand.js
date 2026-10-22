// Survey Nightly: the copy of the app built with VITE_RELEASE_CHANNEL=nightly
// (every beta feature on, see src/featureFlags.js). It shares the production
// database, so it must never pass for surveytool.app: its own name in the tab,
// a violet icon, and a thin violet line with a "Nightly" tag on every screen.
export const NIGHTLY_NAME = 'Survey Nightly';
export const NIGHTLY_COLOR = '#8b5cf6';

export function nightlyTitle(title) {
  const t = String(title || '').trim();
  if (t.includes(NIGHTLY_NAME)) return t;
  if (/\bSurvey\b/.test(t)) return t.replace(/\bSurvey\b/, NIGHTLY_NAME);
  return t ? `${t} · ${NIGHTLY_NAME}` : NIGHTLY_NAME;
}

export function applyNightlyBrand(doc = typeof document !== 'undefined' ? document : null) {
  if (!doc?.head || !doc.body) return false;
  if (doc.getElementById('survey-nightly-tag')) return true;
  doc.title = nightlyTitle(doc.title);
  for (const link of doc.head.querySelectorAll('link[rel="icon"], link[rel="apple-touch-icon"]')) link.remove();
  const icons = [
    ['icon', 'image/svg+xml', '/nightly/favicon.svg'],
    ['icon', 'image/png', '/nightly/logo192.png'],
    ['apple-touch-icon', null, '/nightly/logo192.png'],
  ];
  for (const [rel, type, href] of icons) {
    const link = doc.createElement('link');
    link.rel = rel;
    if (type) link.type = type;
    link.href = href;
    doc.head.appendChild(link);
  }
  // Never catches a click: the line and tag sit over the app, not in its way.
  const style = doc.createElement('style');
  style.textContent = `
    #survey-nightly-line { position: fixed; top: env(safe-area-inset-top, 0px); left: 0; right: 0; height: 3px; background: ${NIGHTLY_COLOR}; z-index: 2147483646; pointer-events: none; }
    #survey-nightly-tag { position: fixed; top: calc(env(safe-area-inset-top, 0px) + 3px); left: 50%; transform: translateX(-50%); z-index: 2147483646; pointer-events: none;
      padding: 1px 8px 2px; border-radius: 0 0 6px 6px; background: ${NIGHTLY_COLOR}; color: #fff;
      font: 600 10px/14px system-ui, -apple-system, "Segoe UI", sans-serif; letter-spacing: 0.04em; text-transform: uppercase; }
    @media print { #survey-nightly-line, #survey-nightly-tag { display: none; } }
  `;
  doc.head.appendChild(style);
  const line = doc.createElement('div');
  line.id = 'survey-nightly-line';
  line.setAttribute('aria-hidden', 'true');
  const tag = doc.createElement('div');
  tag.id = 'survey-nightly-tag';
  tag.textContent = 'Nightly';
  tag.setAttribute('role', 'note');
  tag.setAttribute('aria-label', 'Survey Nightly: test copy with beta features');
  doc.body.append(line, tag);
  return true;
}
