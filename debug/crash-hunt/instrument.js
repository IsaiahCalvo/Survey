// Injected before the app loads (addInitScript). Tracks every canvas the page
// makes (DOM + OffscreenCanvas) through WeakRefs, so a sample can tell how
// many are still alive (attached or detached) and their total pixel area, and
// records errors / unhandled rejections / console.error.
(() => {
  if (window.__crashHunt) return;
  const H = window.__crashHunt = { errors: [], refs: [], created: 0, createdArea: 0, mutations: 0 };
  const reg = (c) => { H.created += 1; H.refs.push(new WeakRef(c)); };
  const origCreate = Document.prototype.createElement;
  Document.prototype.createElement = function createElement(tag, ...rest) {
    const el = origCreate.call(this, tag, ...rest);
    if (typeof tag === 'string' && tag.toLowerCase() === 'canvas') reg(el);
    return el;
  };
  const origCreateNS = Document.prototype.createElementNS;
  Document.prototype.createElementNS = function createElementNS(ns, tag, ...rest) {
    const el = origCreateNS.call(this, ns, tag, ...rest);
    if (typeof tag === 'string' && tag.toLowerCase() === 'canvas') reg(el);
    return el;
  };
  if (typeof window.OffscreenCanvas === 'function') {
    const O = window.OffscreenCanvas;
    const Wrapped = function OffscreenCanvas(w, h) { const c = new O(w, h); reg(c); return c; };
    Wrapped.prototype = O.prototype;
    window.OffscreenCanvas = Wrapped;
  }
  const push = (kind, msg, stack) => {
    H.errors.push({ t: Date.now(), kind, msg: String(msg).slice(0, 500), stack: String(stack || '').slice(0, 800) });
    if (H.errors.length > 400) H.errors.splice(0, 100);
  };
  window.addEventListener('error', (e) => { if (!(e instanceof ErrorEvent)) return; push('error', e.message, e.error && e.error.stack); });
  window.addEventListener('unhandledrejection', (e) => {
    const r = e.reason;
    push('rejection', r && r.message ? r.message : r, r && r.stack);
  });
  const origErr = console.error;
  console.error = function patchedError(...args) {
    try {
      push('console', args.map((a) => (a && a.message) ? a.message : (typeof a === 'string' ? a : (() => { try { return JSON.stringify(a).slice(0, 200); } catch { return String(a); } })())).join(' '),
        args.find((a) => a && a.stack)?.stack);
    } catch { /* ignore */ }
    return origErr.apply(this, args);
  };
  H.sample = () => {
    let live = 0; let area = 0; let attached = 0; let attachedArea = 0; let detached = 0; let detachedArea = 0;
    const bigDetached = [];
    H.refs = H.refs.filter((w) => {
      const c = w.deref();
      if (!c) return false;
      const a = (c.width || 0) * (c.height || 0);
      if (a > 0) {
        live += 1; area += a;
        const conn = typeof c.isConnected === 'boolean' ? c.isConnected : null;
        if (conn) { attached += 1; attachedArea += a; } else {
          detached += 1; detachedArea += a;
          if (a > 200000 && bigDetached.length < 8) bigDetached.push(`${c.width}x${c.height}${conn === null ? ' off' : ''} ${c.className || c.dataset?.role || ''}`);
        }
      }
      return true;
    });
    const mem = performance.memory ? { used: performance.memory.usedJSHeapSize, total: performance.memory.totalJSHeapSize } : null;
    const imgs = document.images.length;
    let imgDataUrlBytes = 0;
    for (const im of document.images) { if (im.src && im.src.startsWith('data:')) imgDataUrlBytes += im.src.length; }
    return {
      refs: H.refs.length, created: H.created, live, areaMP: +(area / 1e6).toFixed(2), attached, attachedMP: +(attachedArea / 1e6).toFixed(2),
      detached, detachedMP: +(detachedArea / 1e6).toFixed(2), bigDetached, mem, nodes: document.getElementsByTagName('*').length, imgs, imgDataUrlKB: Math.round(imgDataUrlBytes / 1024),
    };
  };
  // mutation rate: a cheap "is something re-rendering forever" probe
  const startMO = () => {
    try {
      new MutationObserver((list) => { H.mutations += list.length; }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, characterData: true });
    } catch { /* ignore */ }
  };
  if (document.documentElement) startMO(); else document.addEventListener('DOMContentLoaded', startMO);
})();
