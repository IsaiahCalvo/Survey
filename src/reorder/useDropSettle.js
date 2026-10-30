/**
 * useDropSettle.js — the drop glide (dragMotion.js settleDroppedItem) for a
 * surface that runs its own dnd-kit context (the tab rows). Call the returned
 * function from onDragEnd with the item's id: it notes where the item is drawn
 * at release and, once the reorder has committed, glides it into its gap.
 * `attribute` is the data attribute each item carries with its id as value
 * (e.g. 'data-pdf-tab-id').
 */
import { useCallback, useLayoutEffect, useRef, useState } from 'react';
import { settleDroppedItem } from './dragMotion.js';

// The drawn node (a hidden phone / desktop twin may carry the same id).
const visibleNode = (attribute, id) => Array.from(document.querySelectorAll(`[${attribute}]`))
  .filter((node) => node.getAttribute(attribute) === String(id))
  .find((node) => {
    const rect = node.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }) || null;

export default function useDropSettle(attribute) {
  const pendingRef = useRef(null);
  const [drop, setDrop] = useState(0);
  const noteDrop = useCallback((id) => {
    if (typeof document === 'undefined' || id == null) return;
    const node = visibleNode(attribute, id);
    pendingRef.current = node ? { id, rect: node.getBoundingClientRect() } : null;
    setDrop((count) => count + 1);
  }, [attribute]);
  useLayoutEffect(() => {
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    settleDroppedItem(visibleNode(attribute, pending.id), pending.rect);
  }, [drop, attribute]);
  return noteDrop;
}
