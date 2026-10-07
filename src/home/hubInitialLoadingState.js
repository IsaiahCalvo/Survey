// Documents need projects for their project labels; Projects need documents
// for file counts. These flags are true only until each hook's first request
// settles for the current user/project scope, so a later refetch never replaces
// content and a scope switch never exposes the previous scope's rows.
//
// 2026-10-07 (phone loading), two more holds, both for the first load only:
// - `authLoading`: until the saved sign-in has been read, nobody is known to be
//   signed in or out. The lists used to settle at once as "signed out", so a
//   signed-in phone flashed the signed-out home ("No documents yet", Sign in)
//   before its own documents loaded.
// - `documentsAwaitingSync`: the documents arrived but the home's copy of the
//   list is filled one render later, which showed "No documents yet" for a
//   frame between "Loading documents…" and the rows.
export function resolveHubInitialLoading({
  documentsInitialLoading,
  projectsInitialLoading,
  templatesInitialLoading,
  authLoading = false,
  documentsAwaitingSync = false,
}) {
  const documentsLoading = documentsInitialLoading || documentsAwaitingSync;
  return {
    documents: authLoading || documentsLoading || projectsInitialLoading,
    projects: authLoading || projectsInitialLoading || documentsLoading,
    templates: authLoading || templatesInitialLoading,
  };
}
