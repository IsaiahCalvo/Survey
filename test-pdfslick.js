import React from 'react';
import { usePDFSlick } from '@pdfslick/react';
import '@pdfslick/react/dist/pdf_viewer.css';

function TestPDFSlick() {
  // Minimal test - just try to call the hook
  try {
    const result = usePDFSlick('/test.pdf');
    console.log('PDFSlick hook result:', result);
    
    // If we get here, the hook worked
    const { PDFSlickViewer, viewerRef, usePDFSlickStore } = result;
    
    return (
      <div style={{ width: '100%', height: '100vh' }}>
        <h1>PDFSlick Test</h1>
        <div style={{ width: '100%', height: '90%' }}>
          <PDFSlickViewer {...{ viewerRef, usePDFSlickStore }} />
        </div>
      </div>
    );
  } catch (error) {
    console.error('PDFSlick error:', error);
    return (
      <div>
        <h1>PDFSlick Error</h1>
        <pre>{error.toString()}</pre>
      </div>
    );
  }
}

export default TestPDFSlick;