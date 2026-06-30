import type { Entity, SurveyModule, SurveyTemplate, RegionConfig, SpaceConfig } from '@survey/shared';
import type { BookmarkEntry } from '../types';

export const entities: Entity[] = [
  { id: 'my-company', name: 'My Company', color: '#CBDCFF' },
  { id: 'sub', name: 'Subcontractor', color: '#FFF5C3' },
  { id: 'gc', name: 'GC', color: '#E3D1FB' },
  { id: 'complete', name: '100% Complete', color: '#B2FFB2' },
];

export const surveyModules: SurveyModule[] = [
  {
    id: 'install',
    name: 'Install',
    categories: [
      {
        id: 'camera-install',
        name: 'Cameras',
        checklist: [
          { id: 'cable-pulled', text: 'Cable pulled' },
          { id: 'camera-installed', text: 'Camera installed' },
          { id: 'aimed-focused', text: 'Aimed and focused' },
          { id: 'mounted-plan-location', text: 'Mounted at plan location' },
        ],
      },
      {
        id: 'door-install',
        name: 'Doors',
        checklist: [
          { id: 'reader-wired', text: 'Reader wired' },
          { id: 'lock-installed', text: 'Lock installed' },
          { id: 'door-contact-landed', text: 'Door contact landed' },
          { id: 'cable-labeled', text: 'Cable labeled' },
        ],
      },
      {
        id: 'headend-install',
        name: 'Headend',
        checklist: [
          { id: 'panel-mounted', text: 'Panel mounted' },
          { id: 'power-landed', text: 'Power landed' },
          { id: 'network-patched', text: 'Network patched' },
          { id: 'enclosure-labeled', text: 'Enclosure labeled' },
        ],
      },
    ],
  },
  {
    id: 'commission',
    name: 'Commission',
    categories: [
      {
        id: 'camera-commission',
        name: 'Cameras',
        checklist: [
          { id: 'online-vms', text: 'Online in VMS' },
          { id: 'recording-confirmed', text: 'Recording confirmed' },
          { id: 'view-named', text: 'View named correctly' },
          { id: 'customer-signoff', text: 'Customer sign-off captured' },
          { id: 'aim-accepted', text: 'Aim accepted' },
        ],
      },
      {
        id: 'door-commission',
        name: 'Doors',
        checklist: [
          { id: 'unlock-tested', text: 'Unlock tested' },
          { id: 'forced-open-tested', text: 'Forced-open alarm tested' },
          { id: 'access-level-verified', text: 'Access level verified' },
          { id: 'rex-tested', text: 'Rex tested' },
        ],
      },
      {
        id: 'headend-commission',
        name: 'Headend',
        checklist: [
          { id: 'controller-online', text: 'Controller online' },
          { id: 'backup-confirmed', text: 'Backup confirmed' },
          { id: 'time-sync-verified', text: 'Time sync verified' },
        ],
      },
    ],
  },
];

export const surveyTemplates: SurveyTemplate[] = [
  {
    id: 'security-field-survey',
    name: 'Security Field Survey',
    modules: surveyModules,
    entities,
  },
  {
    id: 'closeout-survey',
    name: 'Closeout Punch Survey',
    modules: surveyModules,
    entities,
  },
];

export const importedPdfBookmarks: BookmarkEntry[] = [
  { id: 'outline-floor-1', title: 'Floor 1', page: 1, type: 'folder', depth: 0, order: 0, sourceId: 'pdf-outline:floor-1' },
  { id: 'outline-customer-area', title: 'Customer area', page: 1, type: 'bookmark', parentId: 'outline-floor-1', depth: 1, order: 1, sourceId: 'pdf-outline:customer-area' },
  { id: 'outline-idf', title: 'IDF', page: 1, type: 'bookmark', parentId: 'outline-floor-1', depth: 1, order: 2, sourceId: 'pdf-outline:idf' },
  { id: 'outline-floor-2', title: 'Floor 2', page: 2, type: 'bookmark', depth: 0, order: 3, sourceId: 'pdf-outline:floor-2' },
];

export const initialSpaces: SpaceConfig[] = [
  {
    id: 'space-floors-1-5',
    name: 'Floors 1-5',
    pages: [1, 2],
    expanded: true,
    regions: [
      {
        id: 'region-floor-1-customer',
        name: 'Floor 1 - Customer area',
        page: 1,
        bounds: { x: 0.17, y: 0.2, width: 0.52, height: 0.31 },
        surveyBound: true,
        showCanvasAnnotations: false,
        showSurveyAnnotations: true,
      },
    ],
  },
];
