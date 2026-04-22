/**
 * Session folder creation and manifest finalization utilities.
 *
 * Each test run creates a timestamped session folder under debug/debug-sessions/
 * containing a manifest.json with scenario metadata, git SHA, timing, and artifact paths.
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/**
 * Returns the absolute path to the debug/debug-sessions/ directory,
 * resolved relative to this library file's location.
 */
export function getSessionBaseDir() {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  return path.resolve(__dirname, '..', 'debug-sessions');
}

/**
 * Creates a timestamped session folder and returns initial session metadata.
 *
 * @param {string} scenarioName - Name of the scenario (e.g., 'smoke')
 * @param {string} baseDir - Absolute path to debug/debug-sessions/
 * @returns {{ sessionDir: string, manifest: object, folderName: string }}
 */
export function createSession(scenarioName, baseDir) {
  // Timestamp format: YYYYMMDDTHHMMSS (ISO 8601 compact, sortable)
  const now = new Date();
  const timestamp = now.toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, '')
    .replace('T', 'T');

  const folderName = `${timestamp}_${scenarioName}`;
  const sessionDir = path.join(baseDir, folderName);

  // Create session directory (and base directory if needed)
  mkdirSync(sessionDir, { recursive: true });

  // Capture git SHA
  let gitSha;
  try {
    gitSha = execSync('git rev-parse HEAD', { encoding: 'utf-8' }).trim();
  } catch {
    gitSha = 'unknown';
  }

  const manifest = {
    scenario: scenarioName,
    gitSha,
    startTime: now.toISOString(),
    endTime: null,
    result: null,
    artifacts: [],
  };

  return { sessionDir, manifest, folderName };
}

/**
 * Finalizes a session by writing the manifest.json with results and artifacts.
 *
 * @param {string} sessionDir - Absolute path to the session folder
 * @param {object} manifest - The manifest object from createSession
 * @param {'pass'|'fail'} result - Test result
 * @param {Array<{type: string, path: string, description: string}>} artifacts - Artifact list
 */
export function finalizeSession(sessionDir, manifest, result, artifacts) {
  manifest.endTime = new Date().toISOString();
  manifest.result = result;
  manifest.artifacts = artifacts;

  writeFileSync(
    path.join(sessionDir, 'manifest.json'),
    JSON.stringify(manifest, null, 2),
    'utf-8'
  );
}
