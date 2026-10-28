// Builds the static marketing pages (welcome, features, pricing, devices, faq)
// into public/. Run `node scripts/build-marketing.mjs` after editing copy here;
// the output HTML is committed so Vite just copies it to dist.
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TOOLS as PDF_TOOLS, TOOL_PATHS } from './free-tools-catalog.mjs';
import { WHATS_NEW } from './whats-new.mjs';

// The app's own tool glyphs (scripts/dump-marketing-icons.mjs renders them).
const ICONS = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'marketing-icons.json'), 'utf8'));

const root = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');
export const ORIGIN = 'https://surveytool.app';
// Inlined so first paint doesn't wait on a stylesheet request.
const CSS = readFileSync(join(root, 'welcome', 'site.css'), 'utf8').replace(/\/\*[^]*?\*\//g, '').replace(/\n+/g, '');
const TODAY = new Date().toISOString().slice(0, 10);
export const APP = '/?signin=1';
// "Start free" opens the app on Create account instead of Welcome back.
export const SIGNUP = '/?signup=1';
const MAIL = 'mailto:isaiahcalvo123@gmail.com';

// Free PDF tools live at /tools/* (scripts/build-free-tools.mjs builds them).
// The footer lists the most used ones; the nav links the /tools hub.
const TOOL_LINKS = [
  ...['merge-pdf', 'split-pdf', 'compress-pdf', 'jpg-to-pdf', 'pdf-to-jpg'].map((id) => [`/tools/${id}`, PDF_TOOLS.find((t) => t.id === id).name]),
  ['/tools', 'All free tools'],
];

const NAV = [
  ['/features', 'Features'],
  ['/use-cases', 'Use cases'],
  ['/pricing', 'Pricing'],
  ...(TOOL_LINKS.length ? [['/tools', 'Free PDF tools']] : []),
  ['/faq', 'FAQ'],
];

const USES = [
  { slug: 'field-surveys', name: 'Field surveys', title: 'Field surveys on drawings',
    desc: 'Walk a site with the plans on a tablet, count what is there, tag what needs work and export the totals as data.',
    lead: 'Take the drawing set to site on a tablet or phone, mark what you find and count it as you go.',
    steps: [['Load the plans', 'Upload the PDF set once. It is on every device you sign in on.'], ['Walk and tap', 'Make a category for each thing you check, like outlets or fire doors, and tap each one on the plan. Survey numbers them and keeps the totals.'], ['Note what you see', 'Add a callout or a cloud where something is wrong, right on the sheet.'], ['Send the results', 'Export the counts as a spreadsheet for the report or the estimate.']] },
  { slug: 'punch-lists', name: 'Punch lists', title: 'Punch lists on the floor plan',
    desc: 'Mark punch items right on the floor plan with numbered markers and notes, then share the marked-up set with your team.',
    lead: 'Put every punch item where it is on the plan, numbered, so nobody hunts for it.',
    steps: [['Open the floor plan', 'Bring up the sheet for the area you are walking.'], ['Drop a marker per item', 'Use a count category for punch items. Each tap adds the next number.'], ['Say what is wrong', 'Add a text callout next to the marker: the trade, the fix, the room.'], ['Share it', 'Invite the trades as viewers or editors so they see the same marked-up set.']] },
  { slug: 'as-builts', name: 'As-builts', title: 'As-built markups',
    desc: 'Red-line the drawings with what was really built: moved walls, rerouted runs, added fixtures. Keep it with the project.',
    lead: 'Red-line what changed in the field so the drawings match what was built.',
    steps: [['Open the issued set', 'Start from the drawings the work was built to.'], ['Red-line the changes', 'Use the pen, clouds and arrows to show what moved, what was added and what was left out.'], ['Count what was installed', 'Tap fixtures or devices to get real installed counts for closeout.'], ['Keep it together', 'The marked-up set stays in the project for the next person who needs it.']] },
];

// Honest side-by-side. Only claims we can stand behind; competitor details
// point readers to the competitor's own site for current facts.
const COMPARE = [
  { slug: 'bluebeam', them: 'Bluebeam Revu',
    desc: 'An honest look at Survey and Bluebeam Revu for marking up and counting on construction drawings: what each does best and who each one fits.',
    intro: 'Bluebeam Revu is the long-time standard for PDF markup in construction, with deep measurement, takeoff and document tools. Survey is a simpler app that runs in the browser and focuses on markup and counting.',
    themBest: ['Full measurement and quantity takeoff tools', 'A large set of document tools: compare sheets, batch edits, forms', 'Wide use across big general contractors'],
    usBest: ['Runs in any browser, nothing to install', 'A free plan, and Pro at $9.99 a month', 'Tap-to-count markers with running totals you can export', 'Made for a pen and touch'],
    pick: 'Pick Bluebeam if you need full takeoff and measurement, or your company already runs on it. Pick Survey if you want quick markup and counting on any device without installing anything or paying much.' },
  { slug: 'drawboard', them: 'Drawboard PDF', table: true,
    desc: 'Survey and Drawboard PDF side by side: the same markup tools, which ones cost money in each, and what Survey does that Drawboard does not.',
    intro: 'Drawboard PDF is a well-known markup app for Windows and iPad. Survey gives you the same markup tools in the browser, free, and adds site surveys that export as data, and spaces and regions.',
    themBest: ['A native Windows and iPad app with a polished pen feel', 'Years of use in design offices', 'Drawboard Projects, a separate product, adds review workflows and issue tracking for design teams'],
    usBest: ['Every markup tool is free, including callouts, measuring, OCR and page tools, which Drawboard puts behind PRO', 'Site surveys on the plan that export as a spreadsheet you can open anywhere', 'Spaces and regions: work on one part of a sheet at a time', 'Count markers with running totals', 'Runs in any browser on a computer, tablet or phone', 'Pro is $9.99 a month, with a free plan that has no time limit'],
    pick: 'Pick Drawboard if you want a native Windows or iPad app and your team already uses it. Pick Survey if you want the same markup tools free in the browser, or you walk sites and want the survey answers as data.' },
];

export const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const strip = (s) => s.replace(/<[^>]+>/g, '');

// One list feeds the visible FAQ and the FAQPage schema, so they never drift.
const FAQ = [
  ['What is Survey?', 'Survey is a PDF markup app for construction and engineering drawings. You open a drawing set in your browser, mark it up with every tool you would expect, and run site surveys on the plan that you export as a spreadsheet.'],
  ['How do site surveys work?', 'Build a checklist template once: the things you check and the questions you ask at each one. On site, drop a marker where each item is, answer Y, N or N/A, and add a note, a photo or a voice note. Export the data and you get a spreadsheet file (.xlsx) with one sheet per category plus a summary. It opens in Excel, Google Sheets, Numbers or LibreOffice. Link a Microsoft 365 workbook and edits made there come back onto the plan.'],
  ['What are spaces and regions?', 'A space is a named set of pages with a region drawn on each page. Turn it on and everything outside the region dims, so you work on one part of a sheet at a time. Markups made inside a space belong to it. We have not found this in any other PDF app.'],
  ['Which markup tools are free?', 'All of them: pen with pressure, highlighter, partial eraser, rectangle, ellipse, polygon, cloud, polyline, line, arrow, count markers, measuring, text, callouts, text highlight and strike-through, OCR and page tools. Drawboard PDF charges for callouts, measuring, OCR and page tools. Survey does not.'],
  ['Do I need to install anything?', 'No. Survey runs in Chrome, Edge and Safari on computers, tablets and phones. Open surveytool.app and sign in.'],
  ['Does it work with a pen on a tablet?', 'Yes. Apple Pencil or any stylus draws, and your fingers pan and zoom, so you never mark the page by mistake.'],
  ['How do count markers work?', 'Pick a category, tap each item on the plan, and Survey numbers the markers and keeps a running total for every category. Export the totals as a spreadsheet when you are done.'],
  ['Is Survey free?', 'Yes. The Free plan gives you 1 project, 5 documents and 100MB of storage with no card needed. Pro is $9.99 a month or $99 a year for unlimited projects and documents, 10GB of storage and every survey tool.'],
  ['Can I cancel Pro any time?', 'Yes. Cancel from your account settings and keep Pro until the end of the period you paid for.'],
  ['Can my team work on the same drawings?', 'Yes. On Pro, invite people as viewers or editors and edit together live. Enterprise is $20 per user a month, with a minimum of 3 users, for 1TB of storage and priority support. A company admin console and single sign-on are coming soon.'],
  ['Where are my files kept?', 'Your markups save to the cloud so they sync to every device you sign in on. Read the <a href="/privacy.html">privacy policy</a> for the details.'],
  ['Can Survey be set up for my company?', 'Yes. We build custom data exports, company markup templates and team roles. <a href="' + MAIL + '">Email us</a> with how your team works.'],
];

const TOOLS = [
  { id: 'count', name: 'Count markers', img: 'app-counts.webp', w: 960, h: 600, alt: 'Count markers numbered 1 to 10 on the desks of an open office',
    lead: 'Tap each item on the plan and Survey numbers it and keeps the total.',
    body: 'Make a category for each thing you count: desks, outlets, sprinklers, doors. Every tap adds a numbered marker, and the totals for each category stay in view. Export them as a spreadsheet in one step.' },
  { id: 'pen', name: 'Pen and highlighter', img: 'app-pen.webp', w: 1280, h: 800, alt: 'A pen circle drawn around the lift and the break room name highlighted on a floor plan',
    lead: 'Write on drawings the way you would on paper.',
    body: 'Smooth ink that follows Apple Pencil, a mouse or a finger. The highlighter sits behind the linework so the drawing stays readable. The eraser takes off just what you rub out.' },
  { id: 'shapes', name: 'Shapes, clouds and arrows', img: 'app-shapes.webp', w: 1280, h: 800, alt: 'A revision cloud around the meeting room table, an arrow to a fire door, count markers on desks and a callout that says Move counter to east wall',
    lead: 'Box it, cloud it, point at it.',
    body: 'Rectangles, ellipses, revision clouds, lines, polylines and arrows, each with its own color and line weight. Select one to move it, resize it or change its style.' },
  { id: 'plan', name: 'The whole drawing set', img: 'app-markup.webp', w: 1600, h: 1000, alt: 'A full floor plan with markups in Survey', srcset: '/welcome/app-markup-800.webp 800w, /welcome/app-markup.webp 1600w',
    lead: 'Big sheets stay sharp and quick at any zoom.',
    body: 'Pinch or scroll to zoom from the whole sheet down to a single dimension. Thumbnails, bookmarks and search help you find the sheet you need in a large set.' },
];

// The three things no other PDF app does. Real screenshots from the app.
const ONLY = [
  { id: 'surveys', kicker: 'Only in Survey', name: 'Site surveys that turn into data',
    lead: 'Walk the site with the plan. Every answer lands in a spreadsheet.',
    body: 'Build a checklist template once: the things you check and the questions you ask at each one. On site, drop a marker where each outlet, fitting or door is, answer Y, N or N/A, and add a note, a photo or a voice note. Export the data and you get a spreadsheet with one sheet per category plus a summary, ready for Excel, Google Sheets or anything that reads a spreadsheet. Link a Microsoft 365 workbook and edits made there come back onto the plan.',
    img: 'survey.webp', w: 1600, h: 1000, alt: 'Survey with a floor plan on the left and the survey panel on the right: outlets and data points marked on the plan, and Data point 2 answered Patched Y, Tested N, with the note "Patch lead missing at desk 14. Re-check Friday."', srcset: '/welcome/survey-800.webp 800w, /welcome/survey.webp 1600w',
    img2: 'sheet.webp', w2: 1600, h2: 669, alt2: 'The exported spreadsheet: an Outlet sheet with Item, Faceplate fitted, Tested, Labelled, Entity and Notes columns, and a tab for every category plus a Summary' },
  { id: 'spaces', kicker: 'Only in Survey', name: 'Spaces and regions',
    lead: 'Work on one part of a sheet at a time.',
    body: 'Name a space, pick its pages and draw a region on each one, as a rectangle or freehand. Turn the space on and everything outside the region dims. Markups made inside a space belong to it, so one sheet can carry the fit-out, the demolition and the services as separate work. Export a space on its own. We have not found this in any other PDF app.',
    img: 'spaces.webp', w: 1600, h: 1000, alt: 'A floor plan with a space turned on: the open office stays clear while the rest of the sheet is dimmed with a grey hatch', srcset: '/welcome/spaces-800.webp 800w, /welcome/spaces.webp 1600w' },
  // Not "projects": Drawboard Projects has projects too (checked 2026-10-27).
  { id: 'templates', kicker: 'Only in Survey', name: 'Survey templates',
    lead: 'Set up a survey once. Use it on every project.',
    body: 'A template holds the modules, the categories under each one, the checklist for each category and the tags you give each item, like Installed, Snag or Missing. Make one per kind of survey: electrical, fire, fit-out.',
    img: 'template.webp', w: 1600, h: 625, alt: 'The template editor: Electrical site survey with Power, Lighting and Fire modules, an Outlet checklist of Faceplate fitted, Tested and Labelled, and the tags Installed, Snag and Missing', srcset: '/welcome/template-800.webp 800w, /welcome/template.webp 1600w' },
];

// Every markup tool, free. Checked against the app: nothing here is gated.
// Each card shows the tool's own toolbar icon.
const TOOLSET = [
  ['pen', 'Pen', 'Pressure ink that follows a pen, a mouse or a finger.'],
  ['highlighter', 'Highlighter', 'Sits behind the linework so the drawing stays readable.'],
  ['eraser', 'Partial eraser', 'Rub out part of a stroke and the rest stays.'],
  ['shapes', 'Shapes', 'Rectangle, ellipse, polygon, polyline, line and arrow.'],
  ['shapeCloud', 'Revision cloud', 'Cloud a change the way you would on paper.'],
  ['counter', 'Count markers', 'Tap each item. Every category keeps a running total.'],
  ['measureScale', 'Measure', 'Set the page scale, then measure length and area.'],
  ['callout', 'Text and callouts', 'Notes that point at the exact spot they are about.'],
  ['formatHighlight', 'Text markup', 'Highlight, underline, squiggle and strike through words.'],
  ['scanText', 'OCR', 'Read a scanned sheet on your device so you can search it.'],
  ['pages', 'Page tools', 'Insert, rotate, delete, merge and split pages.'],
];

// Side by side with Drawboard PDF. Drawboard's column comes from drawboard.com
// (October 2026): "All the essentials, free" plus a PRO grid that lists pressure
// ink, callouts, measuring, OCR, custom templates, merge, split and live sync.
// "Not listed" means it is not on their feature list at all.
const VS = [
  ['Pen and highlighter', 'Free', 'Free'],
  ['Shapes', 'Free', 'Free'],
  ['Text and notes', 'Free', 'Free'],
  ['Insert, rotate and delete pages', 'Free', 'Free'],
  ['Pressure ink', 'Free', 'PRO'],
  ['Callouts', 'Free', 'PRO'],
  ['Measure length and area', 'Free', 'PRO'],
  ['OCR', 'Free', 'PRO'],
  ['Merge and split', 'Free', 'PRO'],
  ['Count markers with totals', 'Free', 'Not listed'],
  ['Site surveys with data export', 'Pro', 'Not listed'],
  ['Spaces and regions', 'Pro', 'Not listed'],
  ['Survey templates', 'Pro', 'Not listed'],
  ['Live editing together', 'Pro', 'PRO'],
];

const MORE = [
  ['Share with your team', 'Invite people as viewers or editors. Everyone sees the same markups. Pro.'],
  ['Data export', 'Counts and survey answers as a spreadsheet for Excel, Google Sheets or Numbers. Spaces also export as CSV. Pro.'],
  ['Microsoft 365 and OneDrive', 'Open drawings from OneDrive and keep a survey workbook in sync. Pro.'],
  ['Undo history', 'Step back through every change on a sheet.'],
  ['Big sheets stay quick', 'Zoom from the whole sheet down to one dimension.'],
  ['Free PDF tools', PDF_TOOLS.length + ' tools in the browser, no sign-in: merge, split, compress, OCR, compare and more.'],
];

// Free PDF tools called out on /features.
const FREE_TOOL_PICKS = [
  ['ocr-pdf', 'Make scans searchable', 'OCR reads a scanned drawing or letter so you can search it and copy the words.'],
  ['compare-pdf', 'Compare two PDFs', 'See what changed between two versions, with changed words marked side by side.'],
  ['merge-pdf', 'Several files at once', 'Add a stack of PDFs to tools like compress, OCR or page numbers and get one ZIP back.'],
  ['compress-pdf', 'Shrink big sets', 'Make a heavy drawing set small enough to email.'],
  ['sign-pdf', 'Sign and lock', 'Draw or type a signature, then add a password.'],
  ['word-to-pdf', 'Word and images to PDF', 'Turn a Word file, photos or a TIFF scan into a PDF.'],
];

const PLANS = [
  { name: 'Free', price: '$0', per: '/month', note: 'For trying Survey on one project', cta: 'Start free', items: ['1 project', '5 documents', '100MB storage', 'Every markup tool, including callouts, measuring and OCR', 'Count markers with totals', 'Works on every device'] },
  { name: 'Pro', price: '$9.99', per: '/month', note: 'or $99 a year, which saves $20', cta: 'Start free, upgrade in the app', best: true, items: ['Unlimited projects', 'Unlimited documents', '10GB storage', 'Site surveys with data export', 'Spaces and regions', 'Templates', 'Share with viewers and editors', 'Live editing together', 'OneDrive'] },
  { name: 'Enterprise', price: '$20', per: '/user/month', note: 'Minimum 3 users', cta: 'Email us', href: MAIL, items: ['Everything in Pro for every user', '1TB storage', 'Priority support', 'Company admin console and single sign-on: coming soon', 'Custom builds for your company'] },
];

// One glyph that morphs: the sun's core grows while a masked "bite" slides in to
// carve a crescent, and the rays spin and shrink away (site.css drives it).
const ICON_THEME = '<svg class="sm" viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><mask id="sm-cut"><rect width="24" height="24" fill="#fff"/><circle class="sm-bite" cx="12" cy="12" r="8" fill="#000"/></mask><circle class="sm-core" cx="12" cy="12" r="5" mask="url(#sm-cut)"/><g class="sm-rays"><path d="M12 1.5v2.2M12 20.3v2.2M1.5 12h2.2M20.3 12h2.2M4.6 4.6l1.5 1.5M17.9 17.9l1.5 1.5M4.6 19.4l1.5-1.5M17.9 6.1l1.5-1.5"/></g></svg>';

export const ORG = { '@type': 'Organization', '@id': ORIGIN + '/#org', name: 'Survey', url: ORIGIN + '/welcome', logo: ORIGIN + '/logo512.png', email: 'isaiahcalvo123@gmail.com' };
const SOFTWARE = {
  '@type': 'SoftwareApplication', '@id': ORIGIN + '/#app', name: 'Survey', url: ORIGIN + '/',
  applicationCategory: 'BusinessApplication', operatingSystem: 'Web browser, macOS, Windows, iPadOS, Android',
  description: 'PDF markup app for construction drawings. Every markup tool free. Site surveys that export as a spreadsheet, spaces and regions, count markers.',
  publisher: { '@id': ORIGIN + '/#org' },
  offers: [
    { '@type': 'Offer', name: 'Free', price: '0', priceCurrency: 'USD' },
    { '@type': 'Offer', name: 'Pro monthly', price: '9.99', priceCurrency: 'USD' },
    { '@type': 'Offer', name: 'Pro yearly', price: '99', priceCurrency: 'USD' },
    { '@type': 'Offer', name: 'Enterprise', price: '20', priceCurrency: 'USD', description: 'Per user per month, minimum 3 users' },
  ],
};

export function page({ path, title, desc, body, schema = [], crumb, crumbs, scripts = '' }) {
  const url = ORIGIN + path;
  const graph = [ORG, ...schema];
  const trail = crumbs || (crumb ? [[crumb, path]] : null);
  if (trail) graph.push({ '@type': 'BreadcrumbList', itemListElement: [['Home', '/welcome'], ...trail].map(([name, p], i) => (
    { '@type': 'ListItem', position: i + 1, name, item: ORIGIN + p }
  )) });
  const nav = NAV.map(([h, l]) => `<a href="${h}"${h === path || path.startsWith(h + '/') ? ' aria-current="page"' : ''}>${l}</a>`).join('');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}" />
<link rel="canonical" href="${url}" />
<meta name="theme-color" content="#141a2b" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="Survey" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(desc)}" />
<meta property="og:url" content="${url}" />
<meta property="og:image" content="${ORIGIN}/welcome/og.jpg" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="${esc(title)}" />
<meta name="twitter:description" content="${esc(desc)}" />
<meta name="twitter:image" content="${ORIGIN}/welcome/og.jpg" />
<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&display=swap" media="print" onload="this.media='all'" />
<style>${CSS}</style>
<script>try{var t=localStorage.getItem('theme');if(t==='light'||t==='dark')document.documentElement.dataset.theme=t}catch(e){}</script>
<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph })}</script>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
<header class="top"><div class="wrap nav">
  <a class="brand" href="/welcome"><img src="/logo192.png" alt="" width="28" height="28" />Survey</a>
  <nav class="links" aria-label="Main">${nav}</nav>
  <div class="right">
    <button class="theme" type="button" aria-label="Dark theme" aria-pressed="false">${ICON_THEME}</button>
    <a class="login" href="${APP}">Log in</a>
    <a class="btn primary" href="${SIGNUP}">Start free</a>
    <button class="menu" type="button" aria-label="Menu" aria-expanded="false" aria-controls="mnav"><span></span><span></span></button>
  </div>
