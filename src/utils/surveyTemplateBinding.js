const PREFIX = 'survey:templateBinding:';
const stable = (value) => Array.isArray(value) ? value.map(stable) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().filter((key) => value[key] !== undefined && typeof value[key] !== 'function').map((key) => [key, stable(value[key])])) : value;
export function templateFingerprint(template) {
  return JSON.stringify(stable({ name: template?.name, modules: template?.modules || template?.spaces || [], entities: template?.entities || [] }));
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
  return fingerprint !== binding.fingerprint && fingerprint !== binding.reviewedFingerprint;
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
export function observeUnusedSurveyTemplateUpdate(observation, { binding, active, latest, restorationReady, hasMarks = false }) {
  if (!active || !latest || active.id !== latest.id) return { observation: null, update: null };
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
