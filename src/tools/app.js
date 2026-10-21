// The free tool UI: drop zone, file list or page grid, options, run, save.
// Each tool in TOOLS below says which view it uses, its options, and how it
// turns the chosen files into output files.
import {
  ToolError, addHeaderFooter, organizePages, flattenPdf, cropPdf, readDetails, editDetails, removeAnnotations, textToPdf, mergePdfs, pickPages, deletePages, splitPdf, rotatePages, addPageNumbers, addWatermark, imagesToPdf,
} from './ops.js';
import { compressPdf } from './compress.js';
import { protectPdf, unlockPdf, looksEncrypted } from './qpdf.js';
import { parsePageSet, parseRangeGroups, formatPageSet, everyN } from './ranges.js';
import { makeZip } from './zip.js';
import {
  canvasCodec, openPdfjs, renderPage, prepareImage, saveFile, canvasToBytes, releaseCanvas, runQpdf,
} from './browser.js';
import { makeSign } from './sign.js';

const root = document.getElementById('tool');
const TOOL_ID = root.dataset.tool;
const ACCEPT = root.dataset.accept;
const MULTIPLE = root.hasAttribute('data-multiple');

const PDF_TYPE = 'application/pdf';
const base = (name) => name.replace(/\.[a-z0-9]+$/i, '');
const pdfOut = (name, bytes) => ({ name, bytes, type: PDF_TYPE });

function fmtSize(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'html') el.innerHTML = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid);
  return el;
}

const ICON = {
  up: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
  down: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M12 5v14M6 13l6 6 6-6"/></svg>',
  x: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  left: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 12a8 8 0 1 0 2.3-5.6"/><path d="M4 4v5h5"/></svg>',
  right: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.6"/><path d="M20 4v5h-5"/></svg>',
  back: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M19 12H5M11 6l-6 6 6 6"/></svg>',
  fwd: '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
};

// ---------------------------------------------------------------- options

const SEG = 'seg';
const IMAGE_OPTIONS = [
  { key: 'pageSize', label: 'Page size', type: SEG, def: 'fit', choices: [['fit', 'Same as image'], ['a4', 'A4'], ['letter', 'Letter']] },
  { key: 'orientation', label: 'Orientation', type: SEG, def: 'auto', choices: [['auto', 'Auto'], ['portrait', 'Portrait'], ['landscape', 'Landscape']], show: (o) => o.pageSize !== 'fit' },
  { key: 'margin', label: 'Margin', type: SEG, def: '0', choices: [['0', 'None'], ['18', 'Small'], ['36', 'Big']] },
];
const TO_IMAGE_OPTIONS = [
  { key: 'dpi', label: 'Quality', type: SEG, def: '150', choices: [['72', 'Small'], ['150', 'Normal'], ['300', 'High']] },
];

async function toImages(file, opts, progress, format) {
  const pdf = await file.pdfjs();
  const pick = file.selected.size ? [...file.selected].sort((a, b) => a - b) : [...Array(file.pages).keys()];
  const type = format === 'png' ? 'image/png' : 'image/jpeg';
  const out = [];
  for (let n = 0; n < pick.length; n += 1) {
    progress(`Page ${n + 1} of ${pick.length}`);
    const canvas = await renderPage(pdf, pick[n], { scale: Number(opts.dpi) / 72 });
    out.push({ name: `${base(file.name)}-page-${pick[n] + 1}.${format}`, bytes: await canvasToBytes(canvas, type, 0.9), type });
    releaseCanvas(canvas);
  }
  return out;
}

async function fromImages(files, opts, progress) {
  const images = [];
  for (let n = 0; n < files.length; n += 1) {
    progress(`Image ${n + 1} of ${files.length}`);
    images.push(...await prepareImage(files[n].bytes, files[n].mime));
  }
  progress('Making the PDF');
  if (!images.length) throw new ToolError('Add at least one image.');
  const name = files.length === 1 ? `${base(files[0].name)}.pdf` : 'images.pdf';
  return [pdfOut(name, await imagesToPdf(images, { pageSize: opts.pageSize, orientation: opts.orientation, margin: Number(opts.margin) }))];
}