</div>
<nav class="mnav" id="mnav" aria-label="Mobile" hidden>${nav}<a href="${APP}">Log in</a></nav>
</header>
<main id="main">
${body}
</main>
<footer class="foot"><div class="wrap">
  <div class="fgrid">
    <div><a class="brand" href="/welcome"><img src="/logo192.png" alt="" width="28" height="28" />Survey</a><p>PDF markup for construction drawings. Every tool free. Site surveys you can export as data.</p></div>
    <div><h2 class="fh">Product</h2><a href="/features">Features</a><a href="/devices">Devices</a><a href="/pricing">Pricing</a><a href="/faq">FAQ</a><a href="/use-with-ai">Use with AI</a><a href="/whats-new">What's new</a></div>
    <div><h2 class="fh">Use cases</h2>${USES.map((u) => `<a href="/use-cases/${u.slug}">${u.name}</a>`).join('')}</div>
    <div><h2 class="fh">Compare</h2>${COMPARE.map((c) => `<a href="/compare/${c.slug}">Survey vs ${c.them.split(' ')[0]}</a>`).join('')}</div>${TOOL_LINKS.length ? `
    <div><h2 class="fh">Free PDF tools</h2>${TOOL_LINKS.map(([h, l]) => `<a href="${h}">${l}</a>`).join('')}</div>` : ''}
    <div><h2 class="fh">Get started</h2><a href="${APP}">Log in</a><a href="${SIGNUP}">Start free</a><a href="${MAIL}">Contact</a><a href="/status">Status</a></div>
    <div><h2 class="fh">Legal</h2><a href="/privacy.html">Privacy</a><a href="/terms.html">Terms</a></div>
  </div>
  <p class="copy">© <span class="yr">2026</span> Survey</p>
