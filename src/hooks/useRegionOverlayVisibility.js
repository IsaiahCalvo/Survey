import { useCallback, useEffect, useRef, useState } from 'react';

const storageKeyFor = (pdfId) => `regionOverlayStates_${pdfId}`;

export function parseRegionOverlayStates(stored) {
  if (!stored) return new Map();
  try {
    const parsed = JSON.parse(stored);
    return new Map(Object.entries(parsed).map(([key, value]) => [key, value === true]));
  } catch (error) {
    console.error('Error loading region overlay states:', error);
    return new Map();
  }
}

export function serializeRegionOverlayStates(map) {
  return JSON.stringify(Object.fromEntries(map));
}

function readRegionOverlayStates(pdfId, storageReader = null) {
  if (!pdfId) return new Map();
  try {
    return parseRegionOverlayStates((storageReader || localStorage).getItem(storageKeyFor(pdfId)));
  } catch (error) {
    console.error('Error loading region overlay states:', error);
    return new Map();
  }
}

export function useRegionOverlayVisibility(pdfId, storageReader = null) {
  const scopeRef = useRef(null);
  if (scopeRef.current?.pdfId !== pdfId || scopeRef.current?.storageReader !== storageReader) {
    scopeRef.current = { pdfId, storageReader };
  }
  const scope = scopeRef.current;
  const [stored, setStored] = useState(() => ({ pdfId, storageReader, value: readRegionOverlayStates(pdfId, storageReader) }));

  useEffect(() => {
    setStored(previous => previous.pdfId === pdfId && previous.storageReader === storageReader
      ? previous : { pdfId, storageReader, value: readRegionOverlayStates(pdfId, storageReader) });
  }, [pdfId, storageReader]);

  useEffect(() => {
    // An identity change renders before its load effect commits. Never write
    // the previous document (or initial empty map) into the new document's key.
    if (storageReader || !pdfId || stored.pdfId !== pdfId || stored.storageReader !== storageReader) return;
    try {
      localStorage.setItem(storageKeyFor(pdfId), serializeRegionOverlayStates(stored.value));
    } catch (error) {
      console.error('Error saving region overlay states:', error);
    }
  }, [stored, pdfId, storageReader]);

  const setRegionOverlayDisabled = useCallback(update => {
    // A retained event handler from a closed document cannot alter the new one.
    setStored(previous => scopeRef.current !== scope || previous.pdfId !== pdfId ? previous : {
      pdfId, storageReader, value: typeof update === 'function' ? update(previous.value) : update,
    });
  }, [pdfId, storageReader, scope]);

  return [stored.pdfId === pdfId && stored.storageReader === storageReader ? stored.value : new Map(), setRegionOverlayDisabled];
}
