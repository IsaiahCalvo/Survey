#!/usr/bin/env node
// Builds the Kal Voe suite site that kalvoe.com serves (KAL-850).
// Output goes to public/kal-voe/: one folder per page, each with index.html.
// functions/_middleware.js maps kalvoe.com/<path> to /kal-voe/<path>, so links
// here are written for kalvoe.com (/survey, /pricing) and static files use the
// full /kal-voe/static/ path so they load on any host.
//
// Patterns borrowed from suite makers:
//  - Google Workspace: suite home on its own domain, a page per app, an app launcher.
//  - Adobe Creative Cloud: buy a single app or all apps, "included in the suite"
//    callouts on each app page, a sticky local nav on product pages.
//  - Microsoft 365 / Autodesk collections: the bundle is shown first, with the
//    saving against buying apps one by one worked out.
//
// Run: node scripts/build-suite-site.mjs
import { writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { TOOLS as PDF_TOOLS } from './free-tools-catalog.mjs';
import { ORG as SURVEY_ORG } from './build-marketing.mjs';
import * as D from './suite-site/demos.mjs';
import { APP_PRICES, SUITE_PRICE, ENTERPRISE_PRICE, TRIAL_DAYS, CHECKOUT_ENDPOINT, money, appYearSave, SEPARATE_MONTHLY, SEPARATE_YEARLY, SUITE_SAVE_MONTHLY, SUITE_SAVE_YEARLY, SUITE_YEAR_SAVE } from './pricing.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'kal-voe');
export const SITE = 'https://kalvoe.com';
const S = '/kal-voe/static/';
// suite.css and suite.js keep one name, so each page asks for them with a
// short hash of the file: a new deploy is picked up at once, not from a cache.
const STATIC_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'kal-voe', 'static');
const ver = (f) => createHash('sha256').update(readFileSync(join(STATIC_DIR, f))).digest('hex').slice(0, 10);
const CSS_URL = `${S}suite.css?v=${ver('suite.css')}`;
const JS_URL = `${S}suite.js?v=${ver('suite.js')}`;
// The contact address the Survey marketing site already publishes.
const MAIL_TO = SURVEY_ORG.email;
const MAIL = 'mailto:' + MAIL_TO;
const YEAR = 2026;

// ---------- Products and prices ----------
// Prices come from scripts/pricing.mjs, shared with surveytool.app.
export const APPS = {
  walkthru: {
    id: 'walkthru', name: 'Walkthru', role: 'Walk', color: 'walkthru',
    url: 'https://walkthru.tools', open: 'Open Walkthru',
    short: 'Walk the site with the customer and capture everything.',
    tagline: 'Walk the site. Capture every detail.',
    ...APP_PRICES.walkthru,
  },
  plot: {
    id: 'plot', name: 'Plot', role: 'Design', color: 'plot',
    url: 'https://plot-taupe-eight.vercel.app', open: 'Open Plot',
    short: 'Turn the walk into shop drawings, schedules and issued PDFs.',
    tagline: 'Draw the plan your installers build from.',
    ...APP_PRICES.plot,
  },
  survey: {
    id: 'survey', name: 'Survey', role: 'Verify', color: 'survey',
    url: 'https://surveytool.app', open: 'Open Survey',
    short: 'Mark up drawings, run site surveys and track every install.',
    tagline: 'Verify the build, device by device.',
    ...APP_PRICES.survey,
  },
};
export const SUITE = { name: 'Kal Voe Suite', ...SUITE_PRICE, storage: '50GB per user' };
export const ENTERPRISE = { name: 'Enterprise', ...ENTERPRISE_PRICE };
const ORDER = ['walkthru', 'plot', 'survey'];
const separateMonthly = SEPARATE_MONTHLY; // 36
const suiteSaveMonthly = SUITE_SAVE_MONTHLY; // 12
const TRIAL = `${TRIAL_DAYS}-day free trial`;

export const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------- Small pieces ----------
const CHECK = '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M4.5 10.5l3.5 3.5 7.5-8" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CHEV = '<svg class="chev" viewBox="0 0 12 12" aria-hidden="true"><path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const ARROW = '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12h13M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const WAFFLE = '<svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">' + [3, 10, 17].flatMap((y) => [3, 10, 17].map((x) => `<circle cx="${x}" cy="${y}" r="2" fill="currentColor"/>`)).join('') + '</svg>';
const BURGER = '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>';
const appIcon = (id, size = 40, alt = '') => `<img src="${S}${id}.svg" width="${size}" height="${size}" alt="${alt}" />`;
const checks = (items) => `<ul class="checks">${items.map((t) => `<li>${CHECK}<span>${t}</span></li>`).join('')}</ul>`;
const li = (items) => items.map((t) => `<li>${CHECK}<span>${t}</span></li>`).join('');

function nav(current) {
  const prod = ORDER.map((k) => `<a href="/${k}">${appIcon(k, 40)}<b>${APPS[k].name}</b><small>${APPS[k].short}</small></a>`).join('');
  const launch = ORDER.map((k) => `<a href="${APPS[k].url}">${appIcon(k, 44)}${APPS[k].name}</a>`).join('');
  const link = (href, label) => `<a href="${href}"${current === href ? ' aria-current="page"' : ''}>${label}</a>`;
  return `<header class="top"><div class="wrap">
  <nav class="nav" aria-label="Main">
    <a class="brand" href="/">${appIcon('kalvoe', 30)}<span>Kal Voe</span></a>
    <div class="nav-links">
      <div class="menu" data-menu><button type="button" aria-expanded="false" aria-haspopup="true">Products ${CHEV}</button>
        <div class="menu-pop">${prod}<div class="menu-foot"><a href="/">The Kal Voe Suite</a><a href="/pricing">Compare plans</a></div></div>
      </div>
      ${ORDER.map((k) => link('/' + k, APPS[k].name)).join('')}
      ${link('/pricing', 'Pricing')}
    </div>
    <div class="nav-end">
      <div class="launcher" data-menu><button type="button" aria-expanded="false" aria-label="Open an app">${WAFFLE}</button>
        <div class="menu-pop"><p>Open an app</p>${launch}</div>
      </div>
      <a class="btn ghost sm hide-sm" href="${APPS.survey.url}/?signin=1">Sign in</a>
      <a class="btn primary sm hide-sm" href="/buy">Buy</a>
      <button class="burger" type="button" aria-expanded="false" aria-label="Menu">${BURGER}</button>
    </div>
  </nav>
  <div class="mnav">${ORDER.map((k) => `<a href="/${k}">${appIcon(k, 28)}${APPS[k].name}</a>`).join('')}<a href="/pricing">Pricing</a><a href="${APPS.survey.url}/?signin=1">Sign in</a><a class="btn primary" href="/buy">Buy</a></div>
</div></header>`;
}

