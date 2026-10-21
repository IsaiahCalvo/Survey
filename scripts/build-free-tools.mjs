// Builds the free PDF tool pages (/tools and /tools/<id>) into tools/ at the
// repo root, using the marketing layout. Unlike the marketing pages these are
// Vite pages: each loads src/tools/main.js, which vite.config.js bundles.
// Run `node scripts/build-free-tools.mjs` after editing the catalog; the output
// HTML is committed.
import { writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ORIGIN, SIGNUP, page, faqList, faqSchema } from './build-marketing.mjs';
import { GROUPS, TOOLS, POPULAR } from './free-tools-catalog.mjs';
import { BATCH } from './free-tools-faq.mjs';

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
  crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14M2 6h14a2 2 0 0 1 2 2v14"/>',
  details: '<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M8.5 8h7M8.5 12h7M8.5 16h4"/>',
  clean: '<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M9 10l6 6M15 10l-6 6"/>',
  txt: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M10 13h6M10 17h6"/>',
  flatten: '<path d="M4 15l8 4 8-4M4 11l8 4 8-4M12 3l8 4-8 4-8-4z"/>',
  word: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M9.5 12l1.2 5 1.3-4 1.3 4 1.2-5"/>',
  sign: '<path d="M3 19c3-1 4-8 6-8s0 7 2 7 2-4 4-4 1 3 3 3 2-1 3-1"/><path d="M14 4l4 4-7 7H7v-4z"/>',
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  unlock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.5-2"/>',
};
// An entry may bring its own icon paths as `iconSvg` instead of naming one here.
const icon = (k, own) => `<svg class="ticon" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">${own || ICONS[k]}</svg>`;

