const finitePositive = (value) => Number.isFinite(Number(value)) && Number(value) > 0;

const formatPt = (value) => Number(Number(value).toFixed(3)).toString();

export function buildBrowserPrintLayout(inputPages = []) {
  const pages = inputPages
    .filter((page) => (
      Number.isInteger(Number(page?.pageNumber))
      && Number(page.pageNumber) > 0
      && finitePositive(page?.widthPt)
      && finitePositive(page?.heightPt)
      && typeof page?.src === 'string'
      && page.src.length > 0
    ))
    .map((page) => ({
      ...page,
      pageNumber: Number(page.pageNumber),
      widthPt: Number(page.widthPt),
      heightPt: Number(page.heightPt),
      pageName: Number(page.widthPt) > Number(page.heightPt)
        ? `landscape-${Number(page.pageNumber)}`
        : null,
    }));

  // One uniform margin-less page rule (pdf.js's shipping print pattern).
  // Per-page named @page sizes broke real print dialogs two ways: with CSS
  // sizes ignored (default paper + margins) the fixed pt sheet heights
  // overflowed into a phantom trailing page, and mixed-orientation documents
  // paginated unpredictably. size:auto keeps the user's chosen paper,
  // margin:0 makes the page box the full sheet, and each sheet fills exactly
  // one page (100vh) with the image letterboxed via object-fit: contain.
  return {
    pages,
    pageCss: [
      '@page { size: auto; margin: 0; }',
      ...pages
        .filter((page) => page.pageName)
        .map((page) => `@page ${page.pageName} { size: landscape; margin: 0; }`),
    ].join('\n'),
  };
}
