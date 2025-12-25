import React, { useEffect, useRef, memo } from 'react';
import { perfRender } from '../utils/performanceLogger';

const PDFPageCanvas = ({ page, scale, pageNum, onFinishRender }) => {
    const canvasRef = useRef(null);
    const renderTaskRef = useRef(null);

    useEffect(() => {
        if (!page) return;

        const canvas = canvasRef.current;
        if (!canvas) return;

        const pageLabel = pageNum || 'unknown';
        perfRender.start(pageLabel);

        const viewport = page.getViewport({ scale });
        const outputScale = window.devicePixelRatio || 1;

        // Cancel any ongoing render
        if (renderTaskRef.current) {
            renderTaskRef.current.cancel();
        }

        // Set canvas dimensions
        canvas.width = Math.floor(viewport.width * outputScale);
        canvas.height = Math.floor(viewport.height * outputScale);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;

        const context = canvas.getContext('2d');

        // Apply transform for high DPI
        context.setTransform(outputScale, 0, 0, outputScale, 0, 0);

        // Clear canvas
        context.clearRect(0, 0, canvas.width, canvas.height);

        perfRender.mark(pageLabel, 'Canvas prepared');

        // Render the page
        // Disable annotation rendering - we import editable annotations as Fabric.js objects
        // AnnotationMode: 0 = DISABLE, 1 = ENABLE, 2 = ENABLE_FORMS, 3 = ENABLE_STORAGE
        renderTaskRef.current = page.render({
            canvasContext: context,
            viewport: viewport,
            annotationMode: 0 // Disable PDF.js annotation rendering
        });

        renderTaskRef.current.promise
            .then(() => {
                perfRender.end(pageLabel);
                if (onFinishRender) {
                    onFinishRender();
                }
            })
            .catch(error => {
                if (error.name !== 'RenderingCancelledException') {
                    console.error('Error rendering page:', error);
                }
            });

        // Cleanup
        return () => {
            if (renderTaskRef.current) {
                renderTaskRef.current.cancel();
            }
        };
    }, [page, scale]);

    if (!page) return null;

    const viewport = page.getViewport({ scale });

    return (
        <canvas
            ref={canvasRef}
            style={{
                display: 'block',
                width: `${Math.floor(viewport.width)}px`,
                height: `${Math.floor(viewport.height)}px`,
            }}
        />
    );
};

PDFPageCanvas.displayName = 'PDFPageCanvas';

// Custom comparison function to ignore onFinishRender changes
// (onFinishRender is not in useEffect deps, so changes shouldn't trigger re-render)
const arePropsEqual = (prevProps, nextProps) => {
    return prevProps.page === nextProps.page && prevProps.scale === nextProps.scale && prevProps.pageNum === nextProps.pageNum;
};

export default memo(PDFPageCanvas, arePropsEqual);
