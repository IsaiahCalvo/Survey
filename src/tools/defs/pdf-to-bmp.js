// PDF to BMP: each page as a BMP picture, for old programs that want one.
import {
  SEG, base, renderPage, releaseCanvas, ToolError,
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
    const out = [];
    let total = 0;
    for (let n = 0; n < pick.length; n += 1) {
      progress(`Page ${n + 1} of ${pick.length}`);
      const canvas = await renderPage(pdf, pick[n], { scale: Number(opts.dpi) / 72 });
      const { width, height } = canvas;
      const data = canvas.getContext('2d').getImageData(0, 0, width, height).data;
      releaseCanvas(canvas);
      // BMPs aren't compressed, and the ZIP and memory both top out well
      // before a long file at high quality would.
      total += width * height * 3;
      if (total > MAX_TOTAL) throw new ToolError('That many BMPs would be too big to save at once. Pick fewer pages or a lower quality.');
      out.push({ name: `${base(file.name)}-page-${pick[n] + 1}.bmp`, bytes: encodeBmp({ width, height, data, dpi: Number(opts.dpi) }), type: 'image/bmp' });
    }
    return out;
  },
};
