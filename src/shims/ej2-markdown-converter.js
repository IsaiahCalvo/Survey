/**
 * ej2-markdown-converter.js — stub shim for Syncfusion's markdown converter.
 *
 * Exports a MarkdownConverter object whose toHtml() is a passthrough (returns
 * the input text unchanged), letting the bundle satisfy the import without the
 * real EJ2 markdown dependency.
 */
export const MarkdownConverter = {
  toHtml(text = '') {
    return text;
  }
};
