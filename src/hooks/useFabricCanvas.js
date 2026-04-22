/**
 * useFabricCanvas
 *
 * Shared Fabric.js Canvas lifecycle hook. Creates a Fabric Canvas on mount,
 * stores it in a ref, and disposes synchronously on unmount.
 *
 * Phase 10 Plan 01: Canvas creation/disposal for FabricDrawingCanvas and FabricEraserCanvas.
 */
import { useEffect, useRef } from 'react';
import { fabric } from 'fabric';

/**
 * @param {object} params
 * @param {React.RefObject<HTMLCanvasElement>} params.canvasElRef - Ref to the <canvas> DOM element
 * @param {object} params.options - Fabric.js Canvas constructor options
 * @param {React.MutableRefObject<Function|null>} [params.onBeforeDisposeRef] - Ref to a callback invoked
 *   before canvas.off()/dispose(). Allows the consumer to flush in-progress work (e.g., commit a
 *   mid-stroke pen path) while event listeners are still bound. Set the ref's .current in your
 *   component; the hook reads it at cleanup time.
 * @returns {{ fabricRef: React.MutableRefObject<fabric.Canvas|null> }}
 */
export function useFabricCanvas({ canvasElRef, options, onBeforeDisposeRef }) {
  const fabricRef = useRef(null);

  useEffect(() => {
    if (!canvasElRef.current) return;

    const canvas = new fabric.Canvas(canvasElRef.current, options);
    fabricRef.current = canvas;

    return () => {
      if (fabricRef.current) {
        // Run consumer cleanup BEFORE unbinding listeners / disposing.
        // This lets FabricDrawingCanvas flush mid-stroke paths while
        // path:created is still bound, and FabricEraserCanvas flush
        // mid-erase gestures while the canvas is still alive.
        if (onBeforeDisposeRef?.current) {
          try {
            onBeforeDisposeRef.current(fabricRef.current);
          } catch (e) {
            console.error('onBeforeDispose error:', e);
          }
        }
        fabricRef.current.off();
        try {
          fabricRef.current.dispose();
        } catch (e) {
          console.error('Canvas disposal error:', e);
        }
        fabricRef.current = null;
      }
    };
  }, []); // Mount only -- dispose on unmount

  return { fabricRef };
}
