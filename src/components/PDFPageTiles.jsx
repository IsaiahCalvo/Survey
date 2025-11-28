import React, { useEffect, useRef, memo, useState, useMemo } from 'react';
import { pdfWorkerManager } from '../utils/PDFWorkerManager';

const TILE_SIZE = 512;

const Tile = memo(({ page, docId, pageIndex, scale, row, col, viewport, onRenderFinish }) => {
    const canvasRef = useRef(null);
    const isRenderedRef = useRef(false);

    useEffect(() => {
        const canvas = canvasRef.current;
        // docId check removed - not needed for fallback rendering
        if (!canvas || isRenderedRef.current) return;

        // Calculate tile position
        const tileX = col * TILE_SIZE;
        const tileY = row * TILE_SIZE;

        // Calculate tile dimensions (might be smaller at edges)
        const tileWidth = Math.min(TILE_SIZE, viewport.width - tileX);
        const tileHeight = Math.min(TILE_SIZE, viewport.height - tileY);

        const outputScale = window.devicePixelRatio || 1;

        // Set canvas dimensions
        canvas.width = Math.floor(tileWidth * outputScale);
        canvas.height = Math.floor(tileHeight * outputScale);
        canvas.style.width = `${Math.floor(tileWidth)}px`;
        canvas.style.height = `${Math.floor(tileHeight)}px`;

        // Worker-based rendering disabled - always use fallback
        // Check if OffscreenCanvas is supported and transfer control
        if (false && canvas.transferControlToOffscreen) {
            const offscreen = canvas.transferControlToOffscreen();

            pdfWorkerManager.renderTile({
                docId,
                pageIndex,
                scale,
                tileX,
                tileY,
                tileSize: TILE_SIZE,
                canvas: offscreen
            });

            isRenderedRef.current = true;
            if (onRenderFinish) onRenderFinish();
        } else {
            // Fallback for browsers without OffscreenCanvas support
            console.warn('OffscreenCanvas not supported, rendering on main thread');

            (async () => {
                try {
                    const context = canvas.getContext('2d');

                    // Clear and fill white background
                    context.fillStyle = '#ffffff';
                    context.fillRect(0, 0, canvas.width, canvas.height);

                    // Scale context for high DPI
                    context.scale(outputScale, outputScale);

                    // Translate to render only this tile
                    context.translate(-tileX, -tileY);

                    // Render the page
                    await page.render({
                        canvasContext: context,
                        viewport: viewport
                    }).promise;

                    isRenderedRef.current = true;
                    if (onRenderFinish) onRenderFinish();
                } catch (error) {
                    console.error('Error rendering tile:', error);
                }
            })();
        }

    }, [page, docId, pageIndex, scale, row, col, viewport, onRenderFinish]);

    return (
        <canvas
            ref={canvasRef}
            style={{
                position: 'absolute',
                left: `${col * TILE_SIZE}px`,
                top: `${row * TILE_SIZE}px`,
                width: `${Math.min(TILE_SIZE, viewport.width - (col * TILE_SIZE))}px`,
                height: `${Math.min(TILE_SIZE, viewport.height - (row * TILE_SIZE))}px`,
            }}
        />
    );
});

const PDFPageTiles = ({ page, docId, scale, onFinishRender }) => {
    console.log('PDFPageTiles render - page:', page, 'docId:', docId, 'scale:', scale);

    const viewport = useMemo(() => {
        const vp = page ? page.getViewport({ scale }) : null;
        console.log('PDFPageTiles viewport:', vp);
        return vp;
    }, [page, scale]);

    if (!page || !viewport) {
        console.log('PDFPageTiles: No page or viewport, returning null');
        return null;
    }

    const cols = Math.ceil(viewport.width / TILE_SIZE);
    const rows = Math.ceil(viewport.height / TILE_SIZE);

    const tiles = [];
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            tiles.push(
                <Tile
                    key={`${r}-${c}`}
                    row={r}
                    col={c}
                    page={page} // Pass page object for fallback rendering
                    docId={docId}
                    pageIndex={page._pageIndex} // Access internal page index
                    scale={scale}
                    viewport={viewport}
                    onRenderFinish={onFinishRender}
                />
            );
        }
    }

    return (
        <div style={{
            width: viewport.width,
            height: viewport.height,
            position: 'relative',
            overflow: 'hidden',
            background: '#fff'
        }}>
            {tiles}
        </div>
    );
};

export default memo(PDFPageTiles);
