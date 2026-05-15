/* Survey Hub — top-level home redesign component.
   Thin router: owns the active tab and the share popup, and renders the active
   tab component. Each tab component renders its own shell (sidebar + header),
   mirroring the Claude Design prototype where every layout owns its shell.

   Props (all optional so the hub renders standalone for development):
     documents  — array of the user's documents
     projects   — array of the user's projects
     templates  — array of the user's templates
     user       — { name, email } for the sidebar identity row
     isPro      — gates the Templates tab (matches current app behavior)
     onOpenDocument(doc)   — open a document in the PDF viewer
     onUpload()            — start the upload flow
     onCreateProject()     — start the new-project flow
     onCreateTemplate()    — start the new-template flow
*/
import React, { useState, useEffect } from 'react';
import DocumentsLedger from './DocumentsLedger';
import ProjectsFolderTree from './ProjectsFolderTree';
import TemplatesEditor from './TemplatesEditor';
import ShareModal from './ShareModal';
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
  onOpenDocument,
  onUpload,
  onCreateProject,
  onCreateTemplate,
  onDuplicateDocuments,
  onDeleteDocuments,
  onMoveCopyDocuments,
}) {
  const [tab, setTab] = useState(() => {
    if (initialTab) return initialTab;
    try { return localStorage.getItem(TAB_KEY) || 'documents'; } catch { return 'documents'; }
  });
  const [share, setShare] = useState(null); // null | { kind, name }

  useEffect(() => {
    if (tab === 'templates' && !isPro) setTab('documents');
  }, [tab, isPro]);

  useEffect(() => {
    try { localStorage.setItem(TAB_KEY, tab); } catch { /* storage unavailable — non-fatal */ }
  }, [tab]);

  const shareDocuments = (docs) => {
    if (!docs || !docs.length) return;
    setShare({ kind: 'document', name: docs.length === 1 ? docs[0].name : `${docs.length} documents` });
  };
  const shareProject = (project) => {
    if (project) setShare({ kind: 'project', name: project.name });
  };

  const common = { onNav: setTab, user, templatesLocked: !isPro };

  return (
    <>
      {tab === 'documents' && (
        <DocumentsLedger
          {...common}
          documents={documents}
          projects={projects}
          onOpenDocument={onOpenDocument}
          onUpload={onUpload}
          onShare={shareDocuments}
          onDuplicate={onDuplicateDocuments}
          onDelete={onDeleteDocuments}
          onMoveCopy={onMoveCopyDocuments}
        />
      )}
      {tab === 'projects' && (
        <ProjectsFolderTree
          {...common}
          projects={projects}
          documents={documents}
          members={members}
          onOpenDocument={onOpenDocument}
          onCreateProject={onCreateProject}
          onShare={shareProject}
        />
      )}
      {tab === 'templates' && (
        <TemplatesEditor
          {...common}
          templates={templates}
          onCreateTemplate={onCreateTemplate}
        />
      )}

      <ShareModal
        open={!!share}
        kind={share?.kind}
        name={share?.name}
        onClose={() => setShare(null)}
      />
    </>
  );
}
