// Animated product demos for the Kal Voe suite site (kalvoe.com).
// Each demo is a dark app window with an inline SVG. public/kal-voe/static/suite.js
// plays them: elements with class "a" turn on at data-at seconds (and off at
// data-off), a .cursor walks through data-moves, and [data-count-to] counts up.
// Animated elements never carry a transform attribute, because the CSS
// transform that animates them would replace it; they sit inside a positioned <g>.

const C = {
  g: '#131315', p: '#1c1c1e', r: '#242426', r2: '#2c2c2f', l: '#2c2c2f', ls: '#3f3f43',
  t: '#e8e7e2', t2: '#d2d1cc', t3: '#9a9a97',
  walkthru: '#e07a5e', plot: '#5b9cff', survey: '#d8a84e', ok: '#8baa6e',
};
const S = '/kal-voe/static/';

// Attribute helpers
const a = (kind, at, off) => `class="a ${kind}" data-at="${at}"${off != null ? ` data-off="${off}"` : ''}`;
const at = (x, y, inner) => `<g transform="translate(${x} ${y})">${inner}</g>`;
const txt = (x, y, s, { size = 13, fill = C.t3, weight = 500, anchor = 'start', extra = '' } = {}) =>
  `<text x="${x}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${extra}>${s}</text>`;
const bar = (x, y, w, h = 8, fill = C.ls, r = 4) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${r}" fill="${fill}"/>`;

// A floor plan in a 600 x 400 box: outer wall, interior walls with door gaps, room names.
export function plan(x, y, s = 1, { labels = true } = {}) {
  const wall = `stroke="${C.ls}" stroke-width="${3 / s}" fill="none" stroke-linecap="square"`;
  const thin = `stroke="${C.l}" stroke-width="${1 / s}"`;
  let grid = '';
  for (let gx = 40; gx < 600; gx += 40) grid += `<line x1="${gx}" y1="0" x2="${gx}" y2="400" ${thin}/>`;
  for (let gy = 40; gy < 400; gy += 40) grid += `<line x1="0" y1="${gy}" x2="600" y2="${gy}" ${thin}/>`;
  const rooms = labels
    ? [['Lobby', 110, 30], ['Open office', 320, 30], ['Conference', 510, 30], ['IDF', 110, 268], ['Lab', 450, 268]]
        .map(([n, lx, ly]) => txt(lx, ly, n, { size: 13 / s * 0.9, anchor: 'middle', fill: C.t3 })).join('')
    : '';
  return `<g transform="translate(${x} ${y}) scale(${s})">
  <rect x="0" y="0" width="600" height="400" fill="${C.p}"/>${grid}
  <path d="M0 0H600V400H0Z M220 0V100 M220 140V240 M420 0V100 M420 140V240 M0 240H90 M130 240H330 M370 240H600 M300 240V300 M300 340V400" ${wall}/>
  <rect x="40" y="290" width="44" height="70" rx="3" fill="${C.r}" stroke="${C.ls}" stroke-width="${1 / s}"/>
  ${rooms}</g>`;
}

// Glyphs (drawn around 0,0)
const pin = (color = C.walkthru, n) => `<path d="M0 0c-6-8-12-13-12-20a12 12 0 1 1 24 0c0 7-6 12-12 20z" fill="${color}"/>${n != null ? `<text y="-15.5" font-size="11" font-weight="700" fill="${C.g}" text-anchor="middle">${n}</text>` : `<circle cy="-20" r="4.5" fill="${C.g}"/>`}`;
const device = (label, color = C.plot) => `<rect x="-12" y="-12" width="24" height="24" rx="6" fill="${C.p}" stroke="${color}" stroke-width="2"/><circle r="4" fill="${color}"/>${label ? `<rect x="-24" y="16" width="48" height="17" rx="8.5" fill="${C.r}" stroke="${C.ls}"/><text y="28.5" font-size="10" font-weight="700" fill="${color}" text-anchor="middle">${label}</text>` : ''}`;
const check = (color = C.ok, r = 9) => `<circle r="${r}" fill="${color}"/><path d="M${-r * 0.42} 0l${r * 0.3} ${r * 0.3} ${r * 0.56}-${r * 0.6}" stroke="${C.g}" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
const pingRing = (color, cls = 'ping', dataAt = 0) => `<circle class="${cls}" data-at="${dataAt}" r="10" fill="none" stroke="${color}" stroke-width="2"/>`;
const cursor = (moves) => `<g class="cursor" data-moves="${moves}"><path d="M0 0l0 17 4.5-4.2 3 6.8 2.8-1.2-3-6.6 6.1-.3z" fill="#fff" stroke="${C.g}" stroke-width="1.2" stroke-linejoin="round"/></g>`;
const chip = (x, y, w, label, color, { fill = C.r } = {}) => `<rect x="${x}" y="${y}" width="${w}" height="22" rx="11" fill="${fill}" stroke="${color}" stroke-opacity=".55"/><circle cx="${x + 12}" cy="${y + 11}" r="3.5" fill="${color}"/>${txt(x + 22, y + 15, label, { size: 11.5, fill: color, weight: 650 })}`;
const photo = (x, y, w, h, tint = '#3a3a3e') => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="6" fill="${tint}"/><path d="M${x + 6} ${y + h - 6}l${w * 0.28} -${h * 0.42} ${w * 0.18} ${h * 0.22} ${w * 0.16} -${h * 0.14} ${w * 0.26} ${h * 0.34}z" fill="#55555b"/><circle cx="${x + w * 0.74}" cy="${y + h * 0.3}" r="${Math.min(w, h) * 0.1}" fill="#6a6a70"/>`;
const wave = (x, y, n = 18, color = C.walkthru, h = 22) => {
  let s = `<g class="wave">`;
  for (let i = 0; i < n; i++) {
    const hh = h * (0.3 + 0.7 * Math.abs(Math.sin(i * 1.7)));
    s += `<rect x="${x + i * 6}" y="${y - hh / 2}" width="3" height="${hh}" rx="1.5" fill="${color}" style="animation-delay:-${(i * 0.13).toFixed(2)}s"/>`;
  }
  return s + '</g>';
};
const icon = (x, y, app, size = 22) => `<image href="${S}${app}.svg" x="${x}" y="${y}" width="${size}" height="${size}"/>`;

