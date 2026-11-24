// Nightly 'marker-tap-card' (owner 2026-11-24): a tap on a Survey Marker
// shows what it is. The quick bar over it names its Category and Tag and lists
// the Category's checklist items with this marker's answers (Cable Pulled,
// Stub-ups, Camera Installed), in place of Comment, Duplicate and Delete,
// which stay in More. Expand opens the Survey panel on the marker.
// Dependency-light so the Node tests run it as it is.
import { shownChecklist } from '../services/conditionalLines.js';

const same = (a, b) => a != null && b != null && String(a) === String(b);

/** The template Category a marker belongs to (its own Module first). */
export function markerCategory(marker, template) {
  if (!marker) return null;
  const modules = template?.modules || template?.spaces || [];
  const inModule = (mod) => (mod?.categories || []).find((c) => same(c?.id, marker.categoryId)) || null;
  const own = modules.find((mod) => same(mod?.id, marker.moduleId));
  return inModule(own) || modules.map(inModule).find(Boolean) || null;
}

const answered = (value) => value != null && String(value).trim() !== '';

/**
 * What the tap card shows for one marker, or null when it is not a marker
 * this template knows.
 * @returns {{ categoryName: string, tag: string, lines: {id, text, answer}[], answered: number }|null}
 */
export function markerTapCardModel(marker, template) {
  if (!marker) return null;
  const category = markerCategory(marker, template);
  const responses = marker.checklistResponses || {};
  const lines = shownChecklist(category?.checklist, responses).map((item) => ({
    id: item.id,
    text: String(item.text || item.name || 'Untitled item'),
    answer: answered(responses[item.id]?.selection) ? String(responses[item.id].selection) : null,
  }));
  return {
    categoryName: category?.name ? String(category.name) : 'No Category',
    tag: marker.name ? String(marker.name) : '',
    lines,
    answered: lines.filter((line) => line.answer != null).length,
  };
}