</div></footer>
<script src="/welcome/site.js" defer></script>${scripts}
</body>
</html>
`;
}

const shot = (t, cls = '') => `<figure class="shot ${cls}"><img src="/welcome/${t.img}"${t.srcset ? ` srcset="${t.srcset}" sizes="(max-width: 900px) 92vw, 640px"` : ''} width="${t.w}" height="${t.h}" loading="lazy" decoding="async" alt="${esc(t.alt)}" /></figure>`;

const only = (f, i) => `<section class="sec feat${i % 2 ? ' flip' : ''}" id="${f.id}"><div class="wrap feat-grid">
  <div><p class="kicker">${f.kicker}</p><h2>${f.name}</h2><p class="lead">${f.lead}</p><p>${f.body}</p></div>
  ${f.img2 ? `<div class="duo">${shot(f)}${shot({ img: f.img2, w: f.w2, h: f.h2, alt: f.alt2, srcset: '/welcome/' + f.img2.replace('.webp', '-800.webp') + ' 800w, /welcome/' + f.img2 + ' 1600w' })}</div>` : shot(f)}
</div></section>`;

const cell = (v) => v === 'Not listed' ? '<span class="no">Not listed</span>' : `<span class="${v === 'Free' ? 'yes' : 'tier'}">${v}</span>`;
const vsTable = () => `<div class="tbl vs-tbl"><table>
    <thead><tr><th scope="col"><span class="sr">Tool</span></th><th scope="col">Survey</th><th scope="col">Drawboard PDF</th></tr></thead>
    <tbody>${VS.map(([f, a, b]) => `<tr><th scope="row">${f}</th><td>${cell(a)}</td><td>${cell(b)}</td></tr>`).join('')}</tbody>
  </table></div>
  <p class="fine">Drawboard's column is from drawboard.com in October 2026. "Not listed" means it is not on their feature list. Check their site for current facts.</p>`;