const winBar = (app, title, extra = '') => `<div class="win-bar"><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span><img src="${S}${app}.svg" alt="" width="18" height="18" /><b>${title}</b><span class="sp"></span>${extra}</div>`;
const win = (app, title, loop, label, svg, { vb = '0 0 960 560', small = false, extra = '' } = {}) =>
  `<figure class="win demo${small ? ' demo-sm' : ''}" data-loop="${loop}" role="img" aria-label="${label}">${winBar(app, title, extra)}<svg viewBox="${vb}" aria-hidden="true">${svg}</svg></figure>`;

// Shared device positions on the plan (plan coordinates)
const SPOTS = [[110, 110], [290, 90], [360, 180], [510, 110], [470, 330]];
const IDF = [62, 325];

/* ------------------------------------------------------------------ */
/* Home: one job flowing through Walkthru, then Plot, then Survey.     */
/* ------------------------------------------------------------------ */
export function homeFlow() {
  const ox = 34, oy = 34, sc = 1.12; // plan placement
  const P = ([x, y]) => [ox + x * sc, oy + y * sc];
  let pins = '', devs = '', cables = '', checks = '';
  SPOTS.forEach((sp, i) => {
    const [x, y] = P(sp);
    pins += at(x, y, `<g ${a('drop', 0.5 + i * 0.35, 4.4)}>${pin(C.walkthru, i + 1)}</g>`);
    devs += at(x, y, `<g ${a('pop', 4.7 + i * 0.25)}>${device(TAGS[i])}</g>`);
    const [ix, iy] = P(IDF);
    const mx = x, my = iy - 8 - i * 6;
    cables += `<path ${a('draw', 5.9 + i * 0.2)} pathLength="1" d="M${x} ${y + 12}V${my}H${ix + 30}" stroke="${C.plot}" stroke-width="2" fill="none" stroke-opacity=".8"/>`;
    checks += at(x + 14, y - 14, `<g ${a('pop', 9.0 + i * 0.3)}>${check(C.ok, 9)}</g>`);
  });
  const [px, py] = P(SPOTS[1]);
  const popup = at(px + 18, py - 120, `<g ${a('rise', 2.3, 4.4)}><rect width="190" height="104" rx="10" fill="${C.r}" stroke="${C.ls}"/>${photo(10, 10, 72, 54)}${photo(88, 10, 44, 54, '#34343a')}${txt(10, 82, 'Node 2 · Open office', { size: 12, fill: C.t, weight: 650 })}${txt(10, 97, '2 photos · voice note', { size: 11 })}</g>`);
  const px0 = 740; // right panel
  const panel = `<rect x="${px0}" y="34" width="190" height="448" rx="12" fill="${C.p}" stroke="${C.l}"/>
  <g ${a('fade', 0.2, 4.4)}>${txt(px0 + 16, 64, 'Site walk', { size: 15, fill: C.t, weight: 650 })}
    ${chip(px0 + 16, 80, 74, 'REC', C.walkthru)}${wave(px0 + 100, 91, 12, C.walkthru, 16)}
    ${txt(px0 + 16, 140, 'Nodes', { size: 12 })}<text x="${px0 + 174}" y="140" font-size="12" fill="${C.t}" font-weight="650" text-anchor="end" data-count-to="5" data-count-at="0.5" data-count-dur="1.6">0</text>
    ${[0, 1, 2, 3].map((i) => `<g ${a('rise', 1.2 + i * 0.5, 4.4)}>${bar(px0 + 16, 160 + i * 22, 150 - i * 18, 8, C.ls)}</g>`).join('')}
    <g ${a('rise', 3.0, 4.4)}><rect x="${px0 + 16}" y="260" width="158" height="70" rx="8" fill="${C.r}"/>${txt(px0 + 28, 282, 'AI summary', { size: 12, fill: C.walkthru, weight: 650 })}${bar(px0 + 28, 294, 120, 6)}${bar(px0 + 28, 308, 96, 6)}</g></g>
  <g ${a('fade', 4.5, 8.6)}>${txt(px0 + 16, 64, 'Device schedule', { size: 15, fill: C.t, weight: 650 })}
    ${TAGS.map((t, i) => `<g ${a('left', 6.4 + i * 0.25, 8.6)}>${txt(px0 + 16, 100 + i * 28, t, { size: 12, fill: C.plot, weight: 650 })}${bar(px0 + 82, 93 + i * 28, 90 - (i % 2) * 24, 7)}</g>`).join('')}
    <g ${a('rise', 7.8, 8.6)}>${chip(px0 + 16, 260, 120, 'Issued PDF', C.plot)}</g></g>
  <g ${a('fade', 8.8)}>${txt(px0 + 16, 64, 'Install progress', { size: 15, fill: C.t, weight: 650 })}
    <text x="${px0 + 16}" y="118" font-size="40" font-weight="650" fill="${C.t}" data-count-to="100" data-count-at="9" data-count-dur="2.4" data-count-suf="%">0%</text>
    ${bar(px0 + 16, 136, 158, 8, C.r2)}<rect ${a('grow', 9)} x="${px0 + 16}" y="136" width="158" height="8" rx="4" fill="${C.survey}" style="transition-duration:.45s,2.4s"/>
    ${['Installed', 'Tested', 'Commissioned'].map((t, i) => `<g ${a('rise', 9.4 + i * 0.6)}>${chip(px0 + 16, 170 + i * 32, 130, t, i === 2 ? C.ok : C.survey)}</g>`).join('')}</g>`;
  const moves = `0:400,480;0.4:${P(SPOTS[0])};0.85:${P(SPOTS[1])};1.2:${P(SPOTS[2])};1.6:${P(SPOTS[3])};2.0:${P(SPOTS[4])};2.6:640,480;4.6:${P(SPOTS[2])};8.9:${P(SPOTS[3])};11.5:640,480`;
  const svg = `<rect width="960" height="516" fill="${C.g}"/>${plan(ox, oy, sc)}${cables}${pins}${devs}${checks}${popup}${panel}${cursor(moves)}`;
  const extra = `<span class="apps-mini" aria-hidden="true"><img class="a dim" data-at="0" data-off="4.4" src="${S}walkthru.svg" width="18" height="18" alt="" /><img class="a dim" data-at="4.5" data-off="8.7" src="${S}plot.svg" width="18" height="18" alt="" /><img class="a dim" data-at="8.8" src="${S}survey.svg" width="18" height="18" alt="" /></span>`;
  const title = `<span class="swap"><span class="a fade" data-at="0" data-off="4.4">Walkthru · Site walk</span><span class="a fade" data-at="4.5" data-off="8.7">Plot · Shop drawing</span><span class="a fade" data-at="8.8">Survey · Install tracking</span></span>`;
  return `<figure class="win demo" data-loop="13.5" role="img" aria-label="One job moving through the suite: nodes dropped in Walkthru become tagged devices and cable runs in Plot, then get checked off as installed in Survey."><div class="win-bar"><span class="dots" aria-hidden="true"><i></i><i></i><i></i></span><img src="${S}kalvoe.svg" alt="" width="18" height="18" /><b>${title}</b><span class="sp"></span>${extra}</div><svg viewBox="0 0 960 516" aria-hidden="true">${svg}</svg></figure>`;
}

