// One glyph per free PDF tool, drawn for /tools and the website (2026-11-09).
// Before this, 58 tools shared about 20 glyphs: every image converter had the
// same picture icon and every document converter the same page. Now each file
// type has its own mark (photo, see-through PNG, pixel grid, film strip,
// stacked scans, W, </>, M-down, archive box) and every page tool its own
// action. 24-unit grid, 1.7 stroke, round ends, like the app's icon set.
// The group color tells "to PDF" from "from PDF"; the glyph tells the format.

const PAGE = '<path d="M14 3H7a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V7z"/><path d="M14 3v4h4"/>';
const fill = (d, o = 1) => `<path d="${d}" fill="currentColor" stroke="none"${o < 1 ? ` opacity="${o}"` : ''}/>`;

const F = {
  photo: '<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="8.5" cy="10" r="1.6"/><path d="M21 16l-5-5-8 8"/>',
  png: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M12 5v14M3 12h18"/>' + fill('M3.9 5.9h8.1V12H3.9zM12 12h8.1v6.1H12z', 0.38),
  photos: '<rect x="7" y="7" width="14" height="12" rx="1.5"/><path d="M4 16V5.5A1.5 1.5 0 0 1 5.5 4H17"/><circle cx="11.5" cy="11" r="1.3"/><path d="M21 16l-4-4-6 6"/>',
  tiff: '<path d="M9 3h9a1 1 0 0 1 1 1v12"/><rect x="5" y="6" width="11" height="15" rx="1"/><path d="M8 17l2.2-2.6 1.8 1.6 1.5-1.8"/><circle cx="9.5" cy="10.5" r="1.1"/>',
  bmp: '<rect x="4" y="4" width="16" height="16" rx="1.5"/><path d="M4 9.33h16M4 14.67h16M9.33 4v16M14.67 4v16"/>' + fill('M4.8 4.8h4.53v4.53H4.8zM14.67 4.8h4.53v4.53h-4.53zM9.33 9.33h5.34v5.34H9.33zM4.8 14.67h4.53v4.53H4.8zM14.67 14.67h4.53v4.53h-4.53z', 0.38),
  gif: '<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M8 3v18M16 3v18M4 7.5h4M4 12h4M4 16.5h4M16 7.5h4M16 12h4M16 16.5h4"/>',
  lines: PAGE + '<path d="M9 12h6M9 15h6M9 18h3.5"/>',
  bigT: '<path d="M5 5h14M12 5v14M9 19h6"/>',
  word: PAGE + '<path d="M8.6 11.5l1.2 5.5 2.2-4.2 2.2 4.2 1.2-5.5"/>',
  docx: '<rect x="3" y="6" width="11" height="12" rx="1.5"/><path d="M14 4h5a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-5M16.5 9h1.5M16.5 12h1.5M16.5 15h1.5"/><path d="M5.6 9.5l1 5 1.9-3.4 1.9 3.4 1-5"/>',
  rtf: PAGE + '<path d="M8.5 18l2.5-6.5 2.5 6.5M9.5 16h3"/>',
  html: '<path d="M8 7l-5 5 5 5M16 7l5 5-5 5M13.5 4l-3 16"/>',
  md: '<rect x="2.5" y="6" width="19" height="12" rx="2"/><path d="M6 15V9l2.5 3L11 9v6M16 9v6M13.8 12.8l2.2 2.2 2.2-2.2"/>',
  archive: '<rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V9M10 13h4"/>',
};

