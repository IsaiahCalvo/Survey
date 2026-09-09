const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const LOCAL_ID = /^local:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/;
const MAX_MODULES = 64;
const MAX_CATEGORIES = 1024;
const MAX_CHECKLIST_ITEMS = 8192;
const MAX_CHECKLIST_ITEMS_PER_CATEGORY = 256;
const MAX_STRUCTURE_BYTES = 1024 * 1024;
const RESERVED_EXCEL_HEADERS = new Set(['Row ID', 'Changed By', 'Changed Date', 'Item', 'Entity', 'Notes']);

export class DocumentSurveyDefinitionError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DocumentSurveyDefinitionError';
    this.code = code;
  }
}

const fail = (code, message) => new DocumentSurveyDefinitionError(code, message);
const check = (value, code = 'DOCUMENT_SURVEY_DEFINITION_INVALID',
  message = 'The document survey definition is invalid.') => {
  if (!value) throw fail(code, message);
};
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const exact = (value, keys) => plain(value)
  && Object.keys(value).sort().join('|') === [...keys].sort().join('|');
const RFC3339 = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?(Z|([+-])(\d{2}):(\d{2}))$/;
const iso = value => {
  if (typeof value !== 'string') return false;
  const match = RFC3339.exec(value);
  if (!match) return false;
  const [, year, month, day, hour, minute, second, zone, , offsetHour, offsetMinute] = match;
  const y = Number(year), m = Number(month), d = Number(day);
  // Date.UTC treats years 0..99 as 1900..1999. Shift by a complete Gregorian
  // 400-year cycle so strict early-year validation keeps the same leap rules.
  const maxDay = new Date(Date.UTC(y < 100 ? y + 400 : y, m, 0)).getUTCDate();
  const validOffset = zone === 'Z' || (Number(offsetHour) <= 14
    && Number(offsetMinute) <= 59 && (Number(offsetHour) < 14 || Number(offsetMinute) === 0));
  return y >= 1 && m >= 1 && m <= 12 && d >= 1 && d <= maxDay
    && Number(hour) <= 23 && Number(minute) <= 59 && Number(second) <= 59
    && validOffset && Number.isFinite(Date.parse(value));
};
const ownedString = (value, max) => typeof value === 'string'
  && value.length > 0 && value.length <= max && value === value.trim();

// This matches the existing item metadata key in viewerShared.js. Keep the
// lowercase before whitespace removal: Unicode case context can depend on the
// space that follows a character (for example Greek final sigma).
export const documentSurveyModuleDataKey = name => `${String(name).toLowerCase().replace(/\s+/g, '')}Data`;

const displayNameKey = value => String(value).normalize('NFC').trim()
  .replace(/\s+/g, ' ').toLowerCase();

// ExcelJS/Excel sheet names are case-insensitive. This is the exact cleanup and
// UTF-16 31-code-unit truncation used by the current static exporter.
export const documentSurveySheetNameKey = (categoryName, moduleName) => {
  const raw = `${categoryName || 'Category'} - ${moduleName || 'Module'}`.trim();
  const cleaned = raw.replace(/[\\/?*[\]:]/g, '');
  check(!(cleaned.length > 31 && /[\uD800-\uDBFF]/.test(cleaned[30])
    && /[\uDC00-\uDFFF]/.test(cleaned[31])), 'DOCUMENT_SURVEY_DEFINITION_INVALID',
  'A survey worksheet name cannot split a Unicode character at Excel\'s 31-character limit.');
  return (cleaned.substring(0, 31) || 'Sheet').toLowerCase();
};

function copyChecklistItem(value, { source = false } = {}) {
  check(plain(value));
  const allowed = new Set(['id', 'text', 'archived', 'archivedAt', 'lastKnownLabel']);
  if (!source) check(Object.keys(value).every(key => allowed.has(key)));
  check(ownedString(value.id, 128) && ownedString(value.text, 100));
  const item = { id: value.id, text: value.text };
  if (Object.hasOwn(value, 'archived')) {
    check(typeof value.archived === 'boolean');
    item.archived = value.archived;
  }
  if (Object.hasOwn(value, 'archivedAt')) {
    check(typeof value.archivedAt === 'string' && value.archivedAt.length <= 64 && iso(value.archivedAt));
    item.archivedAt = value.archivedAt;
  }
  if (Object.hasOwn(value, 'lastKnownLabel')) {
    check(ownedString(value.lastKnownLabel, 100));
    item.lastKnownLabel = value.lastKnownLabel;
  }
  return Object.freeze(item);
}