/* ------------------------------------------------------------------ */
/* Walkthru                                                            */
/* ------------------------------------------------------------------ */
export function walkthruHero() {
  const ox = 30, oy = 30, sc = 1.12;
  const P = ([x, y]) => [ox + x * sc, oy + y * sc];
  let pins = '';
  SPOTS.slice(0, 4).forEach((sp, i) => {
    const [x, y] = P(sp);
    const t = [1.0, 5.6, 6.6, 7.6][i];
    pins += at(x, y, `${pingRing(C.walkthru, 'ping', t + 0.25)}<g ${a('drop', t)}>${pin(C.walkthru, i + 1)}</g>`);
  });
  const [x1, y1] = P(SPOTS[0]);
  const popup = at(x1 + 20, y1 + 6, `<g ${a('rise', 1.7, 5.4)}><rect width="210" height="132" rx="10" fill="${C.r}" stroke="${C.ls}"/>${txt(12, 24, 'Node 1 · Lobby', { size: 13, fill: C.t, weight: 650 })}
    <g ${a('pop', 2.1)}>${photo(12, 36, 58, 46)}</g><g ${a('pop', 2.4)}>${photo(76, 36, 58, 46, '#34343a')}</g><g ${a('pop', 2.7)}><rect x="140" y="36" width="58" height="46" rx="6" fill="#2a2a2e"/><path d="M164 51v16l13-8z" fill="${C.t}"/></g>
    <g ${a('rise', 3.1)}>${txt(12, 102, 'Note: two cameras at the entry', { size: 11.5, fill: C.t2 })}${txt(12, 120, 'Photos 2 · Video 1', { size: 11 })}</g></g>`);
  const px0 = 740;
  const panel = `<rect x="${px0}" y="30" width="196" height="448" rx="12" fill="${C.p}" stroke="${C.l}"/>
  ${txt(px0 + 16, 60, 'Walk with the customer', { size: 14, fill: C.t, weight: 650 })}
  <g ${a('fade', 0.4)}>${chip(px0 + 16, 76, 66, 'REC', C.walkthru)}${wave(px0 + 92, 87, 13, C.walkthru, 16)}
  <text x="${px0 + 180}" y="120" font-size="12" fill="${C.t3}" text-anchor="end" data-count-to="38" data-count-at="0.4" data-count-dur="9" data-count-pre="0:" data-count-pad="2">0:00</text>${txt(px0 + 16, 120, 'Recording', { size: 12 })}</g>
  ${txt(px0 + 16, 156, 'Transcript', { size: 12, weight: 650, fill: C.t2 })}
  ${[[0, 160], [1, 132], [2, 150], [3, 110], [4, 140]].map(([i, w]) => `<g ${a('rise', 3.6 + i * 0.55)}>${bar(px0 + 16, 170 + i * 18, w, 7)}</g>`).join('')}
  <g ${a('rise', 8.6)}><rect x="${px0 + 12}" y="262" width="172" height="146" rx="10" fill="${C.r}"/>
    ${txt(px0 + 26, 286, 'AI summary', { size: 12.5, fill: C.walkthru, weight: 650 })}
    ${[0, 1, 2, 3].map((i) => `<g ${a('left', 8.9 + i * 0.3)}><circle cx="${px0 + 30}" cy="${304 + i * 22}" r="3" fill="${C.walkthru}"/>${bar(px0 + 40, 300 + i * 22, 120 - i * 14, 7)}</g>`).join('')}</g>
  <g ${a('pop', 10.4)}><rect x="${px0 + 12}" y="422" width="172" height="40" rx="10" fill="${C.plot}"/>${txt(px0 + 98, 447, 'Send to Plot', { size: 13.5, fill: C.g, weight: 700, anchor: 'middle' })}</g>
  ${at(px0 + 98, 442, pingRing(C.plot, 'ping', 10.7))}`;
  const moves = `0:520,490;0.6:${P(SPOTS[0])};3.4:600,500;5.3:${P(SPOTS[1])};6.3:${P(SPOTS[2])};7.3:${P(SPOTS[3])};10.2:${px0 + 110},444;12:${px0 + 110},444`;
  return win('walkthru', 'Walkthru · Site walk', 12.6, 'Walkthru demo: nodes dropped on a floor plan during a site walk, with photos, a video and a note at the first node, a live recording and transcript, an AI summary, and a Send to Plot button.',
    `<rect width="960" height="508" fill="${C.g}"/>${plan(ox, oy, sc)}${pins}${popup}${panel}${cursor(moves)}`, { vb: '0 0 960 508' });
}

const smallPlan = (inner, { s = 0.72, x = 24, y = 22 } = {}) => `<rect width="560" height="340" fill="${C.g}"/>${plan(x, y, s, { labels: false })}${inner}`;
const SM = (sp, s = 0.72, x = 24, y = 22) => [x + sp[0] * s, y + sp[1] * s];

export function walkthruNodes() {
  let s = '';
  SPOTS.forEach((sp, i) => {
    const [x, y] = SM(sp);
    s += at(x, y, `${pingRing(C.walkthru, 'ping', 0.6 + i * 0.6 + 0.25)}<g ${a('drop', 0.6 + i * 0.6)}>${pin(C.walkthru, i + 1)}</g>`);
  });
  const list = `<rect x="470" y="22" width="70" height="288" rx="10" fill="${C.p}" stroke="${C.l}"/>${SPOTS.map((_, i) => `<g ${a('left', 0.8 + i * 0.6)}><circle cx="490" cy="${52 + i * 34}" r="9" fill="${C.walkthru}"/><text x="490" y="${56 + i * 34}" font-size="10" font-weight="700" fill="${C.g}" text-anchor="middle">${i + 1}</text>${bar(504, 48 + i * 34, 26, 7)}</g>`).join('')}`;
  const moves = `0:300,320;${SPOTS.map((sp, i) => `${0.3 + i * 0.6}:${SM(sp)}`).join(';')};4:420,320`;
  return win('walkthru', 'Walkthru', 6.5, 'Nodes numbered 1 to 5 dropped onto a floor plan, each added to the node list.', smallPlan(list + s + cursor(moves)), { vb: '0 0 560 340', small: true });
}

