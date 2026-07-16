import { escapeCSVValue } from './csvValue.js';
import { normalizePageRegions } from './annotationVisibilityRules.js';
import { regionContainsPoint } from './regionMath.js';

export function buildSpaceCSVContent(space, annotationsByPage) {
  const headers = [
    'Space Name', 'Page', 'Mode', 'Region Count', 'Annotation Type', 'Annotation ID',
    'Left', 'Top', 'Width', 'Height', 'Stroke Color', 'Fill Color', 'Stroke Width',
    'Notes', 'Checklist Items', 'Status', 'Attachments',
  ];
  const rows = [headers.map(escapeCSVValue).join(',')];

  (space.assignedPages || []).forEach((page) => {
    const pageNumber = page.pageId;
    if (!pageNumber) return;
    const mode = page.wholePageIncluded === false ? 'region' : 'full';
    const regions = normalizePageRegions(page.regions || []);
    const pageAnnotations = annotationsByPage[pageNumber]?.objects || [];

    pageAnnotations.forEach((object) => {
      if (!object) return;
      const objectSpaceId = object.spaceId || null;
      if (space.id && objectSpaceId && objectSpaceId !== space.id) return;
      const width = (object.width || 0) * (object.scaleX || 1);
      const height = (object.height || 0) * (object.scaleY || 1);
      const centerX = (object.left || 0) + width / 2;
      const centerY = (object.top || 0) + height / 2;
      if (mode === 'region' && regions.length > 0) {
        const inRegion = regions.some((region) => regionContainsPoint(centerX, centerY, region, 1));
        if (!inRegion) return;
      }
      const attachmentCount = Array.isArray(object.attachments) ? object.attachments.length : '';
      rows.push([
        escapeCSVValue(space.name || ''),
        escapeCSVValue(pageNumber),
        escapeCSVValue(mode),
        escapeCSVValue(regions.length),
        escapeCSVValue(object.type || ''),
        escapeCSVValue(object.id || ''),
        escapeCSVValue(typeof object.left === 'number' ? object.left.toFixed(2) : object.left || ''),
        escapeCSVValue(typeof object.top === 'number' ? object.top.toFixed(2) : object.top || ''),
        escapeCSVValue(width ? width.toFixed(2) : ''),
        escapeCSVValue(height ? height.toFixed(2) : ''),
        escapeCSVValue(object.stroke || ''),
        escapeCSVValue(object.fill || ''),
        escapeCSVValue(object.strokeWidth || ''),
        escapeCSVValue(object.note || ''),
        escapeCSVValue((object.checklistItems || []).join?.('; ') || ''),
        escapeCSVValue(object.status || ''),
        escapeCSVValue(attachmentCount),
      ].join(','));
    });
  });

  if (Array.isArray(space.categories)) {
    space.categories.forEach((category) => {
      rows.push([
        escapeCSVValue(space.name || ''), '', 'category', '', '', '', '', '', '', '', '', '', '',
        escapeCSVValue(category?.name || ''), escapeCSVValue(category?.checklist?.length || 0), '', '',
      ].join(','));
    });
  }

  return rows.join('\n');
}
