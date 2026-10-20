/**
 * smartFillSamples.js — the tags the user has applied with Smart fill,
 * remembered so "Find more like this" works on any page or drawing
 * (owner 2026-10-20, beta). Kept in this browser only (like the playground's
 * template store); nothing leaves the device. Page units, newest first.
 */
import { outlineSignature } from './smartFillEngine.js';

const STORAGE_KEY = 'smartFill:samples:v1';
const MAX_SAMPLES = 5;

export function loadSmartFillSamples() {
  try {
    const list = JSON.parse(window.localStorage.getItem(STORAGE_KEY) || '[]');
    return Array.isArray(list) ? list.filter((s) => s && s.width > 0 && Array.isArray(s.grid)) : [];
  } catch {
    return [];
  }
}

/** Remember an applied outline ring (page units). Returns its signature. */
export function saveSmartFillSample(ring) {
  const signature = outlineSignature(ring);
  if (!(signature.width > 0)) return null;
  try {
    const next = [{ ...signature, savedAt: Date.now() }, ...loadSmartFillSamples()].slice(0, MAX_SAMPLES);
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    window.dispatchEvent(new CustomEvent('smart-fill-samples-changed'));
  } catch { /* storage full or blocked: matching still works this session */ }
  return signature;
}

export function latestSmartFillSample() {
  return loadSmartFillSamples()[0] || null;
}
