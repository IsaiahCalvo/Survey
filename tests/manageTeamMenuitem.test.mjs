import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';

// Source contracts for Manage Team member/invite More *actions* role=menuitem.
// Live proof: debug/scenarios/e2e-manage-team-menuitem.spec.mjs
// Distinct from leftover-18 / Activity dialog name (A-06) / unnamed-dialog
// family / hub Account menuitem / Home-tab / annotation / Pages context.

const read = (rel) => readFileSync(join(process.cwd(), rel), 'utf8');

test('member More menu items are role=menuitem; Activity dialog stays unnamed this pass', () => {
  const src = read('src/home/ManageTeamModal.jsx');
  const start = src.indexOf('{!editMode && openMenu === m.id && (');
  const end = src.indexOf('{/* Pending invites');
  assert.ok(start > 0 && end > start);
  const slice = src.slice(start, end);
  assert.match(slice, /role="menu"/);
  assert.match(slice, /aria-label=\{`\$\{m\.name \|\| m\.email \|\| 'Member'\} actions`\}/);
  assert.match(slice, /Invite user[\s\S]*role="menuitem"/);
  assert.match(slice, /View activity[\s\S]*role="menuitem"/);
  assert.match(slice, /Copy email[\s\S]*role="menuitem"/);
  assert.equal((slice.match(/role="menuitem"/g) || []).length, 1);
  assert.doesNotMatch(slice, /create-checkout-session|Turnstile|msalInstance/);
});

test('pending-invite More menu items are role=menuitem; no leftover-18 mint invented', () => {
  const src = read('src/home/ManageTeamModal.jsx');
  const start = src.indexOf('{openInviteMenu === inv.id && (');
  const end = src.indexOf('{/* Inline feedback');
  assert.ok(start > 0 && end > start);
  const slice = src.slice(start, end);
  assert.match(slice, /role="menu"/);
  assert.match(slice, /aria-label=\{`\$\{inv\.target_email \|\| 'Invite'\} actions`\}/);
  assert.match(slice, /Copy invite link[\s\S]*role="menuitem"/);
  assert.match(slice, /Revoke invite[\s\S]*role="menuitem"/);
  assert.equal((slice.match(/role="menuitem"/g) || []).length, 1);
  assert.doesNotMatch(slice, /create-checkout-session|Turnstile|msalInstance/);
});

test('live spec covers named menuitem actions intended + break + edge; skip leftover-18 and Activity name', () => {
  const spec = read('debug/scenarios/e2e-manage-team-menuitem.spec.mjs');
  assert.match(spec, /hubPreview=1/);
  assert.match(spec, /tab=projects/);
  assert.match(spec, /testPdf=clickable-link-test\.pdf/);
  assert.match(spec, /getByRole\('menuitem', \{ name: 'Copy email', exact: true \}\)/);
  assert.match(spec, /getByRole\('menuitem', \{ name: 'Invite user', exact: true \}\)/);
  assert.match(spec, /keyboard\.press\('Escape'\)/);
  assert.match(spec, /projects-mobile-folder-row/);
  assert.match(spec, /file\.id/);
  assert.doesNotMatch(spec, /file\.id\s*=/);
  assert.doesNotMatch(spec, /VITE_DEV_AUTO_LOGIN/);
  assert.doesNotMatch(spec, /create-checkout-session|Turnstile|msalInstance/);
  assert.doesNotMatch(spec, /doDeleteForever|deleteAccount/);
  assert.doesNotMatch(spec, /aria-labelledby="activity/);
  assert.doesNotMatch(spec, /getByRole\('dialog', \{ name: 'Activity'/);
  assert.doesNotMatch(spec, /Home `\?` must be one overlay, not two/);
});