const toolGrid = () => `<div class="toolgrid">${TOOLSET.map(([icon, h, p]) => `<div><span class="tool-ic">${ICONS[icon]}</span><h3>${h}</h3><p>${p}</p></div>`).join('')}</div>`;

// Computer, tablet and phone: real captures at each size, named underneath.
const devs = () => `<div class="devs">
  <figure class="dev dev-pc"><div class="scr"><img src="/welcome/app-markup.webp" srcset="/welcome/app-markup-800.webp 800w, /welcome/app-markup.webp 1600w" sizes="(max-width: 980px) 92vw, 640px" width="1600" height="1000" loading="lazy" decoding="async" alt="Survey in a browser on a computer, showing a marked-up floor plan" /></div><figcaption>Computer</figcaption></figure>
  <figure class="dev dev-tab"><div class="scr"><img src="/welcome/app-tablet.webp" srcset="/welcome/app-tablet-800.webp 800w, /welcome/app-tablet.webp 1600w" sizes="(max-width: 980px) 70vw, 460px" width="1600" height="1112" loading="lazy" decoding="async" alt="Survey on a tablet with the Shapes row open and the Cloud tool picked" /></div><figcaption>Tablet</figcaption></figure>
  <figure class="dev dev-ph"><div class="scr"><img src="/welcome/app-phone.webp" width="780" height="1688" loading="lazy" decoding="async" alt="Survey on a phone, zoomed in on the open office with count markers and a callout" /></div><figcaption>Phone</figcaption></figure>
</div>`;

const plans = () => `<div class="plans">${PLANS.map((p) => `
  <article class="plan${p.best ? ' best' : ''}">
    <h3>${p.name}</h3>${p.best ? '<p class="flag">Most picked</p>' : ''}
    <p class="amt">${p.price}<small>${p.per}</small></p>
    <p class="note">${p.note}</p>
    <ul>${p.items.map((i) => `<li>${i}</li>`).join('')}</ul>
    <a class="btn ${p.best ? 'primary' : 'ghost'}" href="${p.href || SIGNUP}">${p.cta}</a>
  </article>`).join('')}
</div>`;

export const faqList = (items) => `<div class="faq">${items.map(([q, a]) => `<details><summary><h3>${q}</h3></summary><p>${a}</p></details>`).join('')}</div>`;
export const faqSchema = (items) => ({ '@type': 'FAQPage', mainEntity: items.map(([q, a]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: strip(a) } })) });

export const cta = (h = 'Bring your next drawing set') => `<section class="band"><div class="wrap cta-band">
  <h2>${h}</h2>
  <p>Free to start. Nothing to install.</p>
  <a class="btn primary lg" href="${SIGNUP}">Open Survey free</a>
</div></section>`;