const TOOLS = {
  'merge-pdf': {
    view: 'files',
    hint: 'Drag the files, or use the arrows, to set the order.',
    async run(files) {
      if (files.length < 2) throw new ToolError('Add at least two PDFs to merge.');
      return [pdfOut('merged.pdf', await mergePdfs(files.map((f) => f.bytes)))];
    },
  },
  'split-pdf': {
    view: 'pages',
    options: [
      { key: 'mode', label: 'Split', type: SEG, def: 'ranges', choices: [['ranges', 'By ranges'], ['every', 'Every few pages'], ['each', 'Every page']] },
      { key: 'ranges', label: 'Ranges', type: 'text', def: (f) => (f.pages > 1 ? `1-${Math.ceil(f.pages / 2)}, ${Math.ceil(f.pages / 2) + 1}-${f.pages}` : '1'), placeholder: '1-3, 4-10', show: (o) => o.mode === 'ranges', help: 'Each range becomes its own file.' },
      { key: 'every', label: 'Pages per file', type: 'number', def: '2', min: 1, show: (o) => o.mode === 'every' },
    ],
    async run([file], opts, progress) {
      let groups;
      if (opts.mode === 'each') groups = everyN(file.pages, 1);
      else if (opts.mode === 'every') groups = everyN(file.pages, Math.max(1, Math.floor(Number(opts.every) || 1)));
      else groups = parseRangeGroups(opts.ranges, file.pages);
      const parts = await splitPdf(file.bytes, groups, (g, n) => progress(`File ${g + 1} of ${n}`));
      return parts.map((bytes, i) => pdfOut(`${base(file.name)}-pages-${formatPageSet(groups[i]).replace(/, /g, '_')}.pdf`, bytes));
    },
  },
  'compress-pdf': {
    view: 'files',
    options: [{ key: 'level', label: 'How much', type: SEG, def: 'medium', choices: [['light', 'Light'], ['medium', 'Medium'], ['strong', 'Strong']] }],
    async run(files, opts, progress) {
      const out = [];
      for (let n = 0; n < files.length; n += 1) {
        const f = files[n];
        const bytes = await compressPdf(f.bytes, opts.level, canvasCodec, (i, total) => progress(`${files.length > 1 ? `File ${n + 1} of ${files.length}: ` : ''}${Math.round((i / total) * 100)}%`));
        out.push({ ...pdfOut(`${base(f.name)}-compressed.pdf`, bytes), before: f.size });
      }
      return out;
    },
  },
  'rotate-pdf': {
    view: 'pages', rotate: true,
    async run([file]) {
      const turns = Object.fromEntries(file.turns);
      if (![...file.turns.values()].some((q) => q % 4)) throw new ToolError('Turn at least one page first.');
      return [pdfOut(`${base(file.name)}-rotated.pdf`, await rotatePages(file.bytes, turns))];
    },
  },
  'delete-pages': {
    view: 'pages', select: 'delete',
    options: [{ key: 'pages', label: 'Pages to delete', type: 'pages', placeholder: '2, 5-7' }],
    async run([file]) {
      return [pdfOut(`${base(file.name)}-edited.pdf`, await deletePages(file.bytes, [...file.selected]))];
    },
  },
  'extract-pages': {
    view: 'pages', select: 'keep',
    options: [
      { key: 'pages', label: 'Pages to keep', type: 'pages', placeholder: '1-3, 8' },
      { key: 'each', label: 'One file per page', type: 'check', def: false },
    ],
    async run([file], opts) {
      const pick = [...file.selected].sort((a, b) => a - b);
      if (!pick.length) throw new ToolError('Pick at least one page.');
      if (opts.each) {
        const out = [];
        for (const i of pick) out.push(pdfOut(`${base(file.name)}-page-${i + 1}.pdf`, await pickPages(file.bytes, [i])));
        return out;
      }
      return [pdfOut(`${base(file.name)}-pages-${formatPageSet(pick).replace(/, /g, '_')}.pdf`, await pickPages(file.bytes, pick))];
    },
  },
  'jpg-to-pdf': { view: 'files', hint: 'Drag the images, or use the arrows, to set the order.', options: IMAGE_OPTIONS, run: fromImages },
  'png-to-pdf': { view: 'files', hint: 'Drag the images, or use the arrows, to set the order.', options: IMAGE_OPTIONS, run: fromImages },
  'image-to-pdf': { view: 'files', hint: 'Drag the images, or use the arrows, to set the order.', options: IMAGE_OPTIONS, run: fromImages },
  'pdf-to-jpg': {
    view: 'pages', select: 'keep', hint: 'Every page is saved. Tap pages to save only those.',
    options: TO_IMAGE_OPTIONS, run: ([f], o, p) => toImages(f, o, p, 'jpg'),
  },
  'pdf-to-png': {
    view: 'pages', select: 'keep', hint: 'Every page is saved. Tap pages to save only those.',
    options: TO_IMAGE_OPTIONS, run: ([f], o, p) => toImages(f, o, p, 'png'),
  },
  'add-page-numbers': {
    view: 'pages',
    options: [
      { key: 'position', label: 'Where', type: 'select', def: 'bottom-center', choices: [['bottom-center', 'Bottom middle'], ['bottom-right', 'Bottom right'], ['bottom-left', 'Bottom left'], ['top-center', 'Top middle'], ['top-right', 'Top right'], ['top-left', 'Top left']] },
      { key: 'format', label: 'Style', type: 'select', def: 'n', choices: [['n', '1'], ['page', 'Page 1'], ['of', 'Page 1 of 10'], ['slash', '1 / 10']] },
      { key: 'start', label: 'First number', type: 'number', def: '1', min: 0 },
      { key: 'size', label: 'Size', type: SEG, def: '11', choices: [['9', 'Small'], ['11', 'Medium'], ['14', 'Large']] },
      { key: 'skipFirst', label: 'Skip the first page', type: 'check', def: false },
    ],
    async run([file], o) {
      const bytes = await addPageNumbers(file.bytes, { position: o.position, format: o.format, start: Math.floor(Number(o.start) || 0), size: Number(o.size), skipFirst: o.skipFirst });
      return [pdfOut(`${base(file.name)}-numbered.pdf`, bytes)];
    },
  },
  'watermark-pdf': {
    view: 'pages',
    options: [
      { key: 'text', label: 'Words', type: 'text', def: 'DRAFT', placeholder: 'DRAFT' },
      { key: 'color', label: 'Color', type: SEG, def: 'red', choices: [['red', 'Red'], ['gray', 'Gray'], ['blue', 'Blue'], ['black', 'Black']] },
      { key: 'size', label: 'Size', type: SEG, def: '0.6', choices: [['0.35', 'Small'], ['0.6', 'Medium'], ['0.9', 'Large']] },
      { key: 'opacity', label: 'See-through', type: SEG, def: '0.25', choices: [['0.15', 'Faint'], ['0.25', 'Light'], ['0.5', 'Strong']] },
      { key: 'diagonal', label: 'Across the page corner to corner', type: 'check', def: true },
    ],
    async run([file], o) {
      const bytes = await addWatermark(file.bytes, { text: o.text, color: o.color, size: Number(o.size), opacity: Number(o.opacity), diagonal: o.diagonal });
      return [pdfOut(`${base(file.name)}-watermarked.pdf`, bytes)];
    },
  },
  'crop-pdf': {
    view: 'pages',
    options: [{ key: 'trim', label: 'Trim from every edge', type: SEG, def: '36', choices: [['18', '¼ inch'], ['36', '½ inch'], ['72', '1 inch'], ['108', '1½ inch']] }],
    async run([file], o) {
      return [pdfOut(`${base(file.name)}-cropped.pdf`, await cropPdf(file.bytes, { trim: Number(o.trim) }))];
    },
  },
  'edit-pdf-details': {
    view: 'pages',
    async prepare(item) {
      item.details = await readDetails(item.bytes).catch(() => ({}));
    },
    options: [
      { key: 'title', label: 'Title', type: 'text', def: (f) => f.details?.title || '' },
      { key: 'author', label: 'Author', type: 'text', def: (f) => f.details?.author || '' },
      { key: 'subject', label: 'Subject', type: 'text', def: (f) => f.details?.subject || '' },
      { key: 'keywords', label: 'Keywords', type: 'text', def: (f) => (f.details?.keywords || '').split(/\s+/).filter(Boolean).join(', '), help: 'Put commas between them.' },
    ],
    async run([file], o) {
      return [pdfOut(file.name, await editDetails(file.bytes, o))];
    },
  },
  'remove-annotations': {
    view: 'pages',
    options: [{ key: 'keepLinks', label: 'Keep links working', type: 'check', def: true }],
    async run([file], o) {
      return [pdfOut(`${base(file.name)}-clean.pdf`, await removeAnnotations(file.bytes, { keepLinks: o.keepLinks }))];
    },
  },
  'txt-to-pdf': {
    view: 'files',
    options: [
      { key: 'font', label: 'Font', type: SEG, def: 'sans', choices: [['sans', 'Helvetica'], ['serif', 'Times'], ['mono', 'Courier']] },
      { key: 'size', label: 'Text size', type: SEG, def: '11', choices: [['9', 'Small'], ['11', 'Medium'], ['14', 'Large']] },
      { key: 'pageSize', label: 'Page size', type: SEG, def: 'letter', choices: [['letter', 'Letter'], ['a4', 'A4']] },
    ],
    async run([file], o) {
      const text = new TextDecoder().decode(file.bytes);
      return [pdfOut(`${base(file.name)}.pdf`, await textToPdf(text, { font: o.font, size: Number(o.size), pageSize: o.pageSize }))];
    },
  },
  'tiff-to-pdf': { view: 'files', hint: 'Every page of a multi-page TIFF is kept. Drag files to set the order.', options: IMAGE_OPTIONS, run: fromImages },
  'protect-pdf': {
    view: 'files',
    options: [
      { key: 'password', label: 'Password', type: 'password', def: '', autocomplete: 'new-password' },
      { key: 'again', label: 'Type it again', type: 'password', def: '', autocomplete: 'new-password' },
      { key: 'show', label: 'Show password', type: 'check', def: false, rerender: true },
      { key: 'allowPrint', label: 'Let people print it', type: 'check', def: true },
      { key: 'allowCopy', label: 'Let people copy text from it', type: 'check', def: true },
    ],
    async run([file], o) {
      if (!o.password) throw new ToolError('Type a password first.');
      if (o.password !== o.again) throw new ToolError('The two passwords don\'t match.');
      const bytes = await protectPdf(runQpdf, file.bytes, { password: o.password, allowPrint: o.allowPrint, allowCopy: o.allowCopy });
      return [pdfOut(`${base(file.name)}-protected.pdf`, bytes)];
    },
  },
  'unlock-pdf': {
    view: 'files', keepLock: true,
    options: [
      { key: 'password', label: 'Password', type: 'password', def: '', autocomplete: 'current-password', help: 'Leave it blank if the PDF opens without one and only blocks printing or copying.' },
      { key: 'show', label: 'Show password', type: 'check', def: false, rerender: true },
    ],
    async run([file], o) {
      return [pdfOut(`${base(file.name)}-unlocked.pdf`, await unlockPdf(runQpdf, file.bytes, { password: o.password }))];
    },
  },
  'sign-pdf': {
    view: 'sign',
    prepare: (item) => sign.prepare(item),
    async run([file]) {
      return [pdfOut(`${base(file.name)}-signed.pdf`, await sign.run(file))];
    },
  },
  'organize-pdf': {
    view: 'organize', hint: 'Drag pages, or use the arrows, to change the order. Turn or remove any page.',
    async run([file]) {
      return [pdfOut(`${base(file.name)}-organized.pdf`, await organizePages(file.bytes, file.order))];
    },
  },
  'add-header-footer': {
    view: 'pages',
    options: [
      { key: 'header', label: 'Header', type: 'text', def: '', placeholder: 'Project name' },
      { key: 'footer', label: 'Footer', type: 'text', def: 'Page {page} of {total}', placeholder: 'Page {page} of {total}', help: 'Use {page}, {total}, {date} or {file} to fill those in.' },
      { key: 'align', label: 'Line up', type: SEG, def: 'center', choices: [['left', 'Left'], ['center', 'Middle'], ['right', 'Right']] },
      { key: 'size', label: 'Size', type: SEG, def: '10', choices: [['8', 'Small'], ['10', 'Medium'], ['13', 'Large']] },
      { key: 'skipFirst', label: 'Skip the first page', type: 'check', def: false },
    ],
    async run([file], o) {
      const bytes = await addHeaderFooter(file.bytes, { header: o.header, footer: o.footer, align: o.align, size: Number(o.size), skipFirst: o.skipFirst, fileName: file.name });
      return [pdfOut(`${base(file.name)}-header-footer.pdf`, bytes)];
    },
  },
  'flatten-pdf': {
    view: 'pages',
    async run([file]) {
      return [pdfOut(`${base(file.name)}-flattened.pdf`, await flattenPdf(file.bytes))];
    },
  },
  'pdf-to-txt': {
    view: 'pages',
    async run([file], o, progress) {
      const pdf = await file.pdfjs();
      const out = [];
      for (let i = 1; i <= file.pages; i += 1) {
        progress(`Page ${i} of ${file.pages}`);
        const page = await pdf.getPage(i);
        const content = await page.getTextContent();
        out.push(content.items.map((it) => (it.str ?? '') + (it.hasEOL ? '\n' : '')).join('').trim());
        page.cleanup();
      }
      const text = out.join('\n\n\f');
      if (!text.replace(/\f/g, '').trim()) throw new ToolError('No text was found. This PDF may be a scan, which is a picture of the page.');
      return [{ name: `${base(file.name)}.txt`, bytes: new TextEncoder().encode(text), type: 'text/plain;charset=utf-8' }];
    },
  },
};

