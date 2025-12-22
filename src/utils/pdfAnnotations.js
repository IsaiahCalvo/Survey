/**
 * PDF Annotation Utilities
 * Converts Fabric.js canvas annotations to PDF standard annotations
 * Uses annotpdf library to embed annotations into PDF files
 */

import { AnnotationFactory } from 'annotpdf';

/**
 * Convert Fabric.js path object (pen/highlighter stroke) to PDF Ink annotation
 */
const fabricPathToInkAnnotation = (fabricObj, pageNumber, pageHeight) => {
  if (fabricObj.type?.toLowerCase() !== 'path') {
    console.log(`fabricPathToInkAnnotation: Wrong type ${fabricObj.type}`);
    return null;
  }

  try {
    // Extract path points from Fabric.js path data
    const pathData = fabricObj.path;
    console.log('Path data:', pathData);
    if (!pathData || pathData.length === 0) {
      console.log('No path data found');
      return null;
    }

    const inkLists = [];
    let currentList = [];

    pathData.forEach(cmd => {
      const command = cmd[0];
      if (command === 'M') {
        // Move command - start new ink list if we have points
        if (currentList.length > 0) {
          inkLists.push([...currentList]);
          currentList = [];
        }
        currentList.push(cmd[1], pageHeight - cmd[2]); // Flip Y coordinate
      } else if (command === 'L') {
        // Line command - add to current list
        currentList.push(cmd[1], pageHeight - cmd[2]); // Flip Y coordinate
      } else if (command === 'Q') {
        // Quadratic bezier - approximate with line to end point
        currentList.push(cmd[3], pageHeight - cmd[4]);
      } else if (command === 'C') {
        // Cubic bezier - approximate with line to end point
        currentList.push(cmd[5], pageHeight - cmd[6]);
      }
    });

    // Add final list
    if (currentList.length > 0) {
      inkLists.push(currentList);
    }

    console.log(`Generated ${inkLists.length} ink lists with ${inkLists.reduce((sum, list) => sum + list.length / 2, 0)} total points`);

    if (inkLists.length === 0) {
      console.log('No ink lists generated');
      return null;
    }

    // Calculate bounding rect from path data (can't use getBoundingRect on serialized JSON)
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    pathData.forEach(cmd => {
      const command = cmd[0];
      if (command === 'M' || command === 'L') {
        minX = Math.min(minX, cmd[1]);
        maxX = Math.max(maxX, cmd[1]);
        minY = Math.min(minY, cmd[2]);
        maxY = Math.max(maxY, cmd[2]);
      } else if (command === 'Q') {
        minX = Math.min(minX, cmd[1], cmd[3]);
        maxX = Math.max(maxX, cmd[1], cmd[3]);
        minY = Math.min(minY, cmd[2], cmd[4]);
        maxY = Math.max(maxY, cmd[2], cmd[4]);
      } else if (command === 'C') {
        minX = Math.min(minX, cmd[1], cmd[3], cmd[5]);
        maxX = Math.max(maxX, cmd[1], cmd[3], cmd[5]);
        minY = Math.min(minY, cmd[2], cmd[4], cmd[6]);
        maxY = Math.max(maxY, cmd[2], cmd[4], cmd[6]);
      }
    });

    const bounds = {
      left: minX,
      top: minY,
      width: maxX - minX,
      height: maxY - minY
    };
    console.log('Calculated bounds:', bounds);

    return {
      type: 'ink',
      page: pageNumber,
      rect: [
        bounds.left,
        pageHeight - (bounds.top + bounds.height), // Flip Y
        bounds.left + bounds.width,
        pageHeight - bounds.top
      ],
      inkLists: inkLists,
      color: fabricObj.stroke || '#000000',
      width: fabricObj.strokeWidth || 1,
      opacity: fabricObj.opacity || 1.0
    };
  } catch (e) {
    console.error('Error converting path to ink annotation:', e);
    return null;
  }
};

/**
 * Convert Fabric.js textbox to PDF FreeText annotation
 */
const fabricTextToFreeTextAnnotation = (fabricObj, pageNumber, pageHeight) => {
  if (fabricObj.type !== 'textbox' && fabricObj.type !== 'text') return null;

  try {
    return {
      type: 'freetext',
      page: pageNumber,
      rect: [
        fabricObj.left,
        pageHeight - (fabricObj.top + fabricObj.height),
        fabricObj.left + fabricObj.width,
        pageHeight - fabricObj.top
      ],
      contents: fabricObj.text || '',
      color: fabricObj.fill || '#000000',
      fontSize: fabricObj.fontSize || 12
    };
  } catch (e) {
    console.error('Error converting text to freetext annotation:', e);
    return null;
  }
};