function footer() {
  return `<footer class="foot"><div class="wrap">
  <div class="foot-grid">
    <div><a class="brand" href="/">${appIcon('kalvoe', 28)}<span>Kal Voe</span></a><p>Three apps for building systems teams, from the first site walk to closeout. One account across all of them.</p></div>
    <div><h2>Apps</h2>${ORDER.map((k) => `<a href="/${k}">${appIcon(k, 20)}${APPS[k].name}</a>`).join('')}</div>
    <div><h2>Buy</h2><a href="/pricing">Pricing</a><a href="/buy?app=suite">Get the suite</a><a href="/buy?app=survey">Buy one app</a><a href="${MAIL}?subject=Kal%20Voe%20Enterprise">Enterprise</a></div>
    <div><h2>Open</h2>${ORDER.map((k) => `<a href="${APPS[k].url}">${APPS[k].name} app</a>`).join('')}<a href="https://surveytool.app/tools">Free PDF tools</a></div>
  </div>
  <div class="legal"><span>&copy; ${YEAR} Kal Voe LLC, New Jersey, United States.</span><span><a href="/privacy.html">Privacy</a><a href="/terms.html">Terms</a><a href="${MAIL}">Contact</a></span></div>
</div></footer>`;
}

function page({ path, title, desc, body, current, schema = [], config }) {
  const url = SITE + path;
  const graph = [{ '@type': 'Organization', '@id': SITE + '/#org', name: 'Kal Voe', url: SITE + '/', logo: SITE + '/kal-voe/logo-512.png', email: MAIL_TO }, ...schema];
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)}</title>
<meta name="description" content="${esc(desc)}" />
<link rel="canonical" href="${url}" />
<meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />
<meta name="theme-color" content="#131315" media="(prefers-color-scheme: dark)" />
<link rel="icon" href="${S}kalvoe.svg" type="image/svg+xml" />
<link rel="icon" href="${S}favicon.ico" sizes="32x32" />
<link rel="apple-touch-icon" href="${S}apple-touch-icon.png" />
<meta property="og:type" content="website" />
<meta property="og:site_name" content="Kal Voe" />
<meta property="og:title" content="${esc(title)}" />
<meta property="og:description" content="${esc(desc)}" />
<meta property="og:url" content="${url}" />
<meta property="og:image" content="${SITE}${S}og.png" />
<meta name="twitter:card" content="summary_large_image" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600;700&amp;display=swap" />
<link rel="stylesheet" href="${CSS_URL}" />
<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@graph': graph })}</script>
${config ? `<script type="application/json" id="kv-config">${JSON.stringify(config)}</script>\n` : ''}<script src="${JS_URL}" defer></script>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
${nav(current)}
<main id="main">
${body}
</main>
${footer()}
</body>
</html>
`;
}

// ---------- Pricing pieces shared by several pages ----------
const cycleToggle = () => `<div class="cycle" role="group" aria-label="Billing"><button type="button" data-cycle="monthly" aria-pressed="true">Monthly</button><button type="button" data-cycle="yearly" aria-pressed="false">Yearly<span class="save">2 months free</span></button></div>`;
const buyHref = (id) => `href="/buy?app=${id}&amp;cycle=monthly" data-href-monthly="/buy?app=${id}&amp;cycle=monthly" data-href-yearly="/buy?app=${id}&amp;cycle=yearly"`;

function suitePlan() {
  return `<article class="plan suite"><span class="tag">Best value</span>
  <div>
    <div class="apps">${ORDER.map((k) => appIcon(k, 44, APPS[k].name)).join('')}</div>
    <h3>${SUITE.name}</h3>
    <p class="lede" style="font-size:17px">All three apps under one account. Walk the site in Walkthru, draw it in Plot, verify it in Survey, and pass the job along without retyping it.</p>
    <div class="amt"><strong data-monthly="${money(SUITE.monthly)}" data-yearly="${money(SUITE.yearly)}">${money(SUITE.monthly)}</strong><span data-monthly="per user / month" data-yearly="per user / year">per user / month</span></div>
    <p class="sub" data-monthly="Or ${money(SUITE.yearly)} per user a year, which saves ${money(SUITE_YEAR_SAVE)}. ${TRIAL}." data-yearly="${money(SUITE.yearly / 12)} per user a month, billed yearly. Saves ${money(SUITE_YEAR_SAVE)}. ${TRIAL}.">Or ${money(SUITE.yearly)} per user a year, which saves ${money(SUITE_YEAR_SAVE)}. ${TRIAL}.</p>
    <a class="btn primary lg" ${buyHref('suite')}>Get the suite</a>
  </div>
  <div>
    <ul>${li(['Walkthru, Plot and Survey, all included', 'One Kal Voe account on desktop, tablet and phone', `${SUITE.storage} of storage`, 'Hand jobs from Walkthru to Plot to Survey', 'Everything in each app’s Pro plan', 'Live team editing and OneDrive sync'])}</ul>
    <div class="math">Each app is ${money(APPS.survey.monthly)} a month on its own, so all three would be ${money(separateMonthly)}. The suite is ${money(SUITE.monthly)}, so you <b>save ${money(suiteSaveMonthly)} a month</b> per user (${money(SUITE_SAVE_YEARLY)} a year on yearly plans).</div>
  </div>
