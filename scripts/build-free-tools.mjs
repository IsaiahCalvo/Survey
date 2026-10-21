// Builds the free PDF tool pages (/tools and /tools/<id>) into tools/ at the
// repo root, using the marketing layout. Unlike the marketing pages these are
// Vite pages: each loads src/tools/main.js, which vite.config.js bundles.
// Run `node scripts/build-free-tools.mjs` after editing the catalog; the output
// HTML is committed.
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ORIGIN, APP, page, faqList, faqSchema } from './build-marketing.mjs';
import { GROUPS, TOOLS } from './free-tools-catalog.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'tools');

const ICONS = {
  merge: '<path d="M6 4v5a4 4 0 0 0 4 4h4a4 4 0 0 1 4 4v3M18 4v5a4 4 0 0 1-4 4"/><path d="M15 17l3 3 3-3"/>',
  split: '<path d="M12 4v6M12 10l-6 6v4M12 10l6 6v4"/><path d="M3 18l3 2 3-2M15 18l3 2 3-2"/>',
  compress: '<path d="M8 3v5H3M16 3v5h5M8 21v-5H3M16 21v-5h5"/>',
  rotate: '<path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v5h-5"/>',
  delete: '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/>',
  extract: '<rect x="4" y="3" width="11" height="15" rx="1.5"/><path d="M13 13h8M18 10l3 3-3 3"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="9" cy="10" r="2"/><path d="M21 16l-5-5-9 9"/>',
  photo: '<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M9 3v4h6V3"/><path d="M8 17l3-4 2 2 3-4"/>',
  numbers: '<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M10 16h4M12 16v-5l-1.5 1"/>',
  watermark: '<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M8 16l8-8"/>',
  organize: '<rect x="3" y="4" width="7" height="7" rx="1"/><rect x="14" y="4" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 17.5h7M18 14.5l3 3-3 3"/>',
  text: '<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M9 8h6M12 8v9"/>',
  header: '<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M8 6.5h8M8 17.5h8"/>',
  flatten: '<path d="M4 15l8 4 8-4M4 11l8 4 8-4M12 3l8 4-8 4-8-4z"/>',
};
const icon = (k) => `<svg class="ticon" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">${ICONS[k]}</svg>`;

const card = (t) => `<a class="tcard" href="/tools/${t.id}">${icon(t.icon)}<h3>${t.name}</h3><p>${t.short}</p></a>`;

const WHY = [
  ['Private', 'Your files stay on your device. Nothing is uploaded.'],
  ['Free', 'No sign-up, no watermark on your file, no daily limit.'],
  ['Works offline', 'Once the page loads, it keeps working without the internet.'],
  ['Any device', 'Phone, tablet or computer, in Chrome, Edge or Safari.'],
];
const why = () => `<div class="why">${WHY.map(([h, p]) => `<div><h3>${h}</h3><p>${p}</p></div>`).join('')}</div>`;

const APP_PITCH = `<section class="sec"><div class="wrap custom">
  <h2>Need to mark up the PDF too?</h2>
  <p>Survey is a full PDF app for drawings. Add pens, shapes, clouds and count markers, and keep every sheet in sync on your computer, iPad and phone.</p>
  <a class="btn ghost" href="${APP}">Open Survey free</a>
</div></section>`;

const SCRIPT = '\n<script type="module" src="/src/tools/main.js"></script>';

