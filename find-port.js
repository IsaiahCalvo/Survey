// Starts Vite, detects its actual port, then launches Electron on that port
const { spawn } = require('child_process');

const vite = spawn('npx', ['vite'], {
  shell: true,
  env: { ...process.env },
  stdio: ['inherit', 'pipe', 'inherit']
});

let electronStarted = false;

// Strip ANSI color codes before regex matching — Vite colorizes its output and
// the CSI sequences (e.g. "localhost:\x1b[1m5173") break /localhost:(\d+)/.
const stripAnsi = (s) => s.replace(/\x1B\[[0-9;]*[A-Za-z]/g, '');

vite.stdout.on('data', (data) => {
  const text = data.toString();
  process.stdout.write(text);

  // Parse the actual port from Vite's output: "Local:   http://localhost:XXXX/"
  if (!electronStarted) {
    const match = stripAnsi(text).match(/localhost:(\d+)/);
    if (match) {
      const port = match[1];
      electronStarted = true;
      console.log(`\n  Electron connecting to port ${port}\n`);

      const electron = spawn('electron', ['.'], {
        shell: true,
        stdio: 'inherit',
        env: { ...process.env, DEV_PORT: port, NODE_ENV: 'development' }
      });

      electron.on('exit', () => {
        vite.kill();
        process.exit(0);
      });
    }
  }
});

vite.on('exit', (code) => process.exit(code || 0));

// Clean up on Ctrl+C
process.on('SIGINT', () => {
  vite.kill();
  process.exit(0);
});
