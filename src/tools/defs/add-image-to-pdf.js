// Add image to PDF: place a PNG or JPG (logo, stamp, signature, north arrow)
// on chosen pages.
import { SEG, ToolError, base, pdfOut } from '../kit.js';
import { parsePageSet } from '../ranges.js';

const IMAGE_ACCEPT = 'image/png,image/jpeg,.png,.jpg,.jpeg';

function pickPages(file, opts) {
  if (opts.pages === 'first') return [0];
  if (opts.pages === 'custom') return parsePageSet(opts.range || '', file.pages);
  return null; // every page
}

export default {
  view: 'pages',
  options: [
    { key: 'image', label: 'Image', type: 'file', accept: IMAGE_ACCEPT, pick: 'Choose a PNG or JPG', help: 'A logo, stamp, signature or north arrow. PNG keeps a see-through background.' },
    {
      key: 'position', label: 'Where', type: 'select', def: 'bottom-right',
      choices: [['top-left', 'Top left'], ['top-center', 'Top middle'], ['top-right', 'Top right'], ['center', 'Middle of the page'], ['bottom-left', 'Bottom left'], ['bottom-center', 'Bottom middle'], ['bottom-right', 'Bottom right']],
    },
    { key: 'width', label: 'Width, % of the page', type: 'number', def: '20', min: 1, help: 'The height follows the image\'s shape.' },
    { key: 'opacity', label: 'See-through', type: SEG, def: '1', choices: [['1', 'Solid'], ['0.75', 'Light'], ['0.5', 'Half'], ['0.25', 'Faint']] },
    { key: 'pages', label: 'Pages', type: SEG, def: 'all', choices: [['all', 'All'], ['first', 'First'], ['custom', 'Some']] },
    { key: 'range', label: 'Which pages', type: 'text', def: '1', placeholder: '1-3, 8', show: (o) => o.pages === 'custom', help: 'Like 1-3, 8. "5-" runs to the end.' },
  ],
  notice(files, opts) {
    return opts && !opts.image ? 'Choose the image to place on the pages.' : null;
  },
  async run([file], opts, progress) {
    const image = opts.image;
    if (!image) throw new ToolError('Choose a PNG or JPG image first.');
    const width = Number(opts.width);
    if (!(width >= 1 && width <= 100)) throw new ToolError('Type a width from 1 to 100 percent.');
    const pages = pickPages(file, opts);
    progress('Placing the image');
    const { addImageToPdf } = await import('../addImage.js');
    const bytes = await addImageToPdf(file.bytes, image.bytes, {
      pages, position: opts.position, widthPct: width, opacity: Number(opts.opacity),
    });
    const out = pdfOut(`${base(file.name)}-with-image.pdf`, bytes);
    const n = pages ? pages.length : file.pages;
    out.note = `Placed on ${n} page${n === 1 ? '' : 's'}.`;
    return [out];
  },
};