function copyChecklist(values, options, budget = options.budget) {
  check(Array.isArray(values) && values.length <= MAX_CHECKLIST_ITEMS_PER_CATEGORY);
  if (budget) {
    check(budget.checklist + values.length <= MAX_CHECKLIST_ITEMS);
    budget.checklist += values.length;
  }
  return Object.freeze(values.map(item => copyChecklistItem(item, options)));
}

function copyCategories(values, options, budget = options.budget) {
  check(Array.isArray(values) && values.length <= MAX_CATEGORIES);
  if (budget) {
    check(budget.categories + values.length <= MAX_CATEGORIES);
    budget.categories += values.length;
  }
  return Object.freeze(values.map(value => {
    check(plain(value));
    if (!options.source) check(Object.keys(value).every(key => ['id', 'name', 'checklist'].includes(key)));
    check(ownedString(value.id, 128) && ownedString(value.name, 256));
    let checklist;
    if (options.source) {
      const present = ['checklist', 'items'].filter(key => Object.hasOwn(value, key));
      check(present.length > 0);
      checklist = copyChecklist(value[present[0]], options, budget);
      if (present.length === 2) check(stable(copyChecklist(value[present[1]], options, null)) === stable(checklist));
    } else checklist = copyChecklist(value.checklist, options, budget);
    return Object.freeze({ id: value.id, name: value.name, checklist });
  }));
}

function copyModulesArray(values, options) {
  check(Array.isArray(values) && values.length <= MAX_MODULES);
  const budget = options.budget || { categories: 0, checklist: 0 };
  return Object.freeze(values.map(value => {
    check(plain(value));
    if (!options.source) check(Object.keys(value).every(key => ['id', 'name', 'categories'].includes(key)));
    check(ownedString(value.id, 128) && ownedString(value.name, 256));
    let categories;
    if (options.source) {
      const present = ['categories', 'cats'].filter(key => Object.hasOwn(value, key));
      check(present.length > 0);
      categories = copyCategories(value[present[0]], options, budget);
      if (present.length === 2) check(stable(copyCategories(value[present[1]], options,
        { categories: 0, checklist: 0 })) === stable(categories));
    } else categories = copyCategories(value.categories, options, budget);
    return Object.freeze({ id: value.id, name: value.name, categories });
  }));
}

function validateTree(modules) {
  const moduleIds = new Set();
  const categoryIds = new Set();
  const checklistIds = new Set();
  const moduleKeys = new Set();
  const sheetKeys = new Set();
  let categoryCount = 0;
  let checklistCount = 0;
  for (const module of modules) {
    const moduleKey = documentSurveyModuleDataKey(module.name);
    check(!moduleIds.has(module.id) && !moduleKeys.has(moduleKey));
    moduleIds.add(module.id); moduleKeys.add(moduleKey);
    if (module.categories.length === 0) {
      const sheetKey = documentSurveySheetNameKey('General', module.name);
      check(!sheetKeys.has(sheetKey));
      sheetKeys.add(sheetKey);
    }
    const categoryNames = new Set();
    for (const category of module.categories) {
      categoryCount++;
      const categoryName = displayNameKey(category.name);
      const sheetKey = documentSurveySheetNameKey(category.name, module.name);
      check(!categoryIds.has(category.id) && !categoryNames.has(categoryName) && !sheetKeys.has(sheetKey));
      categoryIds.add(category.id); categoryNames.add(categoryName); sheetKeys.add(sheetKey);
      const checklistTexts = new Set();
      for (const item of category.checklist) {
        checklistCount++;
        check(!checklistIds.has(item.id) && !checklistTexts.has(item.text)
          && !RESERVED_EXCEL_HEADERS.has(item.text));
        checklistIds.add(item.id); checklistTexts.add(item.text);
      }
    }
  }
  check(categoryCount <= MAX_CATEGORIES && checklistCount <= MAX_CHECKLIST_ITEMS);
  check(new TextEncoder().encode(stable(modules)).byteLength <= MAX_STRUCTURE_BYTES,
    'DOCUMENT_SURVEY_DEFINITION_TOO_LARGE', 'The document survey definition exceeds its limit.');
  return modules;
}

function copyModules(values) {
  return validateTree(copyModulesArray(values, { source: false }));
}

