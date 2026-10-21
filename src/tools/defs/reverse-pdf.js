import { base, pdfOut } from '../kit.js';

export default {
  view: 'pages',
  hint: 'The last page will come first.',
  async run([file]) {
    const { reversePdf } = await import('../reorder.js');
    return [pdfOut(`${base(file.name)}-reversed.pdf`, await reversePdf(file.bytes))];
  },
};
