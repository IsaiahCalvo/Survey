// Survey pins (Survey Nightly, beta flag 'survey-mode-tools'; owner
// 2026-11-23): in Survey mode the pinned tools bar holds survey things, not
// only drawing tools. "One of the toolbars you might want to have is the
// rectangular marker, or freehand marker, or smart fill marker ... your
// different entities or modules, and maybe your categories."
//
// - A marker pin (Rectangle, Freehand, Smart fill) arms the Survey Marker tool
//   in that drawing way (markerDrawMode.js).
// - An entity, module or category pin picks that entity, module or category
//   for the next Survey Marker and arms the tool, as the survey bar's swatches,
//   module menu and chips do. It names its template's thing by id, so a pin
//   whose thing is not in the template in use shows dimmed and does nothing.
//
// Pure part only: components/PinnedToolsDock.jsx draws and arms them. The
// survey bar's handlers come from the viewer's toolbar API (`surveyToolbar`,
// PDFViewer), the same ones the phone's survey rail uses.

export const SURVEY_MARKER_PIN_KINDS = Object.freeze([
  { id: 'survey-rect', label: 'Rectangle marker', iconName: 'selectionPlus', group: 'Survey markers', drawMode: 'rectangle' },
  { id: 'survey-freehand', label: 'Freehand marker', iconName: 'brush', group: 'Survey markers', drawMode: 'freehand' },
  { id: 'survey-smartfill', label: 'Smart fill marker', iconName: 'smartFillDrop', group: 'Survey markers', drawMode: 'smartFill' },
].map((entry) => Object.freeze({ ...entry, tool: 'survey-marker', survey: true })));

export const SURVEY_REF_PIN_KINDS = Object.freeze([
  { id: 'survey-entity', label: 'Entity', iconName: 'survey', group: 'Entities' },
  { id: 'survey-module', label: 'Module', iconName: 'layers', group: 'Modules' },
  { id: 'survey-category', label: 'Category', iconName: 'survey', group: 'Categories' },
].map((entry) => Object.freeze({ ...entry, tool: 'survey-marker', survey: true })));

export const SURVEY_PIN_KINDS = Object.freeze([...SURVEY_MARKER_PIN_KINDS, ...SURVEY_REF_PIN_KINDS]);
const KIND_BY_ID = new Map(SURVEY_PIN_KINDS.map((kind) => [kind.id, kind]));

export const surveyPinKind = (id) => KIND_BY_ID.get(id) || null;
export const isSurveyPinKind = (id) => KIND_BY_ID.has(id);

// The marker pins a Survey pin set starts with (Smart fill joins only where
// its provider is there, see seedSurveyMarkerPins).
export const SEED_MARKER_KINDS = Object.freeze(['survey-rect', 'survey-freehand']);

const cleanText = (value, max = 120) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : undefined);
const HEX = /^#[0-9a-f]{6}$/i;

/** What an entity / module / category pin names, cleaned for saving. */
export function sanitizeSurveyRef(kindId, raw) {
  if (!raw || typeof raw !== 'object') return null;
  const ref = {};
  const templateId = cleanText(raw.templateId, 80);
  if (templateId) ref.templateId = templateId;
  const name = cleanText(raw.name);
  if (name) ref.name = name;
  if (kindId === 'survey-entity') {
    const entityId = cleanText(raw.entityId, 80);
    if (!entityId) return null;
    ref.entityId = entityId;
    const color = typeof raw.color === 'string' ? raw.color.trim() : '';
    if (HEX.test(color)) ref.color = color.toLowerCase();
    return ref;
  }
  const moduleId = cleanText(raw.moduleId, 80);
  if (kindId === 'survey-module') {
    if (!moduleId) return null;
    ref.moduleId = moduleId;
    return ref;
  }
  if (kindId === 'survey-category') {
    const categoryId = cleanText(raw.categoryId, 80);
    if (!categoryId) return null;
    ref.categoryId = categoryId;
    if (moduleId) ref.moduleId = moduleId;
    return ref;
  }
  return null;
}

/** Plain words for a survey pin: "Rectangle marker", "Camera (category)". */
export function surveyPinDescription(pin) {
  const kind = surveyPinKind(pin?.kind);
  if (!kind) return '';
  if (!kind.drawMode) return `${pin.ref?.name || kind.label} (${kind.label.toLowerCase()})`;
  return kind.label;
}

const modulesOf = (toolbar) => (Array.isArray(toolbar?.modules) ? toolbar.modules : []);
const findCategory = (toolbar, categoryId) => {
  for (const module of modulesOf(toolbar)) {
    const category = (module.categories || []).find((entry) => entry.id === categoryId);
    if (category) return { module, category };
  }
  return null;
};

/**
 * Can this pin be used now, and is it the one in use? `toolbar` is the
 * viewer's `surveyToolbar` (null outside Survey or before a template is
 * picked); `shownMode` the drawing way the tool bar shows lit.
 */
