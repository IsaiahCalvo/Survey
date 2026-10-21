// PDF to BMP: each page as a BMP picture, for old programs that want one.
import {
  SEG, base, renderPage, releaseCanvas, ToolError, MAX_PIXELS,
} from '../kit.js';
import { encodeBmp } from '../imageWriters.js';

const MAX_TOTAL = 1_500_000_000;

export default {
  view: 'pages',
  select: 'keep',
  hint: 'Every page is saved. Tap pages to save only those.',
  options: [
    { key: 'dpi', label: 'Quality', type: SEG, def: '150', choices: [['72', 'Small'], ['150', 'Normal'], ['300', 'High']] },
  ],
  async run([file], opts, progress) {
    const pdf = await file.pdfjs();
    const pick = file.selected.size ? [...file.selected].sort((a, b) => a - b) : [...Array(file.pages).keys()];
    const scale = Number(opts.dpi) / 72;
    // BMPs aren't compressed, and the ZIP and memory both top out well
    // before a long file at high quality would. Add up the sizes before
    // drawing anything, so a big set says so at once instead of after
    // filling the memory.
    let total = 0;
    for (const i of pick) {
      const { width, height } = (await pdf.getPage(i + 1)).getViewport({ scale });
      total += Math.min(width * height, MAX_PIXELS) * 3;
    }
    if (total > MAX_TOTAL) {
      const gb = (total / 1e9).toFixed(1);
      throw new ToolError(`These pages would make ${gb} GB of BMPs, too big to save at once. Pick fewer pages or a lower quality.`);
    }
    const out = [];
    for (let n = 0; n < pick.length; n += 1) {
      progress(`Page ${n + 1} of ${pick.length}`);
      const canvas = await renderPage(pdf, pick[n], { scale: Number(opts.dpi) / 72 });
      const { width, height } = canvas;
      const data = canvas.getContext('2d').getImageData(0, 0, width, height).data;
      releaseCanvas(canvas);
      out.push({ name: `${base(file.name)}-page-${pick[n] + 1}.bmp`, bytes: encodeBmp({ width, height, data, dpi: Number(opts.dpi) }), type: 'image/bmp' });
    }
    return out;
  },
};