</article>`;
}

// What each app's Pro plan adds. Walkthru's come from its account-plan config
// (walkthu repo, apps/web/src/lib/account-plan.ts).
const APP_PLAN_ITEMS = {
  walkthru: ['Unlimited walkthroughs', 'Cloud transcription, 50 hours a month', 'AI summary, talking points, action items and next steps', '100GB of storage, templates and exports'],
  plot: ['Devices, tags, floors and cable runs', 'Riser diagrams', 'Schedules and bill of materials in Excel', 'Title blocks and issued PDFs'],
  survey: ['Unlimited projects and documents, 10GB', 'Site surveys with Excel (.xlsx) export', 'Count markers and device tracking', 'Live team editing and OneDrive sync'],
};

// The free steps of each app, in the order a person meets them: no sign-up,
// then a free account, then Pro. Only facts the apps already have.
const LADDER = {
  walkthru: {
    none: ['Open a PDF in your browser, mark it up and export it', 'The file stays on your device', 'No card and no sign-up'],
    noneCta: [APPS.walkthru.url + '/try', 'Try Walkthru'],
    account: ['Up to 2 active walkthroughs and 1 template', 'Photos, videos, notes and audio recording', '60 cloud transcription minutes a month', '2GB of storage'],
    accountCta: [APPS.walkthru.url, 'Create a free account'],
  },
  plot: {
    none: ['The whole app runs in your browser', 'Projects saved on your device as .plt files', 'No card and no sign-up'],
    noneCta: [APPS.plot.url, 'Open Plot'],
    account: ['Plot accounts are coming', 'Until then, Plot is free in full'],
    accountCta: null,
  },
  survey: {
    none: ['Open a PDF from your device and mark it up', 'Choose “Continue without an account”', `${PDF_TOOLS.length} free browser PDF tools`],
    noneCta: [APPS.survey.url, 'Open Survey'],
    account: ['1 project, 5 documents, 100MB', 'Every markup tool, including callouts, measuring and OCR', 'Count markers with running totals'],
    accountCta: [APPS.survey.url + '/?signup=1', 'Create a free account'],
  },
};

// One app's three steps, shown on its page and on /pricing.
function ladder(k, { heading = true } = {}) {
  const a = APPS[k];
  const L = LADDER[k];
  const step = (n, title, sub, items, cta, extra = '') => `<article class="plan rung"><header><span class="num">${n}</span><div><b>${title}</b><small>${sub}</small></div></header>
  ${extra}<ul>${li(items)}</ul>${cta ? `<a class="btn ghost" href="${cta[0]}">${cta[1]}</a>` : ''}</article>`;
  const pro = a.checkout
    ? step(3, `${a.name} Pro`, `${money(a.monthly)} a month or ${money(a.yearly)} a year`, APP_PLAN_ITEMS[k], [`/buy?app=${k}`, `Buy ${a.name} Pro`], `<p class="sub">${TRIAL}, then ${money(a.monthly)} a month.</p>`)
    : step(3, `${a.name} in the ${SUITE.name}`, 'Free while in early access', ['Everything in Plot is free today', `Included in the ${SUITE.name}`], ['/buy?app=suite', 'Get the suite']);
  return `${heading ? `<h3 class="ladder-h">${appIcon(k, 28)}${a.name}</h3>` : ''}<div class="plans ladder">
  ${step(1, 'Free, no sign-up', 'Start right now', L.none, L.noneCta)}
  ${step(2, 'Free account', L.accountCta ? 'Sign up free, no card' : 'Coming soon', L.account, L.accountCta)}
  ${pro}
</div>`;
}

function appPlan(k) {
  const a = APPS[k];
  if (!a.checkout) {
    return `<article class="plan app-${a.color}">
  <header>${appIcon(k, 40)}<div><b>${a.name}</b><small>${a.role} · single app</small></div></header>
  <div class="amt"><strong>$0</strong><span>free while in early access</span></div>
  <p class="sub">No account needed. ${a.name} is included in the ${SUITE.name}.</p>
  <ul>${li(APP_PLAN_ITEMS[k])}</ul>
  <a class="btn app app-${a.color}" href="${a.url}">${a.open}, free</a>
</article>`;
  }
  return `<article class="plan app-${a.color}">
  <header>${appIcon(k, 40)}<div><b>${a.name}</b><small>${a.role} · single app</small></div></header>
  <div class="amt"><strong data-monthly="${money(a.monthly)}" data-yearly="${money(a.yearly)}">${money(a.monthly)}</strong><span data-monthly="/ month" data-yearly="/ year">/ month</span></div>
  <p class="sub" data-monthly="Or ${money(a.yearly)} a year. ${TRIAL}." data-yearly="Saves ${money(appYearSave(k))} a year. ${TRIAL}.">Or ${money(a.yearly)} a year. ${TRIAL}.</p>
  <ul>${li(APP_PLAN_ITEMS[k])}</ul>
  <a class="btn app app-${a.color}" ${buyHref(k)}>Buy ${a.name}</a>
</article>`;
}

function enterprisePlan() {
  return `<article class="plan"><header>${appIcon('kalvoe', 40)}<div><b>Enterprise</b><small>For larger teams</small></div></header>
  <div class="amt"><strong>${money(ENTERPRISE.monthly)}</strong><span>per user / month</span></div><p class="sub">Or a custom yearly contract. Talk to us to set it up.</p>
  <ul>${li(['Everything in the Kal Voe Suite for every user', 'Single sign-on (SSO) and seat management', '1TB shared team storage', 'Activity and security audit log', 'Priority support', 'Custom templates, title blocks and export layouts'])}</ul>
  <a class="btn ghost" href="${MAIL}?subject=Kal%20Voe%20Enterprise">Contact sales</a></article>`;
}

// ---------- Home ----------
function home() {
  const tiles = ORDER.map((k, i) => {
    const a = APPS[k];
    return `<a class="tile app-${a.color}" href="/${k}"><span class="step">0${i + 1}</span>${appIcon(k, 56)}<p class="role">${a.role}</p><h3>${a.name}</h3><p>${a.short}</p><span class="arrow-link">See what ${a.name} does <span>&rarr;</span></span></a>`;
  }).join('');
  const flow = [
    ['walkthru', 'Walk the site with the customer. Drop a node wherever something goes, and capture it.', ['Photos, video and notes at each node', 'The walk recorded and transcribed', 'An AI summary of what was asked for']],
    ['plot', 'Open the walk in Plot. Every node becomes a device you can tag, cable and schedule.', ['Devices, tags and cable runs', 'Riser diagrams and schedules', 'Title blocks and issued PDFs']],
    ['survey', 'Take the drawings to site in Survey. Mark them up and check off each device as it goes in.', ['Markup and counts on the drawings', 'Installed, tested, commissioned', 'Excel reports and as-built notes']],
  ].map(([k, p, items]) => `<div class="flow-step app-${APPS[k].color}"><header>${appIcon(k, 34)}<b>${APPS[k].name}</b></header><p>${p}</p><ul>${items.map((t) => `<li>${t}</li>`).join('')}</ul></div>`).join(`<div class="flow-arrow">${ARROW}</div>`);
  const body = `<section class="hero center"><div class="wrap">
  <div class="suite-icons">${ORDER.map((k) => appIcon(k, 52, APPS[k].name)).join('')}</div>
  <h1>Walk the site. Draw the plan.<br />Verify the build.</h1>
  <p class="lede">Kal Voe is a suite of three apps for building systems teams. Walkthru, Plot and Survey share one account, so a job moves from the first site walk to closeout without anyone retyping it.</p>
  <div class="ctas"><a class="btn primary lg" href="/buy?app=suite">Get the suite</a><a class="btn ghost lg" href="#apps">Explore the apps</a></div>
  <p class="fine">Use each app on its own, or all three together. Every app can be tried free with no sign-up.</p>
  <div class="hero-stage win-frame">${D.homeFlow()}</div>
