/**
 * TextLayer.jsx — selectable PDF text overlay rendered via pdf.js.
 *
 * Default export is a memo-wrapped TextLayer that, for a given pdf.js `page`
 * and `scale`, calls page.getTextContent() + pdfjsLib.renderTextLayer() into
 * an absolutely-positioned div sized to the page. Toggles pointer-events with
 * `isSelectionMode` and surfaces selection via the onTextSelected mouse-up
 * handler. Sets the `--scale-factor` CSS var the pdf.js text layer requires.
 */
import { useEffect, useRef, memo } from 'react';
import * as pdfjsLib from 'pdfjs-dist';

const TextLayer = ({ page, scale, width, height, onTextSelected, isSelectionMode, debug }) => {
    const layerRef = useRef(null);

    useEffect(() => {
        if (!page || !layerRef.current) return;

        let cancelled = false;
        const layer = layerRef.current;

        // Clear previous content
        layer.innerHTML = '';

        const renderLayer = async () => {
            try {
                const textContent = await page.getTextContent();
                if (cancelled) return;

                // Create viewport
                const viewport = page.getViewport({ scale });

                // Render text layer
                // Note: renderTextLayer returns a promise in recent versions, but we don't strictly need to await it here
                // unless we want to handle errors or completion specifically.
                await pdfjsLib.renderTextLayer({
                    textContentSource: textContent,
                    container: layer,
                    viewport: viewport,
                    textDivs: []
                }).promise;
            } catch (error) {
                console.error('Error rendering text layer:', error);
            }
        };

        renderLayer();

        return () => {
            cancelled = true;
            layer.innerHTML = '';
        };
    }, [page, scale]);

    return (
        <div
            ref={layerRef}
            className="textLayer"
            style={{
                width: `${width}px`,
                height: `${height}px`,
                position: 'absolute',
                top: 0,
                left: 0,
                pointerEvents: isSelectionMode ? 'auto' : 'none',
                opacity: debug ? 0.5 : 1,
                backgroundColor: debug ? 'rgba(255, 0, 0, 0.1)' : 'transparent',
                zIndex: 2, // Ensure text layer is above canvas but below annotations if needed
                '--scale-factor': scale
            }}
            onMouseUp={onTextSelected}
        />
    );
};

export default memo(TextLayer);
