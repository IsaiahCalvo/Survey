export const DURABLE_SURFACES = Object.freeze({
  desktop: Object.freeze({
    viewport: Object.freeze({ width: 1512, height: 900 }),
    route: '/',
    isMobile: false,
    hasTouch: false,
    deviceScaleFactor: 1,
  }),
  mobile: Object.freeze({
    viewport: Object.freeze({ width: 390, height: 844 }),
    route: '/?mobileNav=tabs&nativeShell=expo',
    isMobile: true,
    hasTouch: true,
    deviceScaleFactor: 3,
  }),
});

export function parseSurface(value = 'both') {
  const normalized = String(value || 'both').trim().toLowerCase();
  if (normalized === 'both') return ['desktop', 'mobile'];
  if (Object.hasOwn(DURABLE_SURFACES, normalized)) return [normalized];
  throw new Error(`Unknown surface "${value}"; expected desktop, mobile, or both`);
}

export function parseDurableArgs(argv = []) {
  const read = (name) => argv.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3) || null;
  return {
    surfaces: parseSurface(read('surface') || 'both'),
    baseUrl: read('base-url'),
    headful: argv.includes('--headful'),
    dryRun: argv.includes('--dry-run'),
    artifactRoot: read('artifact-root') || '.playwright-mcp/full-app-durable',
  };
}

export function createDurableNames(surface, runId) {
  if (!Object.hasOwn(DURABLE_SURFACES, surface)) throw new Error(`Unknown surface: ${surface}`);
  const prefix = `FULLAPP E2E ${surface} ${runId}`;
  return Object.freeze({
    prefix,
    sourceProject: `${prefix} Source`,
    renamedProject: `${prefix} Primary`,
    targetProject: `${prefix} Target`,
    sourceDocument: 'se011.pdf',
    targetDocument: 'clickable-link-test.pdf',
    renamedDocument: `${prefix} renamed.pdf`,
  });
}

export function createCleanupManifest({ surface, runId, names, collaboration = null }) {
  return {
    schemaVersion: 1,
    surface,
    runId,
    names,
    created: { projects: [], documents: [], storagePaths: [] },
    workflowCoverage: {
      createProject: 'pending',
      uploadDocuments: 'pending',
      reloadList: 'pending',
      renameProject: 'pending',
      renameDocument: 'pending',
      moveDocument: 'pending',
      openViewerAndBack: 'pending',
    },
    requests: [],
    uiAbsenceAfterReload: { documents: [], projects: [] },
    collaboration: collaboration || {
      status: 'not-covered',
      blockerCode: 'not-configured',
      blocker: 'No second leased identity was configured for this run.',
    },
    browserDiagnostics: { consoleErrors: [], expectedConsoleErrors: [], criticalRequestFailures: [] },
    errors: [],
    complete: false,
  };
}

const unique = (values) => [...new Set(values.filter(Boolean))];

export function finalizeCleanupManifest(manifest) {
  manifest.created.projects = dedupeById(manifest.created.projects);
  manifest.created.documents = dedupeById(manifest.created.documents);
  manifest.created.storagePaths = unique([
    ...manifest.created.storagePaths,
    ...manifest.created.documents.map((document) => document.file_path),
  ]);
  manifest.uiAbsenceAfterReload.documents = unique(manifest.uiAbsenceAfterReload.documents);
  manifest.uiAbsenceAfterReload.projects = unique(manifest.uiAbsenceAfterReload.projects);

  const expectedDocuments = [manifest.names.renamedDocument, manifest.names.targetDocument];
  const moveCovered = manifest.workflowCoverage.moveDocument === 'covered';
  const expectedProjects = moveCovered
    ? [manifest.names.renamedProject, manifest.names.targetProject]
    : [manifest.names.renamedProject];
  const missingUiDocuments = expectedDocuments.filter((name) => !manifest.uiAbsenceAfterReload.documents.includes(name));
  const missingUiProjects = expectedProjects.filter((name) => !manifest.uiAbsenceAfterReload.projects.includes(name));
  const createdDocumentIds = unique(manifest.created.documents.map((item) => item.id));
  const createdProjectIds = unique(manifest.created.projects.map((item) => item.id));
  const deletedDocumentIds = unique(manifest.requests
    .filter((item) => item.resource === 'documents' && item.operation === 'delete' && item.ok)
    .flatMap((item) => item.ids || []));
  const deletedProjectIds = unique(manifest.requests
    .filter((item) => item.resource === 'projects' && item.operation === 'delete' && item.ok)
    .flatMap((item) => item.ids || []));
  const storageDeletes = manifest.requests.filter((item) => item.resource === 'storage' && item.operation === 'delete' && item.ok);

  const problems = [];
  for (const key of ['createProject', 'uploadDocuments', 'reloadList', 'renameProject', 'renameDocument', 'openViewerAndBack']) {
    if (!String(manifest.workflowCoverage[key] || '').startsWith('covered')) {
      problems.push(`${key} workflow was not covered`);
    }
  }
  if (!/^(?:covered|blocked:)/.test(String(manifest.workflowCoverage.moveDocument || ''))) {
    problems.push('moveDocument workflow lacks covered or explicit blocked classification');
  }
  const requiredProjectCount = moveCovered ? 2 : 1;
  if (manifest.created.projects.length < requiredProjectCount || createdProjectIds.length < requiredProjectCount) {
    problems.push(`fewer than ${requiredProjectCount} created project row(s) were observed`);
  }
  if (manifest.created.documents.length < 2 || createdDocumentIds.length < 2) problems.push('fewer than two created document rows were observed');
  if (createdDocumentIds.some((id) => !deletedDocumentIds.includes(id))) problems.push('not every created document id had a successful DELETE');
  if (createdProjectIds.some((id) => !deletedProjectIds.includes(id))) problems.push('not every created project id had a successful DELETE');
  if (manifest.created.storagePaths.length > 0 && storageDeletes.length < manifest.created.storagePaths.length) {
    problems.push('not every created storage path had a successful remove request');
  }
  if (missingUiDocuments.length) problems.push(`documents still unproved after reload: ${missingUiDocuments.join(', ')}`);
  if (missingUiProjects.length) problems.push(`projects still unproved after reload: ${missingUiProjects.join(', ')}`);
  if (manifest.errors.length) problems.push(`${manifest.errors.length} cleanup error(s) recorded`);

  manifest.complete = problems.length === 0;
  manifest.problems = problems;
  return manifest;
}

function dedupeById(items) {
  const byIdentity = new Map();
  for (const item of items) {
    const key = item?.id || `${item?.name || ''}:${item?.file_path || ''}`;
    if (!key) continue;
    byIdentity.set(key, { ...(byIdentity.get(key) || {}), ...item });
  }
  return [...byIdentity.values()];
}