export function walkthruCapture() {
  const card = `<rect x="70" y="30" width="420" height="280" rx="14" fill="${C.p}" stroke="${C.l}"/>
  ${at(104, 74, pin(C.walkthru, 3))}${txt(126, 66, 'Node 3 · Open office', { size: 15, fill: C.t, weight: 650 })}
  <g ${a('pop', 0.5)}>${photo(94, 92, 116, 86)}</g><g ${a('pop', 0.9)}>${photo(222, 92, 116, 86, '#34343a')}</g>
  <g ${a('pop', 1.3)}><rect x="350" y="92" width="116" height="86" rx="6" fill="#2a2a2e"/><circle cx="408" cy="135" r="20" fill="${C.t}" fill-opacity=".14"/><path d="M402 125v20l17-10z" fill="${C.t}"/>${txt(358, 170, '0:24', { size: 11, fill: C.t2 })}</g>
  <g ${a('rise', 2)}>${txt(94, 210, 'Note', { size: 12, fill: C.walkthru, weight: 650 })}${txt(94, 230, 'Ceiling is open. Mount the access point on the beam.', { size: 13, fill: C.t2 })}</g>
  <g ${a('rise', 2.6)}>${chip(94, 256, 96, 'Photos 2', C.t3)}${chip(198, 256, 84, 'Video 1', C.t3)}${chip(290, 256, 80, 'Note 1', C.t3)}</g>`;
  return win('walkthru', 'Walkthru', 6, 'A Walkthru node with two photos, a short video and a typed note.', `<rect width="560" height="340" fill="${C.g}"/>${card}`, { vb: '0 0 560 340', small: true });
}

export function walkthruAudio() {
  const lines = [['You', 'Can we get coverage in the lab too?'], ['Customer', 'Yes, and badge readers on both doors.'], ['You', 'Got it. I’ll add two readers.']];
  const body = `<rect x="40" y="26" width="480" height="288" rx="14" fill="${C.p}" stroke="${C.l}"/>
  ${chip(64, 48, 66, 'REC', C.walkthru)}${wave(144, 59, 40, C.walkthru, 22)}
  <text x="496" y="64" font-size="13" fill="${C.t3}" text-anchor="end" data-count-to="52" data-count-at="0.2" data-count-dur="6" data-count-pre="1:" data-count-pad="2">1:00</text>
  ${lines.map(([who, said], i) => `<g ${a('rise', 0.9 + i * 1.3)}>${txt(64, 112 + i * 56, who, { size: 12, weight: 650, fill: who === 'You' ? C.walkthru : C.t2 })}${txt(64, 132 + i * 56, said, { size: 14.5, fill: C.t })}</g>`).join('')}
  <g ${a('fade', 4.8)}>${txt(64, 298, 'Transcribing as you talk', { size: 12 })}</g>`;
  return win('walkthru', 'Walkthru', 7.5, 'A recording of the site walk with the conversation transcribed line by line.', `<rect width="560" height="340" fill="${C.g}"/>${body}`, { vb: '0 0 560 340', small: true });
}

export function walkthruSummary() {
  const items = ['6 cameras, 2 at the entry', '4 access points, open ceiling in the office', '2 badge readers on the lab doors', 'Customer wants a quote by Friday'];
  const body = `<rect x="60" y="24" width="440" height="292" rx="14" fill="${C.p}" stroke="${C.l}"/>
  ${txt(88, 60, 'AI summary', { size: 15, fill: C.walkthru, weight: 650 })}${txt(472, 60, 'Site walk · 5 nodes', { size: 12, anchor: 'end' })}
  ${items.map((t, i) => `<g ${a('left', 0.6 + i * 0.5)}><circle cx="94" cy="${96 + i * 34}" r="3.5" fill="${C.walkthru}"/>${txt(108, 101 + i * 34, t, { size: 14.5, fill: C.t })}</g>`).join('')}
  <g ${a('pop', 3.2)}><rect x="88" y="252" width="132" height="38" rx="9" fill="${C.r}" stroke="${C.ls}"/>${txt(154, 276, 'Share link', { size: 13.5, fill: C.t, weight: 650, anchor: 'middle' })}</g>
  <g ${a('pop', 3.5)}><rect x="232" y="252" width="132" height="38" rx="9" fill="${C.plot}"/>${txt(298, 276, 'Send to Plot', { size: 13.5, fill: C.g, weight: 700, anchor: 'middle' })}</g>`;
  return win('walkthru', 'Walkthru', 6.5, 'An AI summary of the walk listing what the customer wants, with Share link and Send to Plot buttons.', `<rect width="560" height="340" fill="${C.g}"/>${body}`, { vb: '0 0 560 340', small: true });
}

export function handoff() {
  // Walkthru nodes slide across and become Plot devices.
  let s = `<rect width="560" height="340" fill="${C.g}"/>
  <rect x="24" y="24" width="200" height="292" rx="12" fill="${C.p}" stroke="${C.l}"/>${icon(40, 40, 'walkthru', 22)}${txt(70, 56, 'Walkthru', { size: 13.5, fill: C.t, weight: 650 })}
  <rect x="336" y="24" width="200" height="292" rx="12" fill="${C.p}" stroke="${C.l}"/>${icon(352, 40, 'plot', 22)}${txt(382, 56, 'Plot', { size: 13.5, fill: C.t, weight: 650 })}
  <path ${a('draw', 1.2)} pathLength="1" d="M236 170H324" stroke="${C.t3}" stroke-width="2" stroke-dasharray="1" fill="none"/><path ${a('fade', 1.8)} d="M318 164l8 6-8 6" stroke="${C.t3}" stroke-width="2" fill="none"/>`;
  ['Entry camera', 'Office AP', 'Lab reader', 'Conf. display'].forEach((n, i) => {
    s += `<g ${a('left', 0.3 + i * 0.2)}>${at(52, 104 + i * 50, pin(C.walkthru, i + 1))}${txt(72, 92 + i * 50, n, { size: 12.5, fill: C.t2 })}</g>`;
    s += `<g ${a('left', 2.0 + i * 0.35)}>${at(366, 92 + i * 50, device(null))}${txt(388, 89 + i * 50, ['CAM-01', 'AP-01', 'RD-01', 'DS-01'][i], { size: 12, fill: C.plot, weight: 700 })}${txt(388, 104 + i * 50, n, { size: 11, fill: C.t3 })}</g>`;
  });
  return win('plot', 'Walkthru to Plot', 6.5, 'Four Walkthru nodes moving into Plot as tagged devices, with nothing retyped.', s, { vb: '0 0 560 340', small: true });
}

