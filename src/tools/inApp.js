// The free PDF tools, run on documents inside the app (Documents list and the
// viewer's menus). Same in-browser code as /tools: nothing is uploaded until
// the person saves the result as a new document.
//
// sources: [{ name, bytes }]. Each tool returns [{ name, bytes }].
import { ToolError } from './errors.js';
import { parseRangeGroups, formatPageSet, everyN } from './ranges.js';

export const IN_APP_TOOLS = [
  { id: 'merge', label: 'Merge into one PDF', short: 'Join documents, in the order you set.' },
  { id: 'split', label: 'Split', short: 'Make a new document from each range of pages.' },
  { id: 'organize', label: 'Organize pages', short: 'Move, turn or remove pages.' },
  { id: 'rotate', label: 'Rotate pages', short: 'Turn every page, or only some.' },
  { id: 'compress', label: 'Compress', short: 'Make the file smaller to send.' },
  { id: 'ocr', label: 'Make searchable (OCR)', short: 'Read scanned pages so you can search them.' },
  { id: 'flatten', label: 'Flatten forms', short: 'Fix filled-in form fields onto the page.' },
  { id: 'protect', label: 'Add a password', short: 'Lock a copy with a password.' },
];

export const baseName = (name) => String(name || 'document').replace(/\.pdf$/i, '');
const out = (name, bytes) => ({ name, bytes });
const ops = () => import('./ops.js');

export async function runInAppTool(id, sources, opts = {}, progress = () => {}) {
  if (!sources.length) throw new ToolError('Choose a document first.');
  const [first] = sources;
  const stem = baseName(first.name);
  switch (id) {
    case 'merge': {
      if (sources.length < 2) throw new ToolError('Pick at least two documents to merge.');
      progress('Joining the documents');
      const { mergePdfs } = await ops();
      const name = (opts.name || '').trim() || `${stem} (merged)`;
      return [out(`${baseName(name)}.pdf`, await mergePdfs(sources.map((s) => s.bytes)))];
    }
    case 'split': {
      const { splitPdf, pageCount } = await ops();
      const pages = await pageCount(first.bytes);
      let groups;
      if (opts.mode === 'each') groups = everyN(pages, 1);
      else if (opts.mode === 'every') groups = everyN(pages, Math.max(1, Math.floor(Number(opts.every ?? 2) || 1)));
      else groups = parseRangeGroups(opts.ranges || '', pages);
      if (groups.length < 2 && groups[0]?.length === pages) throw new ToolError('That keeps every page in one file. Type two or more ranges, like 1-3, 4-10.');
      const parts = await splitPdf(first.bytes, groups, (g, n) => progress(`Making part ${g + 1} of ${n}`));
      return parts.map((bytes, i) => out(`${stem} (pages ${formatPageSet(groups[i])}).pdf`, bytes));
    }
    case 'organize': {
      const order = opts.order || [];
      if (!order.length) throw new ToolError('Keep at least one page.');
      progress('Putting the pages in order');
      const { organizePages } = await ops();
      return [out(`${stem} (organized).pdf`, await organizePages(first.bytes, order))];
    }
    case 'rotate': {
      const turns = opts.turns || {};
      if (!Object.values(turns).some((q) => q % 4)) throw new ToolError('Turn at least one page first.');
      progress('Turning the pages');
      const { rotatePages } = await ops();
      return [out(`${stem} (rotated).pdf`, await rotatePages(first.bytes, turns))];
    }
    case 'compress': {
      const [{ compressPdf }, { canvasCodec }] = await Promise.all([import('./compress.js'), import('./browser.js')]);
      const bytes = await compressPdf(first.bytes, opts.level || 'medium', canvasCodec, (i, total) => progress(`${Math.round((i / total) * 100)}%`));
      return [{ ...out(`${stem} (compressed).pdf`, bytes), before: first.bytes.length }];
    }
    case 'ocr': {
      const [{ ocrPdf }, { makePageReader }, { openPdfjs }] = await Promise.all([import('./ocr.js'), import('./ocr-browser.js'), import('./browser.js')]);
      const reader = makePageReader(await openPdfjs(first.bytes.slice()), { skipText: opts.skipText !== false, progress });
      try {
        const r = await ocrPdf(first.bytes, reader.readPage, (i, total) => progress(`Reading page ${i + 1} of ${total}`));
        const note = r.skipped ? `${r.skipped} of ${r.pages} pages already had text and were left as they were.` : undefined;
        return [{ ...out(`${stem} (searchable).pdf`, r.bytes), note }];
      } finally {
        await reader.close();
      }
    }
    case 'flatten': {
      progress('Flattening');
      const { flattenPdf } = await ops();
      return [out(`${stem} (flattened).pdf`, await flattenPdf(first.bytes))];
    }
    case 'protect': {
      if (!opts.password) throw new ToolError('Type a password first.');
      if (opts.password !== opts.again) throw new ToolError('The two passwords don\'t match.');
      progress('Locking');
      const [{ protectPdf }, { runQpdf }] = await Promise.all([import('./qpdf.js'), import('./browser.js')]);
      const bytes = await protectPdf(runQpdf, first.bytes, { password: opts.password, allowPrint: opts.allowPrint !== false, allowCopy: opts.allowCopy !== false });
      return [out(`${stem} (protected).pdf`, bytes)];
    }
    default:
      throw new ToolError('That tool isn\'t available here.');
  }
}
