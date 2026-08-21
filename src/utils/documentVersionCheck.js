export class DocumentVersionConflictError extends Error {
  constructor(message, details = null) {
    super(message);
    this.name = 'DocumentVersionConflictError';
    this.code = 'document-version-conflict';
    this.details = details;
  }
}

export function assertDocumentVersionMatch({ expectedUpdatedAt, remoteUpdatedAt } = {}) {
  if (expectedUpdatedAt == null || expectedUpdatedAt === '') {
    return { ok: true };
  }
  if (remoteUpdatedAt == null || remoteUpdatedAt === '') {
    return { ok: true };
  }
  if (String(expectedUpdatedAt) === String(remoteUpdatedAt)) {
    return { ok: true };
  }
  return {
    ok: false,
    error: new DocumentVersionConflictError(
      'Document changed remotely. Reload before saving.',
      { expectedUpdatedAt, remoteUpdatedAt },
    ),
  };
}
