import { useState, useEffect } from 'react';

// Region overlay visibility persistence, lifted verbatim out of PDFViewer.jsx
// (de-fragilize campaign). State is a Map keyed by `${spaceId}-${pageId}`, value
// true = overlay disabled; false/undefined/null = enabled (default). Persisted to
// localStorage per pdfId under `regionOverlayStates_<pdfId>`.
//
// The parse/serialize halves are exported as pure functions so they can be
// node-tested; the localStorage I/O + effect wiring stays in the hook.

const storageKeyFor = (pdfId) => `regionOverlayStates_${pdfId}`;

// Parse a stored JSON string into the disabled-state Map. Coerces every value to a
// strict boolean (v === true), so only an explicit true means "disabled". Null /
// empty / invalid JSON yields an empty Map (with the same console.error the
// original logged, so error visibility is unchanged).
export function parseRegionOverlayStates(stored) {
  if (!stored) return new Map();
  try {
    const parsed = JSON.parse(stored);
    return new Map(Object.entries(parsed).map(([k, v]) => [k, v === true]));
  } catch (e) {
    console.error('Error loading region overlay states:', e);
    return new Map();
  }
}

// Serialize the disabled-state Map to a JSON string for localStorage.
export function serializeRegionOverlayStates(map) {
  return JSON.stringify(Object.fromEntries(map));
}

function readRegionOverlayStates(pdfId) {
  if (!pdfId) return new Map();
  try {
    return parseRegionOverlayStates(localStorage.getItem(storageKeyFor(pdfId)));
  } catch (e) {
    console.error('Error loading region overlay states:', e);
    return new Map();
  }
}

export function useRegionOverlayVisibility(pdfId) {
  const [regionOverlayDisabled, setRegionOverlayDisabled] = useState(() => readRegionOverlayStates(pdfId));

  // Save to localStorage whenever it changes
  useEffect(() => {
    if (!pdfId) return;
    try {
      localStorage.setItem(storageKeyFor(pdfId), serializeRegionOverlayStates(regionOverlayDisabled));
    } catch (e) {
      console.error('Error saving region overlay states:', e);
    }
  }, [regionOverlayDisabled, pdfId]);

  // Reload overlay states when pdfId changes
  useEffect(() => {
    setRegionOverlayDisabled(readRegionOverlayStates(pdfId));
  }, [pdfId]);

  return [regionOverlayDisabled, setRegionOverlayDisabled];
}
