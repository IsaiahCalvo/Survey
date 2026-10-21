// Reads one localStorage key from the app's Android web view over the
// DevTools protocol (debug builds only). Usage: node webview-storage.mjs <key>
// Expects `adb forward tcp:9222 localabstract:webview_devtools_remote_<pid>`.
const key = process.argv[2];
const pages = await (await fetch('http://127.0.0.1:9222/json')).json();
const page = pages.find((p) => p.type === 'page') || pages[0];
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: `localStorage.getItem(${JSON.stringify(key)})`, returnByValue: true } }));
const msg = await new Promise((r) => { ws.onmessage = (e) => r(JSON.parse(e.data)); });
console.log(String(msg.result?.result?.value ?? 'null'));
ws.close();
