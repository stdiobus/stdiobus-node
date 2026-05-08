# Worker Protocol

How workers communicate with the stdio Bus kernel via NDJSON JSON-RPC 2.0.

## Framing: NDJSON

All messages are **newline-delimited JSON** (NDJSON). Each message is a single JSON
object followed by `\n`. No length prefix, no framing bytes — just JSON + newline.

```
{"jsonrpc":"2.0","id":"1","method":"echo","params":{"msg":"hi"}}\n
{"jsonrpc":"2.0","id":"1","result":{"echo":"hi"}}\n
```

Workers read from **stdin** and write to **stdout**. Diagnostic output goes to **stderr**
(not processed by the bus).

## JSON-RPC 2.0 Message Types

### Request (has `id` + `method`)

```json
{
  "jsonrpc": "2.0",
  "id": "unique-id-123",
  "method": "tools/call",
  "params": { "name": "search", "arguments": { "query": "hello" } }
}
```

### Response (has `id` + `result` or `error`)

```json
{
  "jsonrpc": "2.0",
  "id": "unique-id-123",
  "result": { "content": "search results here" }
}
```

### Error Response

```json
{
  "jsonrpc": "2.0",
  "id": "unique-id-123",
  "error": { "code": -32600, "message": "Invalid request" }
}
```

### Notification (has `method`, no `id`)

```json
{
  "jsonrpc": "2.0",
  "method": "progress",
  "params": { "percent": 50 }
}
```

Notifications do not expect a response.

## Session-Aware Routing

When a `sessionId` is included in the request params, the bus routes all messages
for that session to the same worker instance. This enables stateful conversations.

```json
{
  "jsonrpc": "2.0",
  "id": "req-1",
  "method": "session/prompt",
  "params": {
    "sessionId": "sess-abc-123",
    "prompt": [{ "type": "text", "text": "Hello" }]
  }
}
```

The bus maintains a session → worker mapping. Once a session is assigned to a worker,
all subsequent messages with that `sessionId` go to the same worker.

## Writing a Worker

### Minimal template (Node.js)

```javascript
#!/usr/bin/env node
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on('line', (line) => {
  try {
    const msg = JSON.parse(line);

    // Only respond to requests (messages with id + method)
    if (msg.id !== undefined && msg.method !== undefined) {
      const result = handleMethod(msg.method, msg.params || {});
      console.log(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
    }
  } catch (e) {
    // Log errors to stderr (not processed by bus)
    console.error('[worker] Error:', e.message);
  }
});

function handleMethod(method, params) {
  switch (method) {
    case 'echo':
      return { echo: params };
    case 'tools/list':
      return { tools: [{ name: 'search', description: 'Search documents' }] };
    default:
      return { error: `Unknown method: ${method}` };
  }
}

// Graceful shutdown
process.on('SIGTERM', () => process.exit(0));
```

### TypeScript worker template

```typescript
#!/usr/bin/env npx tsx
import * as readline from 'readline';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string };
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on('line', (line: string) => {
  try {
    const msg: JsonRpcRequest = JSON.parse(line);
    if (msg.id !== undefined && msg.method !== undefined) {
      const response: JsonRpcResponse = {
        jsonrpc: '2.0',
        id: msg.id,
        result: dispatch(msg.method, msg.params ?? {}),
      };
      process.stdout.write(JSON.stringify(response) + '\n');
    }
  } catch (e) {
    process.stderr.write(`[worker] Parse error: ${(e as Error).message}\n`);
  }
});

function dispatch(method: string, params: Record<string, unknown>): unknown {
  // Implement your methods here
  return { method, params };
}

process.on('SIGTERM', () => process.exit(0));
```

## Worker Lifecycle

1. **Spawn** — The bus spawns `instances` copies of the worker command
2. **Ready** — Workers are immediately ready to receive messages on stdin
3. **Routing** — Bus routes incoming messages to available workers (round-robin or session-pinned)
4. **Crash** — If a worker exits unexpectedly, the bus restarts it (up to `max_restarts`)
5. **Shutdown** — On `stop()`, the bus sends SIGTERM and waits for graceful exit

### Restart behavior

- Workers are restarted automatically on unexpected exit
- Restart count is tracked within a sliding window (`restart_window_sec`)
- After `max_restarts` within the window, the worker is permanently dead
- The bus continues operating with remaining workers

### Graceful shutdown sequence

1. `bus.stop(timeoutSec)` is called
2. Bus sends SIGTERM to all workers
3. Workers should finish current work and exit
4. If workers don't exit within `timeoutSec`, they're forcefully killed
5. Bus transitions to STOPPED state

## TCP/Unix Client Protocol

When `listenMode` is `'tcp'` or `'unix'`, external clients connect and communicate
using the same NDJSON JSON-RPC 2.0 protocol.

```bash
# Connect to TCP listener
echo '{"jsonrpc":"2.0","id":"1","method":"echo","params":{}}' | nc localhost 8080
```

Each connected client gets its own message stream. Responses are routed back to the
originating client.

## Error Codes (JSON-RPC 2.0 standard)

| Code | Meaning |
|------|---------|
| -32700 | Parse error (invalid JSON) |
| -32600 | Invalid request (missing required fields) |
| -32601 | Method not found |
| -32602 | Invalid params |
| -32603 | Internal error |
| -32000 to -32099 | Server error (application-defined) |

## Best Practices for Workers

1. **Always handle SIGTERM** — Exit gracefully to avoid data loss
2. **Use stderr for logging** — stdout is reserved for JSON-RPC responses
3. **Parse defensively** — Wrap JSON.parse in try/catch
4. **Respond to every request** — Messages with `id` expect a response
5. **Keep responses small** — Large responses can hit `max_output_queue` limits
6. **Don't buffer** — Write responses immediately (stdout is line-buffered by default in Node.js)
7. **Include the original `id`** — Responses must echo back the request's `id` field exactly
