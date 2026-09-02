import { spawn } from 'node:child_process';
import net from 'node:net';

const blocked = new Set([5173, 5230, 5260]);
const findFreePort = () => new Promise((resolve, reject) => {
  const server = net.createServer();
  server.unref();
  server.on('error', reject);
  server.listen(0, '127.0.0.1', () => {
    const port = server.address().port;
    server.close(() => blocked.has(port) ? findFreePort().then(resolve, reject) : resolve(port));
  });
});

// Any scenario spec may be passed as arguments; the fidelity spec is the default.
const specs = process.argv.slice(2).length ? process.argv.slice(2) : ['debug/scenarios/print-fidelity.spec.mjs'];
const port = await findFreePort();
const child = spawn(
  process.platform === 'win32' ? 'npx.cmd' : 'npx',
  ['playwright', 'test', '--config', 'debug/playwright.config.mjs', ...specs],
  { stdio: 'inherit', env: { ...process.env, PLAYWRIGHT_BASE_URL: `http://127.0.0.1:${port}` } },
);
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 1;
});
