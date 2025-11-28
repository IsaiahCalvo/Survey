import * as pdfjsLib from 'pdfjs-dist';

console.log('PDF Worker initialized');

// Note: We are INSIDE a worker, so we don't need to configure workerSrc
// PDF.js operations will run directly in this worker context
const loadedDocs = new Map();

self.onmessage = async (e) => {
    const { type, payload } = e.data;
    console.log('Worker received message:', type);

    try {
        if (type === 'LOAD_DOCUMENT') {
            console.log('Loading document:', payload.docId);
            const { docId, data } = payload;
            // data is an ArrayBuffer
            const loadingTask = pdfjsLib.getDocument({ data });
            const pdfDoc = await loadingTask.promise;
            loadedDocs.set(docId, pdfDoc);
            console.log('Document loaded successfully, sending DOC_LOADED message');
            self.postMessage({ type: 'DOC_LOADED', payload: { docId } });
        }

        else if (type === 'RENDER_TILE') {
            const { docId, pageIndex, scale, tileX, tileY, tileSize, canvas } = payload;
            const pdfDoc = loadedDocs.get(docId);

            if (!pdfDoc) {
                console.error(`Document ${docId} not found in worker`);
                return;
            }

            const page = await pdfDoc.getPage(pageIndex);
            const viewport = page.getViewport({ scale });
            const context = canvas.getContext('2d');

            // Clear canvas
            context.fillStyle = '#ffffff';
            context.fillRect(0, 0, canvas.width, canvas.height);

            // Translate context to draw the correct part of the page
            // The canvas is already sized to the tile size by the main thread
            context.translate(-tileX, -tileY);

            await page.render({
                canvasContext: context,
                viewport: viewport
            }).promise;

            // Optional: Signal completion
            // self.postMessage({ type: 'TILE_RENDERED', payload: { ... } });
        }
    } catch (error) {
        console.error('Worker error:', error);
        self.postMessage({ type: 'ERROR', payload: { message: error.message } });
    }
};
