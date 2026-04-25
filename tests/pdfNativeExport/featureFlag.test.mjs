import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isPdfNativeExportEnabled,
  setPdfNativeExportEnabledForDocument,
  clearPdfNativeExportOverride,
} from '../../src/utils/pdfNativeExport/featureFlag.js';

test('flag defaults to false when env unset', () => {
  delete process.env.ENABLE_PDF_NATIVE_EXPORT;
  clearPdfNativeExportOverride('doc-default');
  assert.equal(isPdfNativeExportEnabled(), false);
});

test('flag honors env var truthy values', () => {
  process.env.ENABLE_PDF_NATIVE_EXPORT = 'true';
  assert.equal(isPdfNativeExportEnabled(), true);
  process.env.ENABLE_PDF_NATIVE_EXPORT = '1';
  assert.equal(isPdfNativeExportEnabled(), true);
  delete process.env.ENABLE_PDF_NATIVE_EXPORT;
});

test('per-document override wins over env', () => {
  process.env.ENABLE_PDF_NATIVE_EXPORT = 'true';
  setPdfNativeExportEnabledForDocument('pdf-123', false);
  assert.equal(isPdfNativeExportEnabled('pdf-123'), false);
  delete process.env.ENABLE_PDF_NATIVE_EXPORT;
  clearPdfNativeExportOverride('pdf-123');
});
