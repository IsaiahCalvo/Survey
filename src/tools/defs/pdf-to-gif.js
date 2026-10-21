// PDF to GIF: each page as a still GIF picture, or every page in one moving
// GIF. gifenc (MIT, ~9 KB) picks the 256 colours and writes the file; it loads
// only when a PDF is turned into GIFs.
import {
  SEG, base, renderPage, releaseCanvas, ToolError,
} from '../kit.js';
import { gifWriter } from '../gifWrite.js';

// GIFs are small, but a long set at high quality still adds up.
const MAX_TOTAL = 1_500_000_000;

const pixels = (canvas) => canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height).data;

export default {
  view: 'pages',
  select: 'keep',
  hint: 'Every page is saved. Tap pages to save only those.',
  options: [
    { key: 'dpi', label: 'Quality', type: SEG, def: '150', choices: [['72', 'Small'], ['150', 'Normal'], ['300', 'High']] },
    { key: 'animate', label: 'One moving GIF of all the pages', type: 'check', def: false },
    { key: 'delay', label: 'Each page shows for', type: SEG, def: '2', choices: [['1', '1 second'], ['2', '2 seconds'], ['4', '4 seconds']], show: (o) => o.animate },
  ],
  async run([file], opts, progress) {
    const gifenc = await import('gifenc');
    const pdf = await file.pdfjs();
    const pick = file.selected.size ? [...file.selected].sort((a, b) => a - b) : [...Array(file.pages).keys()];
    const scale = Number(opts.dpi) / 72;
    const name = base(file.name);

    if (opts.animate && pick.length > 1) {
      // Every frame is the first page's size; other pages fit inside it on white.
      const gif = gifWriter(gifenc);
      let W = 0;
      let H = 0;
      for (let n = 0; n < pick.length; n += 1) {
        progress(`Page ${n + 1} of ${pick.length}`);
        const page = await renderPage(pdf, pick[n], { scale });
        let frame = page;
        if (!W) {
          W = page.width;
          H = page.height;
        } else if (page.width !== W || page.height !== H) {
          frame = document.createElement('canvas');
          frame.width = W;
          frame.height = H;
          const ctx = frame.getContext('2d');
          ctx.fillStyle = '#fff';
          ctx.fillRect(0, 0, W, H);
          const k = Math.min(W / page.width, H / page.height);
          const w = page.width * k;
          const h = page.height * k;
          ctx.drawImage(page, (W - w) / 2, (H - h) / 2, w, h);
          releaseCanvas(page);
        }
        const rgba = pixels(frame);
        releaseCanvas(frame);
        gif.add(rgba, W, H, Number(opts.delay) * 1000);
        if (gif.size() > MAX_TOTAL) throw new ToolError('This GIF would be too big. Pick fewer pages or a lower quality.');
      }
      return [{ name: `${name}.gif`, bytes: gif.finish(), type: 'image/gif' }];
    }

    const out = [];
    let total = 0;
    for (let n = 0; n < pick.length; n += 1) {
      progress(`Page ${n + 1} of ${pick.length}`);
      const canvas = await renderPage(pdf, pick[n], { scale });
      const { width, height } = canvas;
      const rgba = pixels(canvas);
      releaseCanvas(canvas);
      const gif = gifWriter(gifenc);
      gif.add(rgba, width, height);
      const bytes = gif.finish();
      total += bytes.length;
      if (total > MAX_TOTAL) throw new ToolError('That many GIFs would be too big to save at once. Pick fewer pages or a lower quality.');
      out.push({ name: `${name}-page-${pick[n] + 1}.gif`, bytes, type: 'image/gif' });
    }
    return out;
  },
};
