#!/usr/bin/env node

/**
 * Unified Log Listener
 * Captures logs from Supabase, Stripe, App Console, and Resend
 *
 * Usage: node log-listener.js
 */

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

// ANSI color codes for better readability
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',

  // Foreground colors
  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',

  // Background colors
  bgBlack: '\x1b[40m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
  bgWhite: '\x1b[47m',
};

// Log file path
const logFilePath = path.join(__dirname, 'combined-logs.txt');
let logFileStream;

// Configuration
const config = {
  saveToFile: true,
  showTimestamps: true,
  services: {
    supabase: true,
    stripe: true,
    app: true, // Browser console logs (via manual sharing or websocket)
    resend: false // Resend doesn't have real-time logs, would need polling
  }
};

// Initialize log file
function initLogFile() {
  if (config.saveToFile) {
    logFileStream = fs.createWriteStream(logFilePath, { flags: 'a' });
    const separator = '\n' + '='.repeat(80) + '\n';
    const startMessage = `Log session started at ${new Date().toISOString()}`;
    logFileStream.write(separator + startMessage + separator);
    console.log(`${colors.green}Logs will be saved to: ${logFilePath}${colors.reset}\n`);
  }
}

// Format and output log message
function logMessage(source, message, color = colors.white) {
  const timestamp = config.showTimestamps ? `[${new Date().toISOString()}]` : '';
  const sourceLabel = `[${source.toUpperCase()}]`;
  const formattedMessage = `${colors.dim}${timestamp}${colors.reset} ${color}${sourceLabel}${colors.reset} ${message}`;

  console.log(formattedMessage);

  if (config.saveToFile && logFileStream) {
    const plainMessage = `${timestamp} ${sourceLabel} ${message}\n`;
    logFileStream.write(plainMessage);
  }
}

// Monitor Supabase Edge Function logs
function monitorSupabase() {
  if (!config.services.supabase) return;

  logMessage('SYSTEM', 'Starting Supabase log listener...', colors.cyan);
  logMessage('SYSTEM', 'Use Kapture console_logs or manually share webhook logs', colors.dim);

  // Note: Supabase CLI doesn't have a tail command for edge function logs
  // Options:
  // 1. Use Kapture to capture console logs from Supabase dashboard
  // 2. Poll the Supabase logs API (requires API key)
  // 3. Manually share logs via the dashboard

  // For now, we'll provide instructions
  logMessage('SUPABASE', 'To view Supabase logs, open:', colors.yellow);
  logMessage('SUPABASE', 'https://supabase.com/dashboard/project/cvamwtpsuvxvjdnotbeg/functions/stripe-webhook/logs', colors.cyan);
}

// Monitor Stripe webhook events
function monitorStripe() {
  if (!config.services.stripe) return;

  logMessage('SYSTEM', 'Starting Stripe webhook listener...', colors.cyan);

  // Get the webhook endpoint from environment or use default
  const webhookEndpoint = process.env.STRIPE_WEBHOOK_ENDPOINT ||
    'https://cvamwtpsuvxvjdnotbeg.supabase.co/functions/v1/stripe-webhook';

  const stripe = spawn('stripe', ['listen', '--forward-to', webhookEndpoint], {
    cwd: __dirname
  });

  stripe.stdout.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach(line => {
      if (line.trim()) {
        // Parse Stripe CLI output for better formatting
        if (line.includes('-->') || line.includes('<--')) {
          logMessage('STRIPE', line, colors.magenta);
        } else if (line.toLowerCase().includes('error') || line.toLowerCase().includes('fail')) {
          logMessage('STRIPE-ERROR', line, colors.red);
        } else if (line.toLowerCase().includes('success') || line.includes('200')) {
          logMessage('STRIPE', line, colors.green);
        } else {
          logMessage('STRIPE', line, colors.magenta);
        }
      }
    });
  });

  stripe.stderr.on('data', (data) => {
    const lines = data.toString().trim().split('\n');
    lines.forEach(line => {
      if (line.trim() && !line.includes('Ready!')) {
        logMessage('STRIPE-ERROR', line, colors.red);
      }
    });
  });

  stripe.on('close', (code) => {
    logMessage('SYSTEM', `Stripe listener stopped (code: ${code})`, colors.yellow);
  });
}

