// Builds the static marketing pages (welcome, features, pricing, devices, faq)
// into public/. Run `node scripts/build-marketing.mjs` after editing copy here;
// the output HTML is committed so Vite just copies it to dist.
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TOOLS as PDF_TOOLS, TOOL_PATHS } from './free-tools-catalog.mjs';
import { WHATS_NEW } from './whats-new.mjs';

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
    desc: 'Walk a site with the plans on your iPad, count what is there, tag what needs work and send the totals to Excel.',
    lead: 'Take the drawing set to site on an iPad or phone, mark what you find and count it as you go.',
    steps: [['Load the plans', 'Upload the PDF set once. It is on every device you sign in on.'], ['Walk and tap', 'Make a category for each thing you check, like outlets or fire doors, and tap each one on the plan. Survey numbers them and keeps the totals.'], ['Note what you see', 'Add a callout or a cloud where something is wrong, right on the sheet.'], ['Send the results', 'Export the counts to Excel for the report or the estimate.']] },
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
    usBest: ['Runs in any browser, nothing to install', 'A free plan, and Pro at $9.99 a month', 'Tap-to-count markers with running totals and Excel export', 'Made to work with Apple Pencil and touch'],
    pick: 'Pick Bluebeam if you need full takeoff and measurement, or your company already runs on it. Pick Survey if you want quick markup and counting on any device without installing anything or paying much.' },
  { slug: 'drawboard', them: 'Drawboard Projects',
    desc: 'An honest look at Survey and Drawboard Projects for marking up construction drawings: what each does best and who each one fits.',
    intro: 'Drawboard Projects is a markup and team review app for architecture, engineering and construction, built around shared projects and issue tracking. Survey focuses on markup and counting, with a free plan.',
    themBest: ['Team review built around projects and issues', 'Polished pen experience on Windows and iPad', 'Made for design teams reviewing drawing sets together'],
    usBest: ['Runs in any browser, nothing to install', 'A free plan, and Pro at $9.99 a month', 'Tap-to-count markers with running totals and Excel export', 'Custom builds for your company: Excel formats, templates, symbol sets'],
    pick: 'Pick Drawboard if your design team wants structured review and issue tracking. Pick Survey if counting on the plan and a low price matter more to you.' },
];

export const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const strip = (s) => s.replace(/<[^>]+>/g, '');

// One list feeds the visible FAQ and the FAQPage schema, so they never drift.
const FAQ = [
  ['What is Survey?', 'Survey is a PDF markup app for construction and engineering drawings. You open a drawing set in your browser, mark it up with pens, shapes and count markers, and send the totals to Excel.'],
  ['Do I need to install anything?', 'No. Survey runs in Chrome, Edge and Safari on Mac, Windows, iPad, Android tablets and phones. Open surveytool.app and sign in.'],
  ['Does it work on iPad with Apple Pencil?', 'Yes. The Pencil draws and your fingers pan and zoom, so you never mark the page by mistake.'],
  ['How do count markers work?', 'Pick a category, tap each item on the plan, and Survey numbers the markers and keeps a running total for every category. Export the totals to Excel when you are done.'],
  ['Is Survey free?', 'Yes. The Free plan gives you 1 project, 5 documents and 100MB of storage with no card needed. Pro is $9.99 a month or $99 a year for unlimited projects and documents, 10GB of storage and every survey tool.'],
  ['Can I cancel Pro any time?', 'Yes. Cancel from your account settings and keep Pro until the end of the period you paid for.'],
  ['Can my team work on the same drawings?', 'Yes. Invite people as viewers or editors. Enterprise adds live editing together, admin tools and single sign-on for $20 per user a month, with a minimum of 3 users.'],
  ['Where are my files kept?', 'Your markups save to the cloud so they sync to every device you sign in on. Read the <a href="/privacy.html">privacy policy</a> for the details.'],
  ['Can Survey be set up for my company?', 'Yes. We build custom Excel exports, company markup templates, symbol sets and team roles. <a href="' + MAIL + '">Email us</a> with how your team works.'],
];

