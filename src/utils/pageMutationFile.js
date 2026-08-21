export const createPageMutationFile = (pdfBytes, pdfFile) => {
  const newFile = new File([pdfBytes], pdfFile.name, { type: 'application/pdf' });
  newFile._surveyPdfId = pdfFile._surveyPdfId || `${pdfFile.name}-${pdfFile.size}`;
  // DEV / ?testPdf= History keys off this local id. Page duplicate/delete
  // must keep it or getHistoryDocumentId() goes null and RevisionsPanel
  // used to crash (hooks-after-early-return).
  if (pdfFile.__localHistoryDocumentId) {
    newFile.__localHistoryDocumentId = pdfFile.__localHistoryDocumentId;
  }
  return newFile;
};
