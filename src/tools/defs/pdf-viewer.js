// View PDF: read a PDF right on the page (scroll, zoom, page count), then open
// it in Survey to mark it up. Only the pages in view are drawn, each capped in
// pixels, so a 60-sheet drawing set scrolls without filling memory.
import { renderPage, releaseCanvas } from '../kit.js';

const ZOOMS = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4];
// A page is drawn at most this big; at higher zoom it is stretched a little.
const MAX_PIXELS = 12_000_000;

// The next zoom stop in or out (dir 1 or -1) from where the view is now.
export function nextZoom(zoom, dir) {
  const next = dir > 0 ? ZOOMS.find((z) => z > zoom * 1.01) : [...ZOOMS].reverse().find((z) => z < zoom * 0.99);
  return next ?? zoom;
}

// The scale to draw a page of `size` points at: sharp on this screen at this
// zoom, but never more than MAX_PIXELS.
export function drawScale(size, zoom, dpr = 1) {
  return Math.min(zoom * Math.min(2, dpr || 1), Math.sqrt(MAX_PIXELS / (size.width * size.height)));
}

const ICON = {
  minus: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M5 12h14"/></svg>',
  plus: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
};

function makeViewer(file, h) {
  const sizes = file.sizes;
  let zoom = 0; // 0 until the first layout picks "fit width"
  let fit = true;
  const scroller = h('div', { class: 'pvscroll', tabindex: '0', 'aria-label': 'Pages' });
  const label = h('span', { class: 'pvzoom', 'aria-live': 'polite' });
  const where = h('span', { class: 'pvpage' });
  const slots = sizes.map((s, i) => {
    const slot = h('div', { class: 'pvslot', 'data-page': String(i), 'aria-label': `Page ${i + 1}` });
    scroller.append(slot);
    return slot;
  });
  const drawn = new Map(); // page index -> { canvas, scale }
  const want = new Set(); // pages near the view
  let queue = Promise.resolve();
  let gen = 0;

  const fitZoom = () => {
    const room = Math.max(120, scroller.clientWidth - 32);
    return room / Math.max(...sizes.map((s) => s.width));
  };
  const pixelScale = (i) => drawScale(sizes[i], zoom, window.devicePixelRatio);

  function draw(i) {
    const my = gen;
    queue = queue.then(async () => {
      if (my !== gen || !want.has(i)) return;
      const scale = pixelScale(i);
      const have = drawn.get(i);
      if (have && Math.abs(have.scale - scale) / scale < 0.1) return;
      let canvas;
      try {
        canvas = await renderPage(await file.pdfjs(), i, { scale });
      } catch {
        return;
      }
      if (!want.has(i)) { releaseCanvas(canvas); return; }
      if (have) releaseCanvas(have.canvas);
      drawn.set(i, { canvas, scale });
      slots[i].replaceChildren(canvas);
    });
  }

  function drop(i) {
    const have = drawn.get(i);
    if (!have) return;
    releaseCanvas(have.canvas);
    have.canvas.remove();
    drawn.delete(i);
  }

  const observer = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const i = Number(e.target.dataset.page);
      if (e.isIntersecting) { want.add(i); draw(i); } else { want.delete(i); drop(i); }
    }
  }, { root: scroller, rootMargin: '600px 0px' });
  slots.forEach((s) => observer.observe(s));

  function layout(next, keepFit = false) {
    // Keep the same spot of the document in the middle while zooming.
    const mid = scroller.scrollHeight ? (scroller.scrollTop + scroller.clientHeight / 2) / scroller.scrollHeight : 0;
    fit = keepFit;
    zoom = Math.min(4, Math.max(0.05, next));
    slots.forEach((slot, i) => {
      slot.style.width = `${Math.round(sizes[i].width * zoom)}px`;
      slot.style.height = `${Math.round(sizes[i].height * zoom)}px`;
    });
    scroller.scrollTop = mid * scroller.scrollHeight - scroller.clientHeight / 2;
    label.textContent = `${Math.round(zoom * 100)}%`;
    gen += 1;
    want.forEach(draw);
  }

  let ticking = false;
  scroller.addEventListener('scroll', () => {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      const line = scroller.scrollTop + scroller.clientHeight / 3;
      let n = 0;
      while (n < slots.length - 1 && slots[n + 1].offsetTop <= line) n += 1;
      // Small last pages never reach the line; at the very end, it's the last.
      if (scroller.scrollTop + scroller.clientHeight >= scroller.scrollHeight - 2) n = slots.length - 1;
      where.textContent = `Page ${n + 1} of ${sizes.length}`;
    });
  });
  // Ctrl/⌘ + wheel or a trackpad pinch zooms the pages, not the whole site.
  scroller.addEventListener('wheel', (e) => {
    if (!e.ctrlKey) return;
    e.preventDefault();
    layout(zoom * Math.exp(-e.deltaY / 300));
  }, { passive: false });
  new ResizeObserver(() => { if (fit && scroller.clientWidth) layout(fitZoom(), true); }).observe(scroller);
  where.textContent = `Page 1 of ${sizes.length}`;
  file.release = () => {
    observer.disconnect();
    [...drawn.keys()].forEach(drop);
  };

  const bar = h('div', { class: 'pvbar' },
    h('button', { type: 'button', class: 'ibtn', 'aria-label': 'Zoom out', onclick: () => layout(nextZoom(zoom, -1)), html: ICON.minus }),
    label,
    h('button', { type: 'button', class: 'ibtn', 'aria-label': 'Zoom in', onclick: () => layout(nextZoom(zoom, 1)), html: ICON.plus }),
    h('button', { type: 'button', class: 'btn ghost', onclick: () => layout(fitZoom(), true) }, 'Fit width'),
    h('button', { type: 'button', class: 'btn ghost', onclick: () => layout(1) }, 'Actual size'),
    where);
  return h('div', { class: 'pv' }, bar, scroller);
}

export default {
  view: 'viewer',
  // Every page's size up front, so the scroll bar is right before any page
  // is drawn. Reading sizes is quick even for big sets.
  async prepare(item, busy) {
    const pdf = await item.pdfjs();
    item.sizes = [];
    for (let i = 1; i <= pdf.numPages; i += 1) {
      if (i % 20 === 0) busy(`Opening… page ${i} of ${pdf.numPages}`);
      const page = await pdf.getPage(i);
      const vp = page.getViewport({ scale: 1, rotation: page.rotate });
      item.sizes.push({ width: vp.width, height: vp.height });
      page.cleanup();
    }
  },
  makeView({ h }) {
    const views = new WeakMap();
    return {
      // The same element across redraws of the tool, so drawn pages stay.
      view(file) {
        if (!views.has(file)) views.set(file, makeViewer(file, h));
        return views.get(file);
      },
    };
  },
  // The main button opens the file in the Survey app on this site.
  act: (file, { openInSurvey }) => openInSurvey(file),
};