// ---------- Home ----------
const home = page({
  path: '/welcome',
  title: 'Survey: PDF markup and site surveys for construction drawings',
  desc: 'Mark up construction drawings with every tool free. Run site surveys on the plan and export the answers as a spreadsheet. Spaces and regions, count markers, teams. Computer, tablet and phone.',
  schema: [SOFTWARE, { '@type': 'WebSite', '@id': ORIGIN + '/#site', name: 'Survey', url: ORIGIN + '/welcome', publisher: { '@id': ORIGIN + '/#org' } }],
  body: `<section class="hero"><div class="wrap hero-grid">
  <div class="hero-copy">
    <p class="kicker">PDF markup for construction drawings</p>
    <h1>Mark up the plans. Survey the site. Export the data.</h1>
    <p class="lede">Every markup tool is free, including the ones other apps charge for. Then Survey does what no other PDF app does: site surveys on the plan that export as a spreadsheet, and spaces that let you work on one part of a sheet at a time.</p>
    <div class="cta"><a class="btn primary lg" href="${SIGNUP}">Open Survey free</a><a class="btn ghost lg" href="#surveys">See how surveys work</a></div>
    <p class="fine">No card. No install. Computer, tablet and phone.</p>
  </div>
  <div class="hero-stage">
    <div class="frame"><img src="/welcome/hero.webp" srcset="/welcome/hero-800.webp 800w, /welcome/hero.webp 1600w" sizes="(max-width: 980px) 92vw, 760px" width="1600" height="1000" fetchpriority="high" decoding="async" alt="Survey with a marked-up floor plan: a revision cloud around the meeting room, numbered count markers on the desks, an arrow to a fire door and a callout that says Move counter to east wall" /></div>
  </div>
</div></section>

<section class="who"><div class="wrap"><p>Made for <span>electricians</span>, <span>surveyors</span>, <span>inspectors</span>, <span>general contractors</span>, <span>estimators</span> and <span>architects</span>.</p></div></section>

<section class="lead-in" id="only"><div class="wrap">
  <div class="head"><h2>What no other PDF app does</h2><p>Three things we built because site work needs them.</p></div>
</div></section>
${ONLY.map(only).join('\n')}

<section class="sec" id="tools"><div class="wrap">
  <div class="head"><h2>Every markup tool, free</h2><p>Pen, partial eraser, polygon, cloud, callout, count, measure, OCR and page tools. Drawboard PDF charges for half of these. Survey does not.</p></div>
  ${toolGrid()}
  <p class="more-link"><a href="/features">All features</a></p>
</div></section>

<section class="sec tight" id="compare"><div class="wrap">
  <div class="head"><h2>Side by side with Drawboard PDF</h2><p>The same markup tools, free in Survey. Then the things only Survey has.</p></div>
  ${vsTable()}
  <p class="more-link"><a href="/compare/drawboard">The full comparison</a></p>
</div></section>

<section class="sec"><div class="wrap"><div class="panel cool split-grid">
  <div>
    <h2>Work on the same drawings as a team</h2>
    <p>Invite people as viewers or editors. Everyone sees the same markups and the same survey answers, on whatever device they have, and Pro teams edit together live.</p>
    <ul class="ticks"><li>Viewers read, editors mark up</li><li>Survey answers from every walk land in one spreadsheet</li><li>Live editing together on Pro</li></ul>
    <a class="btn ghost" href="/pricing">See the plans</a>
  </div>
  <figure class="shot"><img src="/welcome/access.webp" srcset="/welcome/access-600.webp 600w, /welcome/access.webp 1200w" sizes="(max-width: 980px) 92vw, 560px" width="1200" height="836" loading="lazy" decoding="async" alt="The Document Access dialog: an owner, two editors and a viewer on A-201 Level 2 Floor Plan.pdf, with an Invite button" /></figure>
</div></div></section>

<section class="sec tight"><div class="wrap">
  <div class="head"><h2>Computer, tablet and phone</h2><p>Survey runs in the browser, so there is nothing to install. The same project and the same markups follow you from the desk to the site. On a tablet, the pen draws and your fingers move the sheet.</p></div>
  ${devs()}
  <p class="more-link"><a href="/devices">How it works on each device</a></p>
</div></section>

<section class="sec"><div class="wrap">
  <div class="head"><h2>How much does Survey cost?</h2><p>Every markup tool is free, with no time limit. Pro adds surveys, spaces, templates and sharing for $9.99 a month.</p></div>
  ${plans()}
  <p class="more-link"><a href="/pricing">Compare plans</a></p>
</div></section>

<section class="sec tight"><div class="wrap">
  <div class="head"><h2>${PDF_TOOLS.length} free PDF tools, no sign-up</h2><p>Merge, split, compress, OCR, compare, sign and convert in your browser. Your files never leave your device.</p></div>
  <div class="grid6">${FREE_TOOL_PICKS.map(([id, h, p]) => `<div><h3><a href="/tools/${id}">${h}</a></h3><p>${p}</p></div>`).join('')}</div>
  <p class="more-link"><a href="/tools">All free PDF tools</a></p>
</div></section>

<section class="sec"><div class="wrap custom">
  <h2>Need Survey to fit how your company works?</h2>
  <p>We build custom data exports, company survey templates and team roles. Tell us what your team does today and we will set it up.</p>
  <a class="btn ghost" href="${MAIL}">Email us</a>
</div></section>
${cta()}`,
});

// ---------- Features ----------
const features = page({
  path: '/features', crumb: 'Features',
  title: 'Features: site surveys, data export, spaces, every markup tool free | Survey',
  desc: 'Site surveys on the plan that export as a spreadsheet, spaces and regions, templates, count markers, pen, partial eraser, polygon, callouts, measuring and OCR. All markup tools free.',
  schema: [SOFTWARE],
  body: `<section class="page-head"><div class="wrap">
  <h1>Everything you do on a drawing set, in one app</h1>
  <p class="lede">Three things no other PDF app does, then every markup tool you would expect, free.</p>
  <nav class="jump" aria-label="On this page">${[...ONLY.map((f) => [f.id, f.name]), ['tools', 'Every markup tool'], ['count', 'Count markers'], ['compare', 'Survey vs Drawboard PDF'], ['free-pdf-tools', 'Free PDF tools']].map(([id, n]) => `<a href="#${id}">${n}</a>`).join('')}</nav>
</div></section>
${ONLY.map(only).join('\n')}
<section class="sec" id="tools"><div class="wrap">
  <div class="head"><h2>Every markup tool, free</h2><p>Nothing here is behind a paywall. Pick a tool, mark the sheet, keep going.</p></div>
  ${toolGrid()}
</div></section>
${TOOLS.map((t, i) => `<section class="sec feat${i % 2 ? ' flip' : ''}" id="${t.id}"><div class="wrap feat-grid">
  <div><h2>${t.name}</h2><p class="lead">${t.lead}</p><p>${t.body}</p></div>
  ${shot(t)}
</div></section>`).join('\n')}
<section class="sec" id="compare"><div class="wrap">
  <div class="head"><h2>Survey vs Drawboard PDF</h2><p>The same tools, free in Survey. Then the things only Survey has.</p></div>
  ${vsTable()}
  <p class="more-link"><a href="/compare/drawboard">The full comparison</a></p>
</div></section>
<section class="sec tight"><div class="wrap">
  <div class="head"><h2>And the rest</h2></div>
  <div class="grid6">${MORE.map(([h, p]) => `<div><h3>${h}</h3><p>${p}</p></div>`).join('')}</div>
</div></section>
<section class="sec" id="free-pdf-tools"><div class="wrap">
  <div class="head"><h2>Free PDF tools, no sign-up</h2><p>${PDF_TOOLS.length} tools that run in your browser. Your files never leave your device.</p></div>
  <div class="grid6">${FREE_TOOL_PICKS.map(([id, h, p]) => `<div><h3><a href="/tools/${id}">${h}</a></h3><p>${p}</p></div>`).join('')}</div>
  <p class="more-link"><a href="/tools">All free PDF tools</a></p>
</div></section>
${cta('Try every tool on your own drawings')}`,
});

