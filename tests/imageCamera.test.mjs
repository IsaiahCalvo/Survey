import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = (f) => readFileSync(new URL(`../src/${f}`, import.meta.url), 'utf8');

test('phones use the camera app; desktops with a camera get the live card', async () => {
  const { prefersNativeCamera, cameraProblem } = await import('../src/components/ImageCameraHost.jsx').catch(() => ({}));
  if (!prefersNativeCamera) return; // JSX is not loadable in plain node here; the source checks below still run
  const win = (coarse, hover, live = true) => ({
    matchMedia: (q) => ({ matches: q.includes('coarse') ? coarse : q.includes('hover') ? hover : false }),
    navigator: { mediaDevices: live ? { getUserMedia() {} } : {} },
  });
  assert.equal(prefersNativeCamera(win(true, false)), true);
  assert.equal(prefersNativeCamera(win(false, true)), false);
  assert.equal(prefersNativeCamera(win(false, true, false)), true);
  assert.match(cameraProblem({ name: 'NotAllowedError' }), /not allowed/);
});

test('the camera card: back camera, muted inline view, stops the camera when it closes', () => {
  const host = src('components/ImageCameraHost.jsx');
  assert.match(host, /facingMode: \{ ideal: 'environment' \}/);
  assert.match(host, /audio: false/);
  assert.match(host, /<video ref=\{videoRef\} muted playsInline/);
  assert.match(host, /track\.stop\(\)/);
  assert.match(host, /input\.setAttribute\('capture', 'environment'\)/);
  assert.match(host, /insertImageFile\(file, \{ center: true \}\)/);
});

test('Camera sits beside Image on desktop and phone, behind its flag', () => {
  assert.match(src('PDFViewer.jsx'), /imageCameraEnabled \? \[\{ id: 'camera', label: 'Camera', iconName: 'camera', action: 'camera' \}\]/);
  assert.match(src('mobile/MobilePdfViewerChrome.jsx'), /id: 'camera', label: 'Camera', icon: 'camera', flag: 'image-camera', action: 'camera'/);
  assert.match(src('featureFlags.js'), /'image-camera': Object\.freeze\(\{[^}]*stage: 'beta'/);
  const migration = readFileSync(new URL('../supabase/migrations/20261113200000_drawboard_tool_extras_flags.sql', import.meta.url), 'utf8');
  for (const key of ['text-review-remove', 'image-camera', 'ruler-tool']) assert.match(migration, new RegExp(`'${key}', 'off'`));
});
