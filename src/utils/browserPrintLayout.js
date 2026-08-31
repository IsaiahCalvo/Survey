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
      pageName: `survey-print-page-${Number(page.pageNumber)}`,
    }));

  return {
    pages,
    pageCss: pages.map((page) => (
      `@page ${page.pageName} { size: ${formatPt(page.widthPt)}pt ${formatPt(page.heightPt)}pt; margin: 0; }`
    )).join('\n'),
  };
}
