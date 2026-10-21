// Remove blank pages: each page is drawn small when the file is added, the
// blank ones are picked in the page grid, and the person can change the pick
// before saving.
import {
  SEG, base, pdfOut, loadOps, renderPage, releaseCanvas,
} from '../kit.js';
import { measure, blankIndexes } from '../blankPages.js';

const LEVEL_LABEL = 'What counts as blank';
// Wide enough that a lone page number still shows up as a few dark pixels.
const CHECK_WIDTH = 200;

async function check(item, busy) {
  const pdf = await item.pdfjs();
  const out = [];
  for (let i = 0; i < item.pages; i += 1) {
    busy(`Checking page ${i + 1} of ${item.pages}`);
    let canvas;
    try {
      canvas = await renderPage(pdf, i, { width: CHECK_WIDTH });
      const { width, height } = canvas;
      out.push(measure(canvas.getContext('2d').getImageData(0, 0, width, height).data, width, height));
    } catch {
      out.push(null); // a page that won't draw is never called blank
    } finally {
      if (canvas) releaseCanvas(canvas);
    }
  }
  return out;
}

export default {
  view: 'pages',
  select: 'delete',
  hint: 'Pages that look blank are picked. Tap a page to pick or unpick it.',
  options: [
    {
      key: 'level', label: LEVEL_LABEL, type: SEG, def: 'normal',
      choices: [['strict', 'Only empty'], ['normal', 'Normal'], ['loose', 'Nearly empty too']],
      onChange: (level, files) => files.forEach((f) => { f.selected = new Set(blankIndexes(f.blank, level)); }),
    },
  ],
  async prepare(item, busy) {
    item.blank = await check(item, busy);
    item.selected = new Set(blankIndexes(item.blank, 'normal'));
  },
  notice([file], opts) {
    if (!file?.blank) return null;
    const found = blankIndexes(file.blank, opts?.level || 'normal').length;
    if (!found) return 'No blank pages were found. Try "Nearly empty too", or tap pages to pick them yourself.';
    if (found === file.pages) return 'Every page looks blank. Unpick the pages you want to keep.';
    return null;
  },
  async run([file], opts, progress) {
    progress('Taking out the pages');
    const { deletePages } = await loadOps();
    const bytes = await deletePages(file.bytes, [...file.selected]);
    const out = pdfOut(`${base(file.name)}-no-blanks.pdf`, bytes);
    const n = file.selected.size;
    out.note = `${n} page${n === 1 ? ' was' : 's were'} taken out.`;
    return [out];
  },
};
