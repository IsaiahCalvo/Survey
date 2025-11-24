import { useState, useRef, useCallback, useEffect } from 'react';

/**
 * Advanced drag-to-reorder hook implementing smooth, natural reordering
 * 
 * Features:
 * 1. Grab Detection - Freezes item dimensions, captures starting Y, positions absolutely with scale/shadow
 * 2. Lock Horizontal Movement - Only Y-axis movement, X is fixed
 * 3. Real-Time Collision Detection - Midpoint-based swapping
 * 4. Hover Layer - Dragged item rendered on top layer
 * 5. Smooth Sorting Animation - Other items animate, dragged item follows cursor
 * 6. Drop - Ease-out snap to final position
 */
export const useDragToReorder = (items, onReorder, options = {}) => {
  const {
    itemHeight = null, // If null, will measure on first drag
    gap = 1, // Gap between items in pixels
    dragHandleSelector = '[data-drag-handle]',
    enabled = true
  } = options;

  const [draggingState, setDraggingState] = useState(null);
  const [virtualOrder, setVirtualOrder] = useState(null);
  const containerRef = useRef(null);
  const itemRefs = useRef(new Map());
  const dragGhostRef = useRef(null);
  const animationFrameRef = useRef(null);
  const measuredHeights = useRef(new Map());
  const virtualOrderRef = useRef(null); // Ref to track current virtual order synchronously
  const initialOrderRef = useRef(null); // Ref to track the initial order when drag started

  // Measure item height on first drag if not provided
  const measureItemHeight = useCallback((itemId) => {
    const element = itemRefs.current.get(itemId);
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return rect.height;
  }, []);

  // Get item position and dimensions
  const getItemMetrics = useCallback((itemId) => {
    const element = itemRefs.current.get(itemId);
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    const containerRect = containerRef.current?.getBoundingClientRect();
    if (!containerRect) return null;
    
    return {
      top: rect.top - containerRect.top,
      left: rect.left - containerRect.left,
      width: rect.width,
      height: rect.height,
      centerY: rect.top + rect.height / 2 - containerRect.top
    };
  }, []);

  // Get all neighbor items (excluding dragged item)
  const getNeighborItems = useCallback((draggedItemId) => {
    const currentOrder = virtualOrderRef.current || items.map((item, idx) => ({ item, index: idx }));
    return currentOrder
      .filter(({ item }) => item.id !== draggedItemId)
      .map(({ item, index }) => {
        const metrics = getItemMetrics(item.id);
        if (!metrics) return null;
        return {
          item,
          index,
          metrics,
          midpointY: metrics.top + metrics.height / 2
        };
      })
      .filter(Boolean);
  }, [items, getItemMetrics]);

  // Handle grab detection
  const handleGrab = useCallback((e, itemId) => {
    if (!enabled) return;
    
    const itemElement = itemRefs.current.get(itemId);
    if (!itemElement) return;

    e.preventDefault();
    e.stopPropagation();

    const rect = itemElement.getBoundingClientRect();
    const containerRect = containerRef.current?.getBoundingClientRect();
    if (!containerRect) return;

    const startY = rect.top - containerRect.top;
    const startX = rect.left - containerRect.left;
    const width = rect.width;
    const height = itemHeight || measureItemHeight(itemId) || rect.height;
    const grabOffsetY = e.clientY - rect.top;

    // Store original order - capture the initial order at drag start
    const initialOrder = items.map((item, idx) => ({ item, index: idx }));
    console.log('[DragToReorder] Grab started for item:', itemId);
    console.log('[DragToReorder] Initial items:', items.map(i => ({ id: i.id, name: i.name || 'no name' })));
    console.log('[DragToReorder] Initial order:', initialOrder.map(e => ({ id: e.item.id, index: e.index })));
    setVirtualOrder(initialOrder);
    virtualOrderRef.current = initialOrder;
    initialOrderRef.current = initialOrder; // Store initial order to compare against later

    // Create drag ghost element
    const ghost = document.createElement('div');
    ghost.style.position = 'fixed';
    ghost.style.left = `${rect.left}px`;
    ghost.style.top = `${rect.top}px`;
    ghost.style.width = `${width}px`;
    ghost.style.height = `${height}px`;
    ghost.style.pointerEvents = 'none';
    ghost.style.zIndex = '10000';
    ghost.style.transform = 'scale(1.05)';
    ghost.style.transition = 'transform 0.1s ease-out';
    ghost.style.boxShadow = '0 8px 24px rgba(0, 0, 0, 0.3), 0 0 0 1px rgba(0, 0, 0, 0.1)';
    ghost.style.opacity = '0.95';
    ghost.style.backgroundColor = window.getComputedStyle(itemElement).backgroundColor;
    ghost.style.borderRadius = window.getComputedStyle(itemElement).borderRadius || '0px';
    ghost.innerHTML = itemElement.innerHTML;
    document.body.appendChild(ghost);
    dragGhostRef.current = ghost;

    // Hide original item but keep layout space
    itemElement.style.opacity = '0';
    itemElement.style.visibility = 'hidden';
    itemElement.style.pointerEvents = 'none';
    itemElement.style.transition = 'opacity 0.1s';

    setDraggingState({
      itemId,
      startY,
      startX,
      currentY: startY,
      grabOffsetY,
      width,
      height,
      originalIndex: items.findIndex(item => item.id === itemId)
    });

    // Lock horizontal movement - only track Y
    const handleMouseMove = (moveEvent) => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }

      animationFrameRef.current = requestAnimationFrame(() => {
        const containerRect = containerRef.current?.getBoundingClientRect();
        if (!containerRect) return;

        const newY = moveEvent.clientY - containerRect.top - grabOffsetY;
        const fixedX = startX; // Lock X position

        setDraggingState(prev => {
          if (!prev) return null;

          // Update ghost position
          if (ghost && containerRect) {
            ghost.style.left = `${containerRect.left + fixedX}px`;
            ghost.style.top = `${moveEvent.clientY - grabOffsetY}px`;
          }

          // Collision detection based on midpoint
          const draggedCenterY = newY + prev.height / 2;
          const neighbors = getNeighborItems(prev.itemId);

          let newOrder = [...(virtualOrderRef.current || items.map((item, idx) => ({ item, index: idx })))];
          let orderChanged = false;

          neighbors.forEach(({ item, index, midpointY }) => {
            const currentItemIndex = newOrder.findIndex(entry => entry.item.id === item.id);
            if (currentItemIndex === -1) return;

            // Check if dragged item center crossed this item's midpoint
            const draggedWasAbove = prev.currentY + prev.height / 2 < midpointY;
            const draggedIsAbove = draggedCenterY < midpointY;

            if (draggedWasAbove !== draggedIsAbove) {
              // Swap positions
              const draggedIndex = newOrder.findIndex(entry => entry.item.id === prev.itemId);
              if (draggedIndex !== -1) {
                const [draggedEntry] = newOrder.splice(draggedIndex, 1);
                const targetIndex = newOrder.findIndex(entry => entry.item.id === item.id);
                if (targetIndex !== -1) {
                  console.log('[DragToReorder] Swapping: dragged item', prev.itemId, 'from index', draggedIndex, 'to before item', item.id, 'at index', targetIndex);
                  newOrder.splice(targetIndex, 0, draggedEntry);
                  orderChanged = true;
                }
              }
            }
          });

          if (orderChanged) {
            // Update indices to match new array positions
            const updatedOrder = newOrder.map((entry, newIndex) => ({
              ...entry,
              index: newIndex
            }));
            
            console.log('[DragToReorder] Order changed during drag. New order:', updatedOrder.map(e => ({ id: e.item.id, index: e.index })));
            setVirtualOrder(updatedOrder);
            virtualOrderRef.current = updatedOrder; // Update ref synchronously
            
            // Animate other items to their new positions
            requestAnimationFrame(() => {
              updatedOrder.forEach(({ item, index }) => {
                if (item.id === prev.itemId) return; // Don't animate dragged item
                
                const element = itemRefs.current.get(item.id);
                if (!element) return;

                const metrics = getItemMetrics(item.id);
                if (!metrics) return;

                // Calculate target position based on order
                let targetY = 0;
                for (let i = 0; i < index; i++) {
                  const prevItem = updatedOrder[i];
                  if (prevItem.item.id === prev.itemId) continue; // Skip dragged item in calculation
                  const prevHeight = itemHeight || measuredHeights.current.get(prevItem.item.id) || metrics.height;
                  targetY += prevHeight + gap;
                }

                // Calculate current position relative to container
                const containerRect = containerRef.current?.getBoundingClientRect();
                if (!containerRect) return;
                
                const currentTop = metrics.top;
                const offset = targetY - currentTop;

                // Animate to new position
                element.style.transition = 'transform 0.2s cubic-bezier(0.2, 0, 0.2, 1)';
                element.style.transform = `translateY(${offset}px)`;
              });
            });
          }

          return {
            ...prev,
            currentY: newY
          };
        });
      });
    };

    const handleMouseUp = () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);

      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }

      // Cleanup ghost
      if (dragGhostRef.current) {
        dragGhostRef.current.style.transition = 'transform 0.3s cubic-bezier(0.2, 0, 0.2, 1), opacity 0.2s';
        dragGhostRef.current.style.transform = 'scale(1)';
        dragGhostRef.current.style.opacity = '0';
        
        setTimeout(() => {
          if (dragGhostRef.current) {
            dragGhostRef.current.remove();
            dragGhostRef.current = null;
          }
        }, 300);
      }

      // Restore original item
      const itemElement = itemRefs.current.get(itemId);
      if (itemElement) {
        itemElement.style.opacity = '1';
        itemElement.style.visibility = 'visible';
        itemElement.style.pointerEvents = 'auto';
        itemElement.style.transition = 'transform 0.3s cubic-bezier(0.2, 0, 0.2, 1), opacity 0.2s';
        itemElement.style.transform = 'translateY(0)';
      }

      // Reset all item transforms
      itemRefs.current.forEach((element, id) => {
        if (id !== itemId) {
          element.style.transition = 'transform 0.3s cubic-bezier(0.2, 0, 0.2, 1)';
          element.style.transform = 'translateY(0)';
        }
      });

      // Apply final reorder if order changed
      // Use ref to get the latest virtual order synchronously
      const finalOrder = virtualOrderRef.current || initialOrderRef.current || items.map((item, idx) => ({ item, index: idx }));
      console.log('[DragToReorder] MouseUp - Final Order:', finalOrder);
      
      const finalOrderedItems = finalOrder
        .sort((a, b) => a.index - b.index)
        .map(({ item }) => item);
      
      // Compare against the INITIAL order when drag started, not current items prop
      const initialOrder = initialOrderRef.current || items.map((item, idx) => ({ item, index: idx }));
      const originalOrder = initialOrder.sort((a, b) => a.index - b.index).map(({ item }) => item.id);
      const newOrder = finalOrderedItems.map(item => item.id);
      
      console.log('[DragToReorder] Initial Order IDs (from drag start):', originalOrder);
      console.log('[DragToReorder] New Order IDs:', newOrder);
      console.log('[DragToReorder] Order changed?', JSON.stringify(originalOrder) !== JSON.stringify(newOrder));
      console.log('[DragToReorder] Final ordered items:', finalOrderedItems);
      
      if (JSON.stringify(originalOrder) !== JSON.stringify(newOrder)) {
        console.log('[DragToReorder] Calling onReorder with:', finalOrderedItems);
        onReorder(finalOrderedItems);
      } else {
        console.log('[DragToReorder] Order unchanged, not calling onReorder');
      }
      
      // Clear the refs
      virtualOrderRef.current = null;
      initialOrderRef.current = null;

      // Cleanup state
      setTimeout(() => {
        setDraggingState(null);
        setVirtualOrder(null);
        
        // Remove all transforms after animation
        itemRefs.current.forEach((element) => {
          element.style.transition = '';
          element.style.transform = '';
        });
      }, 300);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, [enabled, items, itemHeight, measureItemHeight, getItemMetrics, getNeighborItems, onReorder, gap]);

  // Register item ref
  const registerItemRef = useCallback((itemId, element) => {
    if (element) {
      itemRefs.current.set(itemId, element);
      // Measure and store height
      const height = element.getBoundingClientRect().height;
      measuredHeights.current.set(itemId, height);
    } else {
      itemRefs.current.delete(itemId);
      measuredHeights.current.delete(itemId);
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (dragGhostRef.current) {
        dragGhostRef.current.remove();
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, []);

  return {
    draggingState,
    virtualOrder,
    handleGrab,
    registerItemRef,
    containerRef
  };
};

