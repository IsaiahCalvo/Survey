// Shared fixtures for the signed-in E2E suite: the seeded accounts, project and
// document. scripts/e2e-local-supabase.mjs seeds exactly these; specs import
// them. LOCAL STACK ONLY — these passwords are public and must never exist on a
// real project.

export const E2E_BASE_URL = 'http://127.0.0.1:5199';

const PASSWORD = 'E2e-local-only-123!';

export const E2E_ACCOUNTS = {
  free: {
    email: 'e2e-free@example.com', password: PASSWORD, tier: 'free',
    firstName: 'Fran', lastName: 'Free', label: 'Fran Free',
  },
  pro: {
    email: 'e2e-pro@example.com', password: PASSWORD, tier: 'pro',
    firstName: 'Priya', lastName: 'Pro', label: 'Priya Pro',
  },
  owner: {
    email: 'e2e-owner@example.com', password: PASSWORD, tier: 'pro',
    firstName: 'Olive', lastName: 'Owner', label: 'Olive Owner',
  },
  editor: {
    email: 'e2e-editor@example.com', password: PASSWORD, tier: 'free', role: 'editor',
    firstName: 'Eddie', lastName: 'Editor', label: 'Eddie Editor',
  },
  viewer: {
    email: 'e2e-viewer@example.com', password: PASSWORD, tier: 'free', role: 'viewer',
    firstName: 'Vera', lastName: 'Viewer', label: 'Vera Viewer',
  },
};

// Fixed ids so seeding is idempotent and specs can address rows directly.
export const E2E_PROJECT = {
  id: 'e2e00000-0000-4000-8000-000000000001',
  name: 'E2E Sample Project',
};

export const E2E_DOCUMENT = {
  id: 'e2e00000-0000-4000-8000-000000000101',
  name: 'E2E Sample Drawing.pdf',
  fixture: 'debug/fixtures/clickable-link-test.pdf',
  pageCount: 1,
};

// A survey for voice and agent walks, on its own drawing so no other spec sees
// its marker: template "E2E Doors" with one Installation module, and item
// D-1-17 on page 1. The fake Groq (scripts/e2e-fake-groq.mjs) hears
// "D-1-17 is installed" and sets every line of it.
export const E2E_SURVEY = {
  documentId: 'e2e00000-0000-4000-8000-000000000102',
  documentName: 'E2E Survey Agent Drawing.pdf',
  templateId: 'e2e00000-0000-4000-8000-000000000201',
  templateName: 'E2E Doors',
  moduleId: 'e2e-mod-install',
  moduleName: 'Installation',
  categoryId: 'e2e-cat-door',
  categoryName: 'Door',
  checklist: [
    { id: 'e2e-cl-cable', text: 'Cables Pulled' },
    { id: 'e2e-cl-frame', text: 'Frame Installed & Prepped' },
    { id: 'e2e-cl-door', text: 'Door Installed & Prepped' },
  ],
  markerId: 'surveyMarker-e2e-d117',
  itemName: 'D-1-17',
};
