import { PRIVATE, FREE, OFFLINE } from '../free-tools-faq.mjs';

export default {
  id: 'sanitize-pdf', group: 'secure', name: 'Remove hidden data', icon: 'sanitize',
  // A page with a sweeping brush.
  iconSvg: '<path d="M13 3H7a1.5 1.5 0 0 0-1.5 1.5v15A1.5 1.5 0 0 0 7 21h5"/><path d="M13 3l4.5 4.5V9"/><path d="M21 12l-5 5"/><path d="M16 17l-2.5 4H20l1-2.5z"/>',
  short: 'Strip metadata, scripts and attachments from a PDF.',
  title: 'Remove PDF metadata and hidden data free | Survey',
  desc: 'Clean a PDF before you share it: remove the author, title, XMP metadata, scripts and attached files. Free, in your browser, no upload.',
  h1: 'Remove hidden data from a PDF',
  lede: 'Before you send a PDF, take out what people can\'t see on the page: the author and app details, hidden metadata, scripts and attached files.',
  accept: 'pdf', multiple: false, batch: true, action: 'Clean PDF',
  steps: ['Choose one or more PDFs.', 'Tick what to remove. Comments stay unless you tick them too.', 'Press Clean PDF and save the clean copy.'],
  trade: {
    h2: 'Clean a set before it goes to bidders',
    text: 'Before you send drawings or specs to bidders, owners or subs, take out the author name, old saved versions and attached files left inside the PDF.',
    keys: 'bid set bidders owner subs metadata',
  },
  faq: [
    ['What hidden data can a PDF have?', 'The author\'s name, the title, when it was made and changed, the app used, hidden XMP metadata, scripts that run when it opens, and files attached inside it.'],
    ['Will the pages look different?', 'No. Text, drawings, images, links and form fields stay just as they are. Only the hidden parts are taken out.'],
    ['Are old versions of the file removed too?', 'Yes. Some PDFs keep earlier saved versions inside them. The clean copy is written fresh, so only what you see is kept.'],
    ['Does it remove things shown on the page?', 'No. A name or logo printed on the page is part of the page and stays. Tick "Comments and markups" to take off notes and highlights.'],
    PRIVATE, FREE, OFFLINE,
  ],
};
