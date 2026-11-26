import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  PROJECT_WALKS_EVENT,
  announceProjectWalks,
  listProjectWalks,
  recordProjectWalk,
} from '../src/suite/projectWalks.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('#1600: SurveyHub forwards walkthruTabOn from Dashboard into ProjectsFolderTree', () => {
  const dash = read('src/Dashboard.jsx');
  const hub = read('src/home/SurveyHub.jsx');
  const tree = read('src/home/ProjectsFolderTree.jsx');
  const panel = read('src/projectItems/ProjectWalkthruPanel.jsx');
  const tabs = read('src/projectItems/ProjectItemsPanel.jsx');

  // Dashboard passes walkthruTabOn into SurveyHub
  assert.match(dash, /<SurveyHub[\s\S]*?walkthruTabOn=\{suiteOn && Boolean\(user\)\}/);
  // SurveyHub accepts walkthruTabOn and forwards it into ProjectsFolderTree
  assert.match(hub, /walkthruTabOn = false,/);
  assert.match(hub, /<ProjectsFolderTree[\s\S]*?walkthruTabOn=\{walkthruTabOn\}/);
  // ProjectsFolderTree enables useProjectWalks and renders the Walkthru tab + panel
  assert.match(tree, /walkthruTabOn = false,/);
  assert.match(tree, /useProjectWalks\(\{ projectId: open\?\.id, enabled: walkthruTabOn \}\)/);
  assert.match(tree, /walkthru=\{deskWalksOn\}/);
  assert.match(tree, /walkthru=\{phoneWalksOn\}/);
  // useProjectWalks listens to PROJECT_WALKS_EVENT and reloads for the updated project
  assert.match(panel, /window\.addEventListener\(PROJECT_WALKS_EVENT, onChanged\)/);
  assert.match(tabs, /walkthru \? \[\{ key: 'walkthru', label: 'Walkthru' \}\]/);
});

test('#1600: recording a walk and announcing refreshes listeners for that project', async () => {
  const recorded = [];
  const client = {
    from: (table) => ({
      upsert: async (row, opts) => {
        recorded.push({ table, row, opts });
        return { error: null };
      },
    }),
    rpc: async (name, args) => {
      assert.equal(name, 'list_project_walkthroughs');
      const rows = recorded
        .filter((entry) => entry.row.project_id === args.p_project_id)
        .map((entry) => ({
          walkthrough_id: entry.row.walkthrough_id,
          name: 'Collier Annex QA',
          address: '100 Main St',
          updated_at: entry.row.updated_at,
          added_at: entry.row.updated_at,
          floors: 1,
          nodes: 14,
          plain_nodes: 5,
          photos: 4,
          videos: 0,
          audio: 1,
          notes: 2,
          next_actions: 1,
        }));
      return { data: rows, error: null };
    },
  };

  const listeners = new Map();
  const prevWindow = globalThis.window;
  globalThis.window = {
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      listeners.get(type)?.delete(fn);
    },
    dispatchEvent(event) {
      for (const fn of listeners.get(event.type) || []) fn(event);
      return true;
    },
  };

  try {
    const projectId = '11111111-1111-4111-8111-111111111111';
    const otherProjectId = '22222222-2222-4222-8222-222222222222';
    const walkId = '33333333-3333-4333-8333-333333333333';

    let targetReloads = 0;
    let otherReloads = 0;
    window.addEventListener(PROJECT_WALKS_EVENT, (ev) => {
      const changed = ev?.detail?.projectId;
      if (!changed || changed === projectId) targetReloads += 1;
      if (!changed || changed === otherProjectId) otherReloads += 1;
    });

    assert.equal(await recordProjectWalk(client, projectId, walkId, '2026-11-26T12:00:00Z'), true);
    announceProjectWalks(projectId);

    assert.equal(targetReloads, 1);
    assert.equal(otherReloads, 0);

    const walks = await listProjectWalks(client, projectId);
    assert.equal(walks.length, 1);
    assert.equal(walks[0].id, walkId);
    assert.equal(walks[0].name, 'Collier Annex QA');
    assert.deepEqual(walks[0].counts, {
      floors: 1,
      nodes: 14,
      plainNodes: 5,
      photos: 4,
      videos: 0,
      audio: 1,
      notes: 2,
      nextActions: 1,
    });
  } finally {
    if (prevWindow === undefined) delete globalThis.window;
    else globalThis.window = prevWindow;
  }
});