/* ------------------------------------------------------------------ */
/* Plot                                                                */
/* ------------------------------------------------------------------ */
const TAGS = ['CAM-01', 'AP-01', 'AP-02', 'CAM-02', 'RD-01'];
export function plotHero() {
  const ox = 74, oy = 28, sc = 1.0;
  const P = ([x, y]) => [ox + x * sc, oy + y * sc];
  let devs = '', cables = '';
  const [ix, iy] = P(IDF);
  SPOTS.forEach((sp, i) => {
    const [x, y] = P(sp);
    devs += at(x, y, `${pingRing(C.plot, 'ping', 0.9 + i * 0.45)}<g ${a('pop', 0.7 + i * 0.45)}>${device(TAGS[i])}</g>`);
    const my = iy - 14 - i * 7;
    cables += `<path ${a('draw', 3.4 + i * 0.3)} pathLength="1" d="M${x + 12} ${y}H${x + 22}V${my}H${ix + 24}" stroke="${C.plot}" stroke-width="2" fill="none" stroke-opacity=".75"/>`;
  });
  const rail = `<rect x="16" y="28" width="44" height="400" rx="10" fill="${C.p}" stroke="${C.l}"/>${[0, 1, 2, 3, 4, 5].map((i) => `<rect x="26" y="${42 + i * 40}" width="24" height="24" rx="6" fill="${i === 1 ? C.plot : C.r}" fill-opacity="${i === 1 ? 0.22 : 1}" stroke="${i === 1 ? C.plot : C.ls}"/>`).join('')}`;
  const tb = `<rect x="692" y="28" width="250" height="400" rx="10" fill="${C.p}" stroke="${C.l}"/>
  ${txt(708, 54, 'Properties', { size: 13.5, fill: C.t, weight: 650 })}
  <g ${a('fade', 0.7)}>${txt(708, 84, 'Tag', { size: 11.5 })}<rect x="708" y="90" width="218" height="28" rx="6" fill="${C.r}" stroke="${C.ls}"/>
  ${TAGS.map((t, i) => `<g ${a('fade', 0.7 + i * 0.45, i < TAGS.length - 1 ? 0.7 + (i + 1) * 0.45 : null)}>${txt(718, 109, t, { size: 13, fill: C.plot, weight: 700 })}</g>`).join('')}
  ${txt(708, 140, 'Floor', { size: 11.5 })}<rect x="708" y="146" width="218" height="28" rx="6" fill="${C.r}" stroke="${C.ls}"/>${txt(718, 165, 'Level 2', { size: 13, fill: C.t })}
  ${txt(708, 196, 'Cable', { size: 11.5 })}<rect x="708" y="202" width="218" height="28" rx="6" fill="${C.r}" stroke="${C.ls}"/>${txt(718, 221, 'Home run to IDF', { size: 13, fill: C.t })}</g>
  <g ${a('rise', 6.4)}><rect x="708" y="250" width="218" height="90" rx="8" fill="${C.r}"/>${txt(720, 272, 'Title block', { size: 12, fill: C.plot, weight: 650 })}${bar(720, 284, 150, 6)}${bar(720, 298, 110, 6)}${bar(720, 312, 130, 6)}</g>
  <g ${a('pop', 9.6)}><rect x="708" y="354" width="218" height="40" rx="10" fill="${C.plot}"/>${txt(817, 379, 'Issue PDF', { size: 13.5, fill: C.g, weight: 700, anchor: 'middle' })}</g>${at(817, 374, pingRing(C.plot, 'ping', 9.9))}`;
  const dock = `<rect x="74" y="442" width="868" height="104" rx="10" fill="${C.p}" stroke="${C.l}"/>
  ${txt(92, 466, 'Device schedule', { size: 13, fill: C.t, weight: 650 })}<text x="924" y="466" font-size="12" fill="${C.t3}" text-anchor="end" data-count-to="5" data-count-at="6.8" data-count-dur="1.6" data-count-suf=" devices">0 devices</text>
  ${['Tag', 'Type', 'Floor', 'Cable'].map((h, i) => txt(92 + i * 200, 488, h, { size: 11.5, weight: 650 })).join('')}
  ${[0, 1].map((r) => `<g ${a('left', 7 + r * 0.4)}>${txt(92, 510 + r * 22, TAGS[r], { size: 12, fill: C.plot, weight: 700 })}${bar(292, 503 + r * 22, 90, 7)}${txt(492, 510 + r * 22, 'L2', { size: 12, fill: C.t2 })}${bar(692, 503 + r * 22, 120, 7)}</g>`).join('')}`;
  const moves = `0:400,430;${SPOTS.map((sp, i) => `${0.4 + i * 0.45}:${P(sp)}`).join(';')};3.2:${P(IDF)};9.4:820,376;12:820,376`;
  return win('plot', 'Plot · Shop drawing', 12.5, 'Plot demo: tagged devices placed on a floor plan, cable runs drawn to the IDF, the device schedule filling in, a title block and an Issue PDF button.',
    `<rect width="960" height="560" fill="${C.g}"/>${rail}${plan(ox, oy, sc)}${cables}${devs}${tb}${dock}${cursor(moves)}`);
}

export function plotDevices() {
  let s = '';
  SPOTS.forEach((sp, i) => {
    const [x, y] = SM(sp);
    s += at(x, y, `<g ${a('pop', 0.5 + i * 0.5)}>${device(TAGS[i])}</g>`);
  });
  const side = `<rect x="470" y="22" width="70" height="288" rx="10" fill="${C.p}" stroke="${C.l}"/>${['Camera', 'AP', 'Reader', 'Display', 'Speaker'].map((n, i) => `<g>${at(490, 50 + i * 40, `<rect x="-9" y="-9" width="18" height="18" rx="5" fill="${C.p}" stroke="${C.plot}" stroke-width="1.6"/>`)}${txt(504, 54 + i * 40, n.slice(0, 4), { size: 10, fill: C.t3 })}</g>`).join('')}`;
  const moves = `0:505,50;${SPOTS.map((sp, i) => `${0.25 + i * 0.5}:${SM(sp)}`).join(';')};3.4:505,170`;
  return win('plot', 'Plot', 5.5, 'Devices placed on a floor plan, each tagged automatically: CAM-01, AP-01, AP-02, CAM-02, RD-01.', smallPlan(side + s + cursor(moves)), { vb: '0 0 560 340', small: true });
}

