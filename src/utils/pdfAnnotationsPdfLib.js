/**
 * PDF Annotation System using pdf-lib Low-Level API
 * Manually creates PDF annotations following PDF 1.7 specification
 * Compatible with Adobe Acrobat and all PDF readers
 */

import { PDFDocument, PDFName, PDFArray, PDFDict, PDFNumber, PDFString, rgb } from 'pdf-lib';

/**
 * Convert hex color to RGB object for pdf-lib
 */
const hexToRGB = (hex) => {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (result) {
    return rgb(
      parseInt(result[1], 16) / 255,
      parseInt(result[2], 16) / 255,
      parseInt(result[3], 16) / 255
    );
  }
  return rgb(0, 0, 0);
};

/**
 * Convert Fabric.js path to PDF Ink annotation
 */
const createInkAnnotation = (pdfDoc, page, fabricObj, pageHeight) => {
  try {
    const pathData = fabricObj.path;
    if (!pathData || pathData.length === 0) {
      return null;
    }

    // Build InkList - array of arrays of coordinates
    const inkList = [];
    let currentPath = [];

    pathData.forEach(cmd => {
      const command = cmd[0];
      if (command === 'M') {
        // Move - start new path if we have points
        if (currentPath.length > 0) {
          inkList.push(currentPath);
          currentPath = [];
        }
        // Add point (flip Y coordinate for PDF)
        currentPath.push(cmd[1], pageHeight - cmd[2]);
      } else if (command === 'L') {
        // Line - add point
        currentPath.push(cmd[1], pageHeight - cmd[2]);
      } else if (command === 'Q') {
        // Quadratic bezier - use end point
        currentPath.push(cmd[3], pageHeight - cmd[4]);
      } else if (command === 'C') {
        // Cubic bezier - use end point
        currentPath.push(cmd[5], pageHeight - cmd[6]);
      }
    });

    // Add final path
    if (currentPath.length > 0) {
      inkList.push(currentPath);
    }

    if (inkList.length === 0) {
      return null;
    }

    // Calculate bounding rect
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    pathData.forEach(cmd => {
      const command = cmd[0];
      if (command === 'M' || command === 'L') {
        minX = Math.min(minX, cmd[1]);
        maxX = Math.max(maxX, cmd[1]);
        minY = Math.min(minY, pageHeight - cmd[2]);
        maxY = Math.max(maxY, pageHeight - cmd[2]);
      } else if (command === 'Q') {
        minX = Math.min(minX, cmd[1], cmd[3]);
        maxX = Math.max(maxX, cmd[1], cmd[3]);
        minY = Math.min(minY, pageHeight - cmd[2], pageHeight - cmd[4]);
        maxY = Math.max(maxY, pageHeight - cmd[2], pageHeight - cmd[4]);
      } else if (command === 'C') {
        minX = Math.min(minX, cmd[1], cmd[3], cmd[5]);
        maxX = Math.max(maxX, cmd[1], cmd[3], cmd[5]);
        minY = Math.min(minY, pageHeight - cmd[2], pageHeight - cmd[4], pageHeight - cmd[6]);
        maxY = Math.max(maxY, pageHeight - cmd[2], pageHeight - cmd[4], pageHeight - cmd[6]);
      }
    });

    // Get color
    const color = hexToRGB(fabricObj.stroke || '#000000');

    // Create InkList PDF array
    const inkListArray = pdfDoc.context.obj(
      inkList.map(path => path.map(coord => PDFNumber.of(coord)))
    );

    // Create annotation dictionary following PDF spec
    const annotationDict = pdfDoc.context.obj({
      Type: 'Annot',
      Subtype: 'Ink',
      Rect: [minX, minY, maxX, maxY],
      InkList: inkListArray,
      C: [color.red, color.green, color.blue],
      Border: [0, 0, fabricObj.strokeWidth || 1],
      Contents: PDFString.of(''),
      P: page.ref, // Reference to page
    });

    return pdfDoc.context.register(annotationDict);
  } catch (e) {
    console.error('Error creating ink annotation:', e);
    return null;
  }
};

