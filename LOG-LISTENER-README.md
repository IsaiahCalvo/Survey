# Unified Log Listener

Real-time monitoring tool that captures logs from Supabase, Stripe, your app console, and Resend in one place.

## Features

✅ **Stripe Webhooks** - Automatically captures all webhook events in real-time
✅ **App Console Logs** - WebSocket server to stream browser console logs
✅ **Supabase Edge Functions** - Link to dashboard (CLI doesn't support tailing)
✅ **Unified Output** - All logs in one terminal with color-coding
✅ **File Logging** - All logs saved to `combined-logs.txt` for later review

## Quick Start

```bash
# Start the log listener
node log-listener.js

# Or run in background
node log-listener.js &
```

The listener will automatically start monitoring:
- **Stripe**: Webhooks forwarded to your Supabase endpoint
- **App Console**: WebSocket server on port 8765
- **Supabase**: Link provided to dashboard

## What You'll See

```
╔════════════════════════════════════════════════════════════════╗
║           UNIFIED LOG LISTENER - Real-time Monitoring         ║
╚════════════════════════════════════════════════════════════════╝

Monitoring:
  ▸ Supabase Edge Functions
  ▸ Stripe Webhooks
  ▸ App Console (WebSocket)

Press Ctrl+C to stop monitoring
────────────────────────────────────────────────────────────────

Logs will be saved to: /Users/isaiahcalvo/Desktop/Survey/combined-logs.txt

[2025-12-26T04:10:56.349Z] [SYSTEM] Starting Supabase log listener...
[2025-12-26T04:10:56.349Z] [STRIPE] Ready! You're using Stripe API Version [2025-12-15.clover]
[2025-12-26T04:10:56.392Z] [SYSTEM] WebSocket server listening on ws://localhost:8765
```

## Color Coding

- 🔵 **SUPABASE** - Blue
- 🟣 **STRIPE** - Magenta
- 🔷 **APP** - Cyan
- 🟢 **SYSTEM** - Cyan
- 🔴 **ERROR** - Red
- 🟡 **WARNING** - Yellow

## Capturing App Console Logs

### Option 1: Using Kapture (Recommended)

Use the Kapture MCP tool to capture console logs from your browser:

```javascript
// In Claude Code
mcp__kapture__console_logs({ tabId: "your-tab-id" })
```

### Option 2: Add WebSocket Client to Your App

Add this code to your app to automatically stream console logs to the listener:

```javascript
// Add to your main.jsx or App.jsx
const ws = new WebSocket('ws://localhost:8765');

// Override console.log
const originalLog = console.log;
console.log = function(...args) {
  originalLog.apply(console, args);
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'log', data: args }));
  }
};

// Override console.error
const originalError = console.error;
console.error = function(...args) {
  originalError.apply(console, args);
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: 'error', data: args }));
  }
};
```

## Viewing Supabase Logs

The Supabase CLI doesn't support real-time log tailing. To view Supabase Edge Function logs:

1. **Via Dashboard** (recommended):
   - Open: https://supabase.com/dashboard/project/cvamwtpsuvxvjdnotbeg/functions/stripe-webhook/logs
   - Or use Kapture to capture the logs from the dashboard

2. **Via Kapture**:
   ```javascript
   // Navigate to Supabase dashboard
   mcp__kapture__navigate({
     tabId: "tab-id",
     url: "https://supabase.com/dashboard/project/cvamwtpsuvxvjdnotbeg/functions/stripe-webhook/logs"
   })

   // Capture console logs
   mcp__kapture__console_logs({ tabId: "tab-id" })
   ```

## Testing the System

### 1. Test Stripe Webhooks

Trigger a test webhook from Stripe dashboard or perform an action (subscription signup/cancel):

```bash
# You should see:
[STRIPE] --> customer.subscription.created [evt_xxx]
[STRIPE] <-- [200] POST https://your-supabase-url/functions/v1/stripe-webhook
```

### 2. Test App Console Logs

If you added the WebSocket code to your app, open your app and you should see:

```bash
[APP] User clicked button
[APP] Fetching subscription data...
[APP-ERROR] Failed to load: Network error
```

### 3. Check Saved Logs

All logs are automatically saved to `combined-logs.txt`:

```bash
# View all logs
cat combined-logs.txt

# View recent logs
tail -f combined-logs.txt

# Search for errors
grep ERROR combined-logs.txt
```

## Example Log Output

```
[2025-12-26T04:15:30.123Z] [STRIPE] --> checkout.session.completed [evt_1abc123]
[2025-12-26T04:15:30.456Z] [SUPABASE] Processing webhook event: checkout.session.completed
[2025-12-26T04:15:30.789Z] [SUPABASE] Update data prepared: { tier: 'pro', status: 'trialing' }
[2025-12-26T04:15:31.012Z] [SUPABASE] SUCCESS: Updated subscription for user abc123 to pro (trialing)
[2025-12-26T04:15:31.234Z] [STRIPE] <-- [200] POST https://your-endpoint
[2025-12-26T04:15:31.567Z] [APP] Subscription updated: pro
[2025-12-26T04:15:31.890Z] [APP] Refreshing UI...
```

## Configuration

Edit `log-listener.js` to customize:

```javascript
const config = {
  saveToFile: true,           // Save logs to file
  showTimestamps: true,        // Show timestamps
  services: {
    supabase: true,           // Monitor Supabase
    stripe: true,             // Monitor Stripe webhooks
    app: true,                // WebSocket for app logs
    resend: false             // Resend (not implemented)
  }
};
```

## Troubleshooting

### Stripe listener not starting

Make sure Stripe CLI is installed and authenticated:
```bash
stripe --version
stripe login
```

### WebSocket connection fails

Check if port 8765 is available:
```bash
lsof -i:8765
```

### No logs appearing

1. Check the background process is running
2. Verify `combined-logs.txt` is being updated
3. Check for error messages in the console

## Stopping the Listener

Press `Ctrl+C` or kill the process:

```bash
# Find process
ps aux | grep log-listener

# Kill by PID
kill <PID>

# Kill by port
kill $(lsof -t -i:8765)
```

## Files

- `log-listener.js` - Main script
- `combined-logs.txt` - All captured logs
- `LOG-LISTENER-README.md` - This file

## Integration with Claude Code

When working with Claude, you can now:

1. **Start the listener** before performing actions
2. **Share the log file** with Claude for analysis
3. **Reference specific log entries** when debugging

Example:
```
User: "I just canceled my subscription but the UI didn't update"
Claude: *Checks combined-logs.txt*
Claude: "I see the Stripe webhook succeeded but the database update returned 0 rows..."
```

## Next Steps

1. ✅ Listener is running - monitor logs in real-time
2. ⚠️ Add WebSocket code to your app (optional) for console logs
3. ⚠️ Use Kapture to capture Supabase dashboard logs
4. ✅ All logs automatically saved to `combined-logs.txt`

---

**Status**: ✅ Running
**Log File**: `/Users/isaiahcalvo/Desktop/Survey/combined-logs.txt`
**WebSocket**: `ws://localhost:8765`
**Stripe**: Auto-forwarding webhooks
