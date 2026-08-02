import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function isSurveyVite(baseUrl) {
  try {
    const response = await fetch(baseUrl, { signal: AbortSignal.timeout(1_500) });
    const html = await response.text();
    return response.ok && html.includes('id="root"') && html.includes('/src/entry.jsx');
  } catch {
    return false;
  }
}

async function waitForServer(baseUrl, child, timeoutMs = 25_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Vite exited early with code ${child.exitCode}`);
    if (await isSurveyVite(baseUrl)) return;
    await delay(150);
  }
  throw new Error(`Vite did not become ready at ${baseUrl} within ${timeoutMs}ms`);
}

async function ephemeralLoopbackUrl() {
  const port = await new Promise((resolve, reject) => {
    const server = createServer();
    server.unref();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close((error) => {
        if (error) reject(error);
        else resolve(address.port);
      });
    });
  });
  return `http://127.0.0.1:${port}`;
}

export async function ensureViteServer(requestedBaseUrl) {
  if (requestedBaseUrl) {
    const baseUrl = String(requestedBaseUrl).replace(/\/$/, '');
    if (await isSurveyVite(baseUrl)) return { baseUrl, managedProcess: null };
    throw new Error(`--base-url is not a Survey Vite server: ${baseUrl}`);
  }

  const baseUrl = await ephemeralLoopbackUrl();

  const url = new URL(baseUrl);
  const child = spawn('npm', [
    'run', 'dev:ui', '--',
    '--host', url.hostname,
    '--port', url.port,
    '--strictPort',
  ], {
    cwd: process.cwd(),
    env: { ...process.env, BROWSER: 'none' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  try {
    await waitForServer(baseUrl, child);
  } catch (error) {
    child.kill('SIGTERM');
    throw new Error(`${error.message}\n${output.slice(-4_000)}`);
  }
  return { baseUrl, managedProcess: child };
}