/**
 * Create Square annotation (rectangle)
 */
const createSquareAnnotation = (pdfDoc, page, fabricObj, pageHeight) => {
  try {
    const color = hexToRGB(fabricObj.stroke || '#000000');
    const fillColor = fabricObj.fill ? hexToRGB(fabricObj.fill) : null;

    const left = fabricObj.left || 0;
    const top = fabricObj.top || 0;
    const width = fabricObj.width || 0;
    const height = fabricObj.height || 0;

    // Calculate bounds (flip Y for PDF coordinate system)
    const minX = left;
    const minY = pageHeight - (top + height);
    const maxX = left + width;
    const maxY = pageHeight - top;

    const annotationDict = {
      Type: 'Annot',
      Subtype: 'Square',
      Rect: [minX, minY, maxX, maxY],
      C: [color.red, color.green, color.blue],
      Border: [0, 0, fabricObj.strokeWidth || 1],
      Contents: PDFString.of(''),
      P: page.ref,
    };

    // Add fill color if present
    if (fillColor && fabricObj.fill !== 'transparent') {
      annotationDict.IC = [fillColor.red, fillColor.green, fillColor.blue];
    }

    return pdfDoc.context.register(pdfDoc.context.obj(annotationDict));
  } catch (e) {
    console.error('Error creating square annotation:', e);
    return null;
  }
};

/**
 * Create Circle annotation (ellipse)
 */
const createCircleAnnotation = (pdfDoc, page, fabricObj, pageHeight) => {
  try {
    const color = hexToRGB(fabricObj.stroke || '#000000');
    const fillColor = fabricObj.fill ? hexToRGB(fabricObj.fill) : null;

    const left = fabricObj.left || 0;
    const top = fabricObj.top || 0;
    const radius = fabricObj.radius || 10;

    // Calculate bounds (flip Y for PDF coordinate system)
    const minX = left;
    const minY = pageHeight - (top + radius * 2);
    const maxX = left + radius * 2;
    const maxY = pageHeight - top;

    const annotationDict = {
      Type: 'Annot',
      Subtype: 'Circle',
      Rect: [minX, minY, maxX, maxY],
      C: [color.red, color.green, color.blue],
      Border: [0, 0, fabricObj.strokeWidth || 1],
      Contents: PDFString.of(''),
      P: page.ref,
    };

    // Add fill color if present
    if (fillColor && fabricObj.fill !== 'transparent') {
      annotationDict.IC = [fillColor.red, fillColor.green, fillColor.blue];
    }

    return pdfDoc.context.register(pdfDoc.context.obj(annotationDict));
  } catch (e) {
    console.error('Error creating circle annotation:', e);
    return null;
  }
};

/**
 * Create Highlight annotation
 * Uses QuadPoints following Adobe's implementation (not PDF spec order)
 */
const createHighlightAnnotation = (pdfDoc, page, fabricObj, pageHeight) => {
  try {
    const color = hexToRGB(fabricObj.fill || '#FFFF00');

    const left = fabricObj.left || 0;
    const top = fabricObj.top || 0;
    const width = fabricObj.width || 0;
    const height = fabricObj.height || 0;

    // Calculate bounds (flip Y for PDF coordinate system)
    const minX = left;
    const minY = pageHeight - (top + height);
    const maxX = left + width;
    const maxY = pageHeight - top;

    // QuadPoints: Adobe order is TopLeft, TopRight, BottomLeft, BottomRight
    // (not PDF spec order which is counter-clockwise)
    const quadPoints = [
      minX, maxY,  // Top-left
      maxX, maxY,  // Top-right
      minX, minY,  // Bottom-left
      maxX, minY   // Bottom-right
    ];

    const annotationDict = pdfDoc.context.obj({
      Type: 'Annot',
      Subtype: 'Highlight',
      Rect: [minX, minY, maxX, maxY],
      QuadPoints: quadPoints.map(n => PDFNumber.of(n)),
      C: [color.red, color.green, color.blue],
      Contents: PDFString.of(''),
      P: page.ref,
    });

    return pdfDoc.context.register(annotationDict);
  } catch (e) {
    console.error('Error creating highlight annotation:', e);
    return null;
  }
};