// Other words people search for, so the hub search finds the tool.
const ALSO = {
  'merge-pdf': 'combine join', 'split-pdf': 'separate cut', 'compress-pdf': 'shrink reduce smaller size',
  'organize-pdf': 'reorder sort move pages', 'delete-pages': 'remove pages', 'jpg-to-pdf': 'jpeg photo picture image',
  'png-to-pdf': 'picture image', 'image-to-pdf': 'photo picture jpg png heic webp', 'pdf-to-jpg': 'jpeg image picture convert',
  'pdf-to-png': 'image picture convert', 'pdf-to-txt': 'text extract copy', 'word-to-pdf': 'docx doc microsoft office',
  'sign-pdf': 'signature esign', 'protect-pdf': 'password encrypt lock secure', 'unlock-pdf': 'remove password decrypt',
  'ocr-pdf': 'scan scanned searchable text recognition', 'compare-pdf': 'diff difference changes versions revision',
  'repair-pdf': 'fix broken damaged corrupt', 'grayscale-pdf': 'black and white greyscale gray grey colour color',
  'sanitize-pdf': 'metadata privacy hidden data scrub', 'n-up-pdf': 'pages per sheet 2 up 4 up multiple pages print',
  'booklet-pdf': 'print fold saddle staple', 'resize-pdf': 'page size a4 letter scale', 'fast-web-view': 'linearize optimize web',
  'remove-annotations': 'markups comments delete', 'flatten-pdf': 'forms fields', 'watermark-pdf': 'stamp text draft confidential',
  'add-page-numbers': 'pagination bates', 'extract-images': 'save pictures photos', 'remove-blank-pages': 'empty pages scan',
  'pdf-to-word': 'docx doc microsoft office editable convert', 'pdf-to-markdown': 'md text ai chatgpt llm convert',
  'pdf-to-docx': 'word doc microsoft office editable convert',
  'split-by-size': 'mb smaller parts email limit large file', 'pdf-page-sizes': 'info properties dimensions metadata paper size',
  'add-image-to-pdf': 'logo picture png jpg stamp signature insert',
};
const keys = (t) => `${t.name} ${t.short} ${t.id.replace(/-/g, ' ')} ${ALSO[t.id] || ''} ${t.trade?.keys || ''}`.toLowerCase().replace(/"/g, '');
const card = (t) => `<a class="tcard" href="/tools/${t.id}" data-k="${keys(t)}">${icon(t.icon, t.iconSvg)}<h3>${t.name}</h3><p>${t.short}</p></a>`;
const byId = (id) => TOOLS.find((t) => t.id === id);

// Tools that go together, shown first under "More free PDF tools".
const PAIRS = [
  ['ocr-pdf', 'pdf-to-txt', 'compare-pdf', 'compress-pdf'], ['compare-pdf', 'ocr-pdf', 'merge-pdf'],
  ['repair-pdf', 'compress-pdf', 'unlock-pdf', 'fast-web-view'], ['merge-pdf', 'split-pdf', 'organize-pdf', 'compress-pdf'],
  ['split-pdf', 'split-by-bookmarks', 'extract-pages', 'merge-pdf'], ['compress-pdf', 'grayscale-pdf', 'fast-web-view', 'remove-annotations'],
  ['sign-pdf', 'protect-pdf', 'flatten-pdf'], ['protect-pdf', 'unlock-pdf', 'sanitize-pdf', 'sign-pdf'],
  ['sanitize-pdf', 'edit-pdf-details', 'remove-annotations', 'protect-pdf'], ['pdf-to-jpg', 'pdf-to-png', 'extract-images', 'pdf-to-tiff'],
  ['jpg-to-pdf', 'image-to-pdf', 'png-to-pdf', 'compress-pdf'], ['word-to-pdf', 'txt-to-pdf', 'merge-pdf', 'compress-pdf'],
  ['n-up-pdf', 'booklet-pdf', 'resize-pdf'], ['booklet-pdf', 'n-up-pdf', 'add-blank-pages', 'reverse-pdf'],
  ['remove-blank-pages', 'delete-pages', 'ocr-pdf', 'compress-pdf'], ['grayscale-pdf', 'compress-pdf', 'n-up-pdf'],
  ['pdf-to-word', 'pdf-to-markdown', 'pdf-to-txt', 'ocr-pdf'], ['pdf-to-markdown', 'pdf-to-word', 'pdf-to-txt', 'ocr-pdf'],
  ['pdf-to-docx', 'pdf-to-word', 'word-to-pdf', 'ocr-pdf'],
  ['split-by-size', 'compress-pdf', 'split-pdf', 'merge-pdf'], ['pdf-page-sizes', 'resize-pdf', 'ocr-pdf', 'edit-pdf-details'],
  ['add-image-to-pdf', 'watermark-pdf', 'sign-pdf', 'add-header-footer'],
];
function relatedTo(t) {
  const want = new Set();
  for (const p of PAIRS) if (p.includes(t.id)) p.forEach((id) => want.add(id));
  TOOLS.filter((o) => o.group === t.group).forEach((o) => want.add(o.id));
  POPULAR.forEach((id) => want.add(id));
  want.delete(t.id);
  return [...want].map(byId).filter(Boolean).slice(0, 6);
}

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
  <a class="btn ghost" href="${SIGNUP}">Open Survey free</a>
</div></section>`;

const PICK = {
  pdf: ['Choose a PDF', 'Choose PDF files', 'application/pdf,.pdf'],
  image: ['Choose an image', 'Choose images', 'image/*'],
  text: ['Choose a text file', 'Choose text files', 'text/plain,.txt,.text,.md,.csv,.log'],
  docx: ['Choose a Word file', 'Choose Word files', '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
  tiff: ['Choose a TIFF', 'Choose TIFF files', 'image/tiff,.tif,.tiff'],
};

const SCRIPT = '\n<script type="module" src="/src/tools/main.js"></script>';

function toolPage(t) {
  // A batch tool handles one file at a time but takes several at once.
  const many = t.multiple || t.batch;
  const faq = t.batch && !t.faq.includes(BATCH) ? [...t.faq.slice(0, 2), BATCH, ...t.faq.slice(2)] : t.faq;
  const path = `/tools/${t.id}`;
  const related = relatedTo(t);
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
    schema: [app, howTo, faqSchema(faq)],
    scripts: SCRIPT,
    body: `<section class="page-head tool-head"><div class="wrap">
  <p class="kicker"><a href="/tools">Free PDF tools</a></p>
  <h1>${t.h1}</h1>
  <p class="lede">${t.lede}</p>
</div></section>
<section class="tool-sec"><div class="wrap">
  <div class="tool" id="tool" data-tool="${t.id}" data-accept="${t.accept}" data-action="${t.action}"${many ? ' data-multiple' : ''}${t.batch ? ' data-batch' : ''}>
    <div class="dz" data-dz>
      ${icon(t.icon, t.iconSvg)}
      <p class="dz-main"><label class="btn primary lg"><span data-pick>${PICK[t.accept][many ? 1 : 0]}</span><input type="file" hidden data-early accept="${PICK[t.accept][2]}"${many ? ' multiple' : ''} /></label></p>
      <p class="dz-or">or drop ${many ? 'them' : 'it'} here</p>
      <p class="dz-safe"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>Your files stay on this device</p>
      <noscript><p>This tool needs JavaScript turned on.</p></noscript>
    </div>
  </div>
</div></section>
<section class="sec"><div class="wrap">
  <h2>How to ${t.h1.charAt(0).toLowerCase()}${t.h1.slice(1)}</h2>
  <ol class="steps">${t.steps.map((s) => `<li>${s}</li>`).join('')}</ol>
</div></section>
${t.trade ? `<section class="sec"><div class="wrap narrow">
  <h2>${t.trade.h2}</h2>
  <p>${t.trade.text}</p>
</div></section>
` : ''}<section class="sec tight"><div class="wrap">${why()}</div></section>
<section class="sec"><div class="wrap narrow"><h2>Questions</h2>${faqList(faq)}</div></section>
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
  title: 'Free PDF tools: merge, compress, OCR, convert | Survey',
  desc: `${TOOLS.length} free PDF tools that run in your browser: merge, split, compress, OCR, compare, sign, lock and convert Word or images to PDF. No sign-up, no upload.`,
  schema: [{ '@type': 'ItemList', name: 'Free PDF tools', itemListElement: TOOLS.map((t, i) => ({ '@type': 'ListItem', position: i + 1, name: t.name, url: `${ORIGIN}/tools/${t.id}` })) }, faqSchema(HUB_FAQ)],
  body: `<section class="page-head"><div class="wrap">
  <p class="kicker">Free PDF tools</p>
  <h1>Every PDF tool you need, free</h1>
  <p class="lede">${TOOLS.length} tools to merge, split, shrink, read scans, compare, sign, lock and convert PDFs right in your browser. No sign-up, and your files never leave your device.</p>
</div></section>
<section class="sec tight hub-find-sec"><div class="wrap">
  <div class="hub-find" data-hub hidden>
    <input type="search" id="tool-search" placeholder="Search ${TOOLS.length} tools" aria-label="Search the free PDF tools" autocomplete="off" />
    <div class="chips" role="group" aria-label="Show tools for">
      <button type="button" class="chip" data-g="" aria-pressed="true">All</button>${GROUPS.map(([g, label]) => `<button type="button" class="chip" data-g="${g}" aria-pressed="false">${label}</button>`).join('')}
    </div>
    <p class="hub-none" role="status" hidden>No tool matches that. Try another word, or <a href="/tools">see all tools</a>.</p>
  </div>
</div></section>
<section class="sec tight tgroup" data-group="popular"><div class="wrap">
  <h2>Most used</h2>
  <div class="tgrid">${POPULAR.map(byId).map(card).join('')}</div>
</div></section>
${GROUPS.map(([g, label]) => `<section class="sec tight tgroup" data-group="${g}"><div class="wrap">
  <h2>${label}</h2>
  <div class="tgrid">${TOOLS.filter((t) => t.group === g).map(card).join('')}</div>
</div></section>`).join('\n')}
<section class="sec"><div class="wrap">${why()}</div></section>
<section class="sec"><div class="wrap narrow"><h2>Questions</h2>${faqList(HUB_FAQ)}</div></section>
${APP_PITCH}`,
  scripts: SCRIPT,
});

// Search results cut titles past about 60 characters and descriptions past
// about 160, so fail the build instead of shipping a clipped snippet.
for (const t of TOOLS) {
  if (t.title.length > 60) throw new Error(`${t.id}: title is ${t.title.length} characters (max 60)`);
  if (t.desc.length > 160) throw new Error(`${t.id}: desc is ${t.desc.length} characters (max 160)`);
}

rmSync(root, { recursive: true, force: true });
const out = { 'index.html': hub, ...Object.fromEntries(TOOLS.map((t) => [`${t.id}/index.html`, toolPage(t)])) };
for (const [p, html] of Object.entries(out)) {
  const f = join(root, p);
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, html);
}
console.log('built', Object.keys(out).length, 'tool pages');
