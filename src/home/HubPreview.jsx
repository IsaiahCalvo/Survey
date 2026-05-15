/* DEV-ONLY preview harness for the Survey Hub redesign.
   Mounted by main.jsx when the URL has `?hubPreview=1`, so the new home can be
   built and reviewed in isolation without auth, Supabase, or the real App tree.
   Never imported in production paths. Mock data mirrors the real document /
   project / template shapes. */
import React from 'react';
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

const MOCK_DOCUMENTS = [
  { id: 'd1', name: 'SE-011 Security Shop Drawings.pdf', file_size: 25_050_000, project_id: 'p1', created_at: iso(9), updated_at: iso(2, 9, 14), shared: false },
  { id: 'd2', name: 'Package 2 — Rev 4 — IC.pdf', file_size: 7_930_000, project_id: null, created_at: iso(8), updated_at: iso(1, 16, 48), shared: true },
  { id: 'd3', name: 'RFI-014 Lobby Camera Coverage.pdf', file_size: 1_820_000, project_id: 'p1', created_at: iso(1), updated_at: iso(0, 11, 2), shared: false },
  { id: 'd4', name: 'Door Hardware Schedule — A.601.pdf', file_size: 3_400_000, project_id: 'p2', created_at: iso(15), updated_at: iso(15, 17, 25), shared: false },
  { id: 'd5', name: 'MEP Coordination — Level 3.pdf', file_size: 12_400_000, project_id: 'p3', created_at: iso(5), updated_at: iso(1, 10, 6), shared: true },
  { id: 'd6', name: 'test.pdf', file_size: 2_400, project_id: null, created_at: iso(12), updated_at: iso(5, 13, 51), shared: false },
];

const MOCK_TEMPLATES = [
  { id: 't1', name: 'Security Walk-Through', created_at: iso(28) },
  { id: 't2', name: 'MEP As-Built Markup', created_at: iso(22) },
];

export default function HubPreview() {
  return (
    <div style={{ width: '100vw', height: '100vh' }}>
      <SurveyHub
        documents={MOCK_DOCUMENTS}
        projects={MOCK_PROJECTS}
        templates={MOCK_TEMPLATES}
        user={{ name: 'Isaiah Calvo', email: 'isaiahcalvo123@gmail.com' }}
        isPro
        onOpenDocument={(d) => console.log('[hub preview] open document:', d.name)}
        onUpload={() => console.log('[hub preview] upload')}
        onShare={(items) => console.log('[hub preview] share:', items.map((i) => i.name))}
      />
    </div>
  );
}
