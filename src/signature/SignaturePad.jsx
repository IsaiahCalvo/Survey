// The signature pad: a white strip you draw on with a mouse, pen or finger.
// Strokes are [{x, y}] lists in the pad's own 440 x 160 space, whatever size
// it shows at. Used by the Add signature dialog and the phone page
// (/sign/<token>, Nightly 'phone-sign').
import { useLayoutEffect, useRef } from 'react';
import { paintStrokes } from './signaturePicture.js';

export const SIGNATURE_PAD_W = 440;
export const SIGNATURE_PAD_H = 160;
const PAD_W = SIGNATURE_PAD_W;
const PAD_H = SIGNATURE_PAD_H;

export default function SignaturePad({ strokes, setStrokes, ink, lineWidth }) {
  const canvasRef = useRef(null);
  const drawingRef = useRef(null);
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ratio = window.devicePixelRatio || 1;
    canvas.width = PAD_W * ratio;
    canvas.height = PAD_H * ratio;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
    ctx.clearRect(0, 0, PAD_W, PAD_H);
    paintStrokes(ctx, strokes, { ink, lineWidth });
  }, [strokes, ink, lineWidth]);
  const at = (event) => {
    const r = canvasRef.current.getBoundingClientRect();
    return { x: ((event.clientX - r.left) / r.width) * PAD_W, y: ((event.clientY - r.top) / r.height) * PAD_H };
  };
  return (
    <canvas
      ref={canvasRef}
      className="signature-pad"
      data-signature-pad="true"
      aria-label="Signature pad: draw your signature here"
      style={{ width: '100%', aspectRatio: `${PAD_W} / ${PAD_H}` }}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.currentTarget.setPointerCapture?.(event.pointerId);
        drawingRef.current = event.pointerId;
        setStrokes((list) => [...list, [at(event)]]);
      }}
      onPointerMove={(event) => {
        if (drawingRef.current !== event.pointerId) return;
        const samples = event.nativeEvent.getCoalescedEvents?.() || [event];
        const points = samples.map((sample) => at(sample));
        setStrokes((list) => {
          if (!list.length) return list;
          const next = list.slice();
          next[next.length - 1] = [...next[next.length - 1], ...points];
          return next;
        });
      }}
      onPointerUp={() => { drawingRef.current = null; }}
      onPointerCancel={() => { drawingRef.current = null; }}
    />
  );
}