const TOOLS = [
  { id: 'count', name: 'Count markers', img: 'app-counts.webp', w: 680, h: 440, alt: 'Numbered count markers on desks in a floor plan',
    lead: 'Tap each item on the plan and Survey numbers it and keeps the total.',
    body: 'Make a category for each thing you count: desks, outlets, sprinklers, doors. Every tap adds a numbered marker, and the totals for each category stay in view. Send them to Excel in one step.' },
  { id: 'pen', name: 'Pen and highlighter', img: 'app-pen.webp', w: 850, h: 400, alt: 'A highlighted room name and a pen line on a plan',
    lead: 'Write on drawings the way you would on paper.',
    body: 'Smooth ink that follows Apple Pencil, a mouse or a finger. The highlighter sits behind the linework so the drawing stays readable. The eraser takes off just what you rub out.' },
  { id: 'shapes', name: 'Shapes, clouds and arrows', img: 'app-shapes.webp', w: 880, h: 400, alt: 'A box drawn around a conference room',
    lead: 'Box it, cloud it, point at it.',
    body: 'Rectangles, ellipses, revision clouds, lines, polylines and arrows, each with its own color and line weight. Select one to move it, resize it or change its style.' },
  { id: 'plan', name: 'The whole drawing set', img: 'app-markup.webp', w: 1600, h: 1000, alt: 'A full floor plan with markups in Survey', srcset: '/welcome/app-markup-800.webp 800w, /welcome/app-markup.webp 1600w',
    lead: 'Big sheets stay sharp and quick at any zoom.',
    body: 'Pinch or scroll to zoom from the whole sheet down to a single dimension. Thumbnails, bookmarks and search help you find the sheet you need in a large set.' },
];

const MORE = [
  ['Text and callouts', 'Notes that point at the exact spot they are about.'],
  ['Templates and regions', 'Reuse the same markup set on every sheet. Pro.'],
  ['Excel export', 'Counts and survey data straight into a spreadsheet. Pro.'],
  ['OneDrive', 'Open drawings from your company OneDrive. Pro.'],
  ['Undo history', 'Step back through every change on a sheet.'],
  ['Share with your team', 'Invite viewers and editors to a project.'],
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
  { name: 'Free', price: '$0', per: '/month', note: 'For trying Survey on one project', cta: 'Start free', items: ['1 project', '5 documents', '100MB storage', 'Markup and count tools', 'Works on every device'] },
  { name: 'Pro', price: '$9.99', per: '/month', note: 'or $99 a year, which saves $20', cta: 'Start free, upgrade in the app', best: true, items: ['Unlimited projects', 'Unlimited documents', '10GB storage', 'Survey tools, templates and regions', 'Excel export', 'OneDrive'] },
  { name: 'Enterprise', price: '$20', per: '/user/month', note: 'Minimum 3 users', cta: 'Email us', href: MAIL, items: ['Everything in Pro', 'Live editing together', '1TB storage', 'Admin tools and single sign-on', 'Custom builds for your company'] },
];

const ICON_SUN = '<svg class="i-sun" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><circle cx="12" cy="12" r="4.2"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/></svg>';
const ICON_MOON = '<svg class="i-moon" viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>';

