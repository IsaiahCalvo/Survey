// Entries for the public "What's new" page (/whats-new), newest first. Only
// changes people can see in a live build. Add the notes from each production
// deploy here, in plain words, then run `node scripts/build-marketing.mjs`.
// Work still behind a feature flag stays off this list until it is on for all.
export const WHATS_NEW = [
  { date: '2026-10-21', items: [
    'Account settings has a "Download my data" button that gives you a ZIP of your files and work.',
    'Big drawing sets show their first page sooner, and no longer freeze for a moment after they open.',
    'Counter marks keep their size after you draw an arrow or rectangle.',
    'The page grid draws under your markup and the page text, not over it.',
    'Buttons in dialogs are easier to tap on touch screens.',
    'Color pickers have a "Recent" row with the last custom colors you used.',
    'Delete account in Account settings works again and removes your files. Work you shared stays with the people you shared it with.',
    'Survey photos no longer keep the GPS location they were taken at.',
    'An optional half-inch grid over the page, from the right rail on desktop and tablet or the zoom menu on phones.',
    'The Share dialog shows the owner\'s name and full email addresses, and the access list fits small phones.',
    'Bigger buttons to tap on tablets and in the phone Delete account dialog.',
    'The free tools page has categories, puts the most used tools first and links related tools.',
    'Free PDF tools: 17 more, including OCR (make a scan searchable), compare two PDFs, repair, extract images, grayscale, booklet and pages per sheet. Many tools now take several files at once and give back one ZIP. The tools page has a search box.',
    'A PDF you just uploaded on a phone now opens straight away, without a "Couldn\'t open this PDF" screen.',
    'On small phones, the Survey Marker shape menu (Rectangle, Freehand, Smart fill) can be tapped again, and messages no longer cover Done or Pan.',
    'Tapping away the Smart fill "Check it, then Apply" message now also clears the blue preview outline.',
    'Invite links: if you sign in or make an account from an invite, you land in the shared document instead of your home page.',
    'Pens: drawing starts as "Pencil or Touch". The first time you draw with a pen, Survey switches to "Pencil only" so your hand doesn\'t leave marks.',
    'Free PDF tools: Word to PDF, plus sign, password protect, unlock and TIFF to PDF. Each tool can open its result in Survey.',
    'Documents: shared files show the owner\'s name, greyed-out buttons say why, and tablets get a More button.',
  ] },
  { date: '2026-10-20', items: [
    'Large drawings open faster: big PDFs stream in a piece at a time, and the access check happens once per page instead of once per markup.',
    'Free PDF tools at /tools: merge, split, compress, rotate, crop, organize pages, headers and footers, convert and more, all in your browser.',
    'A status page at /status shows whether Survey is up and lists recent problems.',
    'Exports never write the standard Excel layout over a customer\'s own layout.',
    'Phones: view-only people see locked tools, Settings tabs fit the screen, and the Opening bar shows while a file loads.',
    'Home lists show at once from a copy kept on your device, then refresh.',
  ] },
];