export const TOOL_ICONS = {
  // Organize pages
  'merge-pdf': '<rect x="3" y="3" width="7" height="8.5" rx="1"/><rect x="14" y="3" width="7" height="8.5" rx="1"/><path d="M6.5 11.5V13a2.5 2.5 0 0 0 2.5 2.5h6a2.5 2.5 0 0 0 2.5-2.5v-1.5M12 15.5V21M9.5 18.5L12 21l2.5-2.5"/>',
  'split-pdf': '<circle cx="6" cy="6.5" r="2.5"/><circle cx="6" cy="17.5" r="2.5"/><path d="M8.1 8L20 17.5M8.1 16L20 6.5"/>',
  'rotate-pdf': '<rect x="9" y="9.5" width="10" height="11.5" rx="1"/><path d="M4 13A8.5 8.5 0 0 1 17 5.2"/><path d="M17.5 1.8v3.9h-3.9"/>',
  'organize-pdf': '<rect x="3" y="4" width="7" height="7" rx="1"/><rect x="14" y="4" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 17.5h7M18 14.5l3 3-3 3"/>',
  'delete-pages': '<path d="M4 7h16M9 7V4h6v3M6 7l1 13h10l1-13"/><path d="M10 11v6M14 11v6"/>',
  'extract-pages': '<rect x="3" y="3" width="11" height="15" rx="1.5"/><path d="M11 13h10M18 10l3 3-3 3"/>',
  'reverse-pdf': '<path d="M8 20V4M4 8l4-4 4 4M16 4v16M12 16l4 4 4-4"/>',
  'add-blank-pages': PAGE + '<path d="M12 11v6M9 14h6"/>',
  'remove-blank-pages': PAGE + '<path d="M9 14h6"/>',
  'split-by-bookmarks': '<path d="M7 3h10v18l-5-4-5 4z"/><path d="M3 11h3M18 11h3"/>',
  'split-by-size': '<path d="M3.5 17a8.5 8.5 0 1 1 17 0"/><path d="M12 17l4.5-5.5"/><circle cx="12" cy="17" r="1.4"/><path d="M3.5 21h17"/>',
  // Page size and layout
  'crop-pdf': '<path d="M6 2v14a2 2 0 0 0 2 2h14M2 6h14a2 2 0 0 1 2 2v14"/>',
  'resize-pdf': '<path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/>',
  'n-up-pdf': '<rect x="4" y="3" width="16" height="18" rx="1.5"/><path d="M12 3v18M4 12h16"/>',
  'booklet-pdf': '<path d="M12 6.5C10 5 7 4.5 3.5 4.5v14c3.5 0 6.5.5 8.5 2 2-1.5 5-2 8.5-2v-14c-3.5 0-6.5.5-8.5 2zM12 6.5v14"/>',
  // Make it smaller
  'compress-pdf': '<path d="M4 9h5V4M20 9h-5V4M4 15h5v5M20 15h-5v5"/>',
  'fast-web-view': '<path d="M13 2.5L5 14h6.2l-1 7.5L18.5 10h-6.2z"/>',
  // Convert to PDF
  'jpg-to-pdf': F.photo,
  'png-to-pdf': F.png,
  'image-to-pdf': F.photos,
  'tiff-to-pdf': F.tiff,
  'bmp-to-pdf': F.bmp,
  'gif-to-pdf': F.gif,
  'txt-to-pdf': F.lines,
  'word-to-pdf': F.word,
  'docx-to-pdf': F.docx,
  'rtf-to-pdf': F.rtf,
  'html-to-pdf': F.html,
  // Convert from PDF
  'pdf-to-jpg': F.photo,
  'pdf-to-png': F.png,
  'pdf-to-tiff': F.tiff,
  'pdf-to-bmp': F.bmp,
  'pdf-to-gif': F.gif,
  'pdf-to-txt': F.bigT,
  'pdf-to-word': F.word,
  'pdf-to-docx': F.docx,
  'pdf-to-rtf': F.rtf,
  'pdf-to-html': F.html,
  'pdf-to-markdown': F.md,
  'pdf-to-pdfa': F.archive,
  'extract-images': '<rect x="3" y="3" width="11" height="14" rx="1"/><rect x="9.5" y="9.5" width="11.5" height="11.5" rx="1.5"/><circle cx="13.5" cy="13.5" r="1.2"/><path d="M21 18l-3-3-5.5 5.5"/>',
  // Add to a PDF
  'add-page-numbers': '<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M10 16.5h4M12 16.5v-6l-1.6 1.2"/>',
  'watermark-pdf': PAGE + '<path d="M12 10.5c1.7 2.1 2.9 3.6 2.9 5a2.9 2.9 0 0 1-5.8 0c0-1.4 1.2-2.9 2.9-5z"/>',
  'add-header-footer': '<rect x="5" y="3" width="14" height="18" rx="1.5"/><path d="M8 6.5h8M8 17.5h8"/>',
  'flatten-pdf': '<path d="M4 15l8 4 8-4M4 11l8 4 8-4M12 3l8 4-8 4-8-4z"/>',
  'edit-pdf-details': '<path d="M3 12.2V4a1 1 0 0 1 1-1h8.2l8.8 8.8-9.2 9.2z"/><circle cx="7.8" cy="7.8" r="1.6"/>',
  'remove-annotations': '<path d="M8 20.5h12M15.5 3.5l5 5L11 18H6.5L3.5 15z"/><path d="M10 9l5 5"/>',
  'grayscale-pdf': '<circle cx="12" cy="12" r="8.5"/>' + fill('M12 3.5a8.5 8.5 0 0 1 0 17z'),
  'add-image-to-pdf': PAGE + '<rect x="8.5" y="11" width="7" height="6.5" rx=".8"/><path d="M8.5 16l2.3-2.2 1.9 1.7 2.8-2.5"/>',
  // Read, compare and fix
  'ocr-pdf': '<path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3"/><path d="M8 9h8M8 12h8M8 15h5"/>',
  'compare-pdf': '<rect x="3" y="4" width="7.5" height="16" rx="1"/><rect x="13.5" y="4" width="7.5" height="16" rx="1"/><path d="M5.5 8h2.5M5.5 11h2.5M5.5 14h2.5M16 8h2.5M16 14h2.5"/>' + fill('M15.5 10.2h3.5v1.8h-3.5z'),
  'repair-pdf': '<path d="M15.2 3.3a5 5 0 0 0-5.1 7.1L3.6 16.9a1.9 1.9 0 0 0 2.7 2.7l6.5-6.5a5 5 0 0 0 7.1-5.1l-3 3-2.9-.8-.8-2.9z"/>',
  'pdf-page-sizes': '<rect x="7" y="7" width="12" height="14" rx="1"/><path d="M7 3.5h12M7 2.5v2M19 2.5v2M3.5 7v14M2.5 7h2M2.5 21h2"/>',
  'pdf-viewer': '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="3"/>',
  // Sign and protect
  'sign-pdf': '<path d="M3 19c3-1 4-8 6-8s0 7 2 7 2-4 4-4 1 3 3 3 2-1 3-1"/><path d="M14 4l4 4-7 7H7v-4z"/>',
  'protect-pdf': '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3M12 15v2"/>',
  'unlock-pdf': '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V8a4 4 0 0 1 7.6-1.8M12 15v2"/>',
  'sanitize-pdf': '<path d="M12 3l7.5 2.8V12c0 4.3-3.2 7.9-7.5 9-4.3-1.1-7.5-4.7-7.5-9V5.8z"/><path d="M8.7 12l2.3 2.3 4.3-4.6"/>',
};

export const toolIcon = (id, cls = 'ticon') => {
  const d = TOOL_ICONS[id];
  if (!d) throw new Error(`No icon drawn for the free tool "${id}" (scripts/free-tool-icons.mjs)`);
  return `<svg class="${cls}" viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">${d}</svg>`;
};