const T = TOOLS[TOOL_ID];
// Only the sign tool uses it; made lazily since it needs render() below.
let sign;

// ---------------------------------------------------------------- state

const S = { files: [], opts: {}, busy: false, error: '', result: null };
let keySeq = 0;

function defaults(file) {
  const o = {};
  for (const opt of T.options || []) {
    if (opt.type === 'pages') continue;
    o[opt.key] = typeof opt.def === 'function' ? opt.def(file) : opt.def;
  }
  return o;
}

const isPdf = (f) => f.type === PDF_TYPE || /\.pdf$/i.test(f.name);
const isImage = (f) => f.type.startsWith('image/') || /\.(jpe?g|png|gif|bmp|webp|tiff?)$/i.test(f.name);
const isTiffFile = (f) => f.type === 'image/tiff' || /\.tiff?$/i.test(f.name);
const isText = (f) => f.type.startsWith('text/') || /\.(txt|text|md|csv|log)$/i.test(f.name);
const ACCEPTS = {
  pdf: { test: isPdf, input: 'application/pdf,.pdf', wrong: 'That isn\'t a PDF. Choose a file that ends in .pdf.' },
  image: { test: isImage, input: 'image/jpeg,image/png,image/webp,image/gif,image/bmp,image/tiff,.jpg,.jpeg,.png,.webp,.gif,.bmp,.tif,.tiff', wrong: 'Choose JPG, PNG, WebP, GIF, BMP or TIFF images.' },
  tiff: { test: isTiffFile, input: 'image/tiff,.tif,.tiff', wrong: 'Choose TIFF images, ones that end in .tif or .tiff.' },
  text: { test: isText, input: 'text/plain,.txt,.text,.md,.csv,.log', wrong: 'Choose a plain text file, like one that ends in .txt.' },
}[ACCEPT];