</div></section>

<section class="sec band" id="apps"><div class="wrap">
  <div class="head center"><p class="eyebrow">The apps</p><h2>Three apps. One job.</h2><p class="lede">Each app does one part of the work. Pick the one you need, or get all three.</p></div>
  <div class="tiles">${tiles}</div>
</div></section>

<section class="sec"><div class="wrap">
  <div class="head"><p class="eyebrow">How it fits together</p><h2>From the first walk to closeout</h2><p class="lede">What you capture on the walk becomes the drawing, and the drawing becomes the checklist on site.</p></div>
  <div class="flow">${flow}</div>
</div></section>

<section class="sec band" id="buy"><div class="wrap center">
  <div class="head center"><p class="eyebrow">Pricing</p><h2>Buy one app, or the whole suite</h2><p class="lede">Start with the app you need. Add the others any time, or save with the suite.</p></div>
  ${cycleToggle()}
  <div class="plans suite-row">${suitePlan()}</div>
  <div class="plans apps-row" style="margin-top:20px">${ORDER.map(appPlan).join('')}</div>
  <p style="margin-top:28px"><a class="arrow-link" href="/pricing">Compare every plan <span>&rarr;</span></a></p>
</div></section>

<section class="sec tight"><div class="wrap">
  <div class="tools-strip"><div><h3>${PDF_TOOLS.length} free PDF tools, no sign-up</h3><p>Merge, split, compress, OCR, compare, sign and convert PDFs in your browser. Your files never leave your device.</p></div><a class="btn ghost" href="https://surveytool.app/tools">Open the free tools</a></div>
</div></section>

<section class="sec tight" id="account"><div class="wrap" style="max-width:820px">
  <h2>One Kal Voe account</h2>
  <p>Sign in to Walkthru, Plot and Survey with Google, Microsoft or your email. It is the same account in every app, on the web and on your phone. Each app can also be used on its own.</p>
  <p>Signing in with Google gives us your name, email address and profile picture, for your account. Read the <a href="/privacy.html">privacy policy</a> and <a href="/terms.html">terms</a>.</p>
  <p class="fine">Kal Voe LLC, New Jersey, United States. Questions? <a href="${MAIL}">Email us</a>.</p>
</div></section>

<section class="band"><div class="wrap cta-band">
  <h2>Run the whole job in one suite</h2>
  <p class="lede" style="margin:0 auto">Get Walkthru, Plot and Survey for ${money(SUITE.monthly)} per user a month.</p>
  <div class="ctas"><a class="btn primary lg" href="/buy?app=suite">Get the suite</a><a class="btn ghost lg" href="/pricing">See pricing</a></div>
