// Shared Supabase storage / row error classifiers.
//
// Extracted from App.jsx so they can be reused by components that are being
// lifted out of the monolith (e.g. PDFThumbnail, Dashboard) without those
// components having to import back into App.jsx. Both functions are pure —
// no side effects, no module state.

export const isStorageFileNotFoundError = (error) => {
  // 404 is always "not found".
  if (error?.status === 404 || error?.statusCode === 404) return true;

  const errorDetails = [
    error?.message,
    error?.error_description,
    error?.details,
    error?.hint
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  const mentionsNotFound = (
    errorDetails.includes('not found') ||
    errorDetails.includes('object not found') ||
    errorDetails.includes('resource was not found') ||
    errorDetails.includes('no such object')
  );

  // Supabase storage may use HTTP 400 for missing objects; require explicit not-found text.
  if ((error?.status === 400 || error?.statusCode === 400) && mentionsNotFound) {
    return true;
  }

  // Check error name (Supabase uses StorageUnknownError for missing files)
  const errorName = error?.name?.toLowerCase() || error?.constructor?.name?.toLowerCase() || '';
  if ((errorName.includes('storageunknownerror') || errorName.includes('storageapierror')) && mentionsNotFound) {
    return true;
  }

  // Check stringified error (fallback) for explicit not-found wording only.
  try {
    const errorStr = String(error).toLowerCase();
    if (errorStr.includes('not found') || errorStr.includes('resource was not found') || errorStr.includes('object not found')) {
      return true;
    }
  } catch { }

  return false;
};

export const isSupabaseRowNotFoundError = (error) => {
  if (!error) return false;

  const code = String(error.code || '').toUpperCase();
  if (code === 'PGRST116') return true;

  if (error.status === 404 || error.statusCode === 404) return true;

  const message = String(error.message || '').toLowerCase();
  if (message.includes('no rows') || message.includes('not found')) return true;

  return false;
};
