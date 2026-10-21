import { SEG, base, pdfOut } from '../kit.js';

export default {
  view: 'pages',
  hint: 'Print on both sides, flipping on the short edge. Fold the stack in half and staple the fold.',
  options: [
    { key: 'paper', label: 'Paper you print on', type: SEG, def: 'letter', choices: [['letter', 'Letter'], ['a4', 'A4'], ['tabloid', 'Tabloid'], ['a3', 'A3'], ['double', 'Two pages wide']] },
    { key: 'keepMarkups', label: 'Keep markups and filled-in forms', type: 'check', def: true },
  ],
  notice([file]) {
    if (!file) return null;
    const blanks = (4 - (file.pages % 4)) % 4;
    const parts = [];
    if (blanks) parts.push(`${blanks} blank page${blanks === 1 ? ' is' : 's are'} added at the end, since a booklet needs a multiple of 4 pages.`);
    if (file.pages > 64) parts.push('Booklets over about 64 pages are hard to fold. You could split it into parts first.');
    return parts.join(' ') || null;
  },
  async run([file], o, progress) {
    const { bookletPdf } = await import('../impose.js');
    const bytes = await bookletPdf(file.bytes, { paper: o.paper, keepMarkups: o.keepMarkups }, (i, n) => progress(`Side ${i + 1} of ${n}`));
    return [pdfOut(`${base(file.name)}-booklet.pdf`, bytes)];
  },
};
