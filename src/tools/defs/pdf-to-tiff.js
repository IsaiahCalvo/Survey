// PDF to TIFF: draw each page and put them all in one multi-page TIFF.
import {
  SEG, base, releaseCanvas, ToolError,
} from '../kit.js';
import { rgbaToTiffPage, tiffParts } from '../imageWriters.js';
import { crc32 } from '../zip.js';

export default {
  view: 'pages',
  select: 'keep',
  hint: 'Every page goes in the TIFF. Tap pages to save only those.',
  options: [
    { key: 'dpi', label: 'Quality', type: SEG, def: '150', choices: [['150', 'Normal (150 DPI)'], ['300', 'High (300 DPI)']] },
    { key: 'color', label: 'Colors', type: SEG, def: 'color', choices: [['color', 'Color'], ['gray', 'Gray'], ['bw', 'Black and white']] },
  ],
  async run([file], opts, progress) {
    const scans = await file.scans();
    const pick = file.selected.size ? [...file.selected].sort((a, b) => a - b) : [...Array(file.pages).keys()];
    const dpi = Number(opts.dpi);
    const pages = [];
    for (let n = 0; n < pick.length; n += 1) {
      progress(`Page ${n + 1} of ${pick.length}`);
      const canvas = await file.render(pick[n], { scale: dpi / 72 });
      const { width, height } = canvas;
      let rgba = canvas.getContext('2d').getImageData(0, 0, width, height).data;
      releaseCanvas(canvas);
      // A capped render (huge sheets) has fewer pixels per inch than asked.
      const scan = scans[pick[n]];
      const points = scan ? (scan.rotate % 180 ? scan.box.height : scan.box.width)
        : (await (await file.pdfjs()).getPage(pick[n] + 1)).getViewport({ scale: 1 }).width;
      const pageDpi = Math.min(dpi, (width / points) * 72);
      const page = await rgbaToTiffPage(rgba, width, height, { color: opts.color, dpi: pageDpi });
      rgba = null;
      // Hand each strip to the browser now, so a big set's TIFF isn't held twice
      // (strips, then the joined file) in the page.
      page.strips = page.strips.map((s) => new Blob([s]));
      pages.push(page);
    }
    // TIFF offsets are 32-bit, so a file can't pass 4 GB.
    const size = pages.reduce((n, p) => n + p.strips.reduce((m, s) => m + s.size, 0), 0);
    if (size > 4_000_000_000) throw new ToolError('This TIFF would be too big. Pick fewer pages or a lower quality.');
    progress('Writing the TIFF');
    const parts = tiffParts(pages);
    // A batch packs this into a ZIP, which needs the file's checksum.
    let crc = 0;
    for (const part of parts) crc = crc32(part instanceof Blob ? new Uint8Array(await part.arrayBuffer()) : part, crc);
    const blob = new Blob(parts, { type: 'image/tiff' });
    return [{ name: `${base(file.name)}.tif`, blob, size: blob.size, crc, type: 'image/tiff' }];
  },
};
