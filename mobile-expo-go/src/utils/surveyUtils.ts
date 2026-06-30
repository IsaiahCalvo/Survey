import type { Marker } from '../types';

export function getSurveyCategoryGlyphLabel(name: string) {
  const parts = (name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return '?';
  const label = parts.length > 1
    ? parts.slice(0, 2).map((part) => part[0]).join('')
    : parts[0].slice(0, 2);
  return label.toUpperCase();
}

export function nextMarkerId(markers: Marker[]) {
  return markers.reduce((max, marker) => Math.max(max, marker.id), 0) + 1;
}

export function checklistResponseKey(categoryId: string, item: string) {
  return `${categoryId}:${item}`;
}