export function surveyPinStatus(pin, { toolbar, activeTool, shownMode, smartFillReady = false } = {}) {
  const kind = surveyPinKind(pin?.kind);
  if (!kind || !toolbar) return { available: false, pressed: false };
  const armed = activeTool === 'survey-marker';
  if (kind.drawMode) {
    const available = kind.drawMode !== 'smartFill' || smartFillReady;
    return { available, pressed: available && armed && shownMode === kind.drawMode };
  }
  const ref = pin.ref || {};
  if (kind.id === 'survey-entity') {
    const available = (toolbar.entities || []).some((entity) => entity.id === ref.entityId);
    return { available, pressed: available && armed && toolbar.selectedEntityId === ref.entityId };
  }
  if (kind.id === 'survey-module') {
    const available = modulesOf(toolbar).some((module) => module.id === ref.moduleId);
    return { available, pressed: available && armed && toolbar.selectedModuleId === ref.moduleId };
  }
  const found = findCategory(toolbar, ref.categoryId);
  return { available: Boolean(found), pressed: Boolean(found) && armed && toolbar.selectedCategoryId === ref.categoryId };
}

/**
 * Arm a survey pin through the survey bar's own handlers. Returns true when
 * it did something. `setDrawMode` is markerDrawMode.js setMarkerDrawMode.
 */
export function armSurveyPin(pin, toolbar, { setDrawMode, smartFillReady = false } = {}) {
  const kind = surveyPinKind(pin?.kind);
  if (!kind || !toolbar) return false;
  if (!surveyPinStatus(pin, { toolbar, smartFillReady }).available) return false;
  const ref = pin.ref || {};
  if (kind.drawMode) {
    setDrawMode?.(kind.drawMode);
    toolbar.onArmMarker?.();
    return true;
  }
  if (kind.id === 'survey-entity') {
    toolbar.onSelectEntity?.(ref.entityId);
    return true;
  }
  if (kind.id === 'survey-module') {
    // As the desktop module menu does: the module and its first category,
    // keeping the entity (the phone's module pick also clears the entity).
    const module = modulesOf(toolbar).find((entry) => entry.id === ref.moduleId);
    const first = module?.categories?.[0]?.id || null;
    if (first && toolbar.onPickCategory) toolbar.onPickCategory(first, module.id);
    else toolbar.onSelectModule?.(ref.moduleId);
    return true;
  }
  const found = findCategory(toolbar, ref.categoryId);
  toolbar.onPickCategory?.(ref.categoryId, found?.module?.id || ref.moduleId);
  return true;
}

/**
 * Everything the "Pin a tool" list offers in Survey mode, in groups: the
 * marker kinds, then the template's entities, modules and categories. Each
 * choice is { key, kind, ref?, label, group, sub? }.
 */
export function surveyPinChoices(toolbar, { smartFillReady = false } = {}) {
  const choices = SURVEY_MARKER_PIN_KINDS
    .filter((kind) => kind.drawMode !== 'smartFill' || smartFillReady)
    .map((kind) => ({ key: kind.id, kind: kind.id, label: kind.label, group: kind.group }));
  if (!toolbar) return choices;
  const templateId = toolbar.templateId || undefined;
  for (const entity of toolbar.entities || []) {
    choices.push({
      key: `survey-entity:${entity.id}`,
      kind: 'survey-entity',
      ref: { templateId, entityId: entity.id, name: entity.name || 'Untitled entity', color: entity.color },
      label: entity.name || 'Untitled entity',
      group: 'Entities',
    });
  }
  const modules = modulesOf(toolbar);
  for (const module of modules) {
    choices.push({
      key: `survey-module:${module.id}`,
      kind: 'survey-module',
      ref: { templateId, moduleId: module.id, name: module.name || 'Untitled module' },
      label: module.name || 'Untitled module',
      group: 'Modules',
    });
  }
  for (const module of modules) {
    for (const category of module.categories || []) {
      choices.push({
        key: `survey-category:${category.id}`,
        kind: 'survey-category',
        ref: { templateId, moduleId: module.id, categoryId: category.id, name: category.name || 'Untitled category' },
        label: category.name || 'Untitled category',
        sub: modules.length > 1 ? (module.name || 'Untitled module') : undefined,
        group: 'Categories',
      });
    }
  }
  return choices;
}

const CHOICE_WORDS = Object.freeze({
  'survey-rect': 'survey marker box rectangle square marquee',
  'survey-freehand': 'survey marker freehand brush draw highlighter stroke',
  'survey-smartfill': 'survey marker smart fill auto room area',
  'survey-entity': 'entity trade colour color who',
  'survey-module': 'module group section',
  'survey-category': 'category kind device type',
});

/** The choices whose words hold every typed word. */
export function matchSurveyPinChoices(query, choices) {
  const words = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!words.length) return choices;
  return choices.filter((choice) => {
    const hay = `${choice.label} ${choice.sub || ''} ${choice.group} ${CHOICE_WORDS[choice.kind] || ''}`.toLowerCase();
    return words.every((word) => hay.includes(word));
  });
}

/** One key per pinned thing: the kind, and the entity, category or module. */
export function surveyPinKey(pin) {
  const ref = pin?.ref || {};
  const id = ref.entityId || ref.categoryId || ref.moduleId;
  return id ? `${pin.kind}:${id}` : pin?.kind;
}

/** Is a pin already pinned for this choice (same kind and same thing)? */
export function choiceIsPinned(choice, pins) {
  return (pins || []).some((pin) => surveyPinKey(pin) === choice.key);
}

/** The marker kind for the drawing way in use: 'rectangle' -> Rectangle marker. */
export function markerPinKindForMode(mode) {
  return SURVEY_MARKER_PIN_KINDS.find((kind) => kind.drawMode === mode) || SURVEY_MARKER_PIN_KINDS[0];
}
