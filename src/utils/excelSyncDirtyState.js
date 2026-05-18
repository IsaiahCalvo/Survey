const hashString = (value = '') => {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const getTemplateSyncIdentity = (template) => ({
  templateId: template?.supabaseId || template?.id || null,
  linkedExcelPath: template?.linkedExcelPath || null,
  oneDriveApiPath: template?.oneDriveApiPath || null,
  oneDriveFileId: template?.oneDriveFileId || null
});

export const computeExcelSyncFingerprint = (template, surveyMarkers = {}) => {
  const payload = {
    template: getTemplateSyncIdentity(template),
    surveyMarkers: surveyMarkers || {}
  };
  const serialized = JSON.stringify(payload);
  return {
    hash: hashString(serialized),
    serialized
  };
};

export const computeHasPendingExcelSyncChanges = ({
  template,
  surveyMarkers,
  baselineHash
}) => {
  if (!template?.linkedExcelPath) {
    return false;
  }

  if (!baselineHash) {
    return true;
  }

  const current = computeExcelSyncFingerprint(template, surveyMarkers);
  return current.hash !== baselineHash;
};
