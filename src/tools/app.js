// The free tool UI: drop zone, file list or page grid, options, run, save.
// Each tool in TOOLS below says which view it uses, its options, and how it
// turns the chosen files into output files.
import { ToolError } from './errors.js';
import { protectPdf, unlockPdf, looksEncrypted } from './qpdf.js';
import { parsePageSet, parseRangeGroups, formatPageSet, everyN } from './ranges.js';
import { makeZipBlob } from './zip.js';
import { noteFreeToolStep } from './funnel.js';
import {
  canvasCodec, openPdfjs, closePdfjs, renderPage, renderScan, prepareImage, gifToImages, saveFile, canvasToBytes, releaseCanvas, runQpdf,
} from './browser.js';
import { makeSign } from './sign.js';

// The PDF engine (pdf-lib, ~430 KB) loads when a file is chosen, not with the
// page, so a phone shows the drop zone sooner. Each name below stands in for
// the real function until then.
const lazy = (load, name) => async (...args) => (await load())[name](...args);
const [
  addHeaderFooter, organizePages, flattenPdf, cropPdf, readDetails, editDetails, removeAnnotations, textToPdf, mergePdfs, pickPages, deletePages, splitPdf, rotatePages, addPageNumbers, addWatermark, imagesToPdf,
] = ['addHeaderFooter', 'organizePages', 'flattenPdf', 'cropPdf', 'readDetails', 'editDetails', 'removeAnnotations', 'textToPdf', 'mergePdfs', 'pickPages', 'deletePages', 'splitPdf', 'rotatePages', 'addPageNumbers', 'addWatermark', 'imagesToPdf'].map((n) => lazy(loadOps, n));
const compressPdf = lazy(() => import('./compress.js'), 'compressPdf');

const root = document.getElementById('tool');
const TOOL_ID = root.dataset.tool;
const ACCEPT = root.dataset.accept;
const MULTIPLE = root.hasAttribute('data-multiple');
// Batch tools work on one file but take many: each file runs on its own with
// the same options, and the results come back in one ZIP.
const BATCH = root.hasAttribute('data-batch');
const batching = () => BATCH && S.files.length > 1;
// Tools a finished PDF can go on to ("id:Name|id:Name"), from the page build.
const NEXT = (root.dataset.next || '').split('|').filter(Boolean).map((p) => p.split(':'));

import {
  PDF_TYPE, base, pdfOut, blobOut, SEG, DOC_OPTIONS, blocksToPdf, docNotice, loadOps,
} from './kit.js';

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

const IMAGE_OPTIONS = [
  { key: 'pageSize', label: 'Page size', type: SEG, def: 'fit', choices: [['fit', 'Same as image'], ['a4', 'A4'], ['letter', 'Letter']] },
  { key: 'orientation', label: 'Orientation', type: SEG, def: 'auto', choices: [['auto', 'Auto'], ['portrait', 'Portrait'], ['landscape', 'Landscape']], show: (o) => o.pageSize !== 'fit' },
  { key: 'margin', label: 'Margin', type: SEG, def: '0', choices: [['0', 'None'], ['18', 'Small'], ['36', 'Big']] },
];
const TO_IMAGE_OPTIONS = [
  { key: 'dpi', label: 'Quality', type: SEG, def: '150', choices: [['72', 'Small'], ['150', 'Normal'], ['300', 'High']] },
];

async function toImages(file, opts, progress, format) {
  const pick = file.selected.size ? [...file.selected].sort((a, b) => a - b) : [...Array(file.pages).keys()];
  const type = format === 'png' ? 'image/png' : 'image/jpeg';
  const dpi = Number(opts.dpi);
  const scans = await file.scans();
  const out = [];
  for (let n = 0; n < pick.length; n += 1) {
    progress(`Page ${n + 1} of ${pick.length}`);
    const name = `${base(file.name)}-page-${pick[n] + 1}.${format}`;
    // A scan already at about this many dots per inch is saved as it is:
    // the same picture, with no second round of JPEG loss.
    const scan = scans[pick[n]];
    if (format === 'jpg' && scan && !scan.rotate && Math.abs((scan.width / scan.box.width) * 72 / dpi - 1) < 0.03) {
      out.push(blobOut(name, scan.jpeg, type));
      continue;
    }
    const canvas = await file.render(pick[n], { scale: dpi / 72 });
    out.push(blobOut(name, await canvasToBytes(canvas, type, 0.9), type));
    releaseCanvas(canvas);
  }
  return out;
}

const isGif = (b) => b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46;

