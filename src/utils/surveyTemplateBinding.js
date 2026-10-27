const PREFIX = 'survey:templateBinding:';
const stable = (value) => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined && typeof value[key] !== 'function').map((key) => [key, stable(value[key])])) : value;
// The template's own answer list, its Excel layout and its Auto-mark as
// Complete switch count as part of its version: a drawing keeps the template
// as it was, so a change reaches it through the "use latest version" choice,
// and a drawing on the older version cannot write the template back over the
// change. Each joins the fingerprint only when set (the switch only when
// off), so a template without them keeps the fingerprint older bindings stored.
const legacyFingerprint = (template) => JSON.stringify(stable({ name: template?.name, modules: template?.modules || template?.spaces || [], entities: template?.entities || [] }));
const versionedSettings = (template) => ({
  answerSet: template?.answerSet || undefined,
  exportKitId: template?.exportKitId || undefined,
  autoComplete: template?.autoComplete === false ? false : undefined,
});
export function templateFingerprint(template) {
  const settings = versionedSettings(template);
  if (Object.values(settings).every((v) => v === undefined)) return legacyFingerprint(template);
  return JSON.stringify(stable({ name: template?.name, modules: template?.modules || template?.spaces || [], entities: template?.entities || [], ...settings }));
}
export function templateBindingKey(documentKey, userId, templateId) { return `${PREFIX}${userId || 'local'}:${documentKey}:${templateId}`; }
export function readTemplateBinding(key, storage) { try { return JSON.parse(storage?.getItem(key) || 'null'); } catch { return null; } }
export function writeTemplateBinding(key, value, storage) { try { storage?.setItem(key, JSON.stringify(value)); return Boolean(storage); } catch { return false; } }
export function bindUsedTemplate(template, prior = null) {
  if (!template?.id) return null;
  // Preserve an already accepted snapshot until the user chooses a revision.
  if (prior?.used && prior.snapshot?.id === template.id) return prior;
  return { used: true, snapshot: JSON.parse(JSON.stringify(template)), fingerprint: templateFingerprint(template), reviewedFingerprint: null };
}
export function needsTemplateVersionChoice(binding, latest) {
  if (!binding?.used || !binding.snapshot || !latest) return false;
  const fingerprint = templateFingerprint(latest);
  if (fingerprint === binding.fingerprint || fingerprint === binding.reviewedFingerprint) return false;
  // A binding stored (or reviewed) before answer lists joined the
  // fingerprint: same modules and the snapshot's answers unchanged is the
  // same version. Changed answers ask once; the choice then stores a full
  // fingerprint.
  const legacy = legacyFingerprint(latest);
  const sameSettings = JSON.stringify(stable(versionedSettings(binding.snapshot))) === JSON.stringify(stable(versionedSettings(latest)));
  return !((legacy === binding.fingerprint || legacy === binding.reviewedFingerprint) && sameSettings);
}
export function acceptTemplateVersion(binding, latest, useLatest) {
  return useLatest
    ? { used: true, snapshot: JSON.parse(JSON.stringify(latest)), fingerprint: templateFingerprint(latest), reviewedFingerprint: null }
    : { ...binding, reviewedFingerprint: templateFingerprint(latest) };
}

export function isRetainedSurveyTemplate(binding, active, latest) {
  return Boolean(binding?.used && active && latest && active.id === latest.id
    && templateFingerprint(active) !== templateFingerprint(latest));
}
export function isSurveyTemplateRestorationReady({ isLoadingPDF, loadFailed = false, documentId, hydration }) {
  return !isLoadingPDF && !loadFailed && (!documentId || (hydration?.ready === true && hydration.documentId === documentId));
}
export function hasSurveyTemplateMarks(template, markers = {}, annotationsByPage = {}) {
  const modules = new Set((template?.modules || template?.spaces || []).map((module) => module.id));
  return Object.values(markers || {}).some((marker) => modules.has(marker?.moduleId))
    || Object.values(annotationsByPage || {}).some((page) => (page?.objects || []).some((mark) => modules.has(mark?.moduleId)));
}
export function startSurveyTemplateObservation(template) {
  return template?.id ? { templateId: template.id, latestFingerprint: templateFingerprint(template), pendingBase: null } : null;
}
export function observeUnusedSurveyTemplateUpdate(observation, { binding, active, latest, restorationReady, hasMarks = false }) {
  if (!active) return { observation: null, update: null };
  if (!latest || active.id !== latest.id) {
    return { observation: observation?.templateId === active.id ? observation : null, update: null };
  }
  const activeFingerprint = templateFingerprint(active);
  const latestFingerprint = templateFingerprint(latest);
  if (!observation || observation.templateId !== active.id) {
    return { observation: { templateId: active.id, latestFingerprint, pendingBase: null }, update: null };
  }
  let pendingBase = observation.pendingBase;
  if (latestFingerprint !== observation.latestFingerprint) {
    // Only a shared revision changing under an unchanged selection qualifies.
    // A local draft differs from its last shared base and must stay local.
    pendingBase = activeFingerprint === observation.latestFingerprint
      ? activeFingerprint : pendingBase;
  }
  if (binding?.used || hasMarks || (pendingBase && activeFingerprint !== pendingBase)) pendingBase = null;
  const update = restorationReady && pendingBase && activeFingerprint !== latestFingerprint ? latest : null;
  return {
    observation: { templateId: active.id, latestFingerprint, pendingBase: update ? null : pendingBase },
    update,
  };
}

// Owner 2026-10-26: module order belongs to the template and is shared by the
// home Templates page and the Survey panel. A newer template that differs only
// in the ORDER of its modules is the same version in a new order: the
// document follows it without asking "keep or use latest?". Returns `active`
// with its modules in `latest`'s order, or null when anything else differs
// (or nothing does).
export function followModuleOrder(active, latest) {
  if (!active || !latest || active.id !== latest.id) return null;
  if (templateFingerprint(active) === templateFingerprint(latest)) return null;
  const modules = active.modules || active.spaces || [];
  const order = (latest.modules || latest.spaces || []).map((module) => module?.id);
  const byId = new Map(modules.map((module) => [module?.id, module]));
  if (order.length !== modules.length || byId.size !== modules.length) return null;
  const next = order.map((id) => byId.get(id));
  if (next.some((module) => !module)) return null;
  const candidate = { ...active, modules: next, ...(active.spaces ? { spaces: next } : {}) };
  return templateFingerprint(candidate) === templateFingerprint(latest) ? candidate : null;
}
