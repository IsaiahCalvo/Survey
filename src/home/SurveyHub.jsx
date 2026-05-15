/* Survey Hub — top-level home redesign component.
   Owns the active tab and renders the shared shell. Each tab body is its own
   component; tabs not yet built show a lightweight placeholder so the
   surrounding chrome can be developed and reviewed independently.

   Props (all optional so the hub renders standalone for development):
     documents  — array of the user's documents
     projects   — array of the user's projects
     templates  — array of the user's templates
     user       — { name, email } for the sidebar identity row
     isPro      — gates the Templates tab (matches current app behavior)
     onOpenDocument(doc)   — open a document in the PDF viewer
     onUpload()            — start the upload flow
     onShare(items)        — open the share popup for the given items
*/
import React, { useState, useEffect } from 'react';
import { HubShell, Search, Icon } from './HubShell';
import DocumentsLedger from './DocumentsLedger';
import './hub.css';

const TAB_KEY = 'survey-hub-tab';

const Placeholder = ({ label }) => (
  <div style={{ flex: 1, display: 'grid', placeItems: 'center', color: 'var(--ink-200)', fontSize: 13 }}>
    {label} — coming together next.
  </div>
);

export default function SurveyHub({
  documents = [],
  projects = [],
  templates = [],
  user = null,
  isPro = true,
  onOpenDocument,
  onUpload,
  onShare,
}) {
  const [tab, setTab] = useState(() => {
    try { return localStorage.getItem(TAB_KEY) || 'documents'; } catch { return 'documents'; }
  });
  const [search, setSearch] = useState('');

  // If Templates is gated and somehow active, fall back to Documents.
  useEffect(() => {
    if (tab === 'templates' && !isPro) setTab('documents');
  }, [tab, isPro]);

  useEffect(() => {
    try { localStorage.setItem(TAB_KEY, tab); } catch { /* storage unavailable — non-fatal */ }
  }, [tab]);

  // Search is per-tab context; clear it when switching tabs.
  const navTo = (next) => { setSearch(''); setTab(next); };

  const userName = user?.name || user?.email?.split('@')[0] || 'You';

  const titles = { documents: 'Documents', projects: 'Projects', templates: 'Templates' };
  const subtitles = {
    documents: <span><b>{documents.length}</b> {documents.length === 1 ? 'file' : 'files'}</span>,
    projects: <span><b>{projects.length}</b> {projects.length === 1 ? 'project' : 'projects'}</span>,
    templates: <span><b>{templates.length}</b> {templates.length === 1 ? 'template' : 'templates'}</span>,
  };

  const placeholders = {
    documents: 'Search Documents...',
    projects: 'Search Projects...',
    templates: 'Search Templates...',
  };

  const actions = (
    <>
      <Search placeholder={placeholders[tab]} value={search} onChange={setSearch} />
      {tab === 'documents' && (
        <button className="btn primary" onClick={() => onUpload && onUpload()}>
          <Icon name="upload" size={12} />Upload
        </button>
      )}
    </>
  );

  return (
    <HubShell
      tab={tab}
      onNav={navTo}
      title={titles[tab]}
      subtitle={subtitles[tab]}
      actions={actions}
      userName={userName}
      templatesLocked={!isPro}
    >
      {tab === 'documents' && (
        <DocumentsLedger
          documents={documents}
          projects={projects}
          search={search}
          onOpenDocument={onOpenDocument}
          onShare={onShare}
        />
      )}
      {tab === 'projects' && <Placeholder label="Projects" />}
      {tab === 'templates' && <Placeholder label="Templates" />}
    </HubShell>
  );
}
