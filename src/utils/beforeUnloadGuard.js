export function shouldWarnBeforeUnloadForTab(tab) {
  if (!tab || tab.isHome || !tab.file) return false;
  if (tab.file.id) return false;
  return tab.hasUnsavedAnnotations === true;
}
