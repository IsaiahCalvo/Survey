// A share link (/?docId=) opens its document from the one row it names, so the
// open no longer waits for the whole library list (owned + shared queries).

// The library's row shape (Dashboard formats Supabase rows the same way).
export function formatLibraryDocument(doc) {
  return {
    ...doc,
    id: doc.id,
    name: doc.name,
    size: doc.file_size || 0,
    uploadedAt: doc.created_at || doc.updated_at,
    type: 'application/pdf',
    filePath: doc.file_path,
    projectId: doc.project_id,
    cutoverCompletedAt: doc.cutover_completed_at || null,
  };
}

// The row the library would list for this user, or null when it would not
// list it (archived, not theirs and not shared with them, or unreadable).
export async function fetchLinkedDocumentRow(supabase, { userId, documentId }) {
  if (!supabase || !userId || !documentId) return null;
  const [docRes, roleRes] = await Promise.all([
    supabase
      .from('documents')
      .select('*')
      .eq('id', documentId)
      .eq('archived', false)
      .is('user_archived_at', null)
      .maybeSingle(),
    supabase
      .from('document_collaborators')
      .select('role')
      .eq('document_id', documentId)
      .eq('user_id', userId)
      .eq('status', 'active')
      .maybeSingle(),
  ]);
  const doc = docRes?.data;
  if (docRes?.error || !doc) return null;
  const role = roleRes?.error ? null : roleRes?.data?.role || null;
  if (doc.user_id !== userId && !role) return null;
  return formatLibraryDocument(role && doc.user_id !== userId ? { ...doc, my_role: role } : doc);
}
