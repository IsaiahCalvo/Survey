import React, { memo } from 'react';
import PDFPageCanvas from './PDFPageCanvas';
import TextLayer from './TextLayer';
import PageAnnotationLayer from './PageAnnotationLayer';

const PDFPageItem = ({
    pageNumber,
    page,
    scale,
    width,
    height,
    transform,
    isMounted,
    activeTool,
    debugLayout,
    regions,
    onTextSelected,
    onFinishRender
}) => {
    if (!isMounted) return null;

    return (
        <div style={{
            position: 'relative',
            transform: transform,
            transformOrigin: 'center center'
        }}>
            <PDFPageCanvas
                page={page}
                scale={scale}
                pageNum={pageNumber}
                onFinishRender={onFinishRender}
            />
            {width && height && page && (
                <TextLayer
                    pageNumber={pageNumber}
                    page={page}
                    scale={scale}
                    width={width}
                    height={height}
                    onTextSelected={onTextSelected}
                    isSelectionMode={activeTool === 'pan' || activeTool === 'text-select'}
                    debug={debugLayout}
                />
            )}
            {width && (
                <PageAnnotationLayer
                    pageNumber={pageNumber}
                    scale={scale}
                    width={width}
                    height={height}
                    regions={regions}
                />
            )}
        </div>
    );
};

export default memo(PDFPageItem);
