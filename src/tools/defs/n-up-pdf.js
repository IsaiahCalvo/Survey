import { SEG, base, pdfOut } from '../kit.js';

export default {
  view: 'pages',
  hint: 'Pages fill each sheet across, then down.',
  options: [
    { key: 'per', label: 'Pages per sheet', type: SEG, def: '4', choices: [['2', '2'], ['4', '4'], ['6', '6'], ['9', '9']] },
    { key: 'sheet', label: 'Sheet size', type: SEG, def: 'letter', choices: [['letter', 'Letter'], ['a4', 'A4'], ['first', 'Same as the first page']] },
    { key: 'border', label: 'Thin line around each page', type: 'check', def: false },
    { key: 'keepMarkups', label: 'Keep markups and filled-in forms', type: 'check', def: true },
  ],
  async run([file], o, progress) {
    const { nUpPdf } = await import('../impose.js');
    const opts = { per: Number(o.per), sheet: o.sheet, border: o.border, keepMarkups: o.keepMarkups };
    const bytes = await nUpPdf(file.bytes, opts, (i, n) => progress(`Sheet ${i + 1} of ${n}`));
    return [pdfOut(`${base(file.name)}-${o.per}-up.pdf`, bytes)];
  },
};
