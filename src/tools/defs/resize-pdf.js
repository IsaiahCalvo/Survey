import { SEG, base, pdfOut } from '../kit.js';

export default {
  view: 'pages',
  options: [
    { key: 'size', label: 'New page size', type: 'select', def: 'letter', choices: [['letter', 'Letter (8.5 x 11 in)'], ['a4', 'A4'], ['a3', 'A3'], ['legal', 'Legal (8.5 x 14 in)'], ['tabloid', 'Tabloid (11 x 17 in)'], ['archd', 'ARCH D (24 x 36 in)']] },
    { key: 'orientation', label: 'Orientation', type: SEG, def: 'auto', choices: [['auto', 'Match each page'], ['portrait', 'Portrait'], ['landscape', 'Landscape']] },
    { key: 'margin', label: 'Margin', type: SEG, def: '0', choices: [['0', 'None'], ['18', 'Small'], ['36', 'Big']] },
    { key: 'keepMarkups', label: 'Keep markups and filled-in forms', type: 'check', def: true },
  ],
  async run([file], o, progress) {
    const { resizePdf } = await import('../impose.js');
    const opts = { size: o.size, orientation: o.orientation, margin: Number(o.margin), keepMarkups: o.keepMarkups };
    const bytes = await resizePdf(file.bytes, opts, (i, n) => progress(`Page ${i + 1} of ${n}`));
    return [pdfOut(`${base(file.name)}-${o.size}.pdf`, bytes)];
  },
};