</div></section>`;
  return page({
    path: '/', current: '/',
    title: 'Kal Voe Suite: Walkthru, Plot and Survey for building systems teams',
    desc: 'Walk the site in Walkthru, draw shop drawings and schedules in Plot, and mark up drawings and track installs in Survey. Buy one app or the whole Kal Voe Suite.',
    schema: [{ '@type': 'WebSite', '@id': SITE + '/#site', url: SITE + '/', name: 'Kal Voe', publisher: { '@id': SITE + '/#org' } }],
    body,
  });
}

// ---------- App pages ----------
const APP_PAGES = {
  walkthru: {
    title: 'Walkthru by Kal Voe: site walks with photos, audio and AI summaries',
    desc: 'Walkthru is for walking the site with your customer. Drop nodes on the floor plan, capture photos, video, notes and audio, and get an AI summary you can share or send to Plot.',
    h1: 'Walk the site with your customer. Miss nothing.',
    lede: 'Walkthru is the app you take on a site walk. Drop a node on the floor plan wherever something goes, and capture photos, video, notes and the conversation as you go. You leave with a summary instead of a notebook.',
    hero: D.walkthruHero,
    for: [
      ['Who it’s for', 'Sales engineers, estimators and project managers who walk a site before anything is designed.'],
      ['What you do in it', 'Walk the space on your phone or tablet, put each request on the plan, and record what the customer says.'],
      ['What comes out', 'A walk with every node, photo and note in place, a transcript, and a summary you can share or open in Plot.'],
    ],
    features: [
      ['Drop nodes on the plan', 'Tap the floor plan wherever a device or a question goes. Each node is numbered, so the list and the plan always match.', ['Works on phone and tablet', 'Numbered nodes on the PDF floor plan', 'Every node in one list'], D.walkthruNodes],
      ['Capture everything at each node', 'Photos, short videos and typed notes stay pinned to the node they belong to, not lost in a camera roll.', ['Photos and video', 'Typed notes', 'All of it attached to the node'], D.walkthruCapture],
      ['Record the walk, read it later', 'Record the conversation as you walk. Walkthru turns it into a transcript, so you can look back at exactly what was asked for.', ['Audio recording', 'Transcript of the conversation', 'Kept with the walk'], D.walkthruAudio],
      ['An AI summary you can send', 'When you’re done, Walkthru writes up what the customer asked for. Share it with a link, or send the walk to Plot.', ['AI summary of the walk', 'Share with teammates or the customer by link', 'Send the walk to Plot'], D.walkthruSummary],
    ],
    next: ['plot', 'In the suite, the walk opens in Plot. Each node becomes a device, ready to tag and cable.', D.handoff],
    faq: [
      ['Do I need the other apps to use Walkthru?', 'No. Walkthru works on its own. In the Kal Voe Suite, a walk can also go straight to Plot.'],
      ['Does it work on a phone?', 'Yes. Walkthru is made for walking a site on a phone or tablet, and you can pick the walk up on a computer later.'],
      ['Can the customer see the walk?', 'Only if you share it. You can invite teammates or the customer with a link.'],
      ['Is Walkthru free?', 'Yes. You can open a PDF and mark it up with no account. A free account adds walkthroughs, up to 2 active at a time, with 60 cloud transcription minutes a month.'],
      ['How much does it cost?', `Walkthru Pro is ${money(APPS.walkthru.monthly)} a month or ${money(APPS.walkthru.yearly)} a year on its own, with a ${TRIAL}, or included in the Kal Voe Suite for ${money(SUITE.monthly)} per user a month.`],
    ],
  },
  plot: {
    title: 'Plot by Kal Voe: shop drawings, cable runs, risers and schedules',
    desc: 'Plot turns a site walk into contractor shop drawings: devices and tags on the floor plan, cable runs, riser diagrams, schedules and a bill of materials in Excel, and issued PDFs with title blocks.',
    h1: 'Turn the site walk into shop drawings.',
    lede: 'Plot is where the design happens. Place devices on the floor plan, tag them, run the cabling, build the riser, and issue a PDF set with schedules your installers can follow.',
    hero: D.plotHero,
    for: [
      ['Who it’s for', 'Designers, engineers and project managers who produce shop drawings for low-voltage and building systems work.'],
      ['What you do in it', 'Lay out devices and cable runs on each floor, build risers, and keep the schedules in step with the drawing.'],
      ['What comes out', 'An issued PDF set with title blocks, plus device schedules and a bill of materials in Excel.'],
    ],
    features: [
      ['Place devices, tagged for you', 'Drop devices on the floor plan and Plot numbers them as you go, so tags are never doubled or skipped.', ['Devices by type', 'Tags like CAM-01, numbered for you', 'Organized by floor'], D.plotDevices],
      ['Run the cabling', 'Draw each cable run back to its closet. Every run gets its own number, so the drawing and the schedule agree.', ['Cable runs on the plan', 'Numbered runs', 'Home runs to the IDF'], D.plotCabling],
      ['Build the riser', 'Show how every floor connects in a riser diagram, built from the same devices you placed.', ['Riser diagrams', 'Floors and backbones', 'Devices per floor'], D.plotRiser],
      ['Schedules and a bill of materials', 'The device schedule and the bill of materials come from the drawing. Export them to Excel for the office.', ['Device schedules', 'Bill of materials', 'Excel (.xlsx) export'], D.plotSchedule],
      ['Issue the set', 'Each sheet gets its title block. When it’s ready, issue the set as a PDF.', ['Title blocks', 'Issued PDF sets', 'Revisions'], D.plotIssue],
    ],
    next: ['survey', 'In the suite, Plot takes the walk from Walkthru, and the issued drawing goes on to Survey, where the crew checks off each device.', D.handoff],
    faq: [
      ['Can I start in Plot without a Walkthru walk?', 'Yes. Plot works on its own with any floor plan. In the Kal Voe Suite, you can also open a Walkthru walk in it.'],
      ['What can I export?', 'Issued PDF sets with title blocks, and device schedules and a bill of materials as Excel spreadsheets.'],
      ['Does it handle more than one floor?', 'Yes. Devices are organized by floor, and the riser diagram shows how the floors connect.'],
      ['Is Plot free?', 'Yes, while Plot is in early access. It runs in your browser with no account, and your projects are saved on your device as .plt files.'],
      ['How much does it cost?', `Plot is free in full while it is in early access, and it is included in the Kal Voe Suite for ${money(SUITE.monthly)} per user a month. Plot accounts are coming.`],
    ],
  },
  survey: {
    title: 'Survey by Kal Voe: PDF markup, site surveys and install tracking',
    desc: 'Survey is for the field: mark up construction drawings with every tool free, count devices, run site surveys that export to Excel, and track each device from installed to commissioned.',
    h1: 'Mark it up, count it, check it off.',
    lede: 'Survey is the app you take to site once the drawings are out. Mark them up, count what’s there, and check off every device as it’s installed, tested and commissioned. The office gets a spreadsheet, and Plot gets your as-built notes.',
    hero: D.surveyHero,
    for: [
      ['Who it’s for', 'Field techs, foremen and project managers who install, test and close out the job.'],
      ['What you do in it', 'Mark up drawings, count devices, run checklist surveys on the plan, and track each install.'],
      ['What comes out', 'Marked-up drawings, Excel reports for the office, and as-built notes that go back to Plot.'],
    ],
    features: [
      ['Mark up drawings, every tool free', 'Clouds, arrows, callouts, measurements and more. Every markup tool is on the free plan.', ['Callouts, clouds and arrows', 'Measuring', 'OCR on scanned drawings'], D.surveyMarkup],
      ['Count with running totals', 'Drop count markers on the drawing and the total keeps up as you go.', ['Count markers', 'Running totals', 'Counts by type'], D.surveyCount],
      ['Track every install', 'Each device moves from installed to tested to commissioned, so everyone can see where the job stands.', ['Device tracking', 'Installed, tested, commissioned', 'Progress the team can see'], D.surveyTrack],
      ['Site surveys that export to Excel', 'Run a checklist at each device or room, then export the results as a spreadsheet.', ['Checklist site surveys', 'Photos and notes with each item', 'Excel (.xlsx) export'], D.surveyChecklist],
      ['As-built notes back to Plot', 'When something moves on site, note it in Survey. In the suite, the note goes back to Plot for the as-built.', ['As-built notes', 'Sent to Plot in the suite', 'Keeps the drawing true'], D.surveyAsBuilt],
    ],
    next: null,
    faq: [
      ['Is Survey free?', `Yes. Open a PDF from your device and mark it up with no account, or sign up free for one project, five documents and every markup tool. Survey Pro is ${money(APPS.survey.monthly)} a month or ${money(APPS.survey.yearly)} a year.`],
      ['Do I need Walkthru or Plot?', 'No. Survey works on any PDF drawing. In the Kal Voe Suite, it also takes drawings from Plot and sends as-built notes back.'],
      ['What does the export look like?', 'Site surveys export as Excel (.xlsx) spreadsheets that open in Excel, Google Sheets, Numbers or LibreOffice.'],
      ['How much does it cost?', `Survey Pro is ${money(APPS.survey.monthly)} a month or ${money(APPS.survey.yearly)} a year on its own, with a ${TRIAL}, or included in the Kal Voe Suite for ${money(SUITE.monthly)} per user a month.`],
    ],
  },
};

function appPage(k) {
  const a = APPS[k];
  const p = APP_PAGES[k];
  const others = ORDER.filter((x) => x !== k);
  const priceLine = a.checkout ? `${money(a.monthly)} a month or ${money(a.yearly)} a year` : 'Free while in early access';
  const buyBtn = (cls) => a.checkout ? `<a class="btn app app-${a.color} ${cls}" href="/buy?app=${k}">Buy ${a.name}</a>` : `<a class="btn app app-${a.color} ${cls}" href="${a.url}">${a.open}, free</a>`;
  const features = p.features.map(([h, d, items, demo], i) => `<div class="feature${i % 2 ? ' flip' : ''}"><div class="feature-copy"><span class="num">0${i + 1}</span><h3>${h}</h3><p>${d}</p>${checks(items)}</div><div>${demo()}</div></div>`).join('');
  const steps = ORDER.map((x) => `<div class="flow-step app-${APPS[x].color}"${x === k ? ' style="border-color:var(--app);box-shadow:var(--shadow)"' : ''}><header>${appIcon(x, 34)}<b>${APPS[x].name}</b></header><p>${APPS[x].short}</p></div>`).join(`<div class="flow-arrow">${ARROW}</div>`);
  const suiteLede = p.next ? p.next[1] : 'In the suite, Survey takes the issued drawings from Plot and sends your as-built notes back.';
  const body = `<section class="hero app-hero app-${a.color}"><div class="wrap">
  <a class="app-id" href="/${k}">${appIcon(k, 48)}<span>${a.name}<small>by Kal Voe</small></span></a>
  <h1>${p.h1}</h1>
  <p class="lede">${p.lede}</p>
  <div class="ctas">${a.checkout ? `${buyBtn('lg')}<a class="btn ghost lg" href="${a.url}">Try it free</a>` : `${buyBtn('lg')}<a class="btn ghost lg" href="/buy?app=suite">Get the suite</a>`}</div>
  <p class="price-line"><b>${priceLine}</b>${a.checkout ? ' on its own, or try it free with no sign-up.' : ', with no account needed.'} Also included in the <a href="/pricing">Kal Voe Suite</a> with ${others.map((x) => APPS[x].name).join(' and ')}.</p>
  <div class="hero-stage win-frame">${p.hero()}</div>
