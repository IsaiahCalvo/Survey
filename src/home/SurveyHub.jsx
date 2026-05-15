/* Survey Hub — top-level home redesign component.
   Owns the active tab and renders the shared shell. Each tab body is its own
   component; until a tab is built it shows a lightweight placeholder so the
   surrounding chrome can be developed and reviewed independently.

   Props (all optional so the hub renders standalone for development):
     documents  — array of the user's documents
     projects   — array of the user's projects
     templates  — array of the user's templates
     user       — { name } for the sidebar identity row
     isPro      — gates the Templates tab (matches current app behavior)
     onOpenDocument(doc)   — open a document in the PDF viewer
*/
import React, { useState, useEffect } from 'react';
import { HubShell } from './HubShell';
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
}) {
  const [tab, setTab] = useState(() => {
    try { return localStorage.getItem(TAB_KEY) || 'documents'; } catch { return 'documents'; }
  });

  // If Templates is gated and somehow active, fall back to Documents.
  useEffect(() => {
    if (tab === 'templates' && !isPro) setTab('documents');
  }, [tab, isPro]);

  useEffect(() => {
    try { localStorage.setItem(TAB_KEY, tab); } catch { /* storage unavailable — non-fatal */ }
  }, [tab]);

  const userName = user?.name || user?.email?.split('@')[0] || 'You';

  const titles = { documents: 'Documents', projects: 'Projects', templates: 'Templates' };
  const subtitles = {
    documents: <span><b>{documents.length}</b> {documents.length === 1 ? 'file' : 'files'}</span>,
    projects: <span><b>{projects.length}</b> {projects.length === 1 ? 'project' : 'projects'}</span>,
    templates: <span><b>{templates.length}</b> {templates.length === 1 ? 'template' : 'templates'}</span>,
  };

  return (
    <HubShell
      tab={tab}
      onNav={setTab}
      title={titles[tab]}
      subtitle={subtitles[tab]}
      userName={userName}
      templatesLocked={!isPro}
    >
      {tab === 'documents' && <Placeholder label="Documents" />}
      {tab === 'projects' && <Placeholder label="Projects" />}
      {tab === 'templates' && <Placeholder label="Templates" />}
    </HubShell>
  );
}
