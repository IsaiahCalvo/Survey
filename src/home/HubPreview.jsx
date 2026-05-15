/* DEV-ONLY preview harness for the Survey Hub redesign.
   Mounted by main.jsx when the URL has `?hubPreview=1`, so the new home can be
   built and reviewed in isolation without auth, Supabase, or the real App tree.
   Never imported in production paths. Mock data mirrors the real document /
   project / template shapes, and the bulk-action handlers run on local state
   so duplicate / move / copy / delete are demonstrable here. */
import React, { useState } from 'react';
import SurveyHub from './SurveyHub';

const iso = (daysAgo, h = 10, m = 0) => {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};

const MOCK_PROJECTS = [
  { id: 'p1', name: 'Tower 5 — Security', user_id: 'u1', created_at: iso(40) },
  { id: 'p2', name: 'Lab Reno — MEP', user_id: 'u1', created_at: iso(30) },
  { id: 'p3', name: 'MEP Phase 2', user_id: 'u1', created_at: iso(20) },
];

const INITIAL_DOCUMENTS = [
  { id: 'd1', name: 'SE-011 Security Shop Drawings.pdf', file_size: 25_050_000, project_id: 'p1', created_at: iso(9), updated_at: iso(2, 9, 14), shared: false },
  { id: 'd2', name: 'Package 2 — Rev 4 — IC.pdf', file_size: 7_930_000, project_id: null, created_at: iso(8), updated_at: iso(1, 16, 48), shared: true },
  { id: 'd3', name: 'RFI-014 Lobby Camera Coverage.pdf', file_size: 1_820_000, project_id: 'p1', created_at: iso(1), updated_at: iso(0, 11, 2), shared: false },
  { id: 'd4', name: 'Door Hardware Schedule — A.601.pdf', file_size: 3_400_000, project_id: 'p2', created_at: iso(15), updated_at: iso(15, 17, 25), shared: false },
  { id: 'd5', name: 'MEP Coordination — Level 3.pdf', file_size: 12_400_000, project_id: 'p3', created_at: iso(5), updated_at: iso(1, 10, 6), shared: true },
  { id: 'd6', name: 'test.pdf', file_size: 2_400, project_id: null, created_at: iso(12), updated_at: iso(5, 13, 51), shared: false },
];

const MOCK_TEMPLATES = [
  {
    id: 't1', name: 'Security Walk-Through', created_at: iso(28),
    ballInCourtEntities: [
      { id: 'e1', name: 'GC', color: 'rgba(216,168,78,0.5)' },
      { id: 'e2', name: 'Subcontractor', color: 'rgba(122,183,230,0.5)' },
      { id: 'e3', name: '100% Complete', color: 'rgba(166,224,122,0.5)' },
    ],
    modules: [
      {
        id: 'm1', name: 'Installation Phase',
        categories: [
          { id: 'c1', name: 'Cameras', checklist: [
            { id: 'i1', text: 'Is the camera cable pulled?' },
            { id: 'i2', text: 'Is the camera installed?' },
          ] },
          { id: 'c2', name: 'Doors', checklist: [
            { id: 'i3', text: 'Is the door roughed in?' },
            { id: 'i4', text: 'Are the door devices installed?' },
          ] },
        ],
      },
      { id: 'm2', name: 'Commissioning Phase', categories: [
        { id: 'c3', name: 'Cameras', checklist: [{ id: 'i5', text: 'Camera tested and online?' }] },
      ] },
    ],
  },
  {
    id: 't2', name: 'MEP As-Built Markup', created_at: iso(22),
    ballInCourtEntities: [
      { id: 'e4', name: 'MEP', color: 'rgba(122,183,230,0.5)' },
      { id: 'e5', name: 'Architect', color: 'rgba(194,147,230,0.5)' },
    ],
    modules: [
      { id: 'm3', name: 'Equipment', categories: [
        { id: 'c4', name: 'AHU Equipment', checklist: [{ id: 'i6', text: 'Tags updated?' }] },
      ] },
    ],
  },
];

/* Append "-copy" before the file extension. */
const copyName = (name = '') => {
  const dot = name.lastIndexOf('.');
  return dot > 0 ? `${name.slice(0, dot)}-copy${name.slice(dot)}` : `${name}-copy`;
};
let copyCounter = 0;
const newId = () => `d-copy-${Date.now()}-${copyCounter++}`;

export default function HubPreview() {
  const [documents, setDocuments] = useState(INITIAL_DOCUMENTS);

  // Duplicate: a copy of each, named "<name>-copy", marked just-edited.
  const handleDuplicate = (docs) => {
    const copies = docs.map((d) => ({ ...d, id: newId(), name: copyName(d.name), updated_at: new Date().toISOString() }));
    setDocuments((prev) => [...copies, ...prev]);
  };

  // Delete: drop the documents from the list.
  const handleDelete = (docs) => {
    const ids = new Set(docs.map((d) => d.id));
    setDocuments((prev) => prev.filter((d) => !ids.has(d.id)));
  };

  // Move: reassign the documents to the destination project.
  // Copy: add copies that live in the destination project, originals untouched.
  const handleMoveCopy = (docs, projectId, mode) => {
    const ids = new Set(docs.map((d) => d.id));
    if (mode === 'move') {
      setDocuments((prev) => prev.map((d) => (ids.has(d.id) ? { ...d, project_id: projectId } : d)));
    } else {
      const copies = docs.map((d) => ({ ...d, id: newId(), project_id: projectId, updated_at: new Date().toISOString() }));
      setDocuments((prev) => [...copies, ...prev]);
    }
  };

  const initialTab = new URLSearchParams(window.location.search).get('tab');

  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <SurveyHub
        documents={documents}
        projects={MOCK_PROJECTS}
        templates={MOCK_TEMPLATES}
        user={{ name: 'Isaiah Calvo', email: 'isaiahcalvo123@gmail.com' }}
        isPro
        initialTab={initialTab}
        onOpenDocument={(d) => console.log('[hub preview] open document:', d.name)}
        onUpload={() => console.log('[hub preview] upload')}
        onCreateProject={() => console.log('[hub preview] new project')}
        onCreateTemplate={() => console.log('[hub preview] new template')}
        onDuplicateDocuments={handleDuplicate}
        onDeleteDocuments={handleDelete}
        onMoveCopyDocuments={handleMoveCopy}
      />
    </div>
  );
}
