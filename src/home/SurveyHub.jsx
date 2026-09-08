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
import { useState, useEffect, lazy, Suspense, startTransition } from 'react';
import DocumentsLedger from './DocumentsLedger';
import ProjectsFolderTree from './ProjectsFolderTree';
import TemplatesEditor from './TemplatesEditor';
const ArchiveScreenContainer = lazy(() => import('./ArchiveScreenContainer'));
import ShareModal from './ShareModal';
import AccessManagementModal from './AccessManagementModal';
import { HubChromeContext, HubShell } from './HubShell';
import HubLoadingSkeletons from './HubLoadingSkeletons';
const AccountSettings = lazy(() => import('../components/AccountSettings').then(m => ({ default: m.AccountSettings })));
import LocalStorageStatus from './LocalStorageStatus.jsx';
import './hub.css';

const TAB_KEY = 'survey-hub-tab';

export default function SurveyHub({
  localDocuments = [],
  localDocumentsLoading = false,
  localDocumentsError = '',
  localDocumentBusy = false,
  onImportLocalDocument,
  onOpenLocalDocument,
  onRetryLocalDocuments,
  localRecoveryCopies = [],
  localRecoveryLoading = false,
  localRecoveryError = '',
  onRecoverLocalCopy,
  onDiscardLocalRecoveryCopy,
  onExportLocalRecoveryCopy,
  onImportLocalRecoveryBundle,
  localRecoveryNotice = '',
  localStorageStatusActive = true,
  onRetryLocalRecoveryCopies,
  onLocalDocumentsVisibilityChange,
  documents = [],
  projects = [],
  templates = [],
  documentsInitialLoading = false,
  projectsInitialLoading = false,
  templatesInitialLoading = false,
  projectPreferences = {},
  documentsLoadError = null,
  projectsLoadError = null,
  templatesLoadError = null,
  onRetryDocuments,
  onRetryProjects,
  onRetryTemplates,
  members = [],
  user = null,
  isPro = true,
  initialTab = null,
  initialMobileDetailOpen = false,
  onOpenDocument,
  onUpload,
  uploadBusy = false,
  onCreateProject,
  onRenameProject,
  onCreateTemplate,
  onDeleteProjects,
  onDuplicateProjects,
  onSaveTemplates,
  onArchiveTemplates,
  onReloadTemplates,
  /* KAL-44 — host (App.jsx) supplies this so TemplatesEditor can decide
     whether deleting a checklist item should hard-delete or trigger the
     archive confirmation flow. Pure callback: (itemId) => number. */
  getChecklistItemUsageCount,
  onDuplicateDocuments,
  onDeleteDocuments,
  onRenameDocument,
  onMoveCopyDocuments,
  onProjectPreferencesChange,
  onLockDocument,
  onSettings,
  onSignOut,
  onSignIn,
}) {
  const [tab, setTab] = useState(() => {
    if (initialTab) return initialTab;
    try { return localStorage.getItem(TAB_KEY) || 'documents'; } catch { return 'documents'; }
  });
  const [share, setShare] = useState(null); // null | { kind, name, item, manage }
  const [settingsOpen, setSettingsOpen] = useState(false); // settings page shown over the hub
  const [documentStorage, setDocumentStorage] = useState(() => user ? 'cloud' : 'local');
  useEffect(() => {
    onLocalDocumentsVisibilityChange?.(tab === 'documents' && documentStorage === 'local' && !settingsOpen);
  }, [tab, documentStorage, settingsOpen, onLocalDocumentsVisibilityChange]);
  useEffect(() => { if (!user) setDocumentStorage('local'); }, [user?.id]);

  useEffect(() => {
    try { localStorage.setItem(TAB_KEY, tab); } catch { /* storage unavailable — non-fatal */ }
  }, [tab]);

  // Documents, Projects, and Templates are primary navigation, not optional
  // features. Keep their code eager and retain the current frame while React
  // prepares the next tab so a first visit can never expose a blank shell.
  const navigateToTab = (nextTab) => {
    if (nextTab === tab) return;
    startTransition(() => setTab(nextTab));
  };

  const shareDocuments = (docs) => {
    if (!docs || !docs.length) return;
    const single = docs.length === 1 ? docs[0] : null;
    setShare({
      kind: 'document',
      name: single ? single.name : `${docs.length} documents`,
      item: single,
      // The documents table has no persisted `shared` flag. Owners always
      // enter Manage Access, which also contains the invite-new-person flow.
      // Non-owners keep the ordinary Share dialog and remain RLS-gated.
      manage: !!single && !!user?.id && single.user_id === user.id,
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

  const common = { onNav: navigateToTab, user, templatesLocked: false };
  const storageSwitch = onImportLocalDocument ? (
    <div role="group" aria-label="Document storage" style={{ display: 'flex', gap: 8, padding: '0 8px 12px', flexWrap: 'wrap' }}>
      <button type="button" className={`btn${documentStorage === 'local' ? ' primary' : ''}`}
        aria-pressed={documentStorage === 'local'} onClick={() => setDocumentStorage('local')}>On this device</button>
      <button type="button" className={`btn${documentStorage === 'cloud' ? ' primary' : ''}`}
        aria-pressed={documentStorage === 'cloud'} onClick={() => setDocumentStorage('cloud')}>Cloud</button>
    </div>
  ) : null;

  /* Clicking "Settings" in the profile menu opens the settings page as a
     full-screen view over the hub. We still forward to the parent's
     onSettings (if supplied) so host apps can observe the intent. */
  const openSettings = () => {
    if (!user) return;
    setSettingsOpen(true);
    if (onSettings) onSettings();
  };

  const HubLoadError = ({ tabName, error, onRetry }) => (
    <HubShell
      {...common}
      tab={tabName}
      title={tabName === 'projects' ? 'Projects' : tabName === 'templates' ? 'Templates' : 'Documents'}
      userName={user?.name || user?.email?.split('@')[0] || 'You'}
    >
      {tabName === 'documents' ? storageSwitch : null}
      <div role="alert" style={{ display: 'grid', placeItems: 'center', minHeight: 220, padding: 24, textAlign: 'center' }}>
        <div>
          <p style={{ margin: '0 0 12px', color: 'var(--ink-100)' }}>
            Couldn&apos;t load {tabName}. Check your connection and try again.
          </p>
          <button
            type="button"
            className="btn primary"
            onClick={() => { void Promise.resolve(onRetry?.()).catch(() => undefined); }}
            title={error || undefined}
          >Try again</button>
        </div>
      </div>
    </HubShell>
  );

  return (
    <HubChromeContext.Provider value={{ user, onSettings: openSettings, onSignOut, onSignIn }}>
      {tab === 'documents' && (
        onImportLocalDocument && documentStorage === 'local' ? (
          <HubShell {...common} tab="documents" title="Documents" subtitle="On this device"
            actions={<button type="button" className="btn primary" disabled={localDocumentBusy}
              onClick={onImportLocalDocument}>{localDocumentBusy ? 'Opening…' : 'Open local PDF'}</button>}>
            {storageSwitch}
            <section aria-label="Files on this device" className="card slim-scroll"
              style={{ margin: '0 8px 8px', padding: 16, overflow: 'auto', minHeight: 0, flex: 1 }}>
              <p style={{ margin: '0 0 16px', color: 'var(--ink-200)', fontSize: 13 }}>
                PDFs are copied into this browser or app profile. They are not uploaded or shared.
              </p>
              <LocalStorageStatus active={localStorageStatusActive} />
              {localDocumentsError ? <div role="alert" style={{ marginBottom: 16 }}>
                <p>{localDocumentsError}</p>
                <button type="button" className="btn" onClick={onRetryLocalDocuments}>Refresh local files</button>
              </div> : null}
              {localDocumentsLoading ? <p role="status">Loading local files…</p> : null}
              {!localDocumentsLoading && localDocuments.length === 0 ? <p>No local PDFs yet. Choose Open local PDF to save a copy here.</p> : null}
              <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                {localDocuments.map(row => (
                  <li key={row.localId} style={{ borderTop: '1px solid var(--ink-500)', padding: '12px 0', display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ overflowWrap: 'anywhere', color: 'var(--ink-100)' }}>{row.name}</div>
                      <div style={{ fontSize: 12, color: 'var(--ink-200)', marginTop: 4 }}>
                        On this device · {Math.ceil((Number(row.size) || 0) / 1024).toLocaleString()} KB
                      </div>
                    </div>
                    <button type="button" className="btn" disabled={localDocumentBusy}
                      aria-label={`Open ${row.name}`} onClick={() => onOpenLocalDocument?.(row)}>Open</button>
                  </li>
                ))}
              </ul>
              <section aria-label="Recovery copies" style={{ borderTop: '1px solid var(--ink-500)', marginTop: 24, paddingTop: 16 }}>
                <h2 style={{ margin: '0 0 8px', fontSize: 16 }}>Recovery copies</h2>
                <p style={{ color: 'var(--ink-200)', fontSize: 13 }}>
                  Saved session snapshots. These may already match a saved document. Recover as a separate copy to review them; the original stays unchanged.
                </p>
                {onImportLocalRecoveryBundle ? <button type="button" className="btn" disabled={localDocumentBusy} onClick={onImportLocalRecoveryBundle}>Restore recovery file</button> : null}
                {localRecoveryNotice ? <p role="status">{localRecoveryNotice}</p> : null}
                {localRecoveryError ? <div role="alert">
                  <p>{localRecoveryError}</p>
                  <button type="button" className="btn" onClick={onRetryLocalRecoveryCopies}>Refresh recovery copies</button>
                </div> : null}
                {localRecoveryLoading ? <p role="status">Loading recovery copies…</p> : null}
                {!localRecoveryLoading && localRecoveryCopies.length === 0 ? <p>No recovery copies on this device.</p> : null}
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {localRecoveryCopies.map(row => (
                    <li key={row.sessionId} style={{ borderTop: '1px solid var(--ink-500)', padding: '12px 0', display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
                      <div style={{ flex: 1, minWidth: 180 }}>
                        <div style={{ overflowWrap: 'anywhere', color: 'var(--ink-100)' }}>{row.name}</div>
                        <div style={{ fontSize: 12, color: 'var(--ink-200)', marginTop: 4 }}>
                          {new Date(row.updatedAt || row.updated_at).toLocaleString()} · {Math.ceil((Number(row.size) || 0) / 1024).toLocaleString()} KB
                        </div>
                      </div>
                      <button type="button" className="btn" disabled={localDocumentBusy}
                        aria-label={`Recover ${row.name} as copy`} onClick={() => { void onRecoverLocalCopy?.(row); }}>Recover as copy</button>
                      {onExportLocalRecoveryCopy ? <button type="button" className="btn" disabled={localDocumentBusy}
                        aria-label={`Export recovery file for ${row.name}`} onClick={() => { void onExportLocalRecoveryCopy(row); }}>Export recovery file</button> : null}
                      <button type="button" className="btn" disabled={localDocumentBusy}
                        aria-label={`Discard recovery snapshot for ${row.name}`} onClick={() => { void onDiscardLocalRecoveryCopy?.(row); }}>Discard</button>
                    </li>
                  ))}
                </ul>
              </section>
            </section>
          </HubShell>
        ) : documentsInitialLoading ? (
          onImportLocalDocument ? <HubShell {...common} tab="documents" title="Documents">
            {storageSwitch}<p role="status" style={{ padding: 16 }}>Loading cloud documents…</p>
          </HubShell> :
          <HubLoadingSkeletons {...common} tab="documents" />
        ) : documentsLoadError && documents.length === 0 ? (
          <HubLoadError tabName="documents" error={documentsLoadError} onRetry={onRetryDocuments} />
        ) : (
          <DocumentsLedger
          storageSwitch={storageSwitch}
          {...common}
          documents={documents}
          projects={projects}
          onOpenDocument={(document) => onOpenDocument?.(document, 'documents')}
          onUpload={onUpload}
          uploadBusy={uploadBusy}
          onShare={shareDocuments}
          onDuplicate={onDuplicateDocuments}
          onDelete={onDeleteDocuments}
          onRename={onRenameDocument}
          onMoveCopy={onMoveCopyDocuments}
          onLockDocument={onLockDocument}
          />
        )
      )}
      {tab === 'projects' && (
        projectsInitialLoading ? (
          <HubLoadingSkeletons {...common} tab="projects" />
        ) : projectsLoadError && projects.length === 0 ? (
          <HubLoadError tabName="projects" error={projectsLoadError} onRetry={onRetryProjects} />
        ) : (
          <ProjectsFolderTree
            {...common}
            projects={projects}
            documents={documents}
            members={members}
            initialMobileOpen={initialMobileDetailOpen}
            onOpenDocument={(document) => onOpenDocument?.(document, 'projects')}
            onCreateProject={onCreateProject}
            onRenameProject={onRenameProject}
            onUpload={onUpload}
            onDeleteProjects={onDeleteProjects}
            onDuplicateProjects={onDuplicateProjects}
            onDuplicateDocuments={onDuplicateDocuments}
            onMoveCopyDocuments={onMoveCopyDocuments}
            projectPreferences={projectPreferences}
            onProjectPreferencesChange={onProjectPreferencesChange}
            onDeleteDocuments={onDeleteDocuments}
            onRenameDocument={onRenameDocument}
            onLockDocument={onLockDocument}
            onShare={shareProject}
            onShareDocument={shareDocuments}
          />
        )
      )}
      {tab === 'templates' && (
        templatesInitialLoading ? (
          <HubLoadingSkeletons {...common} tab="templates" />
        ) : templatesLoadError && templates.length === 0 ? (
          <HubLoadError tabName="templates" error={templatesLoadError} onRetry={onRetryTemplates} />
        ) : (
          <TemplatesEditor
            {...common}
            templates={templates}
            initialMobileOpen={initialMobileDetailOpen}
            onCreateTemplate={onCreateTemplate}
            onSaveTemplates={onSaveTemplates}
            onArchiveTemplates={onArchiveTemplates}
            onReloadTemplates={onReloadTemplates}
            onShare={shareTemplate}
            getChecklistItemUsageCount={getChecklistItemUsageCount}
          />
        )
      )}

      {/* KAL-280 — Archive owns its own data: it reads the archived slice
          directly rather than filtering the hub's live lists, because those
          lists deliberately exclude archived rows. */}
      {tab === 'archive' && (
        <Suspense fallback={<HubLoadingSkeletons {...common} tab="documents" />}>
          <ArchiveScreenContainer {...common} />
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
      {settingsOpen && user && (
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