/**
 * Create Polygon annotation with optional cloud border effect
 */
const createPolygonAnnotation = (pdfDoc, page, fabricObj, pageHeight) => {
  try {
    const color = hexToRGB(fabricObj.stroke || '#000000');
    const fillColor = fabricObj.fill ? hexToRGB(fabricObj.fill) : null;

    // Extract points from Fabric.js polygon
    const points = fabricObj.points || [];
    if (points.length < 3) {
      return null;
    }

    const left = fabricObj.left || 0;
    const top = fabricObj.top || 0;

    // Convert points to PDF coordinates (flip Y)
    const vertices = [];
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;

    points.forEach(point => {
      const x = left + point.x;
      const y = pageHeight - (top + point.y);
      vertices.push(x, y);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    });

    const annotationDict = {
      Type: 'Annot',
      Subtype: 'Polygon',
      Rect: [minX, minY, maxX, maxY],
      Vertices: vertices.map(n => PDFNumber.of(n)),
      C: [color.red, color.green, color.blue],
      Border: [0, 0, fabricObj.strokeWidth || 1],
      Contents: PDFString.of(''),
      P: page.ref,
    };

    // Add fill color if present
    if (fillColor && fabricObj.fill !== 'transparent') {
      annotationDict.IC = [fillColor.red, fillColor.green, fillColor.blue];
    }

    // Add cloud border effect if specified
    if (fabricObj.cloudBorder || fabricObj.borderEffect === 'cloudy') {
      annotationDict.BE = pdfDoc.context.obj({
        S: PDFName.of('C'), // Cloudy
        I: PDFNumber.of(fabricObj.cloudIntensity || 2)
      });
      annotationDict.IT = PDFName.of('PolygonCloud');
    }

    return pdfDoc.context.register(pdfDoc.context.obj(annotationDict));
  } catch (e) {
    console.error('Error creating polygon annotation:', e);
    return null;
  }
};

/**
 * Create Line annotation with optional callout
 */
const createLineAnnotation = (pdfDoc, page, fabricObj, pageHeight) => {
  try {
    const color = hexToRGB(fabricObj.stroke || '#000000');

    const x1 = fabricObj.x1 || 0;
    const y1 = fabricObj.y1 || 0;
    const x2 = fabricObj.x2 || 0;
    const y2 = fabricObj.y2 || 0;

    // Calculate bounds (flip Y for PDF coordinate system)
    const minX = Math.min(x1, x2);
    const minY = Math.min(pageHeight - y1, pageHeight - y2);
    const maxX = Math.max(x1, x2);
    const maxY = Math.max(pageHeight - y1, pageHeight - y2);

    const annotationDict = {
      Type: 'Annot',
      Subtype: 'Line',
      Rect: [minX, minY, maxX, maxY],
      L: [x1, pageHeight - y1, x2, pageHeight - y2],
      C: [color.red, color.green, color.blue],
      Border: [0, 0, fabricObj.strokeWidth || 1],
      Contents: PDFString.of(''),
      P: page.ref,
    };

    // Add line endings (arrows, etc.)
    if (fabricObj.lineEnding1 || fabricObj.lineEnding2) {
      const le1 = fabricObj.lineEnding1 || 'None';
      const le2 = fabricObj.lineEnding2 || 'None';
      annotationDict.LE = [PDFName.of(le1), PDFName.of(le2)];
    }

    return pdfDoc.context.register(pdfDoc.context.obj(annotationDict));
  } catch (e) {
    console.error('Error creating line annotation:', e);
    return null;
  }
};

/**
 * Create FreeText annotation (text box)
 */