export function plotCabling() {
  let s = '';
  const [ix, iy] = SM(IDF);
  SPOTS.forEach((sp, i) => {
    const [x, y] = SM(sp);
    s += at(x, y, device(null));
    s += `<path ${a('draw', 0.5 + i * 0.45)} pathLength="1" d="M${x} ${y + 12}V${iy - 6 - i * 6}H${ix + 18}" stroke="${C.plot}" stroke-width="2" fill="none"/>`;
  });
  const legend = `<rect x="470" y="22" width="70" height="288" rx="10" fill="${C.p}" stroke="${C.l}"/>${txt(480, 46, 'Runs', { size: 11, weight: 650, fill: C.t2 })}<text x="505" y="80" font-size="26" font-weight="650" fill="${C.t}" text-anchor="middle" data-count-to="5" data-count-at="0.5" data-count-dur="2.2">0</text>${[0, 1, 2, 3, 4].map((i) => `<g ${a('left', 0.7 + i * 0.45)}>${txt(480, 110 + i * 22, `C-0${i + 1}`, { size: 10.5, fill: C.plot, weight: 700 })}</g>`).join('')}`;
  return win('plot', 'Plot', 5.5, 'Cable runs drawn from each device back to the IDF closet, numbered C-01 to C-05.', smallPlan(legend + s), { vb: '0 0 560 340', small: true });
}

export function plotRiser() {
  const floors = ['Roof', 'Level 3', 'Level 2', 'Level 1'];
  let s = `<rect width="560" height="340" fill="${C.g}"/><rect x="40" y="22" width="480" height="296" rx="12" fill="${C.p}" stroke="${C.l}"/>`;
  floors.forEach((f, i) => {
    const y = 60 + i * 64;
    s += `<line x1="60" y1="${y + 26}" x2="500" y2="${y + 26}" stroke="${C.ls}" stroke-dasharray="4 5"/>${txt(64, y + 18, f, { size: 12.5, weight: 650, fill: C.t2 })}`;
    const n = [1, 4, 5, 3][i];
    for (let k = 0; k < n; k++) s += at(300 + k * 38, y + 8, `<g ${a('pop', 1.4 + i * 0.4 + k * 0.12)}><rect x="-9" y="-9" width="18" height="18" rx="5" fill="${C.p}" stroke="${C.plot}" stroke-width="1.6"/><circle r="3" fill="${C.plot}"/></g>`);
    s += `<path ${a('draw', 1.2 + i * 0.4)} pathLength="1" d="M200 ${y + 8}H${290}" stroke="${C.plot}" stroke-width="2" fill="none"/>`;
    s += at(200, y + 8, `<rect x="-14" y="-10" width="28" height="20" rx="4" fill="${C.r}" stroke="${C.plot}"/>`);
  });
  s = s.replace(`<rect x="40" y="22"`, `<rect x="40" y="22"`) + `<path ${a('draw', 0.3)} pathLength="1" d="M200 300V68" stroke="${C.plot}" stroke-width="3" fill="none"/>`;
  return win('plot', 'Plot · Riser', 5.5, 'A riser diagram: a backbone from Level 1 to the roof, with the devices on each floor branching off it.', s, { vb: '0 0 560 340', small: true });
}

export function plotSchedule() {
  const rows = [['CAM-01', 'Camera', 'L2', 'C-01'], ['AP-01', 'Access point', 'L2', 'C-02'], ['AP-02', 'Access point', 'L2', 'C-03'], ['CAM-02', 'Camera', 'L2', 'C-04'], ['RD-01', 'Badge reader', 'L1', 'C-05']];
  const cols = [56, 156, 300, 370];
  let s = `<rect width="560" height="340" fill="${C.g}"/><rect x="34" y="22" width="492" height="296" rx="12" fill="${C.p}" stroke="${C.l}"/>
  ${txt(56, 52, 'Device schedule', { size: 14, fill: C.t, weight: 650 })}
  ${['Tag', 'Type', 'Floor', 'Cable'].map((h, i) => txt(cols[i], 84, h, { size: 11.5, weight: 650 })).join('')}<line x1="50" y1="94" x2="510" y2="94" stroke="${C.ls}"/>`;
  rows.forEach((r, i) => {
    s += `<g ${a('left', 0.4 + i * 0.35)}>${r.map((c, k) => txt(cols[k], 118 + i * 28, c, { size: 13, fill: k === 0 ? C.plot : C.t2, weight: k === 0 ? 700 : 500 })).join('')}</g>`;
  });
  s += `<g ${a('pop', 2.6)}><rect x="420" y="38" width="88" height="28" rx="8" fill="${C.r}" stroke="${C.ok}"/>${txt(464, 57, '.xlsx', { size: 12.5, fill: C.ok, weight: 700, anchor: 'middle' })}</g>`;
  s += `<g ${a('rise', 3)}>${txt(56, 290, 'Bill of materials', { size: 12, weight: 650, fill: C.t2 })}${txt(200, 290, 'Cameras 2 · Access points 2 · Readers 1', { size: 12 })}</g>`;
  return win('plot', 'Plot · Schedules', 5.5, 'A device schedule filling in row by row with tag, type, floor and cable, plus a bill of materials and an Excel export.', s, { vb: '0 0 560 340', small: true });
}

export function plotIssue() {
  let s = `<rect width="560" height="340" fill="${C.g}"/><rect x="70" y="18" width="420" height="304" rx="6" fill="#ececec"/>
  <g opacity=".9">${plan(86, 34, 0.5, { labels: false }).replace(`fill="${C.p}"`, 'fill="#f7f7f7"').replaceAll(`stroke="${C.ls}"`, 'stroke="#555"').replaceAll(`stroke="${C.l}"`, 'stroke="#e2e2e2"')}</g>`;
  SPOTS.forEach((sp, i) => { s += at(86 + sp[0] * 0.5, 34 + sp[1] * 0.5, `<rect x="-6" y="-6" width="12" height="12" rx="3" fill="#fff" stroke="#0062e6" stroke-width="1.6"/>`); });
  s += `<rect x="396" y="34" width="80" height="274" fill="#fff" stroke="#bbb"/>`;
  s += `<g ${a('rise', 0.6)}>${txt(404, 54, 'KAL VOE', { size: 9, fill: '#131313', weight: 700 })}</g>`;
  ['Project', 'Sheet', 'Scale', 'Rev.', 'Date'].forEach((l, i) => { s += `<g ${a('left', 1 + i * 0.3)}>${txt(404, 84 + i * 40, l, { size: 8, fill: '#666' })}<rect x="404" y="${90 + i * 40}" width="${56 - (i % 2) * 14}" height="7" rx="2" fill="#bdbdbd"/></g>`; });
  s += at(250, 210, `<g ${a('pop', 3)}><rect x="-70" y="-24" width="140" height="48" rx="6" fill="none" stroke="#0062e6" stroke-width="3"/>${txt(0, 8, 'ISSUED', { size: 22, fill: '#0062e6', weight: 700, anchor: 'middle', extra: ' letter-spacing="3"' })}</g>`);
  return win('plot', 'Plot · Issue', 5.5, 'A finished sheet with its title block filled in, stamped Issued and ready as a PDF.', s, { vb: '0 0 560 340', small: true });
}

