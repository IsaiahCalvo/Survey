import PDFWorker from '../workers/pdfRender.worker.js?worker';

class PDFWorkerManager {
    constructor() {
        console.log('PDFWorkerManager: Creating PDF worker');
        this.worker = new PDFWorker();
        console.log('PDFWorkerManager: PDF worker created successfully');

        this.worker.onmessage = (e) => {
            console.log('PDFWorkerManager: Received message from worker:', e.data.type);
            const { type, payload } = e.data;
            if (type === 'ERROR') {
                console.error('PDF Worker Error:', payload.message);
            } else if (type === 'DOC_LOADED') {
                console.log(`Document ${payload.docId} loaded in worker`);
            }
        };

        this.worker.onerror = (error) => {
            console.error('PDFWorkerManager: Worker error event:', error);
        };
    }

    loadDocument(docId, arrayBuffer) {
        console.log('PDFWorkerManager: Sending LOAD_DOCUMENT to worker', docId, 'ArrayBuffer size:', arrayBuffer.byteLength);
        // Transfer the ArrayBuffer to the worker to avoid copying
        this.worker.postMessage(
            { type: 'LOAD_DOCUMENT', payload: { docId, data: arrayBuffer } },
            [arrayBuffer]
        );
        console.log('PDFWorkerManager: LOAD_DOCUMENT message sent');
    }

    renderTile({ docId, pageIndex, scale, tileX, tileY, tileSize, canvas }) {
        // Transfer the OffscreenCanvas to the worker
        this.worker.postMessage(
            {
                type: 'RENDER_TILE',
                payload: { docId, pageIndex, scale, tileX, tileY, tileSize, canvas }
            },
            [canvas]
        );
    }

    terminate() {
        this.worker.terminate();
    }
}

// Singleton instance
export const pdfWorkerManager = new PDFWorkerManager();
