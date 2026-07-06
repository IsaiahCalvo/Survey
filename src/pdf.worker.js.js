/**
 * pdf.worker.js.js — PDF.js Web Worker entry shim.
 *
 * Loads pdfjs-dist's worker bundle (pdf.worker.mjs) via importScripts so the
 * main thread can offload PDF parsing/rendering. Referenced as the worker
 * source for PDF.js page rendering in the v2.0 viewer.
 */
importScripts('pdfjs-dist/legacy/build/pdf.worker.mjs');