/* ------------------------------------------------------------------ */
/* Survey                                                              */
/* ------------------------------------------------------------------ */
export function surveyHero() {
  const ox = 30, oy = 30, sc = 1.12;
  const P = ([x, y]) => [ox + x * sc, oy + y * sc];
  let devs = '';
  SPOTS.forEach((sp, i) => {
    const [x, y] = P(sp);
    devs += at(x, y, `${device(TAGS[i], C.t3)}<g ${a('pop', 1.2 + i * 0.5)}><rect x="-12" y="-12" width="24" height="24" rx="6" fill="${C.p}" stroke="${C.survey}" stroke-width="2.4"/><circle r="4" fill="${C.survey}"/></g>`
      + `<g ${a('pop', 5.4 + i * 0.5)}><rect x="-12" y="-12" width="24" height="24" rx="6" fill="${C.p}" stroke="${C.ok}" stroke-width="2.4"/><circle r="4" fill="${C.ok}"/></g>`
      + at(14, -14, `<g ${a('pop', 5.6 + i * 0.5)}>${check(C.ok, 8)}</g>`));
  });
  const px0 = 740;
  let rows = '';
  TAGS.forEach((t, i) => {
    const y = 110 + i * 46;
    rows += `${txt(px0 + 14, y + 15, t, { size: 12, fill: C.t, weight: 700 })}
    <g ${a('fade', 0, 1.2 + i * 0.5)}>${chip(px0 + 78, y, 106, 'Not started', C.t3)}</g>
    <g ${a('fade', 1.2 + i * 0.5, 5.4 + i * 0.5)}>${chip(px0 + 78, y, 106, 'Installed', C.survey)}</g>
    <g ${a('fade', 5.4 + i * 0.5)}>${chip(px0 + 78, y, 106, i < 3 ? 'Commissioned' : 'Tested', C.ok)}</g>`;
  });
  const panel = `<rect x="${px0}" y="30" width="196" height="448" rx="12" fill="${C.p}" stroke="${C.l}"/>
  ${txt(px0 + 16, 60, 'Device tracking', { size: 14, fill: C.t, weight: 650 })}${bar(px0 + 16, 76, 164, 8, C.r2)}<rect ${a('grow', 1.2)} x="${px0 + 16}" y="76" width="164" height="8" rx="4" fill="${C.ok}" style="transition-duration:.45s,8s"/>
  <text x="${px0 + 180}" y="100" font-size="12" fill="${C.t3}" text-anchor="end" data-count-to="100" data-count-at="1.2" data-count-dur="7.8" data-count-suf="% installed">0% installed</text>
  ${rows}
  <g ${a('pop', 10.2)}><rect x="${px0 + 12}" y="422" width="172" height="40" rx="10" fill="${C.r}" stroke="${C.ok}"/>${txt(px0 + 98, 447, 'Export .xlsx', { size: 13.5, fill: C.ok, weight: 700, anchor: 'middle' })}</g>`;
  const moves = `0:520,490;${SPOTS.map((sp, i) => `${0.9 + i * 0.5}:${P(sp)}`).join(';')};${SPOTS.map((sp, i) => `${5.1 + i * 0.5}:${P(sp)}`).join(';')};10:${px0 + 110},444;12:${px0 + 110},444`;
  return win('survey', 'Survey · Install tracking', 12.6, 'Survey demo: each device on the floor plan goes from not started to installed, then tested or commissioned, while the progress bar fills and an Excel export button appears.',
    `<rect width="960" height="508" fill="${C.g}"/>${plan(ox, oy, sc)}${devs}${panel}${cursor(moves)}`, { vb: '0 0 960 508' });
}

export function surveyMarkup() {
  const s = smallPlan(`
  <path ${a('draw', 0.4)} pathLength="1" d="M300 90c8-14 26-14 32 0c8-12 28-10 30 4c14 2 16 22 2 26c4 14-12 24-24 16c-6 12-26 12-32 0c-14 6-28-6-20-18c-12-6-8-24 6-24c0-2 2-4 6-4z" stroke="${C.survey}" stroke-width="2.4" fill="none"/>
  <path ${a('draw', 1.4)} pathLength="1" d="M150 250L250 170" stroke="${C.survey}" stroke-width="2.4" fill="none"/><path ${a('fade', 2)} d="M238 168l14 0-4 13" stroke="${C.survey}" stroke-width="2.4" fill="none"/>
  <g ${a('rise', 2.2)}><rect x="40" y="250" width="170" height="44" rx="6" fill="${C.r}" stroke="${C.survey}"/>${txt(52, 277, 'Move reader to door 2', { size: 13, fill: C.t })}</g>
  <path ${a('draw', 3)} pathLength="1" d="M330 270H440" stroke="${C.t2}" stroke-width="1.6" fill="none"/>
  <g ${a('fade', 3.6)}><path d="M330 264v12M440 264v12" stroke="${C.t2}" stroke-width="1.6"/><rect x="358" y="248" width="56" height="18" rx="4" fill="${C.r}"/>${txt(386, 261, "24'-6\"", { size: 11, fill: C.t, anchor: 'middle', weight: 650 })}</g>
  <rect x="470" y="22" width="70" height="288" rx="10" fill="${C.p}" stroke="${C.l}"/>${[0, 1, 2, 3, 4, 5].map((i) => `<rect x="489" y="${40 + i * 40}" width="32" height="28" rx="7" fill="${[0, 1, 4].includes(i) ? C.survey : C.r}" fill-opacity="${[0, 1, 4].includes(i) ? 0.2 : 1}" stroke="${[0, 1, 4].includes(i) ? C.survey : C.ls}"/>`).join('')}`);
  return win('survey', 'Survey · Markup', 5.8, 'Markup on a drawing: a revision cloud, an arrow with a callout that reads Move reader to door 2, and a measurement of 24 feet 6 inches.', s, { vb: '0 0 560 340', small: true });
}

