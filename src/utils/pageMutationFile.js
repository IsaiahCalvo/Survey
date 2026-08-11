export const createPageMutationFile = (pdfBytes, pdfFile) => {
  const newFile = new File([pdfBytes], pdfFile.name, { type: 'application/pdf' });
  newFile._surveyPdfId = pdfFile._surveyPdfId || `${pdfFile.name}-${pdfFile.size}`;
  return newFile;
};
