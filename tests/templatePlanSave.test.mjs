// Templates are Pro-only in the database. On Free a template save is turned
// down; it must say so, not "does not belong" / "Could not save" (Nov 17).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  TEMPLATE_PLAN_MESSAGE, isTemplatePlanError, templatePlanError, templateSaveErrorText,
} from '../src/home/templatePersistence.js';

const read = (rel) => readFileSync(new URL(rel, import.meta.url), 'utf8');

test('a plan refusal reads as the plan, anything else as a failed save', () => {
  assert.equal(templateSaveErrorText(templatePlanError()), TEMPLATE_PLAN_MESSAGE);
  assert.equal(templateSaveErrorText(new Error('Saving templates needs the Pro plan.')), TEMPLATE_PLAN_MESSAGE);
  assert.equal(isTemplatePlanError(new Error('Template row does not belong to the signed-in user')), false);
  assert.match(templateSaveErrorText(new Error('network down')), /^Could not save templates\./);
  assert.match(templateSaveErrorText(undefined), /^Could not save templates\./);
});

test('the snapshot function says "needs the Pro plan" before the ownership check', () => {
  const sql = read('../supabase/migrations/20261117170000_template_snapshot_plan_message.sql');
  assert.match(sql, /plan_ok := public\.has_feature_access\(caller_id, 'templates'\);/);
  const plan = sql.indexOf("RAISE EXCEPTION 'Saving templates needs the Pro plan.'");
  const owner = sql.indexOf("RAISE EXCEPTION 'Template row does not belong to the signed-in user'");
  assert.ok(plan > 0 && owner > plan);
  assert.match(sql, /DELETE FROM public\.templates\s+WHERE user_id = caller_id/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.replace_my_templates\(jsonb\) TO authenticated;/);
});

test('the app maps both server answers to the plan message, and the editor shows it', () => {
  const dash = read('../src/Dashboard.jsx');
  assert.match(dash, /\/does not belong to the signed-in user\/\.test\(message\) && !canCreateTemplate\(\)\.allowed\)\) \{\s*throw templatePlanError\(\);/);
  assert.match(dash, /showToast\(isTemplatePlanError\(e\) \? 'Saving templates needs the Pro plan\.' : 'Failed to save templates\.', 'error'\);/);
  const editor = read('../src/home/TemplatesEditor.jsx');
  assert.equal((editor.match(/setPersistenceError\(templateSaveErrorText\(err\)\);/g) || []).length, 3);
  assert.doesNotMatch(editor, /setPersistenceError\('Could not save templates/);
});
