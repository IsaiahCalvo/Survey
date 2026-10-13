import test from 'node:test';
import assert from 'node:assert/strict';

import { getExportErrorMessage, isFileLocked } from '../src/utils/exportHelpers.js';

test('getExportErrorMessage maps known OneDrive failure shapes', () => {
  assert.match(getExportErrorMessage({ message: 'Name already exists' }), /already exists/);
  assert.match(getExportErrorMessage({ message: 'HTTP 409' }), /already exists/);
  assert.match(getExportErrorMessage({ message: 'file locked' }), /currently open/);
  assert.match(getExportErrorMessage({ message: 'unauthorized 401' }), /session has expired/);
  assert.match(getExportErrorMessage({ message: 'forbidden 403' }), /permission/);
  assert.match(getExportErrorMessage({ message: 'not found 404' }), /folder could not be found/);
  assert.match(getExportErrorMessage({ message: 'network timeout' }), /Network connection/);
  assert.match(getExportErrorMessage({ message: 'quota storage exceeded' }), /storage is full/);
  assert.match(getExportErrorMessage({ message: 'mystery' }), /Unable to save to OneDrive/);
  assert.match(getExportErrorMessage(null), /Unable to save to OneDrive/);
});

test('isFileLocked detects lock-shaped errors', () => {
  assert.equal(isFileLocked({ message: 'locked by another process' }), true);
  assert.equal(isFileLocked({ message: 'HTTP 423' }), true);
  assert.equal(isFileLocked({ message: 'in use' }), true);
  assert.equal(isFileLocked({ message: 'not found' }), false);
});