async function addFiles(list) {
  const wanted = [...list].filter(ACCEPTS.test);
  if (!wanted.length) {
    S.error = ACCEPTS.wrong;
    render();
    return;
  }
  S.error = '';
  S.result = null;
  const picked = MULTIPLE ? wanted : wanted.slice(0, 1);
  if (!MULTIPLE) disposeAll();
  setBusy('Opening…');
  for (const file of picked) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const item = {
      key: `f${keySeq += 1}`, name: file.name, size: file.size, mime: file.type, bytes,
      pages: 0, selected: new Set(), turns: new Map(), thumbs: new Map(), url: null, doc: null,
    };
    item.pdfjs = () => (item.doc ||= openPdfjs(bytes));
    if (ACCEPT === 'pdf') {
      try {
        item.pages = (await item.pdfjs()).numPages;
      } catch (err) {
        const locked = err?.name === 'PasswordException';
        if (locked && T.keepLock) {
          item.locked = true;
          item.doc = null;
        } else {
          S.error = locked
            ? [`"${file.name}" is locked with a password. `, h('a', { href: '/tools/unlock-pdf' }, 'Unlock it'), ' first, then try again.']
            : `"${file.name}" could not be opened. It may be damaged.`;
          continue;
        }
      }
      // A PDF that opens without a password but blocks printing or copying is
      // still encrypted, which the page tools can't edit. Take the lock off
      // first; it needs no password, so nothing is lost.
      if (!T.keepLock && looksEncrypted(bytes)) {
        try {
          item.bytes = await unlockPdf(runQpdf, bytes);
        } catch { /* the tool will explain if it can't read the file */ }
      }
    } else if (ACCEPT === 'image' && !isTiffFile(file)) {
      item.url = URL.createObjectURL(file);
    }
    if (T.prepare) await T.prepare(item);
    S.files.push(item);
  }
  if (S.files.length && (!MULTIPLE || !Object.keys(S.opts).length)) S.opts = defaults(S.files[0]);
  setBusy(null);
}