const createFreeTextAnnotation = (pdfDoc, page, fabricObj, pageHeight) => {
  try {
    const color = hexToRGB(fabricObj.fill || '#000000');

    const left = fabricObj.left || 0;
    const top = fabricObj.top || 0;
    const width = fabricObj.width || 100;
    const height = fabricObj.height || 20;
    const text = fabricObj.text || '';
    const fontSize = fabricObj.fontSize || 12;

    // Calculate bounds (flip Y for PDF coordinate system)
    const minX = left;
    const minY = pageHeight - (top + height);
    const maxX = left + width;
    const maxY = pageHeight - top;

    // Default appearance string (simplified - using Helvetica)
    const da = `0 0 0 rg /Helv ${fontSize} Tf`;

    const annotationDict = {
      Type: 'Annot',
      Subtype: 'FreeText',
      Rect: [minX, minY, maxX, maxY],
      Contents: PDFString.of(text),
      DA: PDFString.of(da),
      C: [color.red, color.green, color.blue],
      Border: [0, 0, 0], // No border for text boxes
      P: page.ref,
    };

    return pdfDoc.context.register(pdfDoc.context.obj(annotationDict));
  } catch (e) {
    console.error('Error creating freetext annotation:', e);
    return null;
  }
};

/**
 * Save PDF with embedded annotations using pdf-lib
 */
export const savePDFWithAnnotationsPdfLib = async (pdfFile, annotationsByPage, pageSizes, pdfFilePath = null) => {
  try {
    // Load PDF
    const arrayBuffer = await pdfFile.arrayBuffer();
    const pdfDoc = await PDFDocument.load(arrayBuffer);

    let totalAnnotations = 0;

    // Process each page with annotations
    Object.entries(annotationsByPage).forEach(([pageNumStr, pageData]) => {
      const pageNumber = parseInt(pageNumStr) - 1; // Convert to 0-indexed
      const pageSize = pageSizes[pageNumStr];

      if (!pageSize) {
        console.warn(`No page size found for page ${pageNumStr}`);
        return;
      }

      if (!pageData || !pageData.objects) {
        return;
      }

      const page = pdfDoc.getPage(pageNumber);
      const pageHeight = pageSize.height;

      // Get or create Annots array
      let annots = page.node.lookup(PDFName.of('Annots'));
      if (!annots) {
        annots = pdfDoc.context.obj([]);
        page.node.set(PDFName.of('Annots'), annots);
      }

      // Convert each Fabric.js object to PDF annotation
      pageData.objects.forEach(obj => {
        // Skip survey-specific objects
        if (obj.moduleId || obj.highlightId) {
          return;
        }

        const objType = obj.type?.toLowerCase();
        let annotRef = null;

        switch (objType) {
          case 'path':
            annotRef = createInkAnnotation(pdfDoc, page, obj, pageHeight);
            break;
          case 'rect':
            annotRef = createSquareAnnotation(pdfDoc, page, obj, pageHeight);
            break;
          case 'circle':
            annotRef = createCircleAnnotation(pdfDoc, page, obj, pageHeight);
            break;
          case 'polygon':
            annotRef = createPolygonAnnotation(pdfDoc, page, obj, pageHeight);
            break;
          case 'line':
            annotRef = createLineAnnotation(pdfDoc, page, obj, pageHeight);
            break;
          case 'textbox':
          case 'text':
          case 'i-text':
            annotRef = createFreeTextAnnotation(pdfDoc, page, obj, pageHeight);
            break;
          default:
            // Unsupported annotation type
            break;
        }

        if (annotRef) {
          annots.push(annotRef);
          totalAnnotations++;
        }
      });
    });

    // Save the PDF
    const pdfBytes = await pdfDoc.save();

    // Check if we're in Electron and have the original file path
    if (window.electronAPI && pdfFilePath) {
      // Save to original file location using atomic write (crash-safe)
      if (window.electronAPI.writeFileAtomic) {
        await window.electronAPI.writeFileAtomic(pdfFilePath, pdfBytes);
      } else {
        // Fallback to regular write if atomic not available
        await window.electronAPI.writeFile(pdfFilePath, pdfBytes);
      }
    } else {
      // Fallback: Download the file (browser mode or no file path)
      const blob = new Blob([pdfBytes], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = pdfFile.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }

    return true;
  } catch (error) {
    console.error('Error saving PDF with annotations:', error);
    throw error;
  }
};
