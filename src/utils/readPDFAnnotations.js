/**
 * Read and import existing annotations from PDF files
 * Preserves unsupported annotation types in the PDF without importing them
 */

import { PDFDocument, PDFName } from 'pdf-lib';

/**
 * Convert PDF annotation to Fabric.js format
 */
const pdfAnnotationToFabric = (pdfAnnot, pageNumber, pageHeight) => {
  const subtype = pdfAnnot.get(PDFName.of('Subtype'))?.toString();
  const rect = pdfAnnot.get(PDFName.of('Rect'));
  
  if (!rect || !Array.isArray(rect.array)) {
    return null;
  }

  const [x1, y1, x2, y2] = rect.array.map(v => v?.valueOf() || 0);
  const left = Math.min(x1, x2);
  const bottom = Math.max(y1, y2); // PDF coordinates: bottom is higher Y
  const width = Math.abs(x2 - x1);
  const height = Math.abs(y2 - y1);
  
  // Convert PDF coordinates (bottom-left origin) to Fabric.js (top-left origin)
  const top = pageHeight - bottom;

  // Get color (C field)
  const colorArray = pdfAnnot.get(PDFName.of('C'));
  let strokeColor = '#000000';
  if (colorArray && Array.isArray(colorArray.array)) {
    const rgb = colorArray.array.slice(0, 3).map(v => {
      const val = (v?.valueOf() || 0) * 255;
      return Math.round(Math.max(0, Math.min(255, val)));
    });
    strokeColor = `#${rgb.map(v => v.toString(16).padStart(2, '0')).join('')}`;
  }

  // Get border width
  const border = pdfAnnot.get(PDFName.of('Border'));
  let strokeWidth = 1;
  if (border && Array.isArray(border.array) && border.array.length >= 3) {
    strokeWidth = border.array[2]?.valueOf() || 1;
  }

  switch (subtype) {
    case 'Ink': {
      // Convert Ink annotation to Fabric.js Path
      const inkList = pdfAnnot.get(PDFName.of('InkList'));
      if (!inkList || !Array.isArray(inkList.array)) {
        return null;
      }

      // Build path data from ink lists
      const pathData = [];
      inkList.array.forEach((pathArray) => {
        if (!Array.isArray(pathArray.array)) return;
        
        const points = pathArray.array;
        for (let i = 0; i < points.length; i += 2) {
          if (i + 1 >= points.length) break;
          
          const x = points[i]?.valueOf() || 0;
          const y = pageHeight - (points[i + 1]?.valueOf() || 0); // Flip Y
          
          if (i === 0) {
            pathData.push(['M', x, y]);
          } else {
            pathData.push(['L', x, y]);
          }
        }
      });

      if (pathData.length === 0) return null;

      return {
        type: 'path',
        left,
        top,
        width,
        height,
        path: pathData,
        stroke: strokeColor,
        strokeWidth,
        fill: '',
        opacity: 1
      };
    }

    case 'FreeText': {
      // Convert FreeText to Fabric.js Textbox
      const contents = pdfAnnot.get(PDFName.of('Contents'));
      const text = contents?.toString() || '';
      
      // Try to get font size from DA (default appearance)
      const da = pdfAnnot.get(PDFName.of('DA'));
      let fontSize = 12;
      if (da) {
        const daStr = da.toString();
        const fontSizeMatch = daStr.match(/(\d+(?:\.\d+)?)\s+Tf/);
        if (fontSizeMatch) {
          fontSize = parseFloat(fontSizeMatch[1]);
        }
      }

      return {
        type: 'textbox',
        left,
        top,
        width: Math.max(width, 100), // Minimum width for text
        height: Math.max(height, fontSize + 4),
        text,
        fontSize,
        fill: strokeColor,
        stroke: '',
        strokeWidth: 0
      };
    }

    case 'Square': {
      return {
        type: 'rect',
        left,
        top,
        width,
        height,
        stroke: strokeColor,
        strokeWidth,
        fill: 'transparent'
      };
    }

    case 'Circle': {
      const radius = Math.min(width, height) / 2;
      return {
        type: 'circle',
        left: left + width / 2 - radius,
        top: top + height / 2 - radius,
        radius,
        stroke: strokeColor,
        strokeWidth,
        fill: 'transparent'
      };
    }

    case 'Line': {
      const line = pdfAnnot.get(PDFName.of('L'));
      if (!line || !Array.isArray(line.array) || line.array.length < 4) {
        return null;
      }
      
      const [x1, y1, x2, y2] = line.array.map(v => v?.valueOf() || 0);
      
      return {
        type: 'line',
        x1,
        y1: pageHeight - y1, // Flip Y
        x2,
        y2: pageHeight - y2, // Flip Y
        stroke: strokeColor,
        strokeWidth,
        fill: ''
      };
    }

    case 'Polygon': {
      const vertices = pdfAnnot.get(PDFName.of('Vertices'));
      if (!vertices || !Array.isArray(vertices.array)) {
        return null;
      }

      const points = [];
      for (let i = 0; i < vertices.array.length; i += 2) {
        if (i + 1 >= vertices.array.length) break;
        const x = vertices.array[i]?.valueOf() || 0;
        const y = pageHeight - (vertices.array[i + 1]?.valueOf() || 0);
        points.push({ x: x - left, y: y - top });
      }

      if (points.length < 3) return null;

      return {
        type: 'polygon',
        left,
        top,
        width,
        height,
        points,
        stroke: strokeColor,
        strokeWidth,
        fill: 'transparent'
      };
    }

    case 'Highlight': {
      // Convert Highlight to a transparent rectangle (for visual representation)
      // Note: Highlight annotations are typically handled separately in the app
      
      // Get fill color (IC field for interior color)
      const icArray = pdfAnnot.get(PDFName.of('IC'));
      let fillColor = '#FFFF00';
      if (icArray && Array.isArray(icArray.array)) {
        const rgb = icArray.array.slice(0, 3).map(v => {
          const val = (v?.valueOf() || 0) * 255;
          return Math.round(Math.max(0, Math.min(255, val)));
        });
        fillColor = `#${rgb.map(v => v.toString(16).padStart(2, '0')).join('')}`;
      }

      return {
        type: 'rect',
        left,
        top,
        width,
        height,
        fill: fillColor,
        fillOpacity: 0.3,
        stroke: '',
        strokeWidth: 0
      };
    }

    default:
      return null; // Unsupported type
  }
};

