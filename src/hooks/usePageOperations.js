// usePageOperations — the page add / delete / duplicate / reorder / rotate /
// mirror / reset / cut-copy-paste / insert-blank handlers for the thumbnail
// sidebar.
//
// Extracted verbatim from PDFViewer.jsx (the viewer break-up, phase 2). The
// handler bodies are a pure relocation — no behavior change. State stays owned
// by PDFViewer (pageNames / pageTransformations / clipboardPage / clipboardType
// are co-serialized with bookmarks + spaces in the shared sidebar localStorage
// effects, which are NOT part of this concern), so the component passes its
// state + setters in as the parameter bundle and the hook returns the handlers.
// PDFViewer destructures the returned handlers under their original names, so
// the leftRail API publisher and the per-page PageAnnotationLayer render sites
// keep referencing them unchanged.
//
// INVARIANT — every pdf-lib handler ends with the 2026-04-30 metadata copy
// (newFile.id / projectId / supabaseFilePath / user_id). That block preserves
// per-user delete authority across page-mutation round-trips and MUST stay
// verbatim. The useCallback/useMemo dependency arrays are unchanged so each
// handler keeps its referential identity for the leftRail identity-churn guard.

import { useCallback, useMemo } from 'react';
import { PDFDocument, degrees } from 'pdf-lib';
import { showToast } from '../utils/toast';