export const ORG = { '@type': 'Organization', '@id': ORIGIN + '/#org', name: 'Survey', url: ORIGIN + '/welcome', logo: ORIGIN + '/logo512.png', email: 'isaiahcalvo123@gmail.com' };
const SOFTWARE = {
  '@type': 'SoftwareApplication', '@id': ORIGIN + '/#app', name: 'Survey', url: ORIGIN + '/',
  applicationCategory: 'BusinessApplication', operatingSystem: 'Web browser, macOS, Windows, iPadOS, Android',
  description: 'PDF markup and counting app for construction and engineering drawings.',
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
<meta name="theme-color" content="#ffffff" />
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
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:opsz,wght@12..96,500;12..96,700&family=Public+Sans:wght@400;500;600&family=JetBrains+Mono:wght@500&display=swap" media="print" onload="this.media='all'" />
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
    <button class="theme" type="button" aria-label="Dark theme" aria-pressed="false">${ICON_SUN}${ICON_MOON}</button>
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
    <div><a class="brand" href="/welcome"><img src="/logo192.png" alt="" width="28" height="28" />Survey</a><p>PDF markup and counting for construction and engineering drawings.</p></div>
    <div><h2 class="fh">Product</h2><a href="/features">Features</a><a href="/devices">Devices</a><a href="/pricing">Pricing</a><a href="/faq">FAQ</a><a href="/whats-new">What's new</a></div>
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
  title: 'Survey: PDF markup and counting for construction drawings',
  desc: 'Mark up construction drawings, count items on the plan and send the totals to Excel. Works in your browser on desktop, iPad and phone. Free to start.',
  schema: [SOFTWARE, { '@type': 'WebSite', '@id': ORIGIN + '/#site', name: 'Survey', url: ORIGIN + '/welcome', publisher: { '@id': ORIGIN + '/#org' } }],
  body: `<section class="hero"><div class="wrap hero-grid">
  <div class="hero-copy">
    <p class="kicker">PDF markup for drawing sets</p>
    <h1>Mark up the plans. Count what's on them.</h1>
    <p class="lede">Survey is a PDF markup app for construction drawings. Redline sheets, tap to count fixtures and send the totals to Excel, on your desk, your iPad or your phone.</p>
    <div class="cta"><a class="btn primary lg" href="${SIGNUP}">Open Survey free</a><a class="btn ghost lg" href="/features">See the tools</a></div>
    <p class="fine">No card. No install. Works in Chrome, Edge and Safari.</p>
  </div>
  <div class="hero-stage">
    <div class="frame">
      <div class="bar" aria-hidden="true"><i></i><i></i><i></i><span>surveytool.app</span></div>
      <video autoplay muted loop playsinline preload="metadata" poster="/welcome/hero-poster.webp" width="1280" height="800" aria-label="Screen recording of Survey: count markers dropped on desks, then a highlighter and a box drawn on a floor plan">
        <source src="/welcome/hero.webm" type="video/webm" />
        <source src="/welcome/hero.mp4" type="video/mp4" />
      </video>
    </div>
    <svg class="cloud" viewBox="0 0 600 400" preserveAspectRatio="none" aria-hidden="true"><path pathLength="1" d="M60 70c10-40 70-40 80-10 10-36 80-36 90 0 12-34 84-34 92 0 14-32 82-30 90 4 30-12 66 18 52 52 34 10 34 64 4 76 18 34-14 70-48 58-8 36-76 40-90 8-16 32-84 32-96 0-16 30-82 28-90-6-34 10-66-24-50-58-34-14-30-70 6-74-10-34 26-62 60-50z"/></svg>
    <p class="tag t1"><b>10</b> desks counted</p>
    <p class="tag t2">Synced to iPad</p>
  </div>
</div></section>

<section class="who"><div class="wrap"><p>Made for <span>general contractors</span>, <span>estimators</span>, <span>electricians</span>, <span>surveyors</span>, <span>inspectors</span> and <span>architects</span>.</p></div></section>

<section class="sec"><div class="wrap">
  <div class="head">
    <h2>What can you do with Survey?</h2>
    <p>Everything you would do with a red pen and a printed set, plus the counting you would normally do by hand.</p>
  </div>
  <div class="trio">${TOOLS.slice(0, 3).map((t) => `
    <a class="card" href="/features#${t.id}">${shot(t)}<h3>${t.name}</h3><p>${t.lead}</p></a>`).join('')}
  </div>
  <p class="more-link"><a href="/features">All features</a></p>
</div></section>

<section class="sec split"><div class="wrap split-grid">
  <div>
    <h2>Does it work on my iPad and phone?</h2>
    <p>Yes. The same project and the same markups follow you from your desk to the job site. On iPad, Apple Pencil draws and your fingers move the sheet.</p>
    <ul class="ticks"><li>Mac and Windows in the browser</li><li>iPad and Android tablets</li><li>iPhone and Android phones</li></ul>
    <a class="btn ghost" href="/devices">How it works on each device</a>
  </div>
  <div class="devices"><figure class="dev-tab"><img src="/welcome/app-markup-800.webp" width="800" height="500" loading="lazy" decoding="async" alt="Survey on a tablet showing a marked-up floor plan" /></figure><figure class="dev-ph"><img src="/welcome/app-phone.webp" width="390" height="844" loading="lazy" decoding="async" alt="Survey on a phone showing a floor plan" /></figure></div>
</div></section>

<section class="sec"><div class="wrap">
  <div class="head"><h2>How much does Survey cost?</h2><p>Free for one project. Pro is $9.99 a month for everything else.</p></div>
  ${plans()}
  <p class="more-link"><a href="/pricing">Compare plans</a></p>
</div></section>

<section class="sec"><div class="wrap custom">
  <h2>Need Survey to fit how your company works?</h2>
  <p>We build custom Excel exports, company markup templates, symbol sets and team roles. Tell us what your team does today and we will set it up.</p>
  <a class="btn ghost" href="${MAIL}">Email us</a>
</div></section>
${cta()}`,
});