// Display help message for capturing app logs
function displayAppLogHelp() {
  if (!config.services.app) return;

  console.log(`\n${colors.yellow}${colors.bright}APP CONSOLE LOGS:${colors.reset}`);
  console.log(`${colors.dim}To share browser console logs, you have two options:${colors.reset}`);
  console.log(`  1. Use Kapture to capture console logs: ${colors.cyan}mcp__kapture__console_logs${colors.reset}`);
  console.log(`  2. Add this to your app to send logs here:\n`);
  console.log(`${colors.green}     const ws = new WebSocket('ws://localhost:8765');`);
  console.log(`     const originalLog = console.log;`);
  console.log(`     console.log = function(...args) {`);
  console.log(`       originalLog.apply(console, args);`);
  console.log(`       ws.send(JSON.stringify({ type: 'log', data: args }));`);
  console.log(`     };${colors.reset}\n`);
}

// Start WebSocket server for app logs (optional)
function startWebSocketServer() {
  if (!config.services.app) return;

  try {
    const WebSocket = require('ws');
    const wss = new WebSocket.Server({ port: 8765 });

    wss.on('connection', (ws) => {
      logMessage('SYSTEM', 'App connected to WebSocket log server', colors.green);

      ws.on('message', (message) => {
        try {
          const data = JSON.parse(message);
          if (data.type === 'log') {
            const logData = Array.isArray(data.data) ? data.data.join(' ') : data.data;
            logMessage('APP', logData, colors.cyan);
          } else if (data.type === 'error') {
            const errorData = Array.isArray(data.data) ? data.data.join(' ') : data.data;
            logMessage('APP-ERROR', errorData, colors.red);
          }
        } catch (err) {
          logMessage('SYSTEM', `Failed to parse WebSocket message: ${err.message}`, colors.red);
        }
      });

      ws.on('close', () => {
        logMessage('SYSTEM', 'App disconnected from WebSocket log server', colors.yellow);
      });
    });

    logMessage('SYSTEM', 'WebSocket server listening on ws://localhost:8765', colors.cyan);
  } catch (err) {
    logMessage('SYSTEM', 'WebSocket server not available. Install ws: npm install ws', colors.yellow);
    displayAppLogHelp();
  }
}

// Display header
function displayHeader() {
  console.clear();
  console.log(`${colors.bright}${colors.cyan}`);
  console.log('╔════════════════════════════════════════════════════════════════╗');
  console.log('║           UNIFIED LOG LISTENER - Real-time Monitoring         ║');
  console.log('╚════════════════════════════════════════════════════════════════╝');
  console.log(colors.reset);

  console.log(`${colors.bright}Monitoring:${colors.reset}`);
  if (config.services.supabase) console.log(`  ${colors.blue}▸${colors.reset} Supabase Edge Functions`);
  if (config.services.stripe) console.log(`  ${colors.magenta}▸${colors.reset} Stripe Webhooks`);
  if (config.services.app) console.log(`  ${colors.cyan}▸${colors.reset} App Console (WebSocket)`);
  if (config.services.resend) console.log(`  ${colors.green}▸${colors.reset} Resend Email Logs`);

  console.log(`\n${colors.dim}Press Ctrl+C to stop monitoring${colors.reset}`);
  console.log('─'.repeat(64) + '\n');
}

// Main function
function main() {
  displayHeader();
  initLogFile();

  // Start all listeners
  monitorSupabase();
  monitorStripe();
  startWebSocketServer();

  // Handle graceful shutdown
  process.on('SIGINT', () => {
    console.log(`\n\n${colors.yellow}Stopping log listeners...${colors.reset}`);
    if (logFileStream) {
      const separator = '\n' + '='.repeat(80) + '\n';
      const endMessage = `Log session ended at ${new Date().toISOString()}`;
      logFileStream.write(separator + endMessage + separator);
      logFileStream.end();
    }
    process.exit(0);
  });

  // Keep process alive
  process.stdin.resume();
}

// Run
main();
