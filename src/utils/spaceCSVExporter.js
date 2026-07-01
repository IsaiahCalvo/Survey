/**
 * spaceCSVExporter.js — build the CSV content for a Survey Space export.
 *
 * Extracted VERBATIM from PDFViewer's handleExportSpaceToCSV (the pure row-building
 * half). Pure: no React state, no DOM, no async — the caller wraps the returned string
 * in a Blob and triggers the download. Unblocked for node testing by viewerShared becoming
 * node-importable (escapeCSVValue lives there).
 */
import { escapeCSVValue } from '../viewerShared.js';
import { normalizePageRegions } from './annotationVisibilityRules.js';
import { regionContainsPoint } from './regionMath.js';

/**
 * Build newline-separated CSV content for a space's annotations + category summary.
 * @param {object} space - { id, name, assignedPages, categories }
 * @param {object} annotationsByPage - { [pageNumber]: { objects: [...] } }
 * @returns {string} CSV text (header row + annotation rows + category rows)
 */
export function buildSpaceCSVContent(space, annotationsByPage) {
  const headers = [
    'Space Name',
    'Page',
    'Mode',
    'Region Count',
    'Annotation Type',
    'Annotation ID',
    'Left',
    'Top',
    'Width',
    'Height',
    'Stroke Color',
    'Fill Color',
    'Stroke Width',
    'Notes',
    'Checklist Items',
    'Status',
    'Attachments'
  ];

  const rows = [headers.map(escapeCSVValue).join(',')];

  const assignedPages = space.assignedPages || [];
  assignedPages.forEach(page => {
    const pageNumber = page.pageId;
    if (!pageNumber) {
      return;
    }

    const mode = page.wholePageIncluded === false ? 'region' : 'full';
    const regions = normalizePageRegions(page.regions || []);
    const pageAnnotations = annotationsByPage[pageNumber]?.objects || [];

    pageAnnotations.forEach(obj => {
      if (!obj) return;
      const objSpaceId = obj.spaceId || null;
      if (space.id && objSpaceId && objSpaceId !== space.id) {
        return;
      }

      const width = (obj.width || 0) * (obj.scaleX || 1);
      const height = (obj.height || 0) * (obj.scaleY || 1);
      const centerX = (obj.left || 0) + width / 2;
      const centerY = (obj.top || 0) + height / 2;

      if (mode === 'region' && regions.length > 0) {
        const inRegion = regions.some(region => regionContainsPoint(centerX, centerY, region, 1));
        if (!inRegion) {
          return;
        }
      }

      const attachmentsCount = Array.isArray(obj.attachments) ? obj.attachments.length : '';
      const row = [
        escapeCSVValue(space.name || ''),
        escapeCSVValue(pageNumber),
        escapeCSVValue(mode),
        escapeCSVValue(regions.length),
        escapeCSVValue(obj.type || ''),
        escapeCSVValue(obj.id || ''),
        escapeCSVValue(typeof obj.left === 'number' ? obj.left.toFixed(2) : obj.left || ''),
        escapeCSVValue(typeof obj.top === 'number' ? obj.top.toFixed(2) : obj.top || ''),
        escapeCSVValue(width ? width.toFixed(2) : ''),
        escapeCSVValue(height ? height.toFixed(2) : ''),
        escapeCSVValue(obj.stroke || ''),
        escapeCSVValue(obj.fill || ''),
        escapeCSVValue(obj.strokeWidth || ''),
        escapeCSVValue(obj.note || ''),
        escapeCSVValue((obj.checklistItems || []).join?.('; ') || ''),
        escapeCSVValue(obj.status || ''),
        escapeCSVValue(attachmentsCount)
      ];
      rows.push(row.join(','));
    });
  });

  if (Array.isArray(space.categories)) {
    space.categories.forEach(category => {
      const checklistCount = category?.checklist?.length || 0;
      const row = [
        escapeCSVValue(space.name || ''),
        '',
        'category',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        '',
        escapeCSVValue(category?.name || ''),
        escapeCSVValue(checklistCount),
        '',
        ''
      ];
      rows.push(row.join(','));
    });
  }

  return rows.join('\n');
}
