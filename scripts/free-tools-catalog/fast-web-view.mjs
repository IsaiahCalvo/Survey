import { PRIVATE, FREE, OFFLINE } from '../free-tools-faq.mjs';

export default {
  id: 'fast-web-view', group: 'size', name: 'Fast web view', icon: 'fastweb',
  // A page with speed lines.
  iconSvg: '<path d="M15 3H9a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 9 21h9a1.5 1.5 0 0 0 1.5-1.5V7.5z"/><path d="M15 3v4.5h4.5"/><path d="M2 10h4M3 14h3M2 18h4"/>',
  short: 'Make a big PDF open fast online, page 1 first.',
  title: 'Optimize PDF for fast web view free | Survey',
  desc: 'Linearize a PDF so its first page shows while the rest is still loading. Great for big files on a website. Free, in your browser, no upload.',
  h1: 'Optimize a PDF for fast web view',
  lede: 'Set up a PDF so a browser shows the first page right away, while the rest is still downloading. Also called linearizing.',
  accept: 'pdf', multiple: false, batch: true, action: 'Optimize PDF',
  steps: ['Choose one or more PDFs.', 'Press Optimize PDF.', 'Save the new file and put it on your website or share it.'],
  faq: [
    ['What is fast web view?', 'A PDF set up so its first page and a map of the other pages come first in the file. A browser can show page 1 straight away instead of waiting for the whole file.'],
    ['Does it make the file smaller?', 'Not really. It changes the order inside the file, not what is in it. To make it smaller, use Compress PDF.'],
    ['Will the PDF look different?', 'No. Every page, link and form field stays the same. It still opens in every PDF reader.'],
    PRIVATE, FREE, OFFLINE,
  ],
};
