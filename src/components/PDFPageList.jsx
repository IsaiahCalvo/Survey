import React, { forwardRef, useEffect, useRef } from 'react';
import { VariableSizeList as List } from 'react-window';

const PDFPageList = forwardRef(({
    items, // Array of page numbers
    pageHeights,
    scale,
    renderPageContent,
    onItemsRendered,
    outerRef,
    itemKey,
    height // Explicit height prop
}, ref) => {
    const listRef = useRef(null);

    // Expose list methods via ref
    React.useImperativeHandle(ref, () => ({
        scrollToItem: (index, align) => listRef.current?.scrollToItem(index, align),
        scrollTo: (scrollOffset) => listRef.current?.scrollTo(scrollOffset),
        resetAfterIndex: (index, shouldForceUpdate) => listRef.current?.resetAfterIndex(index, shouldForceUpdate),
    }));

    // Recalculate item sizes when scale or pageHeights change
    useEffect(() => {
        if (listRef.current) {
            listRef.current.resetAfterIndex(0);
        }
    }, [scale, pageHeights, items]);

    const getItemSize = (index) => {
        const pageNum = items[index];
        const h = pageHeights[pageNum] || 800; // Default height if not loaded
        return (h * scale) + 20; // Add margin/padding
    };

    const Row = ({ index, style }) => {
        const pageNum = items[index];
        return (
            <div style={{
                ...style,
                display: 'flex',
                justifyContent: 'center',
                // Adjust style to account for the gap we added in getItemSize
                height: style.height - 20,
                width: '100%',
                marginBottom: 20
            }}>
                {renderPageContent(pageNum)}
            </div>
        );
    };

    return (
        <List
            ref={listRef}
            outerRef={outerRef}
            height={height || 800}
            itemCount={items.length}
            itemSize={getItemSize}
            width="100%"
            onItemsRendered={onItemsRendered}
            itemKey={itemKey}
            overscanCount={2} // Render 2 pages above/below for smoother scrolling
        >
            {Row}
        </List>
    );
});

export default PDFPageList;
