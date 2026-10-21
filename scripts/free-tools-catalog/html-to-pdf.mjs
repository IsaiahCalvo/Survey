import { PRIVATE, FREE, OFFLINE } from '../free-tools-faq.mjs';

export default {
  id: 'html-to-pdf', batch: true, group: 'to-pdf', name: 'HTML to PDF', icon: 'html-to-pdf',
  iconSvg: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M11 12l-2 2.5 2 2.5M15 12l2 2.5-2 2.5"/>',
  short: 'Turn a saved web page (.html) into a PDF.',
  title: 'HTML to PDF converter free, no upload | Survey',
  desc: 'Convert a saved web page (.html or .htm) to a PDF with real, searchable text. Scripts in the page never run. Free, in your browser, no upload.',
  h1: 'Convert HTML to PDF',
  lede: 'Turn a saved web page or an HTML file into a tidy PDF. Text, headings, lists, tables and pictures carry over as real text.',
  accept: 'html', multiple: false, action: 'Make PDF',
  steps: ['Choose an HTML file (.html or .htm).', 'Pick the page size and font.', 'Press Make PDF and save it.'],
  trade: {
    h2: 'Web reports and emails to PDF',
    text: 'Some inspection apps, permit portals and email programs save reports as .html. Turn them into a PDF you can file with the job or attach to a daily report.',
    keys: 'web report permit portal inspection email saved page',
  },
  faq: [
    ['Will it look like the web page?', 'It keeps the content, not the design: headings, text, bold and italic, links, lists, tables and pictures saved inside the file. Colors, columns, menus and page styling are left out, much like a printer-friendly page.'],
    ['Why are some pictures missing?', 'Most web pages keep their pictures as separate files. Only pictures saved inside the .html file itself can come along, and the tool tells you how many were left out. To keep a page exactly as it looks, open it in your browser and use Print, then Save as PDF.'],
    ['Is it safe to open a web page file here?', 'Yes. The file is read as text. Scripts in it never run, and nothing it links to is loaded.'],
    PRIVATE, FREE, OFFLINE,
  ],
};
