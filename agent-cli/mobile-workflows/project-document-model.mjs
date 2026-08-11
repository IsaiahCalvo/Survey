export const WORKFLOW_STORAGE_KEYS = Object.freeze({
  documents: 'mobileWorkflowDocuments',
  projectPreferences: 'mobileWorkflowProjectPreferences',
  projects: 'mobileWorkflowProjects',
  templates: 'mobileWorkflowTemplates',
});

export const WORKFLOW_VIEWPORTS = Object.freeze({
  desktop: { width: 1400, height: 900 },
  mobile: { width: 390, height: 844 },
});

export function workflowRoute(tab = 'projects') {
  const params = new URLSearchParams({
    hubPreview: '1',
    workflowE2E: '1',
    tab,
    mobileNav: 'tabs',
    nativeShell: 'expo',
  });
  return `/?${params.toString()}`;
}

export async function readWorkflowModel(page) {
  return page.evaluate((keys) => {
    const read = (key) => JSON.parse(localStorage.getItem(key) || '[]');
    return {
      documents: read(keys.documents),
      projectPreferences: JSON.parse(localStorage.getItem(keys.projectPreferences) || '{}'),
      projects: read(keys.projects),
      templates: read(keys.templates),
    };
  }, WORKFLOW_STORAGE_KEYS);
}

export async function waitForWorkflowModel(page, predicateSource, argument, timeout = 10_000) {
  await page.waitForFunction(({ keys, source, value }) => {
    const model = {
      documents: JSON.parse(localStorage.getItem(keys.documents) || '[]'),
      projectPreferences: JSON.parse(localStorage.getItem(keys.projectPreferences) || '{}'),
      projects: JSON.parse(localStorage.getItem(keys.projects) || '[]'),
      templates: JSON.parse(localStorage.getItem(keys.templates) || '[]'),
    };
    return Function('model', 'value', `return (${source})(model, value);`)(model, value);
  }, { keys: WORKFLOW_STORAGE_KEYS, source: predicateSource, value: argument }, { timeout });
  return readWorkflowModel(page);
}

export async function restoreWorkflowModel(page, model) {
  await page.evaluate(({ keys, snapshot }) => {
    localStorage.setItem(keys.documents, JSON.stringify(snapshot.documents));
    localStorage.setItem(keys.projectPreferences, JSON.stringify(snapshot.projectPreferences || {}));
    localStorage.setItem(keys.projects, JSON.stringify(snapshot.projects));
    localStorage.setItem(keys.templates, JSON.stringify(snapshot.templates));
  }, { keys: WORKFLOW_STORAGE_KEYS, snapshot: model });
}
