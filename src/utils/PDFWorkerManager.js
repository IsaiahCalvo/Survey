/**
 * PDFWorkerManager.js — singleton wrapper around the pdfRender web worker.
 *
 * Exports `pdfWorkerManager`, a single PDFWorkerManager instance. loadDocument()
 * transfers a PDF ArrayBuffer to the worker; renderTile() transfers an
 * OffscreenCanvas for tiled page rendering off the main thread. Part of the
 * custom (non-Syncfusion) PDF rendering path.
 */
import PDFWorker from '../workers/pdfRender.worker.js?worker';

class PDFWorkerManager {
    constructor() {
        this.worker = new PDFWorker();

        this.worker.onmessage = (e) => {
            const { type, payload } = e.data;
            if (type === 'ERROR') {
                console.error('PDF Worker Error:', payload.message);
            }
        };

        this.worker.onerror = (error) => {
            console.error('PDFWorkerManager: Worker error event:', error);
        };
    }

    loadDocument(docId, arrayBuffer) {
        // Transfer the ArrayBuffer to the worker to avoid copying
        this.worker.postMessage(
            { type: 'LOAD_DOCUMENT', payload: { docId, data: arrayBuffer } },
            [arrayBuffer]
        );
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