export function captureTemplateSurveyModules(template) {
  check(plain(template));
  const candidates = [];
  for (const owner of [template, plain(template.config) ? template.config : null]) {
    if (!owner) continue;
    for (const key of ['modules', 'spaces']) {
      if (!Object.hasOwn(owner, key)) continue;
      check(Array.isArray(owner[key]));
      candidates.push(copyModulesArray(owner[key], { source: true }));
    }
  }
  check(candidates.length > 0);
  const modules = validateTree(candidates[0]);
  for (const candidate of candidates.slice(1)) check(stable(candidate) === stable(modules));
  return modules;
}

function copySource(value) {
  check(exact(value, ['templateId', 'templateUpdatedAt', 'structureSha256'])
    && UUID.test(value.templateId || '') && iso(value.templateUpdatedAt)
    && SHA256.test(value.structureSha256 || ''));
  return Object.freeze({ templateId: value.templateId,
    templateUpdatedAt: value.templateUpdatedAt, structureSha256: value.structureSha256 });
}

function copyPreview(value, documentId = null) {
  check(exact(value, ['status', 'version', 'documentId', 'source', 'modules'])
    && value.status === 'preview' && value.version === 1 && UUID.test(value.documentId || '')
    && (!documentId || value.documentId === documentId));
  return Object.freeze({ status: 'preview', version: 1, documentId: value.documentId,
    source: copySource(value.source), modules: copyModules(value.modules) });
}

export const captureTemplateSurveyDefinitionPreview = copyPreview;

export function validateDocumentSurveyDefinition(value, documentId = null) {
  if (exact(value, ['status', 'version', 'documentId'])) {
    check(value.status === 'unadopted' && value.version === 1 && UUID.test(value.documentId || '')
      && (!documentId || value.documentId === documentId));
    return Object.freeze({ status: 'unadopted', version: 1, documentId: value.documentId });
  }
  check(exact(value, ['status', 'version', 'documentId', 'definitionRevision', 'source', 'seed', 'modules'])
    && value.status === 'accepted' && value.version === 1 && value.definitionRevision === 1
    && UUID.test(value.documentId || '') && (!documentId || value.documentId === documentId)
    && exact(value.seed, ['operationId', 'requestSha256'])
    && UUID.test(value.seed.operationId || '') && SHA256.test(value.seed.requestSha256 || ''));
  return Object.freeze({ status: 'accepted', version: 1, documentId: value.documentId,
    definitionRevision: 1, source: copySource(value.source),
    seed: Object.freeze({ operationId: value.seed.operationId, requestSha256: value.seed.requestSha256 }),
    modules: copyModules(value.modules) });
}

export function validateManagedLocalSurveyDefinition(value, localId = null) {
  check(exact(value, ['status', 'version', 'documentId', 'definitionRevision', 'sourceTemplateId',
    'sourceTemplateUpdatedAt', 'sourceStructureSha256', 'modules'])
    && value.status === 'accepted' && value.version === 1 && value.definitionRevision === 1
    && LOCAL_ID.test(value.documentId || '') && (!localId || value.documentId === localId)
    && typeof value.sourceTemplateId === 'string' && value.sourceTemplateId.length > 0
    && value.sourceTemplateId.length <= 256
    && (value.sourceTemplateUpdatedAt === null || iso(value.sourceTemplateUpdatedAt))
    && SHA256.test(value.sourceStructureSha256 || ''));
  return Object.freeze({ status: 'accepted', version: 1, documentId: value.documentId,
    definitionRevision: 1, sourceTemplateId: value.sourceTemplateId,
    sourceTemplateUpdatedAt: value.sourceTemplateUpdatedAt,
    sourceStructureSha256: value.sourceStructureSha256, modules: copyModules(value.modules) });
}

