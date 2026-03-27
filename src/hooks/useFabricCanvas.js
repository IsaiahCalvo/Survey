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
 * @param {number} [params.options.width]
 * @param {number} [params.options.height]
 * @param {string} [params.options.backgroundColor]
 * @param {boolean} [params.options.isDrawingMode]
 * @param {boolean} [params.options.selection]
 * @param {boolean} [params.options.enableRetinaScaling]
 * @param {boolean} [params.options.stopContextMenu]
 * @returns {{ fabricRef: React.MutableRefObject<fabric.Canvas|null> }}
 */
export function useFabricCanvas({ canvasElRef, options }) {
  const fabricRef = useRef(null);

  useEffect(() => {
    if (!canvasElRef.current) return;

    const canvas = new fabric.Canvas(canvasElRef.current, options);
    fabricRef.current = canvas;

    return () => {
      if (fabricRef.current) {
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
