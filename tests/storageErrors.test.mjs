import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isStorageFileNotFoundError,
  isSupabaseRowNotFoundError,
} from '../src/utils/storageErrors.js';

test('isStorageFileNotFoundError detects 404 statuses', () => {
  assert.equal(isStorageFileNotFoundError({ status: 404 }), true);
  assert.equal(isStorageFileNotFoundError({ statusCode: 404 }), true);
});

test('isStorageFileNotFoundError requires not-found wording for 400s', () => {
  assert.equal(isStorageFileNotFoundError({ status: 400, message: 'Object not found' }), true);
  assert.equal(isStorageFileNotFoundError({ status: 400, message: 'bad request' }), false);
});

test('isStorageFileNotFoundError checks Storage error names', () => {
  assert.equal(isStorageFileNotFoundError({
    name: 'StorageUnknownError',
    message: 'no such object',
  }), true);
  assert.equal(isStorageFileNotFoundError({
    name: 'StorageApiError',
    details: 'resource was not found',
  }), true);
});

test('isStorageFileNotFoundError stringifies unknown errors as fallback', () => {
  assert.equal(isStorageFileNotFoundError('Object not found in bucket'), true);
  assert.equal(isStorageFileNotFoundError({ message: 'permission denied' }), false);
});

test('isSupabaseRowNotFoundError detects PostgREST and 404 shapes', () => {
  assert.equal(isSupabaseRowNotFoundError(null), false);
  assert.equal(isSupabaseRowNotFoundError({ code: 'PGRST116' }), true);
  assert.equal(isSupabaseRowNotFoundError({ status: 404 }), true);
  assert.equal(isSupabaseRowNotFoundError({ statusCode: 404 }), true);
  assert.equal(isSupabaseRowNotFoundError({ message: 'JSON object requested, multiple (or no) rows returned' }), false);
  assert.equal(isSupabaseRowNotFoundError({ message: 'Results contain 0 rows' }), false);
  assert.equal(isSupabaseRowNotFoundError({ message: 'no rows returned' }), true);
  assert.equal(isSupabaseRowNotFoundError({ message: 'not found' }), true);
  assert.equal(isSupabaseRowNotFoundError({ message: 'conflict' }), false);
});
