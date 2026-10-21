// Compare PDFs: two files in (old, then new), one report PDF out.
import {
  SEG, base, pdfOut, ToolError, runQpdf,
} from '../kit.js';
import { looksEncrypted, unlockPdf } from '../qpdf.js';
import { compareDocs, rowChanged, dropTextAreas } from '../compare.js';
import { readPages, lookDiff, pageImage } from '../compare-browser.js';

const quote = (names) => names.map((n) => `"${n}"`).join(' and ');

export default {
  view: 'files',
  // Locked files stay in the list so the note can name both at once.
  keepLock: true,
  hint: 'The first file is the old version, the second the new one. Drag to swap them.',
  options: [
    { key: 'show', label: 'Show in the report', type: SEG, def: 'changed', choices: [['changed', 'Changed pages'], ['all', 'All pages']] },
    { key: 'looks', label: 'Also check how pages look', type: 'check', def: true, help: 'Finds changes to drawings and pictures too, not just words. Takes longer on big files.' },
  ],
  async prepare(item) {
    // A PDF that opens without a password can still block copying; take that
    // lock off (it needs no password) so its pages can go into the report.
    if (!item.locked && looksEncrypted(item.bytes)) {
      try {
        item.bytes = await unlockPdf(runQpdf, item.bytes);
      } catch { /* the report step explains if it can't read the file */ }
    }
  },
  notice(files) {
    const locked = files.filter((f) => f.locked).map((f) => f.name);
    if (locked.length) {
      return `${quote(locked)} ${locked.length > 1 ? 'are' : 'is'} locked with a password. Unlock ${locked.length > 1 ? 'them' : 'it'} with the Unlock PDF tool first, then add ${locked.length > 1 ? 'them' : 'it'} again.`;
    }
    if (files.length === 1) return 'Add one more PDF: the new version to compare with.';
    if (files.length > 2) return 'Compare works on two PDFs at a time. Remove the extra files.';
    if (files.length === 2) return `Old: ${files[0].name}. New: ${files[1].name}.`;
    return null;
  },
  async run(files, opts, progress) {
    if (files.length !== 2) throw new ToolError('Add exactly two PDFs: the old version first, then the new one.');
    const locked = files.filter((f) => f.locked).map((f) => f.name);
    if (locked.length) throw new ToolError(`${quote(locked)} ${locked.length > 1 ? 'are' : 'is'} locked with a password. Unlock ${locked.length > 1 ? 'them' : 'it'} first, then try again.`);
    const [oldFile, newFile] = files;
    const pdfA = await oldFile.pdfjs();
    const pdfB = await newFile.pdfjs();
    const oldPages = await readPages(pdfA, (i, n) => progress(`Reading the old file: page ${i + 1} of ${n}`));
    const newPages = await readPages(pdfB, (i, n) => progress(`Reading the new file: page ${i + 1} of ${n}`));
    const hasText = (pages) => pages.some((p) => p.words.length);
    if (!hasText(oldPages) && !hasText(newPages) && !opts.looks) {
      throw new ToolError('Neither PDF has any text we can read. They may be scans, and the text compare can\'t see changes in scans. Turn on "Also check how pages look" and try again.');
    }

    progress('Finding the changes');
    const result = compareDocs(oldPages, newPages);
    if (opts.looks) {
      const pairs = result.rows.filter((r) => r.a !== null && r.b !== null);
      for (let n = 0; n < pairs.length; n += 1) {
        const row = pairs[n];
        progress(`Checking how pages look: ${n + 1} of ${pairs.length}`);
        try {
          // eslint-disable-next-line no-await-in-loop
          const looks = (await lookDiff(pdfA, row.a, oldPages[row.a], pdfB, row.b, newPages[row.b])) || [];
          row.looks = dropTextAreas(looks, oldPages[row.a], row.removed, newPages[row.b], row.added);
        } catch {
          row.looks = [];
        }
      }
    }

    const { buildReport } = await import('../compare-report.js');
    const bytes = await buildReport({
      oldBytes: oldFile.bytes,
      newBytes: newFile.bytes,
      oldName: oldFile.name,
      newName: newFile.name,
      oldPages,
      newPages,
      result,
      show: opts.show,
      looked: !!opts.looks,
      rasterize: (side, index) => pageImage(side === 'old' ? pdfA : pdfB, index),
      progress,
    });
    const changed = result.rows.filter(rowChanged).length;
    const out = pdfOut(`${base(oldFile.name)}-vs-${base(newFile.name)}-compare.pdf`, bytes);
    out.note = changed
      ? `Found changes on ${changed} ${changed === 1 ? 'page' : 'pages'}. The first page of the report lists them.`
      : 'No changes found. The report says what was checked.';
    return [out];
  },
};
