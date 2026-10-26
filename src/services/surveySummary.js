// A survey's progress in a few numbers per category: done, partly done, not
// started, and the items with issues (an answer the template marks bad,
// like N or Fail). Used for the Survey agent's end-of-walk summary, spoken
// and saved, and for the Summary sheet in the Excel export.
import { answerSetFor, isItemIssue } from './answerSets.js';
import { categoriesOf, checklistOf, itemText, modulesOf } from './templateConfigShape.js';

const activeChecklist = (category) => checklistOf(category)
  .map((item, index) => (typeof item === 'string' ? { id: `item-${index}`, text: item } : item))
  .filter((item) => item && item.archived !== true && item.id);

const nameOf = (marker) => String(marker?.name || '').trim() || 'Unnamed item';
const statusOf = (i) => (i.total && i.answered === i.total ? 'done' : i.answered ? 'partly' : 'notStarted');
const byName = (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true });

/**
 * markers: { id: marker }. itemIds: only these items (an end-of-walk
 * summary of what was worked on), or null for all. page: only items on
 * that page. Categories with no items in scope are left out. rows: also
 * list each category's items ({ name, status, answered, total, issues }).
 */
export function summarizeSurvey({ template, markers, itemIds = null, page = null, rows = false } = {}) {
  const set = answerSetFor(template);
  const wanted = itemIds ? new Set(itemIds) : null;
  const byCategory = new Map();
  for (const module of modulesOf(template)) {
    for (const category of categoriesOf(module)) {
      if (!byCategory.has(category.id)) byCategory.set(category.id, { category, checklist: activeChecklist(category), items: [] });
    }
  }
  for (const [id, marker] of Object.entries(markers || {})) {
    if (!marker || (wanted && !wanted.has(id)) || (page != null && marker.pageNumber !== page)) continue;
    const group = byCategory.get(marker.categoryId);
    if (!group) continue;
    const responses = marker.checklistResponses || {};
    const answered = group.checklist.filter((c) => responses[c.id]?.selection);
    const issues = group.checklist
      .filter((c) => isItemIssue(c, set, responses[c.id]?.selection))
      .map((c) => ({ text: itemText(c), answer: responses[c.id].selection }));
    group.items.push({ id, name: nameOf(marker), total: group.checklist.length, answered: answered.length, issues });
  }
  const categories = [...byCategory.values()]
    .filter((g) => g.items.length)
    .map(({ category, items }) => {
      items.sort(byName);
      return {
        id: category.id,
        name: category.name || 'Category',
        items: items.length,
        done: items.filter((i) => i.total && i.answered === i.total).length,
        partly: items.filter((i) => i.answered && i.answered < i.total).length,
        notStarted: items.filter((i) => !i.answered).length,
        issues: items.filter((i) => i.issues.length).map((i) => ({ id: i.id, name: i.name, lines: i.issues })),
        ...(rows ? { rows: items.map((i) => ({ ...i, status: statusOf(i) })) } : {}),
      };
    });
  const sum = (key) => categories.reduce((n, c) => n + c[key], 0);
  return {
    categories,
    totals: {
      items: sum('items'),
      done: sum('done'),
      partly: sum('partly'),
      notStarted: sum('notStarted'),
      withIssues: categories.reduce((n, c) => n + c.issues.length, 0),
    },
  };
}

/** The summary as plain text, to save or share. */
export function summaryText(summary, { title = 'Survey summary', when = new Date() } = {}) {
  const lines = [title, when.toLocaleString(), ''];
  const t = summary.totals;
  lines.push(`${t.items} item${t.items === 1 ? '' : 's'}: ${t.done} done, ${t.partly} partly done, ${t.notStarted} not started, ${t.withIssues} with issues.`);
  for (const c of summary.categories) {
    lines.push('', `${c.name}: ${c.items} item${c.items === 1 ? '' : 's'}, ${c.done} done, ${c.partly} partly done, ${c.notStarted} not started.`);
    for (const issue of c.issues) {
      lines.push(`  ${issue.name}: ${issue.lines.map((l) => `${l.text} = ${l.answer}`).join('; ')}`);
    }
  }
  return lines.join('\n');
}