// ---------- Features ----------
const features = page({
  path: '/features', crumb: 'Features',
  title: 'Features: markup, count and export tools | Survey',
  desc: 'Count markers with running totals, pen and highlighter, shapes, clouds and arrows, text callouts, templates and Excel export for construction drawings.',
  schema: [SOFTWARE],
  body: `<section class="page-head"><div class="wrap">
  <h1>The tools you need on a drawing set</h1>
  <p class="lede">Survey gives you red-pen markup and counting in one place. Here is what each tool does.</p>
  <nav class="jump" aria-label="Tools on this page">${TOOLS.map((t) => `<a href="#${t.id}">${t.name}</a>`).join('')}</nav>
</div></section>
${TOOLS.map((t, i) => `<section class="sec feat${i % 2 ? ' flip' : ''}" id="${t.id}"><div class="wrap feat-grid">
  <div><h2>${t.name}</h2><p class="lead">${t.lead}</p><p>${t.body}</p></div>
  ${shot(t)}
</div></section>`).join('\n')}
<section class="sec"><div class="wrap">
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
  title: 'Survey on desktop, iPad and phone | Survey',
  desc: 'Survey runs in the browser on Mac, Windows, iPad, Android tablets and phones. Your projects and markups sync to every device.',
  body: `<section class="page-head"><div class="wrap">
  <h1>One project on every screen</h1>
  <p class="lede">Survey runs in your browser, so there is nothing to install. Sign in on any device and your drawings and markups are there.</p>
</div></section>
<section class="sec"><div class="wrap dev-rows">
  <article><h2>At your desk</h2><p>Use Chrome, Edge or Safari on Mac or Windows. A mouse or trackpad draws, the scroll wheel zooms, and keyboard shortcuts switch tools.</p></article>
  <article><h2>On an iPad or Android tablet</h2><p>Apple Pencil or a stylus draws, and your fingers pan and zoom, so you never mark a sheet by mistake. Add Survey to your home screen to open it like an app.</p></article>
  <article><h2>On your phone</h2><p>Check a sheet, drop a count marker or read a note on site. The tools fit a small screen.</p></article>
</div></section>
<section class="sec"><div class="wrap devices wide"><figure class="dev-tab"><img src="/welcome/app-markup.webp" srcset="/welcome/app-markup-800.webp 800w, /welcome/app-markup.webp 1600w" sizes="(max-width: 900px) 80vw, 760px" width="1600" height="1000" loading="lazy" decoding="async" alt="Survey on a tablet showing a marked-up floor plan" /></figure><figure class="dev-ph"><img src="/welcome/app-phone.webp" width="390" height="844" loading="lazy" decoding="async" alt="Survey on a phone showing a floor plan" /></figure></div></section>
<section class="sec"><div class="wrap head">
  <h2>Are there apps to download?</h2>
  <p>Not yet. iPhone, iPad and Android apps, and Mac and Windows apps, are on the way. Until then the browser version does everything.</p>
</div></section>
${cta()}`,
});

// ---------- Pricing ----------
const ROWS = [
  ['Projects', '1', 'Unlimited', 'Unlimited'],
  ['Documents', '5', 'Unlimited', 'Unlimited'],
  ['Storage', '100MB', '10GB', '1TB'],
  ['Markup and count tools', 'Yes', 'Yes', 'Yes'],
  ['Survey tools, templates and regions', '', 'Yes', 'Yes'],
  ['Excel export', '', 'Yes', 'Yes'],
  ['OneDrive', '', 'Yes', 'Yes'],
  ['Live editing together', '', '', 'Yes'],
  ['Admin tools and single sign-on', '', '', 'Yes'],
];
const PRICE_FAQ = [FAQ[4], FAQ[5], FAQ[6]];
const pricing = page({
  path: '/pricing', crumb: 'Pricing',
  title: 'Pricing: Free, Pro $9.99 and Enterprise | Survey',
  desc: 'Survey is free for 1 project and 5 documents. Pro is $9.99 a month or $99 a year. Enterprise is $20 per user a month, minimum 3 users.',
  schema: [SOFTWARE, faqSchema(PRICE_FAQ)],
  body: `<section class="page-head"><div class="wrap">
  <h1>Start free. Pay when you need more.</h1>
  <p class="lede">Survey is free for one project. Pro costs $9.99 a month or $99 a year. Enterprise costs $20 per user a month for teams of 3 or more.</p>
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
<section class="sec tight"><div class="wrap feat-grid"><div><h2>The tools you'll use</h2><p>Count markers, the pen and highlighter, clouds and arrows, and text callouts. All of them are on the Free plan.</p><a class="btn ghost" href="/features">See every tool</a></div>${shot(TOOLS[0])}</div></section>
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
<section class="sec tight"><div class="wrap narrow"><h2>Which one should you pick?</h2><p>${c.pick}</p><p class="fine">We make Survey, so read this with that in mind. Check ${c.them}'s own site for its current features and prices.</p></div></section>
${cta('Try Survey free on your own drawings')}`,
})]));

// Importing this file (build-free-tools.mjs does, for the layout) must not
// rewrite the pages, so the writes only run when it is the script itself.
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = { ...usePages, ...comparePages, 'use-cases/index.html': useIndex, '404.html': notFound, 'welcome/index.html': home, 'features/index.html': features, 'devices/index.html': devices, 'pricing/index.html': pricing, 'faq/index.html': faq, 'status/index.html': status, 'whats-new/index.html': whatsNew };
  for (const [p, html] of Object.entries(out)) {
    const f = join(root, p);
    mkdirSync(dirname(f), { recursive: true });
    writeFileSync(f, html);
  }

  const urls = ['/welcome', '/features', '/devices', '/pricing', '/faq', '/use-cases', '/status', '/whats-new', ...USES.map((u) => '/use-cases/' + u.slug), ...COMPARE.map((c) => '/compare/' + c.slug), ...TOOL_PATHS, '/privacy.html', '/terms.html'];
  writeFileSync(join(root, 'sitemap.xml'), `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url><loc>${ORIGIN}${u}</loc><lastmod>${TODAY}</lastmod></url>`).join('\n')}
</urlset>
`);

  writeFileSync(join(root, 'llms.txt'), `# Survey

> Survey is a PDF markup and counting app for construction and engineering drawings. It runs in the browser on Mac, Windows, iPad, Android tablets and phones at ${ORIGIN}.

People use Survey to redline drawing sets, tap to count items on a plan (each category keeps a running total), and export the counts to Excel. Free plan: 1 project, 5 documents, 100MB. Pro: $9.99 a month or $99 a year, unlimited projects and documents, 10GB, survey tools, templates and regions, Excel export, OneDrive. Enterprise: $20 per user a month, minimum 3 users, live editing together, 1TB, admin tools and single sign-on.

## Pages

- [Home](${ORIGIN}/welcome): what Survey is and who it is for
- [Features](${ORIGIN}/features): count markers, pen and highlighter, shapes, clouds and arrows, large drawing sets
- [Devices](${ORIGIN}/devices): desktop, tablet and phone
- [Pricing](${ORIGIN}/pricing): Free, Pro and Enterprise plans
- [FAQ](${ORIGIN}/faq): common questions
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