/**
 * Convert Fabric.js rectangle to PDF Square annotation
 */
const fabricRectToSquareAnnotation = (fabricObj, pageNumber, pageHeight) => {
  if (fabricObj.type !== 'rect') return null;

  try {
    return {
      type: 'square',
      page: pageNumber,
      rect: [
        fabricObj.left,
        pageHeight - (fabricObj.top + fabricObj.height),
        fabricObj.left + fabricObj.width,
        pageHeight - fabricObj.top
      ],
      color: fabricObj.stroke || '#000000',
      width: fabricObj.strokeWidth || 1,
      opacity: fabricObj.opacity || 1.0
    };
  } catch (e) {
    console.error('Error converting rect to square annotation:', e);
    return null;
  }
};

/**
 * Convert Fabric.js circle to PDF Circle annotation
 */
const fabricCircleToCircleAnnotation = (fabricObj, pageNumber, pageHeight) => {
  if (fabricObj.type !== 'circle') return null;

  try {
    const radius = fabricObj.radius || 10;
    return {
      type: 'circle',
      page: pageNumber,
      rect: [
        fabricObj.left,
        pageHeight - (fabricObj.top + radius * 2),
        fabricObj.left + radius * 2,
        pageHeight - fabricObj.top
      ],
      color: fabricObj.stroke || '#000000',
      width: fabricObj.strokeWidth || 1,
      opacity: fabricObj.opacity || 1.0
    };
  } catch (e) {
    console.error('Error converting circle to circle annotation:', e);
    return null;
  }
};

/**
 * Convert Fabric.js line to PDF Line annotation
 */
const fabricLineToLineAnnotation = (fabricObj, pageNumber, pageHeight) => {
  if (fabricObj.type !== 'line') return null;

  try {
    return {
      type: 'line',
      page: pageNumber,
      rect: [
        Math.min(fabricObj.x1, fabricObj.x2),
        pageHeight - Math.max(fabricObj.y1, fabricObj.y2),
        Math.max(fabricObj.x1, fabricObj.x2),
        pageHeight - Math.min(fabricObj.y1, fabricObj.y2)
      ],
      start: [fabricObj.x1, pageHeight - fabricObj.y1],
      end: [fabricObj.x2, pageHeight - fabricObj.y2],
      color: fabricObj.stroke || '#000000',
      width: fabricObj.strokeWidth || 1,
      opacity: fabricObj.opacity || 1.0
    };
  } catch (e) {
    console.error('Error converting line to line annotation:', e);
    return null;
  }
};

/**
 * Convert all Fabric.js annotations on a page to PDF annotations
 */
export const convertPageAnnotationsToPDF = (fabricJSON, pageNumber, pageHeight) => {
  if (!fabricJSON || !fabricJSON.objects) {
    console.log('No fabricJSON or objects for page', pageNumber);
    return [];
  }

  console.log(`Page ${pageNumber + 1}: Processing ${fabricJSON.objects.length} total objects`);

  const pdfAnnotations = [];

  fabricJSON.objects.forEach(obj => {
    console.log(`Object type: ${obj.type}, moduleId: ${obj.moduleId}, highlightId: ${obj.highlightId}`);

    // Skip objects that have moduleId (they're survey-specific, don't embed in PDF)
    if (obj.moduleId) {
      console.log('Skipping object with moduleId');
      return;
    }

    // Skip survey highlight rectangles (they have highlightId)
    if (obj.highlightId) {
      console.log('Skipping object with highlightId');
      return;
    }

    let annotation = null;
    const objType = obj.type?.toLowerCase(); // Normalize to lowercase

    switch (objType) {
      case 'path':
        console.log('Converting path to ink annotation');
        annotation = fabricPathToInkAnnotation(obj, pageNumber, pageHeight);
        break;
      case 'textbox':
      case 'text':
        annotation = fabricTextToFreeTextAnnotation(obj, pageNumber, pageHeight);
        break;
      case 'rect':
        annotation = fabricRectToSquareAnnotation(obj, pageNumber, pageHeight);
        break;
      case 'circle':
        annotation = fabricCircleToCircleAnnotation(obj, pageNumber, pageHeight);
        break;
      case 'line':
        annotation = fabricLineToLineAnnotation(obj, pageNumber, pageHeight);
        break;
      // TODO: Add support for groups (arrows), polylines, etc.
      default:
        console.log(`Unsupported annotation type: ${obj.type}`);
    }

    if (annotation) {
      pdfAnnotations.push(annotation);
    }
  });

  return pdfAnnotations;
};