function dispose(item) {
  if (item.url) URL.revokeObjectURL(item.url);
  item.doc?.then((d) => d.destroy()).catch(() => {});
  item.thumbs.forEach(releaseCanvas);
}

function disposeAll() {
  S.files.forEach(dispose);
  S.files = [];
}

function setBusy(msg) {
  S.busy = msg;
  render();
}

// ---------------------------------------------------------------- thumbnails

const queue = [];
let pumping = false;
const observer = 'IntersectionObserver' in window
  ? new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      observer.unobserve(e.target);
      queue.push(e.target);
    }
    pump();
  }, { rootMargin: '400px' })
  : null;

async function pump() {
  if (pumping) return;
  pumping = true;
  while (queue.length) {
    const slot = queue.shift();
    const file = S.files.find((f) => f.key === slot.dataset.file);
    if (!file || !slot.isConnected) continue;
    const index = Number(slot.dataset.page);
    let canvas = file.thumbs.get(index);
    if (!canvas) {
      try {
        canvas = await renderPage(await file.pdfjs(), index, { width: 150 * Math.min(2, window.devicePixelRatio || 1) });
        file.thumbs.set(index, canvas);
      } catch {
        continue;
      }
    }
    slot.replaceChildren(canvas);
  }
  pumping = false;
}

function thumbSlot(file, index) {
  const slot = h('div', { class: 'thumb', 'data-file': file.key, 'data-page': String(index) });
  const ready = file.thumbs.get(index);
  if (ready) slot.append(ready);
  else if (observer) observer.observe(slot);
  else { queue.push(slot); pump(); }
  return slot;
}

// ---------------------------------------------------------------- views

function fileRow(file, i) {
  const n = S.files.length;
  const move = (d) => () => {
    const [x] = S.files.splice(i, 1);
    S.files.splice(i + d, 0, x);
    render();
  };
  const remove = () => {
    dispose(file);
    S.files.splice(i, 1);
    render();
  };
  const preview = file.url ? h('div', { class: 'thumb' }, h('img', { src: file.url, alt: '' }))
    : ACCEPT === 'pdf' && !file.locked ? thumbSlot(file, 0) : h('div', { class: 'thumb ext' }, file.name.split('.').pop().slice(0, 4).toUpperCase());
  const row = h('li', { class: 'frow', draggable: n > 1 ? 'true' : null, 'data-index': String(i) },
    preview,
    h('div', { class: 'fmeta' }, h('span', { class: 'fname' }, file.name), h('span', { class: 'fsub' }, `${file.locked ? 'Locked · ' : ''}${file.pages ? `${file.pages} page${file.pages === 1 ? '' : 's'} · ` : ''}${fmtSize(file.size)}`)),
    h('div', { class: 'facts' },
      n > 1 && h('button', { type: 'button', class: 'ibtn', 'aria-label': `Move ${file.name} up`, disabled: i === 0, onclick: move(-1), html: ICON.up }),
      n > 1 && h('button', { type: 'button', class: 'ibtn', 'aria-label': `Move ${file.name} down`, disabled: i === n - 1, onclick: move(1), html: ICON.down }),
      h('button', { type: 'button', class: 'ibtn', 'aria-label': `Remove ${file.name}`, onclick: remove, html: ICON.x })));
  row.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/x-tool-row', String(i)); row.classList.add('dragging'); });
  row.addEventListener('dragend', () => row.classList.remove('dragging'));
  row.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('text/x-tool-row')) { e.preventDefault(); row.classList.add('over'); } });
  row.addEventListener('dragleave', () => row.classList.remove('over'));
  row.addEventListener('drop', (e) => {
    const from = e.dataTransfer.getData('text/x-tool-row');
    if (from === '') return;
    e.preventDefault();
    e.stopPropagation();
    const [x] = S.files.splice(Number(from), 1);
    S.files.splice(i, 0, x);
    render();
  });
  return row;
}

