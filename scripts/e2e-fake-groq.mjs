// scripts/e2e-fake-groq.mjs — a fake Groq for the signed-in E2E stack, so
// app walks can prove a spoken "D-1-17 is installed" fills the survey with
// no real model, no key and no cost. How-to: docs/E2E-SIGNED-IN.md.
//
// Hearing always returns FAKE_HEARD. The model sets every line of the item
// the person named: when the last message is the person's, it calls
// set_answers { item_name, all_lines: the first allowed answer }; after the
// tool result it says "Done." Anything else is a 404.
//
// The stack serves this as an edge function in its own workdir only
// (scripts/e2e-local-supabase.mjs), never deployed. It also runs on its own:
//   node scripts/e2e-fake-groq.mjs [port]     # default 54399, 127.0.0.1
// No imports at the top, so Deno and Node both load it.

export const FAKE_HEARD = 'D-1-17 is installed';

const json = (status, body) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

// The item name the person said: "D-1-17" from "D-1-17 is installed".
function itemNameOf(text) {
  return String(text || '').match(/[A-Z]{1,4}-?\d+(?:-\d+)*/i)?.[0] || String(text || '').trim();
}

export function fakeChatReply(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : [];
  const last = messages[messages.length - 1] || {};
  const usage = { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 };
  const done = (content) => ({ choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }], usage });
  if (last.role !== 'user') return done('Done.');
  const setAnswers = (body?.tools || []).find((t) => t?.function?.name === 'set_answers');
  const allowed = setAnswers?.function?.parameters?.properties?.all_lines?.enum || [];
  const answer = allowed.find((v) => v !== null);
  if (!answer) return done('I cannot set answers here.');
  const args = { item_name: itemNameOf(typeof last.content === 'string' ? last.content : ''), all_lines: answer };
  return {
    choices: [{
      index: 0,
      finish_reason: 'tool_calls',
      message: {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'fake-call-1', type: 'function', function: { name: 'set_answers', arguments: JSON.stringify(args) } }],
      },
    }],
    usage,
  };
}

export async function fakeGroqHandler(req) {
  const path = new URL(req.url).pathname;
  if (req.method !== 'POST') return json(405, { error: 'POST only' });
  if (path.endsWith('/audio/transcriptions')) {
    await req.arrayBuffer();
    return json(200, { text: FAKE_HEARD });
  }
  if (path.endsWith('/chat/completions')) {
    let body;
    try { body = await req.json(); } catch { return json(400, { error: 'bad json' }); }
    return json(200, fakeChatReply(body));
  }
  return json(404, { error: 'not faked' });
}

// Run on its own under Node.
const runByNode = !globalThis.Deno && typeof process !== 'undefined' && process.release?.name === 'node'
  && process.argv[1] && import.meta.url.endsWith(process.argv[1].split(/[\\/]/).pop());
if (runByNode) {
  const { createServer } = await import('node:http');
  const port = Number(process.argv[2] || 54399);
  createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const request = new Request(`http://127.0.0.1:${port}${req.url}`, {
      method: req.method,
      headers: req.headers,
      body: req.method === 'POST' ? Buffer.concat(chunks) : undefined,
    });
    const reply = await fakeGroqHandler(request);
    res.writeHead(reply.status, Object.fromEntries(reply.headers));
    res.end(Buffer.from(await reply.arrayBuffer()));
  }).listen(port, '127.0.0.1', () => console.log(`[fake-groq] http://127.0.0.1:${port}`));
}