function toolPage(t) {
  const path = `/tools/${t.id}`;
  const related = TOOLS.filter((o) => o.id !== t.id && (o.group === t.group || ['merge-pdf', 'compress-pdf', 'split-pdf'].includes(o.id))).slice(0, 6);
  const howTo = {
    '@type': 'HowTo', name: `How to ${t.h1.charAt(0).toLowerCase()}${t.h1.slice(1)}`,
    tool: { '@type': 'HowToTool', name: 'A web browser' },
    step: t.steps.map((s, i) => ({ '@type': 'HowToStep', position: i + 1, text: s })),
  };
  const app = {
    '@type': 'WebApplication', name: `${t.name} by Survey`, url: ORIGIN + path, applicationCategory: 'UtilitiesApplication',
    operatingSystem: 'Any (runs in the browser)', browserRequirements: 'Requires JavaScript', isAccessibleForFree: true,
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' }, description: t.desc, publisher: { '@id': ORIGIN + '/#org' },
  };
  return page({
    path, title: t.title, desc: t.desc,
    crumbs: [['Free PDF tools', '/tools'], [t.name, path]],
    schema: [app, howTo, faqSchema(t.faq)],
    scripts: SCRIPT,
    body: `<section class="page-head tool-head"><div class="wrap">
  <p class="kicker"><a href="/tools">Free PDF tools</a></p>
  <h1>${t.h1}</h1>
  <p class="lede">${t.lede}</p>
</div></section>
<section class="tool-sec"><div class="wrap">
  <div class="tool" id="tool" data-tool="${t.id}" data-accept="${t.accept}" data-action="${t.action}"${t.multiple ? ' data-multiple' : ''}>
    <div class="dz" data-dz>
      ${icon(t.icon)}
      <p class="dz-main"><button class="btn primary lg" type="button" data-pick>Choose ${t.accept === 'pdf' ? (t.multiple ? 'PDF files' : 'a PDF') : 'images'}</button></p>
      <p class="dz-or">or drop ${t.multiple ? 'them' : 'it'} here</p>
      <p class="dz-safe"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>Your files stay on this device</p>
      <noscript><p>This tool needs JavaScript turned on.</p></noscript>
    </div>
  </div>
</div></section>
<section class="sec"><div class="wrap">
  <h2>How to ${t.h1.charAt(0).toLowerCase()}${t.h1.slice(1)}</h2>
  <ol class="steps">${t.steps.map((s) => `<li>${s}</li>`).join('')}</ol>
</div></section>
<section class="sec tight"><div class="wrap">${why()}</div></section>
<section class="sec"><div class="wrap narrow"><h2>Questions</h2>${faqList(t.faq)}</div></section>
<section class="sec tight"><div class="wrap">
  <h2>More free PDF tools</h2>
  <div class="tgrid">${related.map(card).join('')}</div>
  <p class="more-link"><a href="/tools">All free PDF tools</a></p>
</div></section>
${APP_PITCH}`,
  });
}

const HUB_FAQ = [
  ['Are these PDF tools really free?', 'Yes. Every tool is free with no sign-up, no watermark and no daily limit.'],
  ['Are my files uploaded?', 'No. The tools run in your browser, so your files never leave your device.'],
  ['Do they work on a phone?', 'Yes. They work in Chrome, Edge and Safari on phones, tablets and computers.'],
  ['What is Survey?', `Survey is a PDF markup app for construction drawings. The free tools are a small part of it. <a href="/features">See what the full app does</a>.`],
];

const hub = page({
  path: '/tools', crumb: 'Free PDF tools',
  title: 'Free PDF tools: merge, split, compress, convert | Survey',
  desc: 'Free PDF tools that run in your browser: merge, split, compress, rotate, delete and extract pages, convert to and from JPG and PNG. No sign-up, no upload.',
  schema: [{ '@type': 'ItemList', name: 'Free PDF tools', itemListElement: TOOLS.map((t, i) => ({ '@type': 'ListItem', position: i + 1, name: t.name, url: `${ORIGIN}/tools/${t.id}` })) }, faqSchema(HUB_FAQ)],
  body: `<section class="page-head"><div class="wrap">
  <p class="kicker">Free PDF tools</p>
  <h1>Every PDF tool you need, free</h1>
  <p class="lede">Merge, split, shrink, turn and convert PDFs right in your browser. No sign-up, and your files never leave your device.</p>
</div></section>
${GROUPS.map(([g, label]) => `<section class="sec tight tgroup"><div class="wrap">
  <h2>${label}</h2>
  <div class="tgrid">${TOOLS.filter((t) => t.group === g).map(card).join('')}</div>
</div></section>`).join('\n')}
<section class="sec"><div class="wrap">${why()}</div></section>
<section class="sec"><div class="wrap narrow"><h2>Questions</h2>${faqList(HUB_FAQ)}</div></section>
${APP_PITCH}`,
  scripts: SCRIPT,
});

rmSync(root, { recursive: true, force: true });
const out = { 'index.html': hub, ...Object.fromEntries(TOOLS.map((t) => [`${t.id}/index.html`, toolPage(t)])) };
for (const [p, html] of Object.entries(out)) {
  const f = join(root, p);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, html);
}
console.log('built', Object.keys(out).length, 'tool pages');