function filesView() {
  return h('ol', { class: 'flist' }, S.files.map(fileRow));
}

function syncPagesInput(file) {
  const input = root.querySelector('[data-pages-input]');
  if (input) input.value = formatPageSet([...file.selected]);
  const count = root.querySelector('[data-pick-count]');
  if (count) count.textContent = pickCount(file);
}

function pickCount(file) {
  const n = file.selected.size;
  if (T.select === 'delete') return n ? `${n} of ${file.pages} pages will be deleted` : 'Tap the pages to delete';
  if (TOOL_ID.startsWith('pdf-to-')) return n ? `${n} of ${file.pages} pages picked` : `All ${file.pages} pages`;
  return n ? `${n} of ${file.pages} pages picked` : 'Tap the pages to keep';
}

function pagesView() {
  const file = S.files[0];
  const grid = h('ol', { class: `pgrid${T.select ? ' selectable' : ''}${T.select === 'delete' ? ' del' : ''}` });
  for (let i = 0; i < file.pages; i += 1) {
    const q = file.turns.get(i) || 0;
    const slot = thumbSlot(file, i);
    slot.style.setProperty('--turn', `${q * 90}deg`);
    const label = h('span', { class: 'pnum' }, String(i + 1));
    let tile;
    if (T.select) {
      tile = h('button', { type: 'button', class: 'ptile', 'aria-pressed': String(file.selected.has(i)), 'aria-label': `Page ${i + 1}` }, slot, label);
      tile.addEventListener('click', () => {
        if (file.selected.has(i)) file.selected.delete(i); else file.selected.add(i);
        tile.setAttribute('aria-pressed', String(file.selected.has(i)));
        syncPagesInput(file);
      });
    } else if (T.rotate) {
      const turn = (d) => () => {
        const next = (file.turns.get(i) || 0) + d;
        file.turns.set(i, next);
        slot.style.setProperty('--turn', `${next * 90}deg`);
      };
      tile = h('div', { class: 'ptile' }, slot, label, h('div', { class: 'pturn' },
        h('button', { type: 'button', class: 'ibtn', 'aria-label': `Turn page ${i + 1} left`, onclick: turn(-1), html: ICON.left }),
        h('button', { type: 'button', class: 'ibtn', 'aria-label': `Turn page ${i + 1} right`, onclick: turn(1), html: ICON.right })));
    } else {
      tile = h('div', { class: 'ptile' }, slot, label);
    }
    grid.append(h('li', {}, tile));
  }
  return grid;
}

function organizeView() {
  const file = S.files[0];
  file.order ||= Array.from({ length: file.pages }, (_, index) => ({ index, turns: 0 }));
  const { order } = file;
  const move = (from, to) => {
    const [x] = order.splice(from, 1);
    order.splice(to, 0, x);
    render();
  };
  const grid = h('ol', { class: 'pgrid organize' });
  order.forEach((o, k) => {
    const slot = thumbSlot(file, o.index);
    slot.style.setProperty('--turn', `${o.turns * 90}deg`);
    const n = o.index + 1;
    const tile = h('div', { class: 'ptile', draggable: 'true' }, slot, h('span', { class: 'pnum' }, String(n)), h('div', { class: 'pturn' },
      h('button', { type: 'button', class: 'ibtn', 'aria-label': `Move page ${n} earlier`, disabled: k === 0, onclick: () => move(k, k - 1), html: ICON.back }),
      h('button', { type: 'button', class: 'ibtn', 'aria-label': `Turn page ${n} right`, onclick: () => { o.turns += 1; slot.style.setProperty('--turn', `${o.turns * 90}deg`); }, html: ICON.right }),
      h('button', { type: 'button', class: 'ibtn', 'aria-label': `Remove page ${n}`, onclick: () => { order.splice(k, 1); render(); }, html: ICON.x }),
      h('button', { type: 'button', class: 'ibtn', 'aria-label': `Move page ${n} later`, disabled: k === order.length - 1, onclick: () => move(k, k + 1), html: ICON.fwd })));
    tile.addEventListener('dragstart', (e) => { e.dataTransfer.setData('text/x-tool-row', String(k)); tile.classList.add('dragging'); });
    tile.addEventListener('dragend', () => tile.classList.remove('dragging'));
    tile.addEventListener('dragover', (e) => { if (e.dataTransfer.types.includes('text/x-tool-row')) { e.preventDefault(); tile.classList.add('over'); } });
    tile.addEventListener('dragleave', () => tile.classList.remove('over'));
    tile.addEventListener('drop', (e) => {
      const from = e.dataTransfer.getData('text/x-tool-row');
      if (from === '') return;
      e.preventDefault();
      e.stopPropagation();
      move(Number(from), k);
    });
    grid.append(h('li', {}, tile));
  });
  return grid;
}