function stable(value) {
  return value && typeof value === 'object'
    ? (Array.isArray(value) ? `[${value.map(stable).join(',')}]`
      : `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stable(value[key])}`).join(',')}}`)
    : JSON.stringify(value);
}

async function sha256(value) {
  check(globalThis.crypto?.subtle, 'DOCUMENT_SURVEY_DEFINITION_UNAVAILABLE',
    'Document survey definitions are not available in this browser.');
  const digest = new Uint8Array(await globalThis.crypto.subtle.digest('SHA-256',
    new TextEncoder().encode(stable(value))));
  return [...digest].map(byte => byte.toString(16).padStart(2, '0')).join('');
}

export async function documentSurveyDefinitionAdoptionIdentity(preview, operationId) {
  const owned = copyPreview(preview);
  check(UUID.test(operationId || ''));
  const request = { version: 1, documentId: owned.documentId,
    sourceTemplateId: owned.source.templateId,
    sourceTemplateUpdatedAt: owned.source.templateUpdatedAt,
    sourceStructureSha256: owned.source.structureSha256, operationId };
  return Object.freeze({ operationId, requestSha256: await sha256(request) });
}

export async function captureManagedLocalSurveyDefinition({ localId, template } = {}) {
  check(LOCAL_ID.test(localId || '') && plain(template));
  const sourceTemplateId = template.supabaseId || template.id;
  const sourceTemplateUpdatedAt = template.updated_at || template.updatedAt || null;
  check(typeof sourceTemplateId === 'string' && sourceTemplateId.length > 0
    && sourceTemplateId.length <= 256
    && (sourceTemplateUpdatedAt === null || iso(sourceTemplateUpdatedAt)));
  const modules = captureTemplateSurveyModules(template);
  const sourceStructureSha256 = await sha256(modules);
  return validateManagedLocalSurveyDefinition({ status: 'accepted', version: 1,
    documentId: localId, definitionRevision: 1, sourceTemplateId, sourceTemplateUpdatedAt,
    sourceStructureSha256, modules }, localId);
}

function rpcResult(value, error) {
  if (error) {
    if (error.code === '42501' || [401, 403].includes(error.status || error.statusCode)) {
      throw fail('DOCUMENT_SURVEY_DEFINITION_FORBIDDEN',
        'You no longer have access to this document survey definition.');
    }
    const conflict = ['23505', '23514', '40001'].includes(error.code);
    throw fail(conflict ? 'DOCUMENT_SURVEY_DEFINITION_CONFLICT' : 'DOCUMENT_SURVEY_DEFINITION_UNAVAILABLE',
      conflict ? 'The document survey definition changed. Review it again.'
        : 'The document survey definition could not be loaded.');
  }
  return value;
}

export function createDocumentSurveyDefinitionClient({ rpc, enabled = false } = {}) {
  check(typeof rpc === 'function');
  const call = async (name, args, signal) => {
    check(enabled, 'DOCUMENT_SURVEY_DEFINITION_DISABLED',
      'Shared document survey definitions are not enabled.');
    check(signal?.aborted !== true, 'DOCUMENT_SURVEY_DEFINITION_STALE', 'The document changed.');
    let result;
    try { result = await rpc(name, args, { signal }); }
    catch (error) {
      if (signal?.aborted || error?.name === 'AbortError') {
        throw fail('DOCUMENT_SURVEY_DEFINITION_STALE', 'The document changed.');
      }
      return rpcResult(null, error || { code: 'transport_failed' });
    }
    check(signal?.aborted !== true, 'DOCUMENT_SURVEY_DEFINITION_STALE', 'The document changed.');
    return rpcResult(result?.data, result?.error);
  };
  return Object.freeze({
    async read({ documentId, signal } = {}) {
      check(UUID.test(documentId || ''));
      return validateDocumentSurveyDefinition(await call('read_document_survey_definition', {
        p_document_id: documentId,
      }, signal), documentId);
    },
    async preview({ documentId, templateId, signal } = {}) {
      check(UUID.test(documentId || '') && UUID.test(templateId || ''));
      return copyPreview(await call('preview_document_survey_definition_adoption', {
        p_document_id: documentId, p_template_id: templateId,
      }, signal), documentId);
    },
    async adopt({ preview, operationId, signal } = {}) {
      const owned = copyPreview(preview);
      const identity = await documentSurveyDefinitionAdoptionIdentity(owned, operationId);
      const result = await call('adopt_document_survey_definition', {
        p_document_id: owned.documentId, p_template_id: owned.source.templateId,
        p_expected_template_updated_at: owned.source.templateUpdatedAt,
        p_expected_structure_sha256: owned.source.structureSha256,
        p_operation_id: operationId, p_request_sha256: identity.requestSha256,
      }, signal);
      const accepted = validateDocumentSurveyDefinition(result, owned.documentId);
      check(accepted.status === 'accepted' && accepted.seed.operationId === operationId
        && accepted.seed.requestSha256 === identity.requestSha256
        && accepted.source.templateId === owned.source.templateId
        && accepted.source.templateUpdatedAt === owned.source.templateUpdatedAt
        && accepted.source.structureSha256 === owned.source.structureSha256);
      return accepted;
    },
  });
}
