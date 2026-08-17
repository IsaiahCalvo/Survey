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
    ownerAccount: read('owner-account') || process.env.FULL_APP_OWNER_ACCOUNT || null,
    inviteeAccount: read('invitee-account') || process.env.FULL_APP_INVITEE_ACCOUNT || null,
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
    browserDiagnostics: { consoleErrors: [], expectedConsoleErrors: [], httpErrorResponses: [], criticalRequestFailures: [] },
    errors: [],
    complete: false,
  };
}

const unique = (values) => [...new Set(values.filter(Boolean))];

export function documentCleanupProblems(manifest) {
  const createdDocumentIds = unique((manifest.created?.documents || []).map((item) => item.id));
  const deletedDocumentIds = unique((manifest.requests || [])
    .filter((item) => item.resource === 'documents' && item.operation === 'delete' && item.ok)
    .flatMap((item) => item.ids || []));
  const createdStoragePaths = unique([
    ...(manifest.created?.storagePaths || []),
    ...(manifest.created?.documents || []).map((document) => document.file_path),
  ]);
  const deletedStoragePaths = unique((manifest.requests || [])
    .filter((item) => item.resource === 'storage' && item.operation === 'delete' && item.ok)
    .flatMap((item) => item.paths || []));
  const problems = [];
  const missingDocumentIds = createdDocumentIds.filter((id) => !deletedDocumentIds.includes(id));
  const missingStoragePaths = createdStoragePaths.filter((value) => !deletedStoragePaths.includes(value));
  if (missingDocumentIds.length) problems.push(`document DELETE not observed for: ${missingDocumentIds.join(', ')}`);
  if (missingStoragePaths.length) problems.push(`storage DELETE not observed for: ${missingStoragePaths.join(', ')}`);
  return problems;
}

export function exactDocumentCleanupProblems(manifest, { id, file_path: filePath }) {
  const successfulDocumentDelete = (manifest.requests || []).some((item) => (
    item.resource === 'documents'
    && item.operation === 'delete'
    && item.ok
    && (item.ids || []).includes(id)
  ));
  const successfulStorageDelete = !filePath || (manifest.requests || []).some((item) => (
    item.resource === 'storage'
    && item.operation === 'delete'
    && item.ok
    && (item.paths || []).includes(filePath)
  ));
  const problems = [];
  if (!successfulDocumentDelete) problems.push(`document DELETE not completed for ${id}`);
  if (!successfulStorageDelete) problems.push(`storage DELETE not completed for ${filePath}`);
  return problems;
}

export function isExpectedMissingLegacySidecar({ url, status, errorCode, manifest }) {
  if (status !== 400 || errorCode !== 'NoSuchKey') return false;
  let match = null;
  try {
    match = new URL(url).pathname.match(/\/storage\/v1\/object\/documents\/([^/]+)\/([^/]+)_data\.json$/);
  } catch {
    return false;
  }
  if (!match) return false;
  const projectId = decodeURIComponent(match[1]);
  const documentId = decodeURIComponent(match[2]);
  const projectBelongsToRun = (manifest?.created?.projects || []).some((project) => project.id === projectId);
  const documentBelongsToRun = (manifest?.created?.documents || []).some((document) => document.id === documentId);
  return projectBelongsToRun && documentBelongsToRun;
}

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
  problems.push(...documentCleanupProblems(manifest));
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