// ---------- Devices ----------
const devices = page({
  path: '/devices', crumb: 'Devices',
  title: 'Survey on computer, tablet and phone | Survey',
  desc: 'Survey runs in the browser on a computer, tablet or phone. Your projects and markups sync to every device.',
  body: `<section class="page-head"><div class="wrap">
  <h1>One project on every screen</h1>
  <p class="lede">Survey runs in your browser, so there is nothing to install. Sign in on any device and your drawings and markups are there.</p>
</div></section>
<section class="sec"><div class="wrap dev-rows">
  <article><h2>On a computer</h2><p>Use Chrome, Edge or Safari on Mac or Windows. A mouse or trackpad draws, the scroll wheel zooms, and keyboard shortcuts switch tools.</p></article>
  <article><h2>On a tablet</h2><p>Apple Pencil or any stylus draws, and your fingers pan and zoom, so you never mark a sheet by mistake. Add Survey to your home screen to open it like an app.</p></article>
  <article><h2>On your phone</h2><p>Check a sheet, drop a count marker or read a note on site. The tools fit a small screen.</p></article>
</div></section>
<section class="sec tight"><div class="wrap">${devs()}</div></section>
<section class="sec"><div class="wrap head">
  <h2>Are there apps to download?</h2>
  <p>Not yet. Phone, tablet and desktop apps are on the way. Until then the browser version does everything.</p>
</div></section>
${cta()}`,
});

// ---------- Pricing ----------
const ROWS = [
  ['Projects', '1', 'Unlimited', 'Unlimited'],
  ['Documents', '5', 'Unlimited', 'Unlimited'],
  ['Storage', '100MB', '10GB', '1TB'],
  ['Every markup tool: pen, eraser, shapes, callouts, measure, OCR', 'Yes', 'Yes', 'Yes'],
  ['Count markers with totals', 'Yes', 'Yes', 'Yes'],
  ['Site surveys with data export', '', 'Yes', 'Yes'],
  ['Spaces and regions', '', 'Yes', 'Yes'],
  ['Survey templates', '', 'Yes', 'Yes'],
  ['Share with viewers and editors', '', 'Yes', 'Yes'],
  ['OneDrive', '', 'Yes', 'Yes'],
  ['Live editing together', '', 'Yes', 'Yes'],
  ['Priority support', '', '', 'Yes'],
  ['Company admin console and single sign-on', '', '', 'Coming soon'],
];
const PRICE_FAQ = [FAQ[4], FAQ[5], FAQ[6]];
const pricing = page({
  path: '/pricing', crumb: 'Pricing',
  title: 'Pricing: Free, Pro $9.99 and Enterprise | Survey',
  desc: 'Survey is free for 1 project and 5 documents. Pro is $9.99 a month or $99 a year. Enterprise is $20 per user a month, minimum 3 users.',
  schema: [SOFTWARE, faqSchema(PRICE_FAQ)],
  body: `<section class="page-head"><div class="wrap">
  <h1>Start free. Pay when you need more.</h1>
  <p class="lede">Every markup tool is free, with no time limit. Pro adds site surveys, spaces, templates and sharing for $9.99 a month or $99 a year. Enterprise costs $20 per user a month for teams of 3 or more.</p>
</div></section>
<section class="sec tight"><div class="wrap">${plans()}</div></section>
<section class="sec"><div class="wrap">
  <h2 class="center">Compare plans</h2>
  <div class="tbl"><table>
    <thead><tr><th scope="col"><span class="sr">Feature</span></th><th scope="col">Free</th><th scope="col">Pro</th><th scope="col">Enterprise</th></tr></thead>
    <tbody>${ROWS.map(([f, ...v]) => `<tr><th scope="row">${f}</th>${v.map((x) => `<td>${x === 'Yes' ? '<span class="yes" aria-label="Included">✓</span>' : x || '<span class="no" aria-label="Not included">–</span>'}</td>`).join('')}</tr>`).join('')}</tbody>
  </table></div>
</div></section>
<section class="sec"><div class="wrap narrow"><h2>Pricing questions</h2>${faqList(PRICE_FAQ)}</div></section>
${cta()}`,
});

// ---------- FAQ ----------
const faq = page({
  path: '/faq', crumb: 'FAQ',
  title: 'Questions about Survey | Survey',
  desc: 'Answers about Survey: what it is, devices, Apple Pencil, count markers, pricing, teams, where files are kept and custom builds.',
  schema: [faqSchema(FAQ)],
  body: `<section class="page-head"><div class="wrap narrow">
  <h1>Questions and answers</h1>
  <p class="lede">Can't find yours? <a href="${MAIL}">Email us</a> and we will reply.</p>
</div></section>
<section class="sec tight"><div class="wrap narrow">${faqList(FAQ)}</div></section>
${cta()}`,
});

// Status: read in the visitor's browser from the live release marker and the
// production monitor's GitHub issues (.github/workflows/monitor.yml opens an
// `alert` issue when the site is down or a deploy fails, and closes it when
// fixed), so it needs no status service account.
const STATUS_SCRIPT = `<script>
(function(){
  var REPO='IsaiahCalvo/Survey';
  var KINDS=[[/is down/i,'Outage','Survey could not be reached.'],[/deploy|smoke/i,'Update problem','An update or a live check failed.']];
  function kind(t){for(var i=0;i<KINDS.length;i++)if(KINDS[i][0].test(t))return KINDS[i];return [null,'Problem',''];}
  function when(s){var d=new Date(s);return d.toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'});}
  function el(tag,cls,text){var e=document.createElement(tag);if(cls)e.className=cls;if(text!=null)e.textContent=text;return e;}
  var now=document.getElementById('st-now'),ver=document.getElementById('st-ver'),list=document.getElementById('st-list');
  var live=fetch('/release.json?t='+Date.now(),{cache:'no-store'}).then(function(r){return r.ok?r.json():null}).then(function(j){
    if(!j||!j.commit)return false;
    ver.textContent='Live version '+String(j.commit).slice(0,7)+(j.builtAt?', built '+when(j.builtAt):'')+'.';
    return true;
  }).catch(function(){return false});
  // GitHub allows 60 unsigned requests an hour per visitor, so keep the last
  // answer for a few minutes and fall back to it when GitHub says no.
  var KEY='survey-status-v1',cached=null;
  try{cached=JSON.parse(localStorage.getItem(KEY)||'null')}catch(e){}
  var fresh=cached&&Date.now()-cached.t<180000,stale=false;
  (fresh?Promise.resolve(cached.items):fetch('https://api.github.com/repos/'+REPO+'/issues?labels=alert&state=all&per_page=15',{headers:{Accept:'application/vnd.github+json'}})
    .then(function(r){if(!r.ok)throw new Error(r.status);return r.json()}).then(function(items){
      items=items.filter(function(i){return !i.pull_request}).map(function(i){return {title:i.title,state:i.state,created_at:i.created_at,closed_at:i.closed_at}});
      try{localStorage.setItem(KEY,JSON.stringify({t:Date.now(),items:items}))}catch(e){}
      return items;
    },function(err){if(!cached)throw err;stale=true;return cached.items;}))
    .then(function(items){
      var open=items.filter(function(i){return i.state==='open'});
      var down=open.some(function(i){return kind(i.title)[1]==='Outage'});
      if(stale){
        // An old answer must not pass for the current state.
        now.className='st-now';
        now.textContent='Could not check status right now. Below is what we saw at '+when(cached.t)+'.';
      }else{
        now.className='st-now '+(down?'bad':open.length?'warn':'ok');
        now.textContent=down?'Survey is having problems. We are on it.':open.length?'Some parts of Survey may not be working. We are looking into it.':'All systems working.';
      }
      list.textContent='';
      if(!items.length){list.appendChild(el('li','fine','No problems recorded.'));return;}
      items.forEach(function(i){
        var k=kind(i.title),li=el('li');
        li.appendChild(el('strong',null,k[1]));
        li.appendChild(el('span',null,' '+(k[2]||i.title)));
        li.appendChild(el('span','fine',' Started '+when(i.created_at)+(i.closed_at?'. Fixed '+when(i.closed_at)+'.':'. Still open.')));
        list.appendChild(li);
      });
    }).catch(function(){
      live.then(function(up){
        now.className='st-now';
        now.textContent=up?'Survey is up. Incident history could not load right now.':'Could not check status right now. Try again in a minute.';
      });
    });
})();
</script>`;
const status = page({
  path: '/status', crumb: 'Status',
  title: 'Status | Survey',
  desc: 'Whether Survey is up right now, and recent problems.',
  body: `<style>.st-now{font:600 20px/1.3 var(--body);padding:18px 20px;border:1px solid var(--rule);border-radius:12px;background:var(--sheet)}.st-now.ok{border-color:#2e8b57}.st-now.warn{border-color:#c98a00}.st-now.bad{border-color:var(--red)}.st-list{list-style:none;padding:0;margin:0}.st-list li{padding:12px 0;border-top:1px solid var(--rule);display:flex;flex-wrap:wrap;gap:6px}</style>
<section class="page-head"><div class="wrap narrow"><h1>Survey status</h1><p class="lede">We check Survey every 15 minutes. If something breaks, it shows here.</p></div></section>
<section class="sec tight"><div class="wrap narrow"><p class="st-now" id="st-now" role="status">Checking…</p><p class="fine" id="st-ver"></p>
<h2>Recent problems</h2><ul class="st-list" id="st-list"><li class="fine">Loading…</li></ul>
<p class="fine">Something wrong that isn't listed? <a href="${MAIL}">Tell us</a>.</p></div></section>`,
  scripts: STATUS_SCRIPT,
});