</div></section>
<nav class="subnav app-${a.color}" aria-label="${a.name}"><div class="wrap">
  <a class="who" href="/${k}">${appIcon(k, 22)}${a.name}</a>
  <a class="l" href="#what">What it’s for</a><a class="l" href="#features">Features</a><a class="l" href="#suite">In the suite</a><a class="l" href="#free">Start free</a><a class="l" href="#pricing">Pricing</a><a class="l" href="#faq">FAQ</a>
  ${a.checkout ? `<a class="btn app app-${a.color} sm" href="/buy?app=${k}">Buy</a>` : `<a class="btn app app-${a.color} sm" href="${a.url}">Open</a>`}
</div></nav>

<section class="sec app-${a.color}" id="what"><div class="wrap">
  <div class="head"><p class="eyebrow">What ${a.name} is for</p><h2>${a.tagline}</h2></div>
  <div class="cols3">${p.for.map(([h, t]) => `<div><span class="k">${h}</span><p>${t}</p></div>`).join('')}</div>
</div></section>

<section class="sec band app-${a.color}" id="features" style="padding-top:72px;padding-bottom:64px"><div class="wrap">
  <div class="head" style="margin-bottom:8px"><p class="eyebrow">Features</p><h2>What you can do in ${a.name}</h2></div>
  ${features}
</div></section>

<section class="sec app-${a.color}" id="suite"><div class="wrap">
  <div class="head"><p class="eyebrow">In the Kal Voe Suite</p><h2>${a.name} is one step of the job</h2><p class="lede">${suiteLede}</p></div>
  <div class="flow">${steps}</div>
  ${p.next ? `<div style="max-width:760px;margin:48px auto 0">${p.next[2]()}</div>` : ''}
</div></section>

<section class="sec" id="free"><div class="wrap center">
  <div class="head center"><p class="eyebrow">Start free</p><h2>Try ${a.name} before you sign up</h2><p class="lede">Start with no account, make a free account when you want to keep your work, and go Pro when you need more.</p></div>
  ${ladder(k, { heading: false })}
</div></section>

<section class="sec band" id="pricing"><div class="wrap center">
  <div class="head center"><p class="eyebrow">Pricing</p><h2>${a.checkout ? `Buy ${a.name} on its own, or get it in the suite` : `${a.name} is free now, and part of the suite`}</h2></div>
  ${cycleToggle()}
  <div class="plans other-row">${appPlan(k)}
    <article class="plan"><header>${appIcon('kalvoe', 40)}<div><b>${SUITE.name}</b><small>${a.name}, ${others.map((x) => APPS[x].name).join(' and ')}</small></div></header>
    <div class="amt"><strong data-monthly="${money(SUITE.monthly)}" data-yearly="${money(SUITE.yearly)}">${money(SUITE.monthly)}</strong><span data-monthly="per user / month" data-yearly="per user / year">per user / month</span></div>
    <p class="sub">All three apps for ${money(suiteSaveMonthly)} a month less than buying them one by one.</p>
    <ul>${li(['Everything in ' + a.name, ...others.map((x) => APPS[x].name + ' included'), 'Hand jobs between the apps', `${SUITE.storage} of storage`])}</ul>
    <a class="btn primary" ${buyHref('suite')}>Get the suite</a></article>
  </div>
  <p style="margin-top:28px"><a class="arrow-link" href="/pricing">Compare every plan <span>&rarr;</span></a></p>
</div></section>

<section class="sec" id="faq"><div class="wrap">
  <div class="head center"><h2>Questions about ${a.name}</h2></div>
  <div class="faq">${p.faq.map(([q, ans]) => `<details><summary>${q}</summary><p>${ans}</p></details>`).join('')}</div>
</div></section>

<section class="band"><div class="wrap cta-band app-${a.color}">
  <h2>${a.tagline}</h2>
  <div class="ctas">${buyBtn('lg')}<a class="btn ghost lg" href="/buy?app=suite">Get the suite</a></div>
