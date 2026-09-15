import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '@babel/parser';
import { canCommitDocumentDefinitionMutation } from '../src/hooks/useDocumentDefinitionRevisions.js';

const source = readFileSync(new URL('../src/PDFViewer.jsx', import.meta.url), 'utf8');
const tree = parse(source, { sourceType: 'module', plugins: ['jsx'] });

const find = (node, predicate) => {
  if (!node || typeof node !== 'object') return null;
  if (predicate(node)) return node;
  for (const value of Object.values(node)) {
    if (!value || typeof value !== 'object') continue;
    for (const child of Array.isArray(value) ? value : [value]) {
      const match = find(child, predicate);
      if (match) return match;
    }
  }
  return null;
};

const variable = name => {
  const node = find(tree, value => value.type === 'VariableDeclarator' && value.id?.name === name);
  assert.ok(node, `${name} exists in the real viewer`);
  return node;
};

const callbackFromUseCallback = name => variable(name).init.arguments[0];
const evaluate = (node, scope) => new Function(...Object.keys(scope),
  `return (${source.slice(node.start, node.end)});`)(...Object.values(scope));

test('real desktop and mobile marker callbacks stop before history or stores after a live lock flip', () => {
  const effectiveDocumentLockedRef = { current: false };
  const scope = { canCommitDocumentDefinitionMutation, effectiveDocumentLockedRef };
  const desktop = evaluate(callbackFromUseCallback('handleSurveyMarkerCreated'), scope);
  const mobile = evaluate(callbackFromUseCallback('commitMobileSurveyMarker'), scope);
  const history = [];
  const store = [];
  effectiveDocumentLockedRef.current = true;
  assert.doesNotThrow(() => desktop(1, { x: 1, y: 1, width: 20, height: 20 }));
  assert.doesNotThrow(() => mobile({ id: 'marker-1' }, 'category-1'));
  assert.deepEqual(history, []);
  assert.deepEqual(store, []);
});

test('real undo, redo, and native delete callbacks recheck the retained live lock ref', () => {
  const effectiveDocumentLockedRef = { current: false };
  const undo = evaluate(callbackFromUseCallback('handleUndo'), { effectiveDocumentLockedRef });
  const redo = evaluate(callbackFromUseCallback('handleRedo'), { effectiveDocumentLockedRef });
  const nativeDeleteNode = variable('handleNativeTextMarkupDelete').init;
  const nativeDelete = evaluate(nativeDeleteNode, { effectiveDocumentLockedRef });
  const history = [];
  const store = [];
  effectiveDocumentLockedRef.current = true;
  assert.doesNotThrow(() => undo());
  assert.doesNotThrow(() => redo());
  assert.doesNotThrow(() => nativeDelete({ key: 'Delete' }));
  assert.deepEqual(history, []);
  assert.deepEqual(store, []);
});

test('real retained delete confirm and UndoToast callbacks cannot run after a live lock flip', () => {
  const opening = find(tree, node => node.type === 'JSXOpeningElement'
    && node.name?.name === 'ConfirmDeleteModal');
  assert.ok(opening, 'ConfirmDeleteModal exists in the real viewer');
  const confirmAttribute = opening.attributes.find(attribute => attribute.name?.name === 'onConfirm');
  const runnerCalls = [];
  const effectiveDocumentLockedRef = { current: false };
  const confirm = evaluate(confirmAttribute.value.expression, {
    effectiveDocumentLockedRef,
    pendingDeleteRunnerRef: { current: () => runnerCalls.push('delete') },
  });

  const undoCalls = [];
  const guardedFactory = variable('guardedUndoToast').init.arguments[0];
  const guardedToast = evaluate(guardedFactory, { effectiveDocumentLockedRef,
    undoToast: { onUndo: () => undoCalls.push('restore') } })();
  effectiveDocumentLockedRef.current = true;
  assert.doesNotThrow(() => confirm());
  assert.doesNotThrow(() => guardedToast.onUndo());
  assert.deepEqual(runnerCalls, []);
  assert.deepEqual(undoCalls, []);
});