function optionsView() {
  const file = S.files[0];
  const fields = T.view === 'sign' ? sign.fields(file) : [];
  if (T.view === 'organize') {
    const removed = file.pages - file.order.length;
    fields.push(h('div', { class: 'opt' }, h('span', { class: 'olabel' }, 'Pages'),
      h('span', { class: 'ohelp' }, `${file.order.length} of ${file.pages} pages${removed ? `, ${removed} removed` : ''}`),
      h('div', { class: 'seg' }, h('button', { type: 'button', onclick: () => { file.order = null; render(); } }, 'Undo all changes'))));
  }
  if (T.rotate) {
    const all = (d) => () => {
      for (let i = 0; i < file.pages; i += 1) file.turns.set(i, (file.turns.get(i) || 0) + d);
      root.querySelectorAll('.pgrid .thumb').forEach((el) => el.style.setProperty('--turn', `${file.turns.get(Number(el.dataset.page)) * 90}deg`));
    };
    fields.push(h('div', { class: 'opt' }, h('span', { class: 'olabel' }, 'All pages'), h('div', { class: 'seg' },
      h('button', { type: 'button', onclick: all(-1), html: `${ICON.left}<span>Turn left</span>` }),
      h('button', { type: 'button', onclick: all(1), html: `${ICON.right}<span>Turn right</span>` }))));
  }
  for (const opt of T.options || []) {
    if (opt.show && !opt.show(S.opts)) continue;
    const id = `opt-${opt.key}`;
    const set = (v, rerender) => { S.opts[opt.key] = v; if (rerender) render(); };
    let control;
    if (opt.type === SEG) {
      control = h('div', { class: 'seg', role: 'radiogroup', 'aria-label': opt.label }, opt.choices.map(([v, l]) => h('button', {
        type: 'button', role: 'radio', 'aria-checked': String(S.opts[opt.key] === v), onclick: () => set(v, true),
      }, l)));
      fields.push(h('div', { class: 'opt' }, h('span', { class: 'olabel' }, opt.label), control));
      continue;
    }
    if (opt.type === 'check') {
      fields.push(h('label', { class: 'opt check' }, h('input', { type: 'checkbox', checked: S.opts[opt.key], onchange: (e) => set(e.target.checked, opt.rerender) }), h('span', {}, opt.label)));
      continue;
    }
    if (opt.type === 'select') {
      control = h('select', { id, onchange: (e) => set(e.target.value) }, opt.choices.map(([v, l]) => h('option', { value: v, selected: S.opts[opt.key] === v }, l)));
    } else if (opt.type === 'pages') {
      control = h('input', {
        id, type: 'text', inputmode: 'numeric', autocomplete: 'off', placeholder: opt.placeholder, 'data-pages-input': true,
        value: formatPageSet([...file.selected]),
        oninput: (e) => {
          const hint = root.querySelector('[data-pages-hint]');
          try {
            file.selected = new Set(e.target.value.trim() ? parsePageSet(e.target.value, file.pages) : []);
            hint.textContent = '';
          } catch (err) {
            hint.textContent = err.message;
            return;
          }
          root.querySelectorAll('.ptile[aria-pressed]').forEach((el, i) => el.setAttribute('aria-pressed', String(file.selected.has(i))));
          root.querySelector('[data-pick-count]').textContent = pickCount(file);
        },
      });
      fields.push(h('div', { class: 'opt' }, h('label', { class: 'olabel', for: id }, opt.label), control,
        h('span', { class: 'ohelp', 'data-pick-count': true }, pickCount(file)), h('span', { class: 'oerr', 'data-pages-hint': true, 'aria-live': 'polite' })));
      continue;
    } else {
      control = h('input', {
        id, type: opt.type === 'password' && S.opts.show ? 'text' : opt.type, value: S.opts[opt.key], placeholder: opt.placeholder, min: opt.min,
        inputmode: opt.type === 'number' ? 'numeric' : null, autocomplete: opt.autocomplete, spellcheck: opt.type === 'password' ? 'false' : null,
        oninput: (e) => set(e.target.value),
      });
    }
    fields.push(h('div', { class: 'opt' }, h('label', { class: 'olabel', for: id }, opt.label), control, opt.help && h('span', { class: 'ohelp' }, opt.help)));
  }
  if (T.select && !(T.options || []).some((o) => o.type === 'pages')) {
    fields.push(h('div', { class: 'opt' }, h('span', { class: 'olabel' }, 'Pages'), h('span', { class: 'ohelp', 'data-pick-count': true }, pickCount(file))));
  }
  return fields.length ? h('div', { class: 'opts' }, fields) : null;
}

let picker;
function pickFiles() {
  picker?.remove();
  picker = h('input', {
    type: 'file', hidden: true, multiple: MULTIPLE,
    accept: ACCEPTS.input,
    onchange: (e) => { addFiles(e.target.files); picker.remove(); },
  });
  document.body.append(picker);
  picker.click();
}

async function run() {
  S.error = '';
  setBusy('Working…');
  const progress = (msg) => {
    const el = root.querySelector('[data-progress]');
    if (el) el.textContent = msg;
  };
  try {
    let outputs = await T.run(S.files, S.opts, progress);
    if (outputs.length > 1) {
      progress('Packing the ZIP');
      const first = S.files[0];
      const zipName = `${S.files.length === 1 ? base(first.name) : 'files'}-${TOOL_ID}.zip`;
      outputs = [{ name: zipName, bytes: makeZip(outputs), type: 'application/zip', count: outputs.length, parts: outputs }];
    }
    S.result = outputs[0];
  } catch (err) {
    if (!(err instanceof ToolError)) console.error(err);
    S.error = err instanceof ToolError ? err.message : 'Something went wrong with this file. Try again, or try a different file.';
  }
  setBusy(null);
}

