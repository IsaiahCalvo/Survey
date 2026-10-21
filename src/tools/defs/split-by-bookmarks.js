import { SEG, ToolError, pdfOut, loadOps } from '../kit.js';

const loadBookmarks = () => import('../bookmarks.js');

export default {
  view: 'files',
  // Read the bookmarks as soon as the file is chosen, so the note can list
  // them. The parsed file is kept for the split, so it's only read once.
  async prepare(item) {
    const [{ loadPdf }, { readOutline, describeOutline }] = await Promise.all([loadOps(), loadBookmarks()]);
    try {
      item.lib = await loadPdf(item.bytes);
      item.outline = readOutline(item.lib);
      item.found = describeOutline(item.outline);
    } catch {
      item.lib = null;
      item.outline = null;
      item.found = null;
    }
  },
  notice: ([file]) => file?.found || null,
  options: [
    { key: 'level', label: 'Split at', type: SEG, def: '1', choices: [['1', 'Top-level bookmarks'], ['2', 'Top and second level']] },
  ],
  async run([file], opts, progress) {
    const { splitByBookmarks } = await loadBookmarks();
    if (file.outline && !file.outline.length) throw new ToolError('This PDF has no bookmarks. To split it by page numbers, use Split PDF instead.');
    const parts = await splitByBookmarks(file.bytes, { level: Number(opts.level), doc: file.lib || undefined }, progress);
    return parts.map((p) => pdfOut(p.name, p.bytes));
  },
};