const longDate = (d) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const whatsNew = page({
  path: '/whats-new', crumb: "What's new",
  title: "What's new | Survey",
  desc: 'Recent changes to Survey, newest first.',
  body: `<section class="page-head"><div class="wrap narrow"><h1>What's new</h1><p class="lede">Changes to Survey, newest first. Reload the app to get the latest.</p></div></section>
<section class="sec tight"><div class="wrap narrow">${WHATS_NEW.map((day) => `<h2><time datetime="${day.date}">${longDate(day.date)}</time></h2><ul class="ticks">${day.items.map((item) => `<li>${esc(item)}</li>`).join('')}</ul>`).join('\n')}
<p class="fine">Something not working? <a href="/status">Check the status page</a> or <a href="${MAIL}">tell us</a>.</p></div></section>`,
});

// ---------- Use Survey with your AI ----------
const MCP_URL = 'https://cvamwtpsuvxvjdnotbeg.supabase.co/functions/v1/survey-mcp';
const AI_FAQ = [
  ['Which AI tools can use Survey?',
    `Any that speak the open connector standard (MCP). Claude and ChatGPT both let you add a custom connector, which reads your drawings. It acts for you, with your plan and your role on each drawing.`],
  ['Does the AI get its own account?',
    `No. An agent always acts for a signed-in person and never has an account of its own. It has exactly your rights: the same role on each drawing (a viewer's agent can only read) and the same plan.`],
  ['Can Claude or ChatGPT change my drawings?',
    `No. The Claude or ChatGPT connector only reads: it finds your projects and drawings and reads the survey items on a plan.`],
  ['What can no agent ever do?',
    `Pay, change your plan, delete your account, use your linked sign-ins, let other agents in, or change your email or password. Those stay with you.`],
  ['How do I stop an agent?',
    `A Claude or ChatGPT connector, or any agent you let in with a sign-in, you remove at <a href="${ORIGIN}/agent-link">surveytool.app/agent-link</a>; removal is instant.`],
  ['Where do my files go?',
    `Nowhere new. The connector reads the same Survey account you already use.`],
];
const AI_STEPS = [
  ['Open your AI tool\'s connector settings', 'In Claude: Settings, then Connectors, then Add custom connector. ChatGPT has the same kind of setting.'],
  ['Paste Survey\'s address', `Use <code>${MCP_URL}</code> as the server URL.`],
  ['Sign in to Survey', 'Your AI tool sends you to Survey to sign in and press Allow. Make a free account there first if you have none. The connector now reads your drawings as you.'],
  ['Remove it whenever you like', `Manage and remove connectors and other signed-in agents at <a href="${ORIGIN}/agent-link">surveytool.app/agent-link</a>.`],
];
const useWithAi = page({
  path: '/use-with-ai', crumb: 'Use with AI',
  title: 'Use Survey with your AI | Survey',
  desc: 'Let Claude or ChatGPT read your drawings as you, with your plan and your role. What it can and cannot do, and how to turn it off.',
  schema: [
    { '@type': 'HowTo', name: 'How to connect Claude or ChatGPT to Survey', step: AI_STEPS.map(([n, t], i) => ({ '@type': 'HowToStep', position: i + 1, name: n, text: strip(t) })) },
    faqSchema(AI_FAQ),
  ],
  body: `<section class="page-head"><div class="wrap narrow">
  <h1>Use Survey with your AI</h1>
  <p class="lede">Let Claude or ChatGPT read your drawings for you. Add Survey as a custom connector: it signs you in to Survey once, then finds your projects and drawings and reads the survey items on a plan, as you, with your plan and your role on each drawing. It is read-only: it does not change anything.</p>
</div></section>

<section class="sec tight"><div class="wrap narrow">
  <h2>Connect Claude or ChatGPT</h2>
  <ol class="steps">${AI_STEPS.map(([n, t]) => `<li><h3>${n}</h3><p>${t}</p></li>`).join('')}</ol>
</div></section>

<section class="sec tight"><div class="wrap narrow">
  <h2>What the connector can do</h2>
  <p class="fine">Read-only.</p>
  <ul class="ticks">
    <li>See the projects and drawings you can see</li>
    <li>Read the survey items on a plan</li>
  </ul>
</div></section>

<section class="sec tight"><div class="wrap narrow">
  <h2>What no agent can ever do</h2>
  <ul class="ticks">
    <li>Pay or change your plan</li>
    <li>Delete your account</li>
    <li>Use your linked sign-ins</li>
    <li>Let other agents in</li>
    <li>Change your email or password</li>
  </ul>
</div></section>

<section class="sec tight"><div class="wrap narrow">
  <h2>You are always in charge</h2>
  <p>An agent only ever has your rights. If you can only view a drawing, so can its agent.</p>
  <p>To stop an agent: remove a Claude or ChatGPT connector, or any agent you let in with a sign-in, at <a href="${ORIGIN}/agent-link">surveytool.app/agent-link</a> — removal takes effect at once.</p>
</div></section>

<section class="sec tight"><div class="wrap narrow"><h2>Questions</h2>${faqList(AI_FAQ)}</div></section>
${cta('Connect your AI and try it on a drawing')}`,
});

const notFound = page({
  path: '/404', title: 'Page not found | Survey', desc: 'This page does not exist.',
  body: `<section class="page-head"><div class="wrap narrow"><h1>We can't find that page</h1><p class="lede">The link may be old. Try the <a href="/welcome">home page</a> or <a href="${APP}">open Survey</a>.</p></div></section>`,
}).replace('<link rel="canonical" href="https://surveytool.app/404" />', '<meta name="robots" content="noindex" />');

