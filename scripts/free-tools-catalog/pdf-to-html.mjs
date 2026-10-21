import { PRIVATE, FREE, OFFLINE } from '../free-tools-faq.mjs';

export default {
  id: 'pdf-to-html', group: 'from-pdf', name: 'PDF to HTML', icon: 'pdf-to-html',
  iconSvg: '<rect x="3" y="4" width="18" height="16" rx="1.5"/><path d="M3 8h18M9.5 11.5L7 14l2.5 2.5M14.5 11.5L17 14l-2.5 2.5"/>',
  short: 'Turn a PDF into a web page.',
  title: 'PDF to HTML converter free, no upload | Survey',
  desc: 'Turn a PDF into one web page file that looks like the PDF and keeps its words, or text only. Free, in your browser, no upload.',
  h1: 'PDF to HTML',
  lede: 'Turn a PDF into one web page file that opens in any browser. The words stay real text you can find, copy and select.',
  accept: 'pdf', multiple: false, batch: true, action: 'Make web page',
  steps: ['Choose a PDF.', 'Pick "Looks like the PDF" to keep how the pages look, or "Text only" for just the words. Tap pages to use only those.', 'Press Make web page and save the .html file.'],
  trade: {
    h2: 'Post specs and notices on a site page',
    text: 'Put a spec section, safety notice or submittal on an intranet or project site as a web page that opens on any phone, with words people can search. Text only makes a small page that reads well on site.',
    keys: 'spec section safety notice submittal intranet project website',
  },
  faq: [
    ['What is the difference between the two styles?', '"Looks like the PDF" keeps each page looking just as it does, with the words laid over a picture of the page so you can still find and copy them. "Text only" keeps just the headings and paragraphs, which makes a much smaller file.'],
    ['Why is the file big?', 'In "Looks like the PDF" every page is stored as a picture inside the one file, so nothing goes missing when you send it. Pick a lower picture quality, or Text only, for a smaller file.'],
    ['Can I edit the web page?', 'Yes, it is a normal .html file. Text only is the easiest to edit, since it is plain headings and paragraphs.'],
    ['Will a scanned PDF work?', 'It will look right, but a scan has no words to find. Run OCR PDF first to add them.'],
    PRIVATE, FREE, OFFLINE,
  ],
};
