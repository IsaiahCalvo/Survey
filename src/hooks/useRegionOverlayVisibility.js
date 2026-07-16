import { useEffect, useState } from 'react';

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

function readRegionOverlayStates(pdfId) {
  if (!pdfId) return new Map();
  try {
    return parseRegionOverlayStates(localStorage.getItem(storageKeyFor(pdfId)));
  } catch (error) {
    console.error('Error loading region overlay states:', error);
    return new Map();
  }
}

export function useRegionOverlayVisibility(pdfId) {
  const [regionOverlayDisabled, setRegionOverlayDisabled] = useState(() => readRegionOverlayStates(pdfId));

  useEffect(() => {
    if (!pdfId) return;
    try {
      localStorage.setItem(storageKeyFor(pdfId), serializeRegionOverlayStates(regionOverlayDisabled));
    } catch (error) {
      console.error('Error saving region overlay states:', error);
    }
  }, [regionOverlayDisabled, pdfId]);

  useEffect(() => {
    setRegionOverlayDisabled(readRegionOverlayStates(pdfId));
  }, [pdfId]);

  return [regionOverlayDisabled, setRegionOverlayDisabled];
}