const useIndex = page({
  path: '/use-cases', crumb: 'Use cases',
  title: 'Use cases: field surveys, punch lists and as-builts | Survey',
  desc: 'How teams use Survey on construction drawings: field surveys, punch lists and as-built markups.',
  body: `<section class="page-head"><div class="wrap"><h1>What do people use Survey for?</h1><p class="lede">Most teams use Survey for one of three jobs on the drawing set.</p></div></section>
<section class="sec tight"><div class="wrap dev-rows">${USES.map((u) => `<article><h2><a href="/use-cases/${u.slug}">${u.name}</a></h2><p>${u.desc}</p></article>`).join('')}</div></section>
${cta()}`,
});
const usePages = Object.fromEntries(USES.map((u) => [`use-cases/${u.slug}/index.html`, page({
  path: `/use-cases/${u.slug}`, crumb: u.name,
  title: `${u.title} | Survey`, desc: u.desc,
  schema: [{ '@type': 'HowTo', name: `How to do ${u.name.toLowerCase()} with Survey`, step: u.steps.map(([n, t], i) => ({ '@type': 'HowToStep', position: i + 1, name: n, text: t })) }],
  body: `<section class="page-head"><div class="wrap"><p class="kicker"><a href="/use-cases">Use cases</a></p><h1>${u.title}</h1><p class="lede">${u.lead}</p></div></section>
<section class="sec tight"><div class="wrap"><h2>How does it work?</h2><ol class="steps">${u.steps.map(([n, t]) => `<li><h3>${n}</h3><p>${t}</p></li>`).join('')}</ol></div></section>
<section class="sec tight"><div class="wrap feat-grid"><div><h2>The tools you'll use</h2><p>Count markers, the pen and highlighter, clouds and arrows, and text callouts. Every markup tool is free. Site surveys with data export are on Pro.</p><a class="btn ghost" href="/features">See every tool</a></div>${shot(TOOLS[0])}</div></section>
${cta()}`,
})]));
const comparePages = Object.fromEntries(COMPARE.map((c) => [`compare/${c.slug}/index.html`, page({
  path: `/compare/${c.slug}`, crumb: `Survey vs ${c.them}`,
  title: `Survey vs ${c.them}: an honest comparison | Survey`, desc: c.desc,
  body: `<section class="page-head"><div class="wrap narrow"><h1>Survey vs ${c.them}</h1><p class="lede">${c.intro}</p></div></section>
<section class="sec tight"><div class="wrap vs">
  <article><h2>Where ${c.them} is stronger</h2><ul class="ticks">${c.themBest.map((x) => `<li>${x}</li>`).join('')}</ul></article>
  <article><h2>Where Survey is stronger</h2><ul class="ticks">${c.usBest.map((x) => `<li>${x}</li>`).join('')}</ul></article>
</div></section>
${c.table ? `<section class="sec tight"><div class="wrap"><h2 class="center">Tool by tool</h2>${vsTable()}</div></section>` : ''}
<section class="sec tight"><div class="wrap narrow"><h2>Which one should you pick?</h2><p>${c.pick}</p><p class="fine">We make Survey, so read this with that in mind. Check ${c.them}'s own site for its current features and prices.</p></div></section>
${cta('Try Survey free on your own drawings')}`,
})]));

// Importing this file (build-free-tools.mjs does, for the layout) must not
// rewrite the pages, so the writes only run when it is the script itself.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = { ...usePages, ...comparePages, 'use-cases/index.html': useIndex, '404.html': notFound, 'welcome/index.html': home, 'features/index.html': features, 'devices/index.html': devices, 'pricing/index.html': pricing, 'faq/index.html': faq, 'status/index.html': status, 'whats-new/index.html': whatsNew, 'use-with-ai/index.html': useWithAi };
  for (const [p, html] of Object.entries(out)) {
    const f = join(root, p);
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, html);
  }

  const urls = ['/welcome', '/features', '/devices', '/pricing', '/faq', '/use-cases', '/use-with-ai', '/status', '/whats-new', ...USES.map((u) => '/use-cases/' + u.slug), ...COMPARE.map((c) => '/compare/' + c.slug), ...TOOL_PATHS, '/privacy.html', '/terms.html'];
  writeFileSync(join(root, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${ORIGIN}${u}</loc><lastmod>${TODAY}</lastmod></url>`).join('\n')}
</urlset>
`);

  writeFileSync(join(root, 'llms.txt'), `# Survey

> Survey is a PDF markup app for construction and engineering drawings. It runs in the browser on computers, tablets and phones at ${ORIGIN}.

Every markup tool is free: pen with pressure, highlighter, partial eraser, rectangle, ellipse, polygon, cloud, polyline, line, arrow, count markers with running totals, measuring, text, callouts, text markup, OCR and page tools (Drawboard PDF charges for callouts, measuring, OCR, merge and split). Three things no other PDF app does: site surveys on the plan (checklist templates, markers with Y/N/N/A answers, notes, photos and voice notes) that export as a spreadsheet (.xlsx, one sheet per category plus a summary, opens in Excel, Google Sheets, Numbers or LibreOffice) and sync back from a linked Microsoft 365 workbook; spaces and regions (a named set of pages with a region on each, everything outside dims, markups inside belong to the space); and survey templates reused across projects. Free plan: 1 project, 5 documents, 100MB. Pro: $9.99 a month or $99 a year, unlimited projects and documents, 10GB, site surveys with data export, spaces and regions, templates, sharing with viewers and editors, live editing together, OneDrive. Enterprise: $20 per user a month, minimum 3 users, everything in Pro for every user, 1TB, priority support; a company admin console and single sign-on are coming soon.

## Pages

- [Home](${ORIGIN}/welcome): what Survey is and who it is for
- [Features](${ORIGIN}/features): site surveys with data export, spaces and regions, templates, every markup tool free, count markers, Survey vs Drawboard PDF
- [Devices](${ORIGIN}/devices): desktop, tablet and phone
- [Pricing](${ORIGIN}/pricing): Free, Pro and Enterprise plans
- [FAQ](${ORIGIN}/faq): common questions
- [Use Survey with your AI](${ORIGIN}/use-with-ai): connect Claude or ChatGPT to read your drawings as you, with your plan and role (read-only); what it can and cannot do, and how to turn it off. MCP server: ${MCP_URL}
${USES.map((u) => `- [${u.name}](${ORIGIN}/use-cases/${u.slug}): ${u.desc}`).join('\n')}
${COMPARE.map((c) => `- [Survey vs ${c.them}](${ORIGIN}/compare/${c.slug}): ${c.desc}`).join('\n')}
- [Free PDF tools](${ORIGIN}/tools): ${PDF_TOOLS.length} tools to merge, split, compress, OCR scans, compare two PDFs, sign, lock and convert PDFs in the browser, several files at once; no sign-in, files never leave the device
${PDF_TOOLS.map((t) => `- [${t.name}](${ORIGIN}/tools/${t.id}): ${t.short}`).join('\n')}

## Optional

- [Privacy policy](${ORIGIN}/privacy.html)
- [Terms of service](${ORIGIN}/terms.html)
`);
  console.log('built', Object.keys(out).length, 'pages');
}
