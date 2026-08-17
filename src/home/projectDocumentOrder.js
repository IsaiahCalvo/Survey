export function orderDocumentsByProject(rows, storedByProject = {}) {
  const grouped = new Map();
  for (const row of rows) {
    const projectId = String(row.project_id);
    if (!grouped.has(projectId)) grouped.set(projectId, []);
    grouped.get(projectId).push(row);
  }
  const ordered = new Map();
  for (const [projectId, projectRows] of grouped) {
    const ids = storedByProject?.[projectId] || [];
    const rank = new Map(ids.map((id, index) => [id, index]));
    ordered.set(projectId, [...projectRows].sort((a, b) => (
      (rank.get(a.id) ?? Number.MAX_SAFE_INTEGER)
      - (rank.get(b.id) ?? Number.MAX_SAFE_INTEGER)
    )));
  }
  const offsets = new Map();
  return rows.map((row) => {
    const projectId = String(row.project_id);
    const offset = offsets.get(projectId) || 0;
    offsets.set(projectId, offset + 1);
    return ordered.get(projectId)?.[offset] || row;
  });
}

export function mergeProjectDocumentOrder(currentPreferences, projectId, documentIds) {
  const current = currentPreferences && typeof currentPreferences === 'object'
    ? currentPreferences
    : {};
  return {
    ...current,
    documentOrderByProject: {
      ...(current.documentOrderByProject || {}),
      [projectId]: [...documentIds],
    },
  };
}