function resultView() {
  const r = S.result;
  const lines = [];
  if (TOOL_ID === 'compress-pdf') {
    const parts = r.parts || [r];
    const before = parts.reduce((n, p) => n + p.before, 0);
    const after = parts.reduce((n, p) => n + p.bytes.length, 0);
    const saved = Math.round((1 - after / before) * 100);
    lines.push(saved >= 1
      ? h('p', { class: 'rbig' }, `${fmtSize(before)} → ${fmtSize(after)}`, h('span', {}, ` ${saved}% smaller`))
      : h('p', { class: 'rbig' }, 'This file is already about as small as it gets.'));
  }
  if (r.count) lines.push(h('p', {}, `${r.count} files in one ZIP.`));
  return h('div', { class: 'result', role: 'status' },
    h('h2', {}, 'Your file is ready'),
    ...lines,
    h('p', { class: 'rname' }, r.name, h('span', {}, ` · ${fmtSize(r.bytes.length)}`)),
    h('div', { class: 'ract' },
      h('button', { type: 'button', class: 'btn primary lg', onclick: () => saveFile(r.bytes, r.name, r.type) }, 'Download'),
      h('button', { type: 'button', class: 'btn ghost lg', onclick: () => { S.result = null; render(); } }, 'Back'),
      h('button', { type: 'button', class: 'btn ghost lg', onclick: () => { disposeAll(); S.result = null; render(); } }, 'Start over')),
    h('p', { class: 'fine' }, 'Want to mark it up? ', h('a', { href: '/?signin=1' }, 'Open it in Survey free'), '.'));
}

function dropzone() {
  const zone = h('div', { class: 'dz', 'data-dz': true },
    h('p', { class: 'dz-main' }, h('button', { type: 'button', class: 'btn primary lg', onclick: pickFiles }, pickLabel || 'Choose files')),
    h('p', { class: 'dz-or' }, `or drop ${MULTIPLE ? 'them' : 'it'} here`),
    h('p', { class: 'dz-safe', html: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>Your files stay on this device' }));
  const icon = root.querySelector('.dz > .ticon');
  if (icon) zone.prepend(icon.cloneNode(true));
  return zone;
}

let pickLabel;
function render() {
  const err = S.error && h('p', { class: 'terr', role: 'alert' }, S.error);
  if (S.result) {
    root.replaceChildren(resultView());
    return;
  }
  if (!S.files.length) {
    const zone = dropzone();
    zone.querySelector('.btn').textContent = pickLabel || 'Choose files';
    if (S.busy) zone.querySelector('.btn').disabled = true;
    root.replaceChildren(zone, err || '');
    return;
  }
  const view = T.view === 'files' ? filesView() : T.view === 'organize' ? organizeView() : T.view === 'sign' ? sign.view(S.files[0]) : pagesView();
  const head = h('div', { class: 'thead' },
    h('p', { class: 'ttitle' }, T.view === 'files' ? `${S.files.length} file${S.files.length === 1 ? '' : 's'}` : S.files[0].name, T.view === 'pages' && h('span', {}, ` · ${S.files[0].pages} pages`)),
    h('button', { type: 'button', class: 'btn ghost', onclick: pickFiles, disabled: !!S.busy }, MULTIPLE ? 'Add more' : 'Change file'));
  const hint = T.hint && h('p', { class: 'thint' }, T.hint);
  const action = h('div', { class: 'tbar' },
    h('button', { type: 'button', class: 'btn primary lg', onclick: run, disabled: !!S.busy }, S.busy ? 'Working…' : root.dataset.action),
    h('span', { class: 'tprog', 'data-progress': true, 'aria-live': 'polite' }, S.busy && S.busy !== 'Working…' ? S.busy : ''));
  root.replaceChildren(h('div', { class: 'work' }, head, hint || '', h('div', { class: 'wbody' }, h('div', { class: 'wview' }, view), optionsView() || ''), err || '', action));
}


// Files dropped anywhere on the page go to the tool, instead of the browser
// opening them in place of the page. Rows being reordered use their own type.
document.addEventListener('dragover', (e) => {
  if (!e.dataTransfer.types.includes('Files')) return;
  e.preventDefault();
  root.classList.add('drop');
});
document.addEventListener('dragleave', (e) => { if (!e.relatedTarget) root.classList.remove('drop'); });
document.addEventListener('drop', (e) => {
  root.classList.remove('drop');
  if (!e.dataTransfer.files.length) return;
  e.preventDefault();
  if (!S.busy) addFiles(e.dataTransfer.files);
});

// The page's own picker works before this script loads (it is a plain label
// and input). Take any files chosen through it, then or later.
if (T.view === 'sign') sign = makeSign({ h, rerender: () => render(), root });
const early = root.querySelector('[data-early]');
pickLabel = root.querySelector('[data-pick]')?.textContent;
early?.addEventListener('change', () => addFiles(early.files));
if (early?.files.length) addFiles(early.files);
else render();