async function fromImages(files, opts, progress) {
  const images = [];
  for (let n = 0; n < files.length; n += 1) {
    progress(`Image ${n + 1} of ${files.length}`);
    const f = files[n];
    if (opts.frames === 'all' && isGif(f.bytes)) {
      images.push(...await gifToImages(f.bytes, (i, total) => progress(`Image ${n + 1} of ${files.length}: frame ${i + 1} of ${total}`)));
    } else images.push(...await prepareImage(f.bytes, f.mime));
  }
  progress('Making the PDF');
  if (!images.length) throw new ToolError('Add at least one image.');
  const name = files.length === 1 ? `${base(files[0].name)}.pdf` : 'images.pdf';
  return [pdfOut(name, await imagesToPdf(images, { pageSize: opts.pageSize, orientation: opts.orientation, margin: Number(opts.margin) }))];
}

// Shared by the tools that write on pages.
const FONT_CHOICES = [['helvetica', 'Helvetica'], ['times', 'Times'], ['courier', 'Courier']];
const STAMP_PAGES = { label: 'Pages', type: 'text', more: true, def: '', placeholder: 'All pages', help: 'Leave it empty for every page, or type pages like 2-10, 15.' };
const STAMP_TEXT = (size) => [
  { key: 'font', label: 'Font', type: SEG, more: true, def: 'helvetica', choices: FONT_CHOICES },
  { key: 'bold', label: 'Bold', type: 'check', more: true, def: false },
  { key: 'size', label: 'Text size', type: 'select', more: true, def: size, choices: ['8', '9', '10', '11', '12', '14', '16', '18', '24', '32', '48'].map((n) => [n, `${n} pt`]) },
  { key: 'color', label: 'Color', type: 'color', more: true, def: '#1a1a1a' },
];

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
    // With several files there are no page tiles, so one choice turns every
    // page of every file (on top of any page turned by hand before).
    options: [{ key: 'turnAll', label: 'Turn every page', type: SEG, def: '1', show: (o, files) => files.length > 1, choices: [['-1', 'Left'], ['1', 'Right'], ['2', 'Upside down']] }],
    async run([file], o, progress, { batch } = {}) {
      const extra = batch ? Number(o.turnAll) || 0 : 0;
      const turns = Object.fromEntries(Array.from({ length: file.pages }, (_, i) => [i, (file.turns.get(i) || 0) + extra]));
      if (!Object.values(turns).some((q) => q % 4)) throw new ToolError('Turn at least one page first.');
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
      { key: 'format', label: 'Style', type: 'select', def: 'n', choices: [['n', '1'], ['page', 'Page 1'], ['of', 'Page 1 of 10'], ['nof', '1 of 10'], ['slash', '1 / 10'], ['dash', '- 1 -'], ['custom', 'Your own words']] },
      { key: 'custom', label: 'Your words', type: 'text', def: 'Sheet {n} of {p}', show: (o) => o.format === 'custom', help: '{n} becomes the number and {p} the last number.' },
      { key: 'start', label: 'First number', type: 'number', def: '1', min: 0 },
      { key: 'skipFirst', label: 'Skip the first page', type: 'check', def: false },
      { key: 'style', label: 'Number type', type: 'select', more: true, def: '1', choices: [['1', '1, 2, 3'], ['i', 'i, ii, iii'], ['I', 'I, II, III'], ['a', 'a, b, c'], ['A', 'A, B, C'], ['bates', 'Bates: 000001']] },
      { key: 'prefix', label: 'Before the number', type: 'text', more: true, def: '', placeholder: 'ABC-', show: (o) => o.style === 'bates' },
      { key: 'suffix', label: 'After the number', type: 'text', more: true, def: '', show: (o) => o.style === 'bates' },
      { key: 'pages', ...STAMP_PAGES },
      { key: 'margin', label: 'Space from the edge', type: SEG, more: true, def: 'auto', choices: [['auto', 'Auto'], ['18', '¼ in'], ['36', '½ in'], ['72', '1 in']] },
      ...STAMP_TEXT('11'),
    ],
    async run([file], o) {
      const bytes = await addPageNumbers(file.bytes, {
        position: o.position, format: o.format, custom: o.custom, start: Math.floor(Number(o.start) || 0), skipFirst: o.skipFirst,
        style: o.style, prefix: o.prefix, suffix: o.suffix, pages: o.pages, margin: o.margin, font: o.font, bold: o.bold, size: Number(o.size), color: o.color,
      });
      return [pdfOut(`${base(file.name)}-numbered.pdf`, bytes)];
    },
  },
  'watermark-pdf': {
    view: 'pages',
    options: [
      { key: 'kind', label: 'Watermark', type: SEG, def: 'text', choices: [['text', 'Words'], ['image', 'Image']] },
      { key: 'text', label: 'Words', type: 'text', def: 'DRAFT', placeholder: 'DRAFT', show: (o) => o.kind !== 'image' },
      { key: 'image', label: 'Image', type: 'file', accept: 'image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp', button: 'Choose an image', show: (o) => o.kind === 'image', help: 'A PNG or JPG, like a logo or a stamp.' },
      { key: 'color', label: 'Color', type: 'color', def: '#c7382b', show: (o) => o.kind !== 'image' },
      { key: 'size', label: 'Size', type: SEG, def: '0.6', choices: [['0.35', 'Small'], ['0.6', 'Medium'], ['0.9', 'Large']] },
      { key: 'opacity', label: 'See-through', type: SEG, def: '0.25', choices: [['0.15', 'Faint'], ['0.25', 'Light'], ['0.5', 'Strong'], ['1', 'Solid']] },
      { key: 'position', label: 'Where', type: SEG, grid: true, def: 'center', show: (o) => !o.tile, choices: [['top-left', 'Top left'], ['top', 'Top'], ['top-right', 'Top right'], ['left', 'Left'], ['center', 'Middle'], ['right', 'Right'], ['bottom-left', 'Bottom left'], ['bottom', 'Bottom'], ['bottom-right', 'Bottom right']] },
      { key: 'angle', label: 'Angle', type: SEG, more: true, def: 'diag', choices: [['diag', 'Corner to corner'], ['0', 'Level'], ['45', '45°'], ['custom', 'Other']] },
      { key: 'angleCustom', label: 'Degrees', type: 'number', more: true, def: '30', show: (o) => o.angle === 'custom', help: 'Turns it to the left. Use a minus number to turn it right.' },
      { key: 'tile', label: 'Repeat it across the page', type: 'check', more: true, def: false, rerender: true },
      { key: 'behind', label: 'Put it behind the page', type: 'check', more: true, def: false, help: 'Scans and filled shapes will cover it.' },
      { key: 'font', label: 'Font', type: SEG, more: true, def: 'helvetica', choices: FONT_CHOICES, show: (o) => o.kind !== 'image' },
      { key: 'bold', label: 'Bold', type: 'check', more: true, def: true, show: (o) => o.kind !== 'image' },
      { key: 'pages', ...STAMP_PAGES },
    ],
    async run([file], o) {
      let image = null;
      if (o.kind === 'image') {
        if (!o.image) throw new ToolError('Choose an image for the watermark first.');
        // Made once, then reused for every file in a batch.
        o.image.ready ||= (await prepareImage(o.image.bytes, o.image.mime))[0];
        image = o.image.ready;
      }
      const angle = o.angle === 'custom' ? Number(o.angleCustom) || 0 : o.angle;
      const bytes = await addWatermark(file.bytes, {
        text: o.text, image, color: o.color, size: Number(o.size), opacity: Number(o.opacity), angle, position: o.position,
        tile: o.tile, behind: o.behind, font: o.font, bold: o.bold, pages: o.pages,
      });
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
  'word-to-pdf': {
    view: 'files',
    options: DOC_OPTIONS,
    async prepare(item) {
      const { inspectDocx } = await import('./docx.js');
      item.notes = await inspectDocx(item.bytes);
    },
    notice: docNotice,
    async run([file], o, progress) {
      const { readDocx } = await import('./docx.js');
      progress('Reading the document');
      const blocks = await readDocx(file.bytes);
      progress('Making the PDF');
      return [await blocksToPdf(blocks, file.name, o)];
    },
  },
  'tiff-to-pdf': { view: 'files', hint: 'Every page of a multi-page TIFF is kept. Drag files to set the order.', options: IMAGE_OPTIONS, run: fromImages },
  'protect-pdf': {
    view: 'files',
    options: [
      { key: 'password', label: 'Password', type: 'password', def: '', autocomplete: 'new-password' },
      { key: 'again', label: 'Type it again', type: 'password', def: '', autocomplete: 'new-password' },
      { key: 'show', label: 'Show password', type: 'check', def: false, rerender: true, forget: true },
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
      { key: 'show', label: 'Show password', type: 'check', def: false, rerender: true, forget: true },
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
      { key: 'tl', label: 'Header left', type: 'text', def: '', placeholder: 'Project name' },
      { key: 'tc', label: 'Header middle', type: 'text', def: '' },
      { key: 'tr', label: 'Header right', type: 'text', def: '' },
      { key: 'bl', label: 'Footer left', type: 'text', def: '' },
      { key: 'bc', label: 'Footer middle', type: 'text', def: 'Page {page} of {total}' },
      { key: 'br', label: 'Footer right', type: 'text', def: '' },
      { key: 'insert', label: 'Add to the box you are typing in', type: 'insert', target: 'bc', choices: [['{page}', 'Page number'], ['{total}', 'Page count'], ['{date}', 'Date'], ['{file}', 'File name']] },
      { key: 'dateFormat', label: 'Date', type: 'select', more: true, def: 'long', choices: [['mdy', '10/21/2026'], ['dmy', '21/10/2026'], ['ymd', '2026-10-21'], ['long', 'Oct 21, 2026']] },
      { key: 'pages', ...STAMP_PAGES },
      { key: 'skipFirst', label: 'Skip the first page', type: 'check', more: true, def: false },
      { key: 'marginY', label: 'Space from top and bottom', type: SEG, more: true, def: '36', choices: [['18', '¼ in'], ['36', '½ in'], ['72', '1 in']] },
      { key: 'marginX', label: 'Space from the sides', type: SEG, more: true, def: '72', choices: [['36', '½ in'], ['72', '1 in'], ['108', '1½ in']] },
      ...STAMP_TEXT('12'),
    ],
    async run([file], o) {
      const boxes = Object.fromEntries(['tl', 'tc', 'tr', 'bl', 'bc', 'br'].map((k) => [k, o[k]]));
      const bytes = await addHeaderFooter(file.bytes, {
        boxes, dateFormat: o.dateFormat, pages: o.pages, skipFirst: o.skipFirst, marginY: Number(o.marginY), marginX: Number(o.marginX),
        font: o.font, bold: o.bold, size: Number(o.size), color: o.color, fileName: file.name,
      });
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

// Pages of their own for searches like "DOCX to PDF", sharing a tool above.
TOOLS['docx-to-pdf'] = TOOLS['word-to-pdf'];
TOOLS['bmp-to-pdf'] = TOOLS['image-to-pdf'];
TOOLS['gif-to-pdf'] = {
  ...TOOLS['image-to-pdf'],
  options: [
    { key: 'frames', label: 'Moving GIFs', type: SEG, def: 'first', choices: [['first', 'First frame'], ['all', 'Every frame']], help: 'Every frame puts each frame of a moving GIF on its own page.' },
    ...IMAGE_OPTIONS,
  ],
};

// Tools added later live in their own module under defs/ (see kit.js for
// what they get to use), so a page only loads its own tool's code.
const T = TOOLS[TOOL_ID] || (await import(`./defs/${TOOL_ID}.js`)).default;
// Only the sign tool uses it; made lazily since it needs render() below.
let sign;
// A tool with a view of its own (the viewer) builds it with these.
const custom = T.makeView?.({ h });

// ---------------------------------------------------------------- state

const S = { files: [], opts: {}, busy: false, error: '', result: null, moreOpen: false };
let keySeq = 0;
// The text box an 'insert' option types into.
let lastText = null;

// Settings from the last time this tool made a file, kept in this browser
// only. Passwords, files and per-file defaults are never kept.
const MEMORY = `surveyTool.${TOOL_ID}`;
const keepable = (opt) => !['password', 'file', 'pages', 'insert'].includes(opt.type) && typeof opt.def !== 'function' && !opt.forget;
function recall() {
  try {
    const saved = JSON.parse(localStorage.getItem(MEMORY) || '{}');
    return saved && typeof saved === 'object' ? saved : {};
  } catch {
    return {};
  }
}
function remember() {
  try {
    const keep = {};
    for (const opt of T.options || []) if (keepable(opt)) keep[opt.key] = S.opts[opt.key];
    localStorage.setItem(MEMORY, JSON.stringify(keep));
  } catch { /* storage can be off, full or blocked; nothing to keep then */ }
}

function defaults(file) {
  const o = {};
  const saved = recall();
  for (const opt of T.options || []) {
    if (opt.type === 'pages') continue;
    // A picked extra file (type 'file') stays when the main file changes.
    if (opt.type === 'file') { o[opt.key] = S.opts[opt.key] || null; continue; }
    o[opt.key] = typeof opt.def === 'function' ? opt.def(file) : opt.def;
    const v = saved[opt.key];
    if (!keepable(opt) || v === undefined || typeof v !== typeof opt.def) continue;
    if (opt.choices && !opt.choices.some(([c]) => c === v)) continue;
    o[opt.key] = v;
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
  docx: { test: (f) => /\.(docx|doc)$/i.test(f.name) || f.type.includes('wordprocessingml'), input: '.docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document', wrong: 'Choose a Word file that ends in .docx.' },
  tiff: { test: isTiffFile, input: 'image/tiff,.tif,.tiff', wrong: 'Choose TIFF images, ones that end in .tif or .tiff.' },
  rtf: { test: (f) => /\.rtf$/i.test(f.name) || /rtf/i.test(f.type), input: '.rtf,application/rtf,text/rtf', wrong: 'Choose an RTF file, one that ends in .rtf.' },
  html: { test: (f) => /\.x?html?$/i.test(f.name) || /html/i.test(f.type), input: '.html,.htm,.xhtml,text/html', wrong: 'Choose a web page file, one that ends in .html or .htm.' },
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
  loadOps().catch(() => {});
  if (!MULTIPLE) disposeAll();
  setBusy('Opening…');
  for (const file of picked) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const item = {
      key: `f${keySeq += 1}`, name: file.name, size: file.size, mime: file.type, bytes,
      pages: 0, selected: new Set(), turns: new Map(), thumbs: new Map(), url: null, doc: null,
    };
    item.pdfjs = () => (item.doc ||= openPdfjs(bytes));
    item.scans = () => (item.scanList ||= findScans(item));
    item.render = (index, opts) => drawPage(item, index, opts);
    if (ACCEPT === 'pdf') {
      try {
        item.pages = (await item.pdfjs()).numPages;
      } catch (err) {
        const locked = err?.name === 'PasswordException';
        if (locked && T.keepLock) {
          item.locked = true;
          item.doc = null;
        } else if (!locked && T.openAnyway) {
          // Repair takes files pdf.js can't read; the tool tries other readers.
          item.broken = true;
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
    if (T.prepare) await T.prepare(item, setBusy);
    S.files.push(item);
  }
  if (S.files.length && (!MULTIPLE || !Object.keys(S.opts).length)) S.opts = defaults(S.files[0]);
  setBusy(null);
  if (T.auto && S.files.length && !S.error) run();
}

// Which pages are plain scans (see scanPages.js), so they can be drawn from
// their JPEGs. Only read with pdf-lib when the file has about a JPEG a page.
async function findScans(item) {
  if (ACCEPT !== 'pdf' || !item.pages) return [];
  try {
    const { mightBeScans, findScans: find } = await import('./scanPages.js');
    if (!mightBeScans(item.bytes, item.pages)) return [];
    const { loadPdf } = await loadOps();
    const list = find(await loadPdf(item.bytes));
    return list.length === item.pages ? list : [];
  } catch {
    return [];
  }
}

// A page as a canvas: from its JPEG when it is a plain scan, else by pdf.js.
async function drawPage(item, index, opts) {
  const scan = (await item.scans())[index];
  return (scan && await renderScan(scan, opts)) || renderPage(await item.pdfjs(), index, opts);
}

// Let go of pdf.js's copy of what it has read; it opens again when needed.
function closeDoc(item) {
  closePdfjs(item.doc);
  item.doc = null;
}

function dispose(item) {
  if (item.url) URL.revokeObjectURL(item.url);
  item.release?.();
  closeDoc(item);
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
let running = false;
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
  // Thumbnails wait while a tool runs, so the two don't fight over memory.
  while (queue.length && !running) {
    const slot = queue.shift();
    const file = S.files.find((f) => f.key === slot.dataset.file);
    if (!file || !slot.isConnected) continue;
    const index = Number(slot.dataset.page);
    let canvas = file.thumbs.get(index);
    if (!canvas) {
      try {
        canvas = await file.render(index, { width: 150 * Math.min(2, window.devicePixelRatio || 1) });
        file.thumbs.set(index, canvas);
      } catch {
        // A run closed the file under it; draw it again afterwards.
        if (running) queue.unshift(slot);
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
  if (T.rotate) preview.style.setProperty('--turn', `${((file.turns.get(0) || 0) + (Number(S.opts.turnAll) || 0)) * 90}deg`);
  const row = h('li', { class: 'frow', draggable: n > 1 ? 'true' : null, 'data-index': String(i) },
    preview,
    h('div', { class: 'fmeta' }, h('span', { class: 'fname' }, file.name), h('span', { class: 'fsub' }, `${file.locked ? 'Locked · ' : ''}${file.broken ? 'Damaged · ' : ''}${file.pages ? `${file.pages} page${file.pages === 1 ? '' : 's'} · ` : ''}${fmtSize(file.size)}`)),
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
  const notice = T.notice?.(S.files, S.opts);
  if (notice) fields.push(h('p', { class: 'tnote', role: 'note' }, notice));
  if (T.view === 'organize') {
    const removed = file.pages - file.order.length;
    fields.push(h('div', { class: 'opt' }, h('span', { class: 'olabel' }, 'Pages'),
      h('span', { class: 'ohelp' }, `${file.order.length} of ${file.pages} pages${removed ? `, ${removed} removed` : ''}`),
      h('div', { class: 'seg' }, h('button', { type: 'button', onclick: () => { file.order = null; render(); } }, 'Undo all changes'))));
  }
  if (T.rotate && !batching()) {
    const all = (d) => () => {
      for (let i = 0; i < file.pages; i += 1) file.turns.set(i, (file.turns.get(i) || 0) + d);
      root.querySelectorAll('.pgrid .thumb').forEach((el) => el.style.setProperty('--turn', `${file.turns.get(Number(el.dataset.page)) * 90}deg`));
    };
    fields.push(h('div', { class: 'opt' }, h('span', { class: 'olabel' }, 'All pages'), h('div', { class: 'seg' },
      h('button', { type: 'button', onclick: all(-1), html: `${ICON.left}<span>Turn left</span>` }),
      h('button', { type: 'button', onclick: all(1), html: `${ICON.right}<span>Turn right</span>` }))));
  }
  // Options marked `more` sit in a closed "More options" section, so the
  // defaults stay one click away and the rest is there when wanted.
  const more = [];
  const main = fields;
  for (const opt of T.options || []) {
    if (opt.show && !opt.show(S.opts, S.files)) continue;
    const fields = opt.more ? more : main;
    const id = `opt-${opt.key}`;
    const set = (v, rerender) => { S.opts[opt.key] = v; opt.onChange?.(v, S.files); if (rerender || opt.onChange) render(); };
    let control;
    if (opt.type === SEG) {
      control = h('div', { class: `seg${opt.grid ? ' grid3' : ''}`, role: 'radiogroup', 'aria-label': opt.label }, opt.choices.map(([v, l]) => h('button', {
        type: 'button', role: 'radio', 'aria-checked': String(S.opts[opt.key] === v), onclick: () => set(v, true),
      }, l)));
      fields.push(h('div', { class: 'opt' }, h('span', { class: 'olabel' }, opt.label), control));
      continue;
    }
    if (opt.type === 'file') {
      fields.push(extraFileField(opt, set));
      continue;
    }
    if (opt.type === 'check') {
      fields.push(h('label', { class: 'opt check' }, h('input', { type: 'checkbox', checked: S.opts[opt.key], onchange: (e) => set(e.target.checked, opt.rerender) }),
        h('span', {}, opt.label, opt.help && h('small', { class: 'ohelp' }, opt.help))));
      continue;
    }
    if (opt.type === 'insert') {
      // Buttons that type a token like {page} into the text box last used.
      const add = (token) => {
        const input = root.querySelector(`#opt-${lastText || opt.target}`) || root.querySelector(`#opt-${opt.target}`);
        if (!input) return;
        const key = input.id.slice(4);
        input.setRangeText(token, input.selectionStart ?? input.value.length, input.selectionEnd ?? input.value.length, 'end');
        S.opts[key] = input.value;
        input.focus();
      };
      fields.push(h('div', { class: 'opt' }, h('span', { class: 'olabel' }, opt.label), h('div', { class: 'seg' }, opt.choices.map(([token, l]) => h('button', {
        type: 'button', onmousedown: (e) => e.preventDefault(), onclick: () => add(token),
      }, l)))));
      continue;
    }
    if (opt.type === 'select') {
      control = h('select', { id, onchange: (e) => set(e.target.value, true) }, opt.choices.map(([v, l]) => h('option', { value: v, selected: S.opts[opt.key] === v }, l)));
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
        oninput: (e) => set(e.target.value), onfocus: opt.type === 'text' ? () => { lastText = opt.key; } : null,
      });
    }
    fields.push(h('div', { class: 'opt' }, h('label', { class: 'olabel', for: id }, opt.label), control, opt.help && h('span', { class: 'ohelp' }, opt.help)));
  }
  if (more.length) {
    const box = h('details', { class: 'omore', open: S.moreOpen, ontoggle: (e) => { S.moreOpen = e.target.open; } }, h('summary', {}, 'More options'), ...more);
    main.push(box);
  }
  if (T.select && !(T.options || []).some((o) => o.type === 'pages')) {
    fields.push(h('div', { class: 'opt' }, h('span', { class: 'olabel' }, 'Pages'), h('span', { class: 'ohelp', 'data-pick-count': true }, pickCount(file))));
  }
  return fields.length ? h('div', { class: 'opts' }, fields) : null;
}

// An option that takes a second file, like the image for Add image to PDF.
// Its value is { name, bytes, type, mime, url } or null (type and mime
// are the same; both names are in use).
function extraFileField(opt, set) {
  const id = `opt-${opt.key}`;
  const now = S.opts[opt.key];
  const input = h('input', {
    id, type: 'file', accept: opt.accept, class: 'ofile',
    onchange: async (e) => {
      const f = e.target.files[0];
      if (!f) return;
      if (now?.url) URL.revokeObjectURL(now.url);
      set({ name: f.name, type: f.type, mime: f.type, bytes: new Uint8Array(await f.arrayBuffer()), url: URL.createObjectURL(f) }, true);
    },
  });
  return h('div', { class: 'opt' }, h('span', { class: 'olabel' }, opt.label),
    now && h('div', { class: 'opick' }, h('img', { src: now.url, alt: '' }), h('span', {}, now.name)),
    h('label', { class: 'btn ghost', for: id }, now ? 'Change' : (opt.pick || opt.button || 'Choose a file')), input,
    now && h('button', { type: 'button', class: 'btn ghost', 'aria-label': `Remove ${now.name}`, onclick: () => { URL.revokeObjectURL(now.url); set(null, true); } }, 'Remove'),
    opt.help && h('span', { class: 'ohelp' }, opt.help));
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
  running = true;
  await loadOps().catch(() => {});
  // Thumbnails are drawn; pdf.js's copy of the file isn't needed for them
  // now, and tools that use pdf.js open the file again.
  S.files.forEach(closeDoc);
  const progress = (msg) => {
    const el = root.querySelector('[data-progress]');
    if (el) el.textContent = msg;
  };
  try {
    let outputs;
    if (batching()) {
      outputs = [];
      for (let n = 0; n < S.files.length; n += 1) {
        const tag = `File ${n + 1} of ${S.files.length}`;
        progress(tag);
        outputs.push(...await T.run([S.files[n]], S.opts, (msg) => progress(`${tag}: ${msg}`), { batch: true }));
      }
      // Two inputs with the same name would overwrite each other in the ZIP.
      const seen = new Map();
      for (const o of outputs) {
        const n = seen.get(o.name) || 0;
        seen.set(o.name, n + 1);
        if (n) o.name = o.name.replace(/(\.[a-z0-9]+)?$/i, ` (${n + 1})$1`);
      }
    } else {
      outputs = await T.run(S.files, S.opts, progress, { batch: false });
    }
    if (outputs.length > 1) {
      progress('Packing the ZIP');
      const first = S.files[0];
      const zipName = `${S.files.length === 1 ? base(first.name) : 'files'}-${TOOL_ID}.zip`;
      const blob = makeZipBlob(outputs);
      // Keep the sizes only, not a second copy of every file.
      const parts = outputs.map((o) => ({ before: o.before, size: sizeOf(o) }));
      outputs = [{ name: zipName, blob, size: blob.size, type: 'application/zip', count: outputs.length, parts, note: outputs.find((o) => o.note)?.note }];
    }
    S.result = outputs[0];
    remember();
    noteFreeToolStep('result', TOOL_ID);
  } catch (err) {
    if (!(err instanceof ToolError)) console.error(err);
    S.error = err instanceof ToolError ? err.message : 'Something went wrong with this file. Try again, or try a different file.';
  }
  running = false;
  setBusy(null);
  pump();
}

const sizeOf = (r) => (r.bytes ? r.bytes.length : r.size);

function resultView() {
  const r = S.result;
  const lines = [];
  if (TOOL_ID === 'compress-pdf') {
    const parts = r.parts || [r];
    const before = parts.reduce((n, p) => n + p.before, 0);
    const after = parts.reduce((n, p) => n + sizeOf(p), 0);
    const saved = Math.round((1 - after / before) * 100);
    lines.push(saved >= 1
      ? h('p', { class: 'rbig' }, `${fmtSize(before)} → ${fmtSize(after)}`, h('span', {}, ` ${saved}% smaller`))
      : h('p', { class: 'rbig' }, 'This file is already about as small as it gets.'));
  }
  if (r.count) lines.push(h('p', {}, `${r.count} files in one ZIP.`));
  if (r.note) lines.push(h('p', { class: 'tnote' }, r.note));
  if (r.view) lines.push(r.view(h));
  return h('div', { class: 'result', role: 'status' },
    h('h2', {}, r.title || 'Your file is ready'),
    ...lines,
    h('p', { class: 'rname' }, r.name, h('span', {}, ` · ${fmtSize(sizeOf(r))}`)),
    h('div', { class: 'ract' },
      h('button', { type: 'button', class: 'btn primary lg', onclick: () => saveFile(r.blob || r.bytes, r.name, r.type) }, r.saveLabel || 'Download'),
      h('button', { type: 'button', class: 'btn ghost lg', onclick: () => { S.result = null; render(); } }, 'Back'),
      h('button', { type: 'button', class: 'btn ghost lg', onclick: () => { disposeAll(); S.result = null; render(); } }, 'Start over')),
    r.type === PDF_TYPE && r.bytes
      ? h('div', { class: 'rapp' },
        h('p', {}, 'Want to mark it up? Survey adds pens, shapes, clouds and counts, free.'),
        h('button', { type: 'button', class: 'btn ghost', onclick: () => openInSurvey(r) }, 'Open in Survey'))
      : h('p', { class: 'fine' }, 'Want to mark up PDFs? ', h('a', { href: '/?open=app' }, 'Open Survey free'), '.'),
    r.type === PDF_TYPE && NEXT.length
      ? h('div', { class: 'rnext' }, h('p', {}, 'Continue with'),
        h('div', { class: 'rnext-btns' }, NEXT.map(([id, name]) => h('button', { type: 'button', class: 'btn ghost', onclick: () => continueWith(r, id) }, name))))
      : '');
}

// Send the result straight to another tool page, no download and pick again.
// It waits in this browser's storage and the next page takes it on load.
async function continueWith(r, id) {
  try {
    const { putHandoff, NEXT_TOOL } = await import('./handoff.js');
    await putHandoff(r.bytes, r.name, NEXT_TOOL);
    window.location.assign(`/tools/${id}?from=handoff`);
  } catch {
    S.error = 'This browser blocked passing the file on. Download it, then choose it on the next tool.';
    S.result = null;
    render();
  }
}

// A file handed on by "Continue with" on another tool page.
async function takeHandedFile() {
  window.history.replaceState(null, '', window.location.pathname);
  try {
    const { takeHandoff, NEXT_TOOL } = await import('./handoff.js');
    const file = await takeHandoff(NEXT_TOOL);
    if (file) return addFiles([file]);
  } catch { /* fall through to an empty tool */ }
  render();
}

// Hand the PDF to the app on this site; it stays in this browser throughout.
async function openInSurvey(r) {
  try {
    const { putHandoff } = await import('./handoff.js');
    await putHandoff(r.bytes, r.name);
    noteFreeToolStep('opened', TOOL_ID);
    window.location.assign('/?open=tools');
  } catch {
    // Private windows can block storage; the app still opens, just empty.
    window.location.assign('/?open=app');
  }
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
  const kind = batching() ? 'files' : T.view;
  const view = kind === 'files' ? filesView() : kind === 'organize' ? organizeView() : kind === 'sign' ? sign.view(S.files[0]) : custom ? custom.view(S.files[0]) : pagesView();
  const head = h('div', { class: 'thead' },
    h('p', { class: 'ttitle' }, kind === 'files' ? `${S.files.length} file${S.files.length === 1 ? '' : 's'}` : S.files[0].name, (kind === 'pages' || custom) && h('span', {}, ` · ${S.files[0].pages} pages`)),
    h('button', { type: 'button', class: 'btn ghost', onclick: pickFiles, disabled: !!S.busy }, MULTIPLE ? 'Add more' : 'Change file'));
  const hint = T.hint && h('p', { class: 'thint' }, T.hint);
  const action = h('div', { class: 'tbar' },
    h('button', { type: 'button', class: 'btn primary lg', onclick: T.act ? () => T.act(S.files[0], { openInSurvey }) : run, disabled: !!S.busy }, S.busy ? 'Working…' : root.dataset.action),
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
else if (new URLSearchParams(window.location.search).get('from') === 'handoff') takeHandedFile();
else render();
