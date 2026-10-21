// Sign PDF: draw or type a signature, drag it into place on a page, save.
// The signature becomes a transparent PNG drawn onto the page by signPdf.
import { signPdf } from './ops.js';
import { renderPage, canvasToBytes } from './browser.js';
import { ToolError } from './errors.js';

const FONT = '"Segoe Script", "Snell Roundhand", "Brush Script MT", "Apple Chancery", cursive';
const INK = { black: '#111', blue: '#1a3fb3' };

export function makeSign({ h, rerender, root }) {
  const sig = { mode: 'draw', strokes: [], name: '', color: 'black', date: false, page: null, box: null, art: null };
  const big = new Map();

  // ---- the signature picture

  // Draw the signature at high resolution, cropped to the ink, on a transparent
  // canvas. Returns null when there is nothing to draw yet.
  function paint() {
    const ink = INK[sig.color];
    if (sig.mode === 'type') {
      const text = sig.name.trim();
      if (!text) return null;
      const m = document.createElement('canvas').getContext('2d');
      m.font = `italic 120px ${FONT}`;
      const w = Math.ceil(m.measureText(text).width) + 40;
      const c = document.createElement('canvas');
      c.width = Math.min(4000, w);
      c.height = 190;
      const ctx = c.getContext('2d');
      ctx.font = `italic 120px ${FONT}`;
      ctx.fillStyle = ink;
      ctx.textBaseline = 'middle';
      ctx.fillText(text, 20, 95, c.width - 40);
      return c;
    }
    const pts = sig.strokes.flat();
    if (!pts.length) return null;
    const S = 900;
    const xs = pts.map((p) => p[0]);
    const ys = pts.map((p) => p[1]);
    const pad = 0.02;
    const x0 = Math.max(0, Math.min(...xs) - pad);
    const y0 = Math.max(0, Math.min(...ys) - pad * 3);
    const x1 = Math.min(1, Math.max(...xs) + pad);
    const y1 = Math.min(1, Math.max(...ys) + pad * 3);
    // Pad coordinates are 3:1, so a unit of y is a third of a unit of x.
    const w = Math.max(1, Math.round((x1 - x0) * S));
    const hgt = Math.max(1, Math.round(((y1 - y0) * S) / 3));
    const c = document.createElement('canvas');
    c.width = w;
    c.height = hgt;
    const ctx = c.getContext('2d');
    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.lineWidth = S * 0.008;
    for (const s of sig.strokes) {
      const at = (p) => [(p[0] - x0) * S, ((p[1] - y0) * S) / 3];
      if (s.length === 1) {
        const [x, y] = at(s[0]);
        ctx.beginPath();
        ctx.arc(x, y, ctx.lineWidth / 2, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      ctx.beginPath();
      ctx.moveTo(...at(s[0]));
      for (let i = 1; i < s.length; i += 1) ctx.lineTo(...at(s[i]));
      ctx.stroke();
    }
    return c;
  }

  // Keep the box's height in step with the signature's shape and the page's.
  function fitBox(file) {
    if (!sig.art || !sig.box) return;
    const d = file.dims[sig.page];
    sig.box.h = sig.box.w * (sig.art.height / sig.art.width) * (d.width / d.height);
    if (sig.box.h > 0.9) {
      sig.box.w *= 0.9 / sig.box.h;
      sig.box.h = 0.9;
    }
    sig.box.x = Math.min(Math.max(0, sig.box.x), 1 - sig.box.w);
    sig.box.y = Math.min(Math.max(0, sig.box.y), 1 - sig.box.h);
  }

  function refresh(file) {
    sig.art = paint();
    const el = root.querySelector('.sbox');
    if (!sig.art) {
      el?.remove();
      return;
    }
    if (!sig.box) {
      // Start in the bottom right, about half an inch tall (more on big sheets),
      // and never more than 45% of the page wide.
      const d = file.dims[sig.page];
      const h = Math.max(36, d.height * 0.05) / d.height;
      const w = Math.min(0.45, h * (sig.art.width / sig.art.height) * (d.height / d.width));
      sig.box = { x: 0.95 - w, y: 0, w, h: 0 };
      fitBox(file);
      sig.box.y = Math.max(0, 0.93 - sig.box.h);
    }
    fitBox(file);
    if (!el) {
      const stage = root.querySelector('.sstage');
      if (!stage) {
        rerender();
        return;
      }
      stage.append(boxEl(file));
      root.querySelector('.sview > .ohelp')?.remove();
      return;
    }
    place(el);
    el.querySelector('img').src = sig.art.toDataURL('image/png');
  }

  function place(el) {
    const b = sig.box;
    Object.assign(el.style, { left: `${b.x * 100}%`, top: `${b.y * 100}%`, width: `${b.w * 100}%`, height: `${b.h * 100}%` });
  }

  function boxEl(file) {
    const el = h('div', { class: 'sbox', tabindex: '0', role: 'group', 'aria-label': 'Signature. Drag to move it, or use the arrow keys.', onkeydown: (e) => nudge(e, file) },
      h('img', { src: sig.art.toDataURL('image/png'), alt: '' }),
      h('span', { class: 'shandle', 'aria-hidden': 'true' }));
    place(el);
    drag(el, file, 'move');
    drag(el.querySelector('.shandle'), file, 'size');
    return el;
  }

  // ---- the page with the signature on it

  async function pageCanvas(file, i) {
    if (big.has(i)) return big.get(i);
    const pdf = await file.pdfjs();
    const c = await renderPage(pdf, i, { width: 900 * Math.min(2, window.devicePixelRatio || 1) });
    c.setAttribute('aria-hidden', 'true');
    for (const [k, old] of big) {
      if (Math.abs(k - i) > 1) { old.width = 0; old.height = 0; big.delete(k); }
    }
    big.set(i, c);
    return c;
  }

  function drag(el, file, mode) {
    el.addEventListener('pointerdown', (e) => {
      if (e.button > 0) return;
      e.preventDefault();
      e.stopPropagation();
      const stage = root.querySelector('.sstage').getBoundingClientRect();
      const start = { x: e.clientX, y: e.clientY, x0: sig.box.x, y0: sig.box.y, w: sig.box.w };
      el.setPointerCapture(e.pointerId);
      const move = (ev) => {
        const dx = (ev.clientX - start.x) / stage.width;
        const dy = (ev.clientY - start.y) / stage.height;
        if (mode === 'move') {
          sig.box.x = start.x0 + dx;
          sig.box.y = start.y0 + dy;
        } else {
          sig.box.w = Math.min(1 - sig.box.x, Math.max(0.05, start.w + dx));
        }
        fitBox(file);
        place(root.querySelector('.sbox'));
      };
      const up = () => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerup', up);
        el.removeEventListener('pointercancel', up);
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerup', up);
      el.addEventListener('pointercancel', up);
    });
  }

  function nudge(e, file) {
    const step = e.shiftKey ? 0.05 : 0.01;
    const k = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
    if (!k) return;
    e.preventDefault();
    sig.box.x += k[0];
    sig.box.y += k[1];
    fitBox(file);
    place(e.currentTarget);
  }

  function view(file) {
    if (sig.page == null || sig.page >= file.pages) sig.page = file.pages - 1;
    const go = (d) => () => {
      sig.page = Math.min(file.pages - 1, Math.max(0, sig.page + d));
      fitBox(file);
      rerender();
    };
    const stage = h('div', { class: 'sstage' });
    const d = file.dims[sig.page];
    stage.style.aspectRatio = `${d.width} / ${d.height}`;
    pageCanvas(file, sig.page).then((c) => stage.prepend(c)).catch(() => {});
    if (sig.art && sig.box) stage.append(boxEl(file));
    return h('div', { class: 'sview' },
      h('div', { class: 'spager' },
        h('button', { type: 'button', class: 'ibtn', 'aria-label': 'Previous page', disabled: sig.page === 0, onclick: go(-1), html: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M15 6l-6 6 6 6"/></svg>' }),
        h('span', { class: 'pnum' }, `Page ${sig.page + 1} of ${file.pages}`),
        h('button', { type: 'button', class: 'ibtn', 'aria-label': 'Next page', disabled: sig.page === file.pages - 1, onclick: go(1), html: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>' })),
      stage,
      !sig.art && h('p', { class: 'ohelp scenter' }, 'Draw or type your signature, then drag it into place.'));
  }

  // ---- the options panel

  function pad(file) {
    const c = h('canvas', { class: 'spad', width: '900', height: '300', 'aria-label': 'Draw your signature here' });
    const ctx = c.getContext('2d');
    const redraw = () => {
      ctx.clearRect(0, 0, 900, 300);
      ctx.strokeStyle = INK[sig.color];
      ctx.lineWidth = 7;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (const s of sig.strokes) {
        ctx.beginPath();
        s.forEach(([x, y], i) => (i ? ctx.lineTo(x * 900, y * 300) : ctx.moveTo(x * 900, y * 300)));
        if (s.length === 1) ctx.lineTo(s[0][0] * 900 + 0.1, s[0][1] * 300);
        ctx.stroke();
      }
    };
    let cur = null;
    const at = (e) => {
      const r = c.getBoundingClientRect();
      return [Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), Math.min(1, Math.max(0, (e.clientY - r.top) / r.height))];
    };
    c.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      c.setPointerCapture(e.pointerId);
      cur = [at(e)];
      sig.strokes.push(cur);
      redraw();
    });
    c.addEventListener('pointermove', (e) => {
      if (!cur) return;
      for (const ev of e.getCoalescedEvents?.() || [e]) cur.push(at(ev));
      redraw();
    });
    const end = () => {
      if (!cur) return;
      cur = null;
      refresh(file);
    };
    c.addEventListener('pointerup', end);
    c.addEventListener('pointercancel', end);
    redraw();
    return c;
  }

  function fields(file) {
    const seg = (label, key, choices) => h('div', { class: 'opt' }, h('span', { class: 'olabel' }, label),
      h('div', { class: 'seg', role: 'radiogroup', 'aria-label': label }, choices.map(([v, l]) => h('button', {
        type: 'button', role: 'radio', 'aria-checked': String(sig[key] === v),
        onclick: () => { sig[key] = v; sig.art = paint(); fitBox(file); rerender(); },
      }, l))));
    const out = [seg('Signature', 'mode', [['draw', 'Draw'], ['type', 'Type']])];
    if (sig.mode === 'draw') {
      out.push(h('div', { class: 'opt' }, h('span', { class: 'olabel' }, 'Sign in the box'), pad(file),
        h('div', { class: 'seg' }, h('button', { type: 'button', onclick: () => { sig.strokes = []; refresh(file); rerender(); } }, 'Clear'))));
    } else {
      out.push(h('div', { class: 'opt' }, h('label', { class: 'olabel', for: 'opt-name' }, 'Your name'),
        h('input', { id: 'opt-name', type: 'text', autocomplete: 'name', value: sig.name, oninput: (e) => { sig.name = e.target.value; refresh(file); } })));
    }
    out.push(seg('Ink', 'color', [['black', 'Black'], ['blue', 'Blue']]));
    out.push(h('label', { class: 'opt check' }, h('input', { type: 'checkbox', checked: sig.date, onchange: (e) => { sig.date = e.target.checked; } }), h('span', {}, 'Add today\'s date under it')));
    out.push(h('p', { class: 'ohelp' }, 'Drag the signature on the page to move it. Drag its corner to make it bigger or smaller.'));
    return out;
  }

  async function run(file) {
    const art = paint();
    if (!art || !sig.box) throw new ToolError('Draw or type your signature first.');
    const image = await canvasToBytes(art, 'image/png');
    const date = sig.date ? new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()) : '';
    return signPdf(file.bytes, { page: sig.page, image, box: sig.box, date });
  }

  // Page sizes as shown (rotation applied), for the stage and the box shape.
  async function prepare(file) {
    const pdf = await file.pdfjs();
    file.dims = [];
    for (let i = 1; i <= file.pages; i += 1) {
      const p = await pdf.getPage(i);
      const v = p.getViewport({ scale: 1 });
      file.dims.push({ width: v.width, height: v.height });
    }
    sig.page = null;
    big.forEach((c) => { c.width = 0; c.height = 0; });
    big.clear();
  }

  return { view, fields, run, prepare };
}
