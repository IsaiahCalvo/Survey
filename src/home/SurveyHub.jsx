/* Survey Hub — top-level home redesign component.
   Thin router: owns the active tab and the share popup, and renders the active
   tab component. Each tab component renders its own shell (sidebar + header),
   mirroring the Claude Design prototype where every layout owns its shell.

   Props (all optional so the hub renders standalone for development):
     documents  — array of the user's documents
     projects   — array of the user's projects
     templates  — array of the user's templates
     user       — { name, email } for the sidebar identity row
     isPro      — legacy prop; templates now stay visible in the hub
     onOpenDocument(doc)   — open a document in the PDF viewer
     onUpload()            — start the upload flow
     onCreateProject()     — start the new-project flow
     onCreateTemplate()    — start the new-template flow
*/
import { useState, useEffect, lazy, Suspense } from 'react';
import DocumentsLedger from './DocumentsLedger';
const ProjectsFolderTree = lazy(() => import('./ProjectsFolderTree'));
const TemplatesEditor = lazy(() => import('./TemplatesEditor'));
import ShareModal from './ShareModal';
import AccessManagementModal from './AccessManagementModal';
import { HubChromeContext } from './HubShell';
const AccountSettings = lazy(() => import('../components/AccountSettings').then(m => ({ default: m.AccountSettings })));
import './hub.css';

const TAB_KEY = 'survey-hub-tab';

export default function SurveyHub({
  documents = [],
  projects = [],
  templates = [],
  members = [],
  user = null,
  isPro = true,
  initialTab = null,
  initialMobileDetailOpen = false,
  onOpenDocument,
  onUpload,
  onCreateProject,
  onCreateTemplate,
  onDeleteProjects,
  onSaveTemplates,
  /* KAL-44 — host (App.jsx) supplies this so TemplatesEditor can decide
     whether deleting a checklist item should hard-delete or trigger the
     archive confirmation flow. Pure callback: (itemId) => number. */
  getChecklistItemUsageCount,
  onDuplicateDocuments,
  onDeleteDocuments,
  onMoveCopyDocuments,
  onLockDocument,
  onSettings,
  onSignOut,
}) {
  const [tab, setTab] = useState(() => {
    if (initialTab) return initialTab;
    try { return localStorage.getItem(TAB_KEY) || 'documents'; } catch { return 'documents'; }
  });
  const [share, setShare] = useState(null); // null | { kind, name, item, manage }
  const [settingsOpen, setSettingsOpen] = useState(false); // settings page shown over the hub

  useEffect(() => {
    try { localStorage.setItem(TAB_KEY, tab); } catch { /* storage unavailable — non-fatal */ }
  }, [tab]);

  const shareDocuments = (docs) => {
    if (!docs || !docs.length) return;
    const single = docs.length === 1 ? docs[0] : null;
    setShare({
      kind: 'document',
      name: single ? single.name : `${docs.length} documents`,
      item: single,
      manage: !!single?.shared,
    });
  };
  const shareProject = (project) => {
    if (project) setShare({ kind: 'project', name: project.name, item: project, manage: false });
  };
  const shareTemplate = (template) => {
    // manage:false always — AccessManagementModal is document-only; template
    // sharing goes through ShareModal (project/template invites are live).
    if (template) setShare({ kind: 'template', name: template.name, item: template, manage: false });
  };

  const common = { onNav: setTab, user, templatesLocked: false };

  /* Clicking "Settings" in the profile menu opens the settings page as a
     full-screen view over the hub. We still forward to the parent's
     onSettings (if supplied) so host apps can observe the intent. */
  const openSettings = () => {
    setSettingsOpen(true);
    if (onSettings) onSettings();
  };

  return (
    <HubChromeContext.Provider value={{ user, onSettings: openSettings, onSignOut }}>
      {tab === 'documents' && (
        <DocumentsLedger
          {...common}
          documents={documents}
          projects={projects}
          onOpenDocument={(document) => onOpenDocument?.(document, 'documents')}
          onUpload={onUpload}
          onShare={shareDocuments}
          onDuplicate={onDuplicateDocuments}
          onDelete={onDeleteDocuments}
          onMoveCopy={onMoveCopyDocuments}
          onLockDocument={onLockDocument}
        />
      )}
      {tab === 'projects' && (
        <Suspense fallback={null}>
          <ProjectsFolderTree
            {...common}
            projects={projects}
            documents={documents}
            members={members}
            initialMobileOpen={initialMobileDetailOpen}
            onOpenDocument={(document) => onOpenDocument?.(document, 'projects')}
            onCreateProject={onCreateProject}
            onUpload={onUpload}
            onDeleteProjects={onDeleteProjects}
            onDeleteDocuments={onDeleteDocuments}
            onLockDocument={onLockDocument}
            onShare={shareProject}
            onShareDocument={shareDocuments}
          />
        </Suspense>
      )}
      {tab === 'templates' && (
        <Suspense fallback={null}>
          <TemplatesEditor
            {...common}
            templates={templates}
            initialMobileOpen={initialMobileDetailOpen}
            onCreateTemplate={onCreateTemplate}
            onSaveTemplates={onSaveTemplates}
            onShare={shareTemplate}
            getChecklistItemUsageCount={getChecklistItemUsageCount}
          />
        </Suspense>
      )}

      <ShareModal
        open={!!share && !share.manage}
        kind={share?.kind}
        name={share?.name}
        item={share?.item}
        onClose={() => setShare(null)}
      />

      <AccessManagementModal
        open={!!share?.manage}
        kind={share?.kind}
        item={share?.item}
        user={user}
        onClose={() => setShare(null)}
      />

      {/* Settings page — shown full-screen over the hub. AccountSettings
          renders its own fixed overlay with a close (×) button in its
          header, which is the way back to the hub. */}
      {settingsOpen && (
        <Suspense fallback={null}>
          <AccountSettings
            isOpen
            onClose={() => setSettingsOpen(false)}
          />
        </Suspense>
      )}
    </HubChromeContext.Provider>
  );
}
