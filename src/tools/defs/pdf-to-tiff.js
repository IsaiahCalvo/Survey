// PDF to TIFF: draw each page and put them all in one multi-page TIFF.
import {
  SEG, base, renderPage, releaseCanvas, ToolError,
} from '../kit.js';
import { rgbaToTiffPage, writeTiff } from '../imageWriters.js';

export default {
  view: 'pages',
  select: 'keep',
  hint: 'Every page goes in the TIFF. Tap pages to save only those.',
  options: [
    { key: 'dpi', label: 'Quality', type: SEG, def: '150', choices: [['150', 'Normal (150 DPI)'], ['300', 'High (300 DPI)']] },
    { key: 'color', label: 'Colors', type: SEG, def: 'color', choices: [['color', 'Color'], ['gray', 'Gray'], ['bw', 'Black and white']] },
  ],
  async run([file], opts, progress) {
    const pdf = await file.pdfjs();
    const pick = file.selected.size ? [...file.selected].sort((a, b) => a - b) : [...Array(file.pages).keys()];
    const dpi = Number(opts.dpi);
    const pages = [];
    for (let n = 0; n < pick.length; n += 1) {
      progress(`Page ${n + 1} of ${pick.length}`);
      const canvas = await renderPage(pdf, pick[n], { scale: dpi / 72 });
      const { width, height } = canvas;
      let rgba = canvas.getContext('2d').getImageData(0, 0, width, height).data;
      releaseCanvas(canvas);
      // A capped render (huge sheets) has fewer pixels per inch than asked.
      const pageDpi = Math.min(dpi, (width / (await pdf.getPage(pick[n] + 1)).getViewport({ scale: 1 }).width) * 72);
      pages.push(await rgbaToTiffPage(rgba, width, height, { color: opts.color, dpi: pageDpi }));
      rgba = null;
    }
    // TIFF offsets are 32-bit, so a file can't pass 4 GB.
    const size = pages.reduce((n, p) => n + p.strips.reduce((m, s) => m + s.length, 0), 0);
    if (size > 4_000_000_000) throw new ToolError('This TIFF would be too big. Pick fewer pages or a lower quality.');
    progress('Writing the TIFF');
    return [{ name: `${base(file.name)}.tif`, bytes: writeTiff(pages), type: 'image/tiff' }];
  },
};