export function surveyCount() {
  const pts = [[70, 60], [140, 70], [210, 60], [100, 150], [190, 150], [290, 60], [360, 80], [320, 150], [400, 150], [90, 250], [250, 250], [380, 250]];
  let s = '';
  pts.forEach(([x, y], i) => { s += at(x + 24, y + 22, `<g ${a('pop', 0.4 + i * 0.28)}><circle r="10" fill="${C.survey}"/><text y="4" font-size="10" font-weight="700" fill="${C.g}" text-anchor="middle">${i + 1}</text></g>`); });
  const side = `<rect x="470" y="22" width="70" height="288" rx="10" fill="${C.p}" stroke="${C.l}"/>${txt(505, 52, 'Total', { size: 11, anchor: 'middle', weight: 650, fill: C.t2 })}<text x="505" y="90" font-size="32" font-weight="650" fill="${C.survey}" text-anchor="middle" data-count-to="12" data-count-at="0.4" data-count-dur="3.3">0</text>${txt(505, 112, 'cameras', { size: 11, anchor: 'middle' })}`;
  return win('survey', 'Survey · Count', 6, 'Count markers numbered 1 to 12 dropped on a drawing while the running total counts up to 12 cameras.', smallPlan(side + s), { vb: '0 0 560 340', small: true });
}

export function surveyTrack() {
  const steps = ['Not started', 'Installed', 'Tested', 'Commissioned'];
  const colors = [C.t3, C.survey, C.survey, C.ok];
  let s = `<rect width="560" height="340" fill="${C.g}"/><rect x="34" y="22" width="492" height="296" rx="12" fill="${C.p}" stroke="${C.l}"/>
  ${txt(56, 54, 'Level 2 devices', { size: 14, fill: C.t, weight: 650 })}`;
  TAGS.forEach((t, i) => {
    const y = 76 + i * 44;
    s += `${txt(56, y + 16, t, { size: 13, fill: C.t, weight: 700 })}${bar(140, y + 8, 110, 7)}`;
    const last = [3, 3, 2, 2, 1][i];
    for (let k = 0; k <= last; k++) {
      const on = 0.3 + k * 1.1 + i * 0.15;
      const off = k < last ? 0.3 + (k + 1) * 1.1 + i * 0.15 : null;
      s += `<g ${a('fade', on, off)}>${chip(370, y, 128, steps[k], colors[k])}</g>`;
    }
  });
  return win('survey', 'Survey · Tracking', 6.5, 'A list of devices moving through Not started, Installed, Tested and Commissioned.', s, { vb: '0 0 560 340', small: true });
}

export function surveyChecklist() {
  const items = ['Device mounted and labeled', 'Cable tested and certified', 'Photo of the install', 'Customer walk-through done'];
  let s = `<rect width="560" height="340" fill="${C.g}"/><rect x="60" y="22" width="440" height="296" rx="12" fill="${C.p}" stroke="${C.l}"/>
  ${txt(84, 56, 'Site survey · CAM-01', { size: 14.5, fill: C.t, weight: 650 })}`;
  items.forEach((t, i) => {
    const y = 84 + i * 46;
    s += `<rect x="84" y="${y}" width="22" height="22" rx="6" fill="${C.r}" stroke="${C.ls}"/>${at(95, y + 11, `<g ${a('pop', 0.6 + i * 0.6)}>${check(C.ok, 11)}</g>`)}${txt(120, y + 16, t, { size: 14, fill: C.t2 })}`;
  });
  s += `<g ${a('pop', 3.4)}><rect x="84" y="270" width="150" height="34" rx="9" fill="${C.r}" stroke="${C.ok}"/>${txt(159, 292, 'Export .xlsx', { size: 13, fill: C.ok, weight: 700, anchor: 'middle' })}</g>`;
  return win('survey', 'Survey · Site survey', 5.8, 'A site survey checklist being ticked off item by item, then exported as an Excel spreadsheet.', s, { vb: '0 0 560 340', small: true });
}

export function surveyAsBuilt() {
  const s = `<rect width="560" height="340" fill="${C.g}"/>
  <rect x="24" y="24" width="250" height="292" rx="12" fill="${C.p}" stroke="${C.l}"/>${icon(40, 40, 'survey', 22)}${txt(70, 56, 'Survey', { size: 13.5, fill: C.t, weight: 650 })}
  <rect x="44" y="84" width="210" height="110" rx="10" fill="${C.r}" stroke="${C.survey}" stroke-opacity=".6"/>${txt(58, 108, 'As-built note · AP-02', { size: 12.5, fill: C.survey, weight: 650 })}${txt(58, 132, 'Moved 6 ft east, above', { size: 13, fill: C.t2 })}${txt(58, 152, 'the beam. Cable C-03', { size: 13, fill: C.t2 })}${txt(58, 172, 'rerouted.', { size: 13, fill: C.t2 })}
  <rect x="356" y="24" width="180" height="292" rx="12" fill="${C.p}" stroke="${C.l}"/>${icon(372, 40, 'plot', 22)}${txt(402, 56, 'Plot', { size: 13.5, fill: C.t, weight: 650 })}
  <path ${a('draw', 0.8)} pathLength="1" d="M262 140C300 140 310 150 346 150" stroke="${C.t3}" stroke-width="2" fill="none"/><path ${a('fade', 1.6)} d="M340 144l8 6-8 6" stroke="${C.t3}" stroke-width="2" fill="none"/>
  ${at(446, 150, `${device('AP-02')}`)}
  <g ${a('fade', 1.8)}><rect x="372" y="210" width="148" height="52" rx="8" fill="${C.r}" stroke="${C.plot}" stroke-opacity=".6"/>${txt(384, 232, 'Revision B', { size: 12.5, fill: C.plot, weight: 650 })}${txt(384, 250, 'As-built update', { size: 12, fill: C.t2 })}</g>
  <g ${a('pop', 2.2)}>${at(472, 132, check(C.ok, 8))}</g>`;
  return win('survey', 'Survey to Plot', 5.5, 'An as-built note written in Survey going back to Plot, which updates the drawing to revision B.', s, { vb: '0 0 560 340', small: true });
}
