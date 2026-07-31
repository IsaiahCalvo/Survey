// Documents need projects for their project labels; Projects need documents
// for file counts. These flags are true only until each hook's first request
// settles for the current user/project scope, so a later refetch never replaces
// content and a scope switch never exposes the previous scope's rows.
export function resolveHubInitialLoading({
  documentsInitialLoading,
  projectsInitialLoading,
  templatesInitialLoading,
}) {
  return {
    documents: documentsInitialLoading || projectsInitialLoading,
    projects: projectsInitialLoading || documentsInitialLoading,
    templates: templatesInitialLoading,
  };
}
