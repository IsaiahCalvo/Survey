import { readCheckedGenerationPdf } from './documentGenerationReader.js';

/** Build viewer input only after exact issued scope validation. Retain the
 * original bundle identity; copying its fields would discard its proof. No
 * network calls or annotation-state copies occur at this seam. */
export function prepareCheckedDocumentOpen(checkedBundle, actorUserId) {
  try {
    const { documentId, pdfGenerationId } = checkedBundle;
    const pdf = readCheckedGenerationPdf(checkedBundle, { documentId, actorUserId, pdfGenerationId });
    const document = checkedBundle.document;
    const file = new File([pdf], document.name, { type: 'application/pdf' });
    Object.assign(file, {
      id: documentId, user_id: document.user_id,
      projectId: document.project_id, project_id: document.project_id,
      filePath: checkedBundle.pdf.path, file_path: checkedBundle.pdf.path,
      supabaseFilePath: checkedBundle.pdf.path, pdfGenerationId,
    });
    return Object.freeze({ file, checkedBundle, pdfGenerationId, actorUserId });
  } catch {
    throw Object.assign(new Error('The checked document could not be opened.'), { code: 'DOCUMENT_OPEN_INPUT' });
  }
}