/**
 * Save PDF with embedded annotations
 */
export const savePDFWithAnnotations = async (pdfFile, annotationsByPage, pageSizes) => {
  try {
    console.log('Starting PDF annotation embedding...');

    // Load PDF file as ArrayBuffer
    const arrayBuffer = await pdfFile.arrayBuffer();
    const uint8Array = new Uint8Array(arrayBuffer);

    // Create annotation factory (using constructor, not fromData)
    const factory = new AnnotationFactory(uint8Array);

    let totalAnnotations = 0;

    console.log('annotationsByPage:', annotationsByPage);
    console.log('pageSizes:', pageSizes);

    // Convert and add annotations for each page
    Object.entries(annotationsByPage).forEach(([pageNumStr, pageData]) => {
      const pageNumber = parseInt(pageNumStr) - 1; // Convert to 0-indexed
      const pageSize = pageSizes[pageNumStr];

      console.log(`Processing page ${pageNumStr}, pageData:`, pageData);

      if (!pageSize) {
        console.warn(`No page size found for page ${pageNumStr}`);
        return;
      }

      const pageHeight = pageSize.height;
      const pdfAnnotations = convertPageAnnotationsToPDF(pageData, pageNumber, pageHeight);

      console.log(`Page ${pageNumStr}: Converting ${pdfAnnotations.length} annotations`);

      // Add each annotation to the PDF
      pdfAnnotations.forEach(annot => {
        try {
          switch (annot.type) {
            case 'ink':
              factory.createInkAnnotation({
                page: annot.page,
                rect: annot.rect,
                inkLists: annot.inkLists,
                color: hexToRGB(annot.color)
              });
              totalAnnotations++;
              break;

            case 'freetext':
              factory.createFreeTextAnnotation({
                page: annot.page,
                rect: annot.rect,
                contents: annot.contents,
                color: hexToRGB(annot.color)
              });
              totalAnnotations++;
              break;

            case 'square':
              factory.createSquareAnnotation({
                page: annot.page,
                rect: annot.rect,
                color: hexToRGB(annot.color)
              });
              totalAnnotations++;
              break;

            case 'circle':
              factory.createCircleAnnotation({
                page: annot.page,
                rect: annot.rect,
                color: hexToRGB(annot.color)
              });
              totalAnnotations++;
              break;

            case 'line':
              factory.createLineAnnotation({
                page: annot.page,
                rect: annot.rect,
                start: annot.start,
                end: annot.end,
                color: hexToRGB(annot.color)
              });
              totalAnnotations++;
              break;

            default:
              console.warn(`Unsupported annotation type for PDF embedding: ${annot.type}`);
          }
        } catch (e) {
          console.error(`Error adding ${annot.type} annotation:`, e);
        }
      });
    });

    console.log(`Embedded ${totalAnnotations} annotations into PDF`);

    // Write the modified PDF
    const modifiedPdfBytes = await factory.write();

    // Check if we're in Electron and have the original file path
    if (window.electronAPI && pdfFile.path) {
      // Save to original file location using atomic write (crash-safe)
      console.log(`Saving to original file: ${pdfFile.path}`);
      if (window.electronAPI.writeFileAtomic) {
        await window.electronAPI.writeFileAtomic(pdfFile.path, modifiedPdfBytes);
      } else {
        // Fallback to regular write if atomic not available
        await window.electronAPI.writeFile(pdfFile.path, modifiedPdfBytes);
      }
      console.log('PDF saved successfully to original location with embedded annotations');
    } else {
      // Fallback: Download the file (browser mode or no path available)
      console.log('Downloading modified PDF (no original path available)');
      const blob = new Blob([modifiedPdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = pdfFile.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      console.log('PDF downloaded successfully with embedded annotations');
    }

    return true;
  } catch (error) {
    console.error('Error saving PDF with annotations:', error);
    throw error;
  }
};

/**
 * Helper: Convert hex color to RGB object
 */
export const hexToRGB = (hex) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  return result ? {
    r: parseInt(result[1], 16),
    g: parseInt(result[2], 16),
    b: parseInt(result[3], 16)
  } : { r: 0, g: 0, b: 0 };
};