export function usePageOperations({
  pdfFile,
  onUpdatePDFFile,
  pageNames,
  setPageNames,
  setPageTransformations,
  clipboardPage,
  setClipboardPage,
  clipboardType,
  setClipboardType,
  pageNum,
  setPageNum,
}) {
  // Sidebar handlers
  const handleDuplicatePage = useCallback(async (pageNumber) => {
    if (!pdfFile || !onUpdatePDFFile) {
      showToast('PDF file not available for manipulation', 'error');
      return;
    }

    try {
      const arrayBuffer = await pdfFile.arrayBuffer();
      const pdfDoc = await PDFDocument.load(arrayBuffer);

      // Get the page to duplicate (convert from 1-based to 0-based)
      const pages = pdfDoc.getPages();
      const pageToDuplicate = pages[pageNumber - 1];

      if (!pageToDuplicate) {
        showToast(`Page ${pageNumber} not found`, 'error');
        return;
      }

      // Copy the page and insert it directly after the original
      const [copiedPage] = await pdfDoc.copyPages(pdfDoc, [pageNumber - 1]);
      pdfDoc.insertPage(pageNumber, copiedPage); // Insert after original (pageNumber is 1-based, insertPage uses 0-based)

      // Save the modified PDF
      const pdfBytes = await pdfDoc.save();
      const newFile = new File([pdfBytes], pdfFile.name, { type: 'application/pdf' });
      // 2026-04-30 fix: preserve all Supabase metadata across page-mutation
      // round-trips so the per-user delete authority gate keeps resolving
      // documentOwnerId on the next render. Pre-fix, every page op (duplicate
      // / delete / paste / reorder) reconstructed the File without these
      // fields, leaving pdfFile.user_id null and silently blocking deletes.
      newFile.id = pdfFile.id;
      newFile.projectId = pdfFile.projectId;
      newFile.supabaseFilePath = pdfFile.supabaseFilePath;
      newFile.user_id = pdfFile.user_id || null;

      // Update the PDF file
      onUpdatePDFFile(newFile);
    } catch (error) {
      console.error('Error duplicating page:', error);
      showToast(`Error duplicating page: ${error.message}`, 'error');
    }
  }, [pdfFile, onUpdatePDFFile]);

  const handleRenamePage = useCallback((pageNumber, newName) => {
    setPageNames(prev => ({ ...prev, [pageNumber]: newName }));
  }, []);

  const handleDeletePage = useCallback(async (pageNumber) => {
    if (!pdfFile || !onUpdatePDFFile) {
      showToast('PDF file not available for manipulation', 'error');
      return;
    }

    try {
      const arrayBuffer = await pdfFile.arrayBuffer();
      const pdfDoc = await PDFDocument.load(arrayBuffer);

      // Remove the page (convert from 1-based to 0-based)
      pdfDoc.removePage(pageNumber - 1);

      // Save the modified PDF
      const pdfBytes = await pdfDoc.save();
      const newFile = new File([pdfBytes], pdfFile.name, { type: 'application/pdf' });
      // 2026-04-30 fix: preserve all Supabase metadata across page-mutation
      // round-trips so the per-user delete authority gate keeps resolving
      // documentOwnerId on the next render. Pre-fix, every page op (duplicate
      // / delete / paste / reorder) reconstructed the File without these
      // fields, leaving pdfFile.user_id null and silently blocking deletes.
      newFile.id = pdfFile.id;
      newFile.projectId = pdfFile.projectId;
      newFile.supabaseFilePath = pdfFile.supabaseFilePath;
      newFile.user_id = pdfFile.user_id || null;

      // Update the PDF file
      onUpdatePDFFile(newFile);
    } catch (error) {
      console.error('Error deleting page:', error);
      showToast(`Error deleting page: ${error.message}`, 'error');
    }
  }, [pdfFile, onUpdatePDFFile]);

  const handleCutPage = useCallback((pageNumber) => {
    setClipboardPage(pageNumber);
    setClipboardType('cut');
  }, []);

  const handleCopyPage = useCallback((pageNumber) => {
    setClipboardPage(pageNumber);
    setClipboardType('copy');
  }, []);

  const handlePastePage = useCallback(async (targetPageNumber, sourcePageNumber, pasteType) => {
    if (!pdfFile || !onUpdatePDFFile) {
      showToast('PDF file not available for manipulation', 'error');
      return;
    }

    try {
      const arrayBuffer = await pdfFile.arrayBuffer();
      const pdfDoc = await PDFDocument.load(arrayBuffer);

      // Copy the source page
      const [copiedPage] = await pdfDoc.copyPages(pdfDoc, [sourcePageNumber - 1]);

      // Insert after target page (convert from 1-based to 0-based)
      const insertIndex = targetPageNumber; // Insert after targetPageNumber
      pdfDoc.insertPage(insertIndex, copiedPage);

      // If it was a cut operation, remove the source page
      if (pasteType === 'cut') {
        // After inserting, the source page index may have shifted
        const sourceIndex = sourcePageNumber - 1;
        if (sourceIndex < insertIndex) {
          // Source was before insert point, so it's still at the same index
          pdfDoc.removePage(sourceIndex);
        } else {
          // Source was after insert point, so it shifted by 1
          pdfDoc.removePage(sourceIndex + 1);
        }
        setClipboardPage(null);
        setClipboardType(null);
      }

      // Save the modified PDF
      const pdfBytes = await pdfDoc.save();
      const newFile = new File([pdfBytes], pdfFile.name, { type: 'application/pdf' });
      // 2026-04-30 fix: preserve all Supabase metadata across page-mutation
      // round-trips so the per-user delete authority gate keeps resolving
      // documentOwnerId on the next render. Pre-fix, every page op (duplicate
      // / delete / paste / reorder) reconstructed the File without these
      // fields, leaving pdfFile.user_id null and silently blocking deletes.
      newFile.id = pdfFile.id;
      newFile.projectId = pdfFile.projectId;
      newFile.supabaseFilePath = pdfFile.supabaseFilePath;
      newFile.user_id = pdfFile.user_id || null;

      // Update the PDF file
      onUpdatePDFFile(newFile);
    } catch (error) {
      console.error('Error pasting page:', error);
      showToast(`Error pasting page: ${error.message}`, 'error');
    }
  }, [pdfFile, onUpdatePDFFile]);

  const pageClipboardPayload = useMemo(() => (
    clipboardPage ? { pageNumber: clipboardPage, type: clipboardType } : null
  ), [clipboardPage, clipboardType]);

  const handlePastePageHere = useCallback((targetPageNumber) => (
    handlePastePage(targetPageNumber, clipboardPage, clipboardType)
  ), [clipboardPage, clipboardType, handlePastePage]);

  const handleReorderPages = useCallback((sourcePageNumber, targetPageNumber) => {
    // Reorder pages by swapping their positions
    // Note: This is a simplified implementation - actual PDF reordering would require PDF manipulation
    // For now, we'll update page names to reflect the new order
    const newPageNames = { ...pageNames };
    const sourceName = pageNames[sourcePageNumber] || `Page ${sourcePageNumber}`;
    const targetName = pageNames[targetPageNumber] || `Page ${targetPageNumber}`;

    newPageNames[sourcePageNumber] = targetName;
    newPageNames[targetPageNumber] = sourceName;

    setPageNames(newPageNames);

    // If we're on one of the reordered pages, navigate to maintain context
    if (pageNum === sourcePageNumber) {
      setPageNum(targetPageNumber);
    } else if (pageNum === targetPageNumber) {
      setPageNum(sourcePageNumber);
    }
  }, [pageNames, pageNum]);

  const handleRotatePage = useCallback((pageNumber) => {
    setPageTransformations(prev => {
      const current = prev[pageNumber] || { rotation: 0, mirrorH: false, mirrorV: false };
      const newRotation = (current.rotation + 90) % 360;
      return {
        ...prev,
        [pageNumber]: {
          ...current,
          rotation: newRotation
        }
      };
    });
  }, []);

  const handleMirrorPage = useCallback((pageNumber, direction) => {
    setPageTransformations(prev => {
      const current = prev[pageNumber] || { rotation: 0, mirrorH: false, mirrorV: false };
      return {
        ...prev,
        [pageNumber]: {
          ...current,
          [direction === 'horizontal' ? 'mirrorH' : 'mirrorV']: !current[direction === 'horizontal' ? 'mirrorH' : 'mirrorV']
        }
      };
    });
  }, []);

  const handleResetPage = useCallback((pageNumber) => {
    setPageTransformations(prev => {
      const newTransformations = { ...prev };
      delete newTransformations[pageNumber];
      return newTransformations;
    });
  }, []);

  // PDF-lib based rotation handlers (persistent - modifies actual PDF)
  const handleRotatePageCW = useCallback(async (pageNumber) => {
    if (!pdfFile || !onUpdatePDFFile) {
      showToast('PDF file not available for manipulation', 'error');
      return;
    }

    try {
      const arrayBuffer = await pdfFile.arrayBuffer();
      const pdfDoc = await PDFDocument.load(arrayBuffer);
      const page = pdfDoc.getPage(pageNumber - 1);

      // Get current rotation and add 90 degrees clockwise
      const currentRotation = page.getRotation().angle;
      const newRotation = (currentRotation + 90) % 360;
      page.setRotation(degrees(newRotation));

      // Save the modified PDF
      const pdfBytes = await pdfDoc.save();
      const newFile = new File([pdfBytes], pdfFile.name, { type: 'application/pdf' });
      // 2026-04-30 fix: preserve all Supabase metadata across page-mutation
      // round-trips so the per-user delete authority gate keeps resolving
      // documentOwnerId on the next render. Pre-fix, every page op (duplicate
      // / delete / paste / reorder) reconstructed the File without these
      // fields, leaving pdfFile.user_id null and silently blocking deletes.
      newFile.id = pdfFile.id;
      newFile.projectId = pdfFile.projectId;
      newFile.supabaseFilePath = pdfFile.supabaseFilePath;
      newFile.user_id = pdfFile.user_id || null;

      onUpdatePDFFile(newFile);
    } catch (error) {
      console.error('Error rotating page clockwise:', error);
      showToast(`Error rotating page: ${error.message}`, 'error');
    }
  }, [pdfFile, onUpdatePDFFile]);

  const handleRotatePageCCW = useCallback(async (pageNumber) => {
    if (!pdfFile || !onUpdatePDFFile) {
      showToast('PDF file not available for manipulation', 'error');
      return;
    }

    try {
      const arrayBuffer = await pdfFile.arrayBuffer();
      const pdfDoc = await PDFDocument.load(arrayBuffer);
      const page = pdfDoc.getPage(pageNumber - 1);

      // Get current rotation and subtract 90 degrees (counter-clockwise)
      const currentRotation = page.getRotation().angle;
      const newRotation = (currentRotation - 90 + 360) % 360;
      page.setRotation(degrees(newRotation));

      // Save the modified PDF
      const pdfBytes = await pdfDoc.save();
      const newFile = new File([pdfBytes], pdfFile.name, { type: 'application/pdf' });
      // 2026-04-30 fix: preserve all Supabase metadata across page-mutation
      // round-trips so the per-user delete authority gate keeps resolving
      // documentOwnerId on the next render. Pre-fix, every page op (duplicate
      // / delete / paste / reorder) reconstructed the File without these
      // fields, leaving pdfFile.user_id null and silently blocking deletes.
      newFile.id = pdfFile.id;
      newFile.projectId = pdfFile.projectId;
      newFile.supabaseFilePath = pdfFile.supabaseFilePath;
      newFile.user_id = pdfFile.user_id || null;

      onUpdatePDFFile(newFile);
    } catch (error) {
      console.error('Error rotating page counter-clockwise:', error);
      showToast(`Error rotating page: ${error.message}`, 'error');
    }
  }, [pdfFile, onUpdatePDFFile]);

  const handleInsertBlankPage = useCallback(async (afterPageNumber) => {
    if (!pdfFile || !onUpdatePDFFile) {
      showToast('PDF file not available for manipulation', 'error');
      return;
    }

    try {
      const arrayBuffer = await pdfFile.arrayBuffer();
      const pdfDoc = await PDFDocument.load(arrayBuffer);

      // Get dimensions from the reference page
      const refPage = pdfDoc.getPage(afterPageNumber - 1);
      const { width, height } = refPage.getSize();

      // Insert blank page after the specified page (afterPageNumber is 1-based)
      pdfDoc.insertPage(afterPageNumber, [width, height]);

      // Save the modified PDF
      const pdfBytes = await pdfDoc.save();
      const newFile = new File([pdfBytes], pdfFile.name, { type: 'application/pdf' });
      // 2026-04-30 fix: preserve all Supabase metadata across page-mutation
      // round-trips so the per-user delete authority gate keeps resolving
      // documentOwnerId on the next render. Pre-fix, every page op (duplicate
      // / delete / paste / reorder) reconstructed the File without these
      // fields, leaving pdfFile.user_id null and silently blocking deletes.
      newFile.id = pdfFile.id;
      newFile.projectId = pdfFile.projectId;
      newFile.supabaseFilePath = pdfFile.supabaseFilePath;
      newFile.user_id = pdfFile.user_id || null;

      onUpdatePDFFile(newFile);
    } catch (error) {
      console.error('Error inserting blank page:', error);
      showToast(`Error inserting page: ${error.message}`, 'error');
    }
  }, [pdfFile, onUpdatePDFFile]);

  return {
    handleDuplicatePage,
    handleRenamePage,
    handleDeletePage,
    handleCutPage,
    handleCopyPage,
    handlePastePage,
    pageClipboardPayload,
    handlePastePageHere,
    handleReorderPages,
    handleRotatePage,
    handleMirrorPage,
    handleResetPage,
    handleRotatePageCW,
    handleRotatePageCCW,
    handleInsertBlankPage,
  };
}