</div></section>`;
  return page({
    path: '/' + k, current: '/' + k, title: p.title, desc: p.desc, body,
    schema: [
      { '@type': 'SoftwareApplication', name: `${a.name} by Kal Voe`, url: SITE + '/' + k, applicationCategory: 'BusinessApplication', publisher: { '@id': SITE + '/#org' },
        offers: a.checkout
          ? [{ '@type': 'Offer', name: `${a.name} Free`, price: '0', priceCurrency: 'USD' }, { '@type': 'Offer', name: `${a.name} Pro monthly`, price: String(a.monthly), priceCurrency: 'USD' }, { '@type': 'Offer', name: `${a.name} Pro yearly`, price: String(a.yearly), priceCurrency: 'USD' }]
          : [{ '@type': 'Offer', name: `${a.name} (early access)`, price: '0', priceCurrency: 'USD' }] },
      { '@type': 'FAQPage', mainEntity: p.faq.map(([q, ans]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: ans } })) },
    ],
  });
}

// ---------- Pricing ----------
const PRICING_FAQ = [
  ['Can I try the apps before I pay?', 'Yes. Each app can be used free with no sign-up, then with a free account. You pay only when you want Pro or the suite, and checkout starts with a ${TRIAL_DAYS}-day free trial.'],
  ['Can I buy just one app?', `Yes. Walkthru and Survey are each ${money(APPS.survey.monthly)} a month or ${money(APPS.survey.yearly)} a year on their own. Plot is free while it is in early access. You can add the others later, or move to the suite.`],
  ['What does the suite include?', `All three apps under one Kal Voe account, ${SUITE.storage} of storage, and hand-offs from Walkthru to Plot to Survey.`],
  ['How much does the suite save?', `Each app is ${money(APPS.survey.monthly)} a month on its own, so all three would be ${money(separateMonthly)}. The suite is ${money(SUITE.monthly)} per user a month, a saving of ${money(suiteSaveMonthly)}, or ${money(SUITE.yearly)} per user a year against ${money(SEPARATE_YEARLY)}.`],
  ['Is there a free plan?', 'Yes, in every app. Use it with no sign-up first, then make a free account. Survey’s free account has one project, five documents and every markup tool. No card needed.'],
  ['Is there a yearly plan?', `Yes. Every paid plan can be billed yearly, which gives you two months free: ${money(APPS.survey.yearly)} a year for one app, or ${money(SUITE.yearly)} per user a year for the suite.`],
  ['How do I buy for a larger team?', 'The suite is priced per user. For single sign-on, seat management and an audit log, ask us about Enterprise.'],
];

function pricing() {
  const yes = `<td>${CHECK}<span class="sr">Included</span></td>`;
  const no = '<td class="no">—</td>';
  const rows = [
    ['Walkthru site walks', 'walkthru'], ['Photos, video, audio and AI summaries', 'walkthru'],
    ['Plot shop drawings and cable runs', 'plot'], ['Riser diagrams, schedules and BOM', 'plot'],
    ['Survey markup, counts and site surveys', 'survey'], ['Device tracking and Excel export', 'survey'],
    ['Hand jobs between the apps', 'suite'],
  ];
  const cell = (col, need) => (need === 'suite' ? (col === 'suite' ? yes : no) : (col === 'suite' || col === need ? yes : no));
  const table = `<div class="table-scroll"><table class="compare"><thead><tr><th scope="col">What you get</th>${ORDER.map((k) => `<th scope="col">${appIcon(k, 28)}${APPS[k].name}</th>`).join('')}<th scope="col">${appIcon('kalvoe', 28)}Suite</th></tr></thead><tbody>
  ${rows.map(([label, need]) => `<tr><th scope="row" style="font-weight:500">${label}</th>${[...ORDER, 'suite'].map((c) => cell(c, need)).join('')}</tr>`).join('')}
  <tr><th scope="row" style="font-weight:500">Price per month</th>${ORDER.map((k) => `<td>${APPS[k].checkout ? `<b>${money(APPS[k].monthly)}</b>` : '<b>Free</b> for now'}</td>`).join('')}<td><b>${money(SUITE.monthly)}</b> per user</td></tr>
  </tbody></table></div>`;
  const body = `<section class="hero center" style="padding-bottom:24px"><div class="wrap">
  <h1>Pricing</h1>
  <p class="lede">Try every app free with no sign-up. Then buy the one app you need, or all three in the Kal Voe Suite. Every plan works with one Kal Voe account.</p>
  ${cycleToggle()}
</div></section>
<section class="sec" style="padding-top:8px"><div class="wrap center">
  <div class="plans suite-row">${suitePlan()}</div>
  <h2 style="margin:72px 0 8px;font-size:30px">Or buy a single app</h2><p class="lede" style="margin:0 auto 32px">Each app is ${money(APPS.survey.monthly)} a month on its own. Add the others whenever you’re ready.</p>
  <div class="plans apps-row">${ORDER.map(appPlan).join('')}</div>
  <h2 style="margin:72px 0 8px;font-size:30px" id="free">Start free in any app</h2><p class="lede" style="margin:0 auto 32px">Use each app with no sign-up, then with a free account. Pay only when you want more.</p>
  ${ORDER.map((k) => ladder(k)).join('')}
  <h2 style="margin:72px 0 32px;font-size:30px">Enterprise</h2>
  <div class="plans other-row">${enterprisePlan()}</div>
</div></section>
<section class="sec band"><div class="wrap">
  <div class="head center"><h2>Compare the plans</h2></div>
  ${table}
</div></section>
<section class="sec"><div class="wrap">
  <div class="head center"><h2>Pricing questions</h2></div>
  <div class="faq">${PRICING_FAQ.map(([q, ans]) => `<details><summary>${q}</summary><p>${ans}</p></details>`).join('')}</div>
