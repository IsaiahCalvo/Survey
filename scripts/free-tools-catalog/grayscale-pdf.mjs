import { PRIVATE, FREE, LIMIT } from '../free-tools-faq.mjs';

export default {
  id: 'grayscale-pdf', group: 'edit', name: 'Grayscale PDF', icon: 'grayscale-pdf',
  iconSvg: '<rect x="5" y="3" width="14" height="18" rx="1.5"/><circle cx="12" cy="12" r="4.5"/><path d="M12 7.5v9"/>',
  short: 'Make a PDF black and white.',
  title: 'Make a PDF black and white (grayscale) free | Survey',
  desc: 'Turn a color PDF into gray for cheaper printing or a plan set. Text stays sharp and selectable. Free, in your browser, no upload.',
  h1: 'Make a PDF black and white',
  lede: 'Turn every color in a PDF to gray, so it prints the same on any printer. Text and lines stay sharp.',
  accept: 'pdf', multiple: true, action: 'Make it gray',
  steps: ['Choose one or more PDFs.', 'Keep "Keep text sharp", or pick "Turn pages into pictures" to be sure every last bit turns gray.', 'Press Make it gray and save the new file.'],
  trade: {
    h2: 'Print color drawings in black and white',
    text: 'Turn color sheets or site photo reports gray to print on a black and white printer or plotter. Check that color-coded items still tell apart in gray.',
    keys: 'color drawings plotter print plan sheets',
  },
  faq: [
    ['Will I still be able to select and search the text?', 'Yes, with "Keep text sharp", the usual choice. Colors are changed to gray inside the PDF, so text, lines and links stay as they were. "Turn pages into pictures" makes each page a gray picture, so the text can no longer be selected.'],
    ['Why might a little color be left?', 'A few rare kinds of color, like some complex gradients or JPEG 2000 pictures, can\'t be changed in place. The tool tells you when that happens; "Turn pages into pictures" turns everything gray.'],
    ['How are colors turned to gray?', 'Each color becomes the gray of the same brightness, so dark colors stay dark and light colors stay light.'],
    PRIVATE, FREE, LIMIT,
  ],
};