/**
 * Read annotations from PDF and convert to app format
 * Returns { annotationsByPage, unsupportedTypes }
 */
export const readAnnotationsFromPDF = async (pdfFile) => {
  try {
    let arrayBuffer;
    if (typeof pdfFile.arrayBuffer === 'function') {
      arrayBuffer = await pdfFile.arrayBuffer();
    } else if (pdfFile.filePath) {
      // For Supabase files, we'd need to download first
      // This should be handled by the caller
      throw new Error('PDF file must be loaded as ArrayBuffer');
    } else {
      throw new Error('Invalid file object');
    }

    const pdfDoc = await PDFDocument.load(arrayBuffer);
    const pages = pdfDoc.getPages();
    const annotationsByPage = {};
    const unsupportedTypes = new Map();

    pages.forEach((page, pageIndex) => {
      const pageNumber = pageIndex + 1; // 1-indexed
      const pageHeight = page.getSize().height;
      
      // Get annotations from page
      const annots = page.node.lookup(PDFName.of('Annots'));
      if (!annots || !Array.isArray(annots.array)) {
        return;
      }

      const pageAnnotations = [];

      annots.array.forEach((annotRef) => {
        try {
          const annot = pdfDoc.context.lookup(annotRef);
          if (!annot) return;

          const subtype = annot.get(PDFName.of('Subtype'))?.toString();
          
          // Check if supported
          const supportedTypes = ['Ink', 'FreeText', 'Square', 'Circle', 'Line', 'Polygon', 'Highlight'];
          
          if (supportedTypes.includes(subtype)) {
            const fabricObj = pdfAnnotationToFabric(annot, pageNumber, pageHeight);
            if (fabricObj) {
              pageAnnotations.push(fabricObj);
            }
          } else {
            // Track unsupported types
            const count = unsupportedTypes.get(subtype) || 0;
            unsupportedTypes.set(subtype, count + 1);
            // Annotation is preserved in PDF, just not imported
          }
        } catch (error) {
          console.warn(`Error reading annotation on page ${pageNumber}:`, error);
        }
      });

      if (pageAnnotations.length > 0) {
        // Convert to Fabric.js canvas JSON format
        annotationsByPage[pageNumber] = {
          version: '5.3.0',
          objects: pageAnnotations
        };
      }
    });

    return {
      annotationsByPage,
      unsupportedTypes: Array.from(unsupportedTypes.entries()).map(([type, count]) => ({
        type,
        count
      }))
    };
  } catch (error) {
    console.error('Error reading annotations from PDF:', error);
    return {
      annotationsByPage: {},
      unsupportedTypes: [],
      error: error.message
    };
  }
};

