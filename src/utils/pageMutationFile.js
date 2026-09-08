export const createPageMutationFile = (pdfBytes, pdfFile) => {
  const newFile = new File([pdfBytes], pdfFile.name, { type: 'application/pdf' });
  newFile._surveyPdfId = pdfFile._surveyPdfId || `${pdfFile.name}-${pdfFile.size}`;
  if (pdfFile.storageMode === 'local' && pdfFile.localId) {
    newFile.localId = pdfFile.localId;
    newFile.storageMode = 'local';
    newFile.localRevision = pdfFile.localRevision;
  }
  return newFile;
};
