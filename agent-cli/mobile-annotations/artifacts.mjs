import fs from 'node:fs';
import path from 'node:path';
import { isGuardBlockedConsoleMessage } from '../lib/blockNonLoopback.mjs';

const safeName = (value) => String(value).replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '');

export class ArtifactRecorder {
  constructor(rootDir, metadata) {
    this.startedAt = Date.now();
    this.runId = `${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`;
    this.dir = path.join(rootDir, this.runId);
    this.metadata = metadata;
    this.timings = [];
    this.scenarios = [];
    this.browserProblems = [];
    this.final = {};
    fs.mkdirSync(this.dir, { recursive: true });
  }

  captureBrowserProblems(page) {
    page.on('pageerror', (error) => this.browserProblems.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      // A load guardContext aborted is the guard working, not an app error.
      if (message.type() === 'error' && !isGuardBlockedConsoleMessage(message)) {
        this.browserProblems.push(`console: ${message.text()}`);
      }
    });
  }

  async time(label, action) {
    const startedAt = Date.now();
    try {
      return await action();
    } finally {
      this.timings.push({ label, durationMs: Date.now() - startedAt });
    }
  }

  async screenshot(page, label) {
    const file = path.join(this.dir, `${safeName(label)}.png`);
    await page.screenshot({ path: file, fullPage: false });
    return file;
  }

  recordScenario(result) {
    this.scenarios.push(result);
  }

  setFinal(value) {
    this.final = { ...this.final, ...value };
  }

  assertNoBrowserErrors({ ignore = null } = {}) {
    const problems = ignore ? this.browserProblems.filter((line) => !ignore.test(line)) : this.browserProblems;
    if (problems.length) {
      throw new Error(`Browser errors:\n${problems.join('\n')}`);
    }
  }

  durationMs() {
    return Date.now() - this.startedAt;
  }

  finish(status, error = null) {
    const summaryPath = path.join(this.dir, 'summary.json');
    fs.writeFileSync(summaryPath, `${JSON.stringify({
      status,
      runId: this.runId,
      durationMs: this.durationMs(),
      metadata: this.metadata,
      timings: this.timings,
      scenarios: this.scenarios,
      browserProblems: this.browserProblems,
      final: this.final,
      error: error ? { message: error.message, stack: error.stack } : null,
    }, null, 2)}\n`);
    return summaryPath;
  }
}