</div></section>`;
  return page({
    path: '/pricing', current: '/pricing',
    title: 'Pricing: Kal Voe Suite, Walkthru, Plot and Survey',
    desc: `Try Walkthru, Plot and Survey free with no sign-up. Walkthru Pro and Survey Pro are ${money(APPS.survey.monthly)} a month each, Plot is free in early access, and the Kal Voe Suite is ${money(SUITE.monthly)} per user a month.`,
    body,
    schema: [{ '@type': 'FAQPage', mainEntity: PRICING_FAQ.map(([q, ans]) => ({ '@type': 'Question', name: q, acceptedAnswer: { '@type': 'Answer', text: ans } })) }],
  });
}

// ---------- Buy ----------
export const BUY_PRODUCTS = {
  suite: { name: SUITE.name, monthly: SUITE.monthly, yearly: SUITE.yearly, perSeat: true, saveYear: SUITE_YEAR_SAVE, note: `All three apps, priced per user. ${TRIAL} at checkout.`, checkout: true, soon: true, fallback: MAIL, fallbackLabel: 'Email us to get it', fallbackHow: 'Checkout for the suite opens soon. Email us and we’ll set it up for you. Survey Pro can be bought now.' },
  walkthru: { name: 'Walkthru Pro', monthly: APPS.walkthru.monthly, yearly: APPS.walkthru.yearly, saveYear: appYearSave('walkthru'), note: `${TRIAL} at checkout.`, checkout: true, soon: true, fallback: MAIL, fallbackLabel: 'Email us to get it', fallbackHow: 'Checkout for Walkthru Pro opens soon. Email us and we’ll set it up for you. Survey Pro can be bought now.' },
  plot: { name: 'Plot', free: true, fallback: APPS.plot.url, fallbackLabel: 'Open Plot, free', fallbackHow: 'Plot is free while in early access, so there is nothing to buy. It is also part of the Kal Voe Suite.' },
  survey: { name: 'Survey Pro', monthly: APPS.survey.monthly, yearly: APPS.survey.yearly, saveYear: appYearSave('survey'), note: `${TRIAL} at checkout.`, checkout: true },
};

function buy() {
  const price = (k) => (BUY_PRODUCTS[k].free ? 'Free for now' : `${money(BUY_PRODUCTS[k].monthly)} / mo`);
  const choice = [['suite', 'kalvoe', SUITE.name, 'Walkthru, Plot and Survey', `${money(SUITE.monthly)} / user / mo`], ...ORDER.map((k) => [k, k, BUY_PRODUCTS[k].name, APPS[k].short, price(k)])]
    .map(([v, ic, n, d, pr]) => `<label><input type="radio" name="plan" value="${v}" />${appIcon(ic, 44)}<span><b>${n}</b><small>${d}</small></span><span class="p">${pr}</span></label>`).join('');
  const body = `<section class="sec" style="padding-top:64px"><div class="wrap">
  <div class="head"><h1 style="font-size:clamp(34px,4vw,48px)">Choose what to buy</h1><p class="lede">Get the whole suite, or one app on its own. Every plan starts with a ${TRIAL}, and you can switch later.</p></div>
  <form class="buy" id="buy">
    <div>
      <fieldset style="border:0;padding:0;margin:0"><legend class="eyebrow">Product</legend><div class="choice">${choice}</div></fieldset>
      <div style="margin-top:36px"><p class="eyebrow" style="display:flex">Billing</p>${cycleToggle()}</div>
      <div class="email-field" style="margin-top:36px">
        <label class="eyebrow" for="buy-email" style="display:flex">Email (optional)</label>
        <input type="email" id="buy-email" name="email" autocomplete="email" inputmode="email" placeholder="you@company.com" />
        <p class="note">Use the email you sign in to the apps with, so your plan turns on there.</p>
      </div>
    </div>
    <aside class="summary" aria-live="polite">
      <h2>Your order</h2>
      <div class="row"><span>Product</span><b id="sum-name">${SUITE.name}</b></div>
      <div class="row"><span>Price</span><span id="sum-unit"></span></div>
      <div class="row total"><span>Today</span><span id="sum-total">$0</span></div>
      <p class="note" id="sum-note"></p>
      <button type="submit" class="btn primary lg" id="buy-go">Continue to checkout</button>
      <a class="btn primary lg" id="buy-open" href="${APPS.plot.url}" hidden>Open Plot, free</a>
      <p class="note" id="buy-how"></p>
      <p class="note" id="buy-error" role="alert" hidden>We couldn’t open checkout just now. Please try again, or <a href="${MAIL}">email us</a> and we’ll set it up for you.</p>
      <p class="note">Buying for a team of more than one? <a href="${MAIL}">Email us</a> and we’ll set up every seat.</p>
    </aside>
  </form>
</div></section>`;
  return page({
    path: '/buy', current: '/buy',
    title: 'Buy the Kal Voe Suite, Walkthru or Survey',
    desc: `Choose the Kal Voe Suite or a single app, pick monthly or yearly billing, and start a ${TRIAL} at checkout.`,
    body,
    config: { mail: MAIL_TO, products: BUY_PRODUCTS, endpoint: CHECKOUT_ENDPOINT, trialDays: TRIAL_DAYS },
  });
}

function thanks() {
  const links = ORDER.map((k) => `<a class="btn ghost" href="${APPS[k].url}">Open ${APPS[k].name}</a>`).join('');
  return page({
    path: '/buy/thanks', title: 'You’re all set | Kal Voe', desc: 'Your Kal Voe plan is ready.',
    body: `<section class="nf"><div class="wrap"><div class="suite-icons">${ORDER.map((k) => appIcon(k, 52, APPS[k].name)).join('')}</div><h1>You’re all set</h1><p class="lede" style="margin:0 auto 28px">Sign in to each app with the email you paid with and your plan is on.</p><div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap">${links}</div><p class="note" style="margin-top:28px">Something not right? <a href="${MAIL}">Email us</a>.</p></div></section>`,
  }).replace(/<link rel="canonical"[^>]*>/, '<meta name="robots" content="noindex" />');
}

function notFound() {
  return page({
    path: '/404', title: 'Page not found | Kal Voe', desc: 'This page does not exist.',
    body: `<section class="nf"><div class="wrap"><div class="suite-icons">${ORDER.map((k) => appIcon(k, 52, APPS[k].name)).join('')}</div><h1>Page not found</h1><p class="lede" style="margin:0 auto 28px">That page doesn’t exist. Try one of the apps, or go back to the suite.</p><div style="display:flex;gap:12px;justify-content:center"><a class="btn primary" href="/">Kal Voe home</a><a class="btn ghost" href="/pricing">Pricing</a></div></div></section>`,
  }).replace(/<link rel="canonical"[^>]*>/, '<meta name="robots" content="noindex" />');
}

export const PAGES = ['/', '/walkthru', '/plot', '/survey', '/pricing', '/buy'];
// Pages that exist but stay out of the sitemap (noindex).
export const HIDDEN_PAGES = ['/buy/thanks'];

export function buildAll() {
  return {
    'index.html': home(),
    'walkthru/index.html': appPage('walkthru'),
    'plot/index.html': appPage('plot'),
    'survey/index.html': appPage('survey'),
    'pricing/index.html': pricing(),
    'buy/index.html': buy(),
    'buy/thanks/index.html': thanks(),
    '404.html': notFound(),
    'robots.txt': `User-agent: *\nAllow: /\n\nSitemap: ${SITE}/sitemap.xml\n`,
    'sitemap.xml': `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${PAGES.map((p) => `  <url><loc>${SITE}${p}</loc></url>`).join('\n')}\n</urlset>\n`,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const out = buildAll();
  for (const [rel, html] of Object.entries(out)) {
    const file = join(ROOT, rel);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, html);
  }
  console.log(`Kal Voe suite site: wrote ${Object.keys(out).length} files to public/kal-voe/`);
}
