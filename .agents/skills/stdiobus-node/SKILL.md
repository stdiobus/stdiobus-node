---
name: stdiobus-node
description: >
  Build applications with @stdiobus/node — the Node.js SDK for stdio Bus, a deterministic
  C runtime that routes NDJSON JSON-RPC 2.0 messages between an application and worker
  processes. Use when creating worker pools, sending JSON-RPC requests, managing worker
  lifecycle, configuring TCP/Unix listeners, setting up ACP agents, MCP tool servers,
  or integrating stdio Bus into a Node.js project. Covers installation, configuration,
  both native and Docker backends, session-aware routing, and the full TypeScript API.
license: Apache-2.0
compatibility: Requires Node.js >= 18. Native backend requires macOS or Linux (x64/arm64). Docker backend requires Docker CLI.
metadata:
  author: stdiobus
  version: "2.1"
  package: "@stdiobus/node"
  packageVersion: ">=2.0.0"
---

## Overview

`@stdiobus/node` provides a `StdioBus` class that manages worker pools, routes JSON-RPC
messages, and handles worker lifecycle. It ships prebuilt native binaries (N-API) for
macOS and Linux with a Docker fallback for Windows.

**Key facts:**
- Zero runtime dependencies
- Two backends: `native` (C addon via N-API) and `docker` (container over TCP)
- Config via programmatic object (`config`) or file path (`configPath`) — mutually exclusive
- NDJSON framing (newline-delimited JSON) over JSON-RPC 2.0
- Session-aware routing with automatic worker lifecycle management

## Installation

```bash
npm install @stdiobus/node
```

No C compiler needed — prebuilt binaries are included for:
- macOS arm64, x64
- Linux arm64, x64

## Quick Start Pattern

```typescript
import { StdioBus } from '@stdiobus/node';

const bus = new StdioBus({
  config: {
    pools: [{
      id: 'worker',
      command: 'node',
      args: ['./worker.js'],
      instances: 2,
    }],
  },
});

await bus.start();
const result = await bus.request('method-name', { key: 'value' });
await bus.stop();
bus.destroy();
```

**Always call `destroy()` after `stop()`** to release native resources and clean up
temp files.

## Configuration

Two mutually exclusive approaches:

### Programmatic config (recommended)

```typescript
const bus = new StdioBus({
  config: {
    pools: [
      { id: 'pool-name', command: 'node', args: ['./worker.js'], instances: 2 }
    ],
    limits: {
      max_input_buffer: 1_048_576,   // 1MB
      max_output_queue: 4_194_304,   // 4MB
      max_restarts: 5,
      restart_window_sec: 60,
      drain_timeout_sec: 30,
      backpressure_timeout_sec: 5,
    },
  },
});
```

### File-based config

```typescript
const bus = new StdioBus({ configPath: './config.json' });
```

The JSON file has the same structure as the `config` object above.

## Constructor Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `config` | `StdioBusConfig` | — | Programmatic config object |
| `configPath` | `string` | — | Path to JSON config file |
| `backend` | `'auto' \| 'native' \| 'docker'` | `'auto'` | Backend selection |
| `listenMode` | `'none' \| 'tcp' \| 'unix'` | `'none'` | External listener mode |
| `tcpHost` | `string` | `'127.0.0.1'` | TCP bind address |
| `tcpPort` | `number` | — | Required for TCP mode |
| `unixPath` | `string` | — | Required for Unix mode |
| `logLevel` | `number` | `1` | 0=DEBUG, 1=INFO, 2=WARN, 3=ERROR |
| `pollIntervalMs` | `number` | `10` | Native backend poll interval (ms) |
| `docker` | `DockerOptions` | — | Docker backend config |

## Core API

### Lifecycle

```typescript
await bus.start();              // Start bus, spawn workers
await bus.stop(timeoutSec?);    // Graceful shutdown (default 30s)
bus.destroy();                  // Release all resources
```

### Messaging

```typescript
// High-level: send request, await typed response
const result = await bus.request<MyType>('method', { params }, { timeout: 10_000, sessionId: 'abc' });

// Low-level: send raw JSON-RPC string
bus.send(JSON.stringify({ jsonrpc: '2.0', id: '1', method: 'echo', params: {} }));

// Register message handler
bus.onMessage((msg: string) => {
  const parsed = JSON.parse(msg);
  console.log(parsed);
});
```

### State inspection

```typescript
bus.getState();        // 0=CREATED, 1=STARTING, 2=RUNNING, 3=STOPPING, 4=STOPPED
bus.isRunning();       // boolean convenience
bus.getStats();        // { messagesIn, messagesOut, bytesIn, bytesOut, workerRestarts, ... }
bus.getWorkerCount();  // number of running workers
bus.getClientCount();  // connected clients (TCP/Unix mode)
bus.getBackendType();  // 'native' | 'docker'
bus.getListenMode();   // 'none' | 'tcp' | 'unix'
```

## Worker Protocol

Workers communicate via stdin/stdout using NDJSON (one JSON object per line).

### Request → Response pattern

Worker receives on stdin:
```json
{"jsonrpc":"2.0","id":"abc-123","method":"tools/call","params":{"name":"search"}}
```

Worker writes to stdout:
```json
{"jsonrpc":"2.0","id":"abc-123","result":{"content":"found it"}}
```

### Minimal echo worker

```javascript
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on('line', (line) => {
  const msg = JSON.parse(line);
  if (msg.id !== undefined && msg.method !== undefined) {
    console.log(JSON.stringify({
      jsonrpc: '2.0',
      id: msg.id,
      result: { echo: msg.params, method: msg.method },
    }));
  }
});

process.on('SIGTERM', () => process.exit(0));
```

## Use Cases

### TCP Server (external clients)

```typescript
const bus = new StdioBus({
  config: { pools: [{ id: 'worker', command: 'node', args: ['./worker.js'], instances: 4 }] },
  listenMode: 'tcp',
  tcpHost: '0.0.0.0',
  tcpPort: 8080,
});
await bus.start();
// Clients connect via: nc localhost 8080
```

### Docker backend (Windows / unsupported platforms)

```typescript
const bus = new StdioBus({
  configPath: './config.json',
  backend: 'docker',
  docker: {
    image: 'stdiobus/stdiobus:node20',
    pullPolicy: 'if-missing',
    startupTimeoutMs: 15_000,
  },
});
```

### ACP Agent transport

```typescript
const bus = new StdioBus({
  config: { pools: [{ id: 'acp-worker', command: 'node', args: ['./acp-worker.js'], instances: 1 }] },
});
await bus.start();

await bus.request('initialize', {
  protocolVersion: 1,
  clientInfo: { name: 'my-app', version: '1.0.0' },
  clientCapabilities: {},
}, { timeout: 60_000 });

const session = await bus.request('session/new', { cwd: process.cwd(), mcpServers: [] });
const result = await bus.request('session/prompt', {
  sessionId: session.sessionId,
  prompt: [{ type: 'text', text: 'Hello' }],
});
```

### MCP Tool Server

```typescript
const bus = new StdioBus({
  config: { pools: [{ id: 'mcp-tools', command: 'node', args: ['./mcp-worker.js'], instances: 2 }] },
});
await bus.start();

const tools = await bus.request('tools/list');
const output = await bus.request('tools/call', { name: 'search_docs', arguments: { query: 'retry' } });
```

## Gotchas

- `config` and `configPath` are **mutually exclusive** — passing both throws an error.
- Always call `destroy()` after `stop()`. Skipping it leaks native resources and temp files.
- Workers that crash beyond `max_restarts` within `restart_window_sec` are permanently dead.
- `stop()` sends SIGTERM to workers. If they don't exit within `timeoutSec`, they're killed.
- `request()` correlates responses by JSON-RPC `id`. Each request gets a unique ID internally.
- In embedded mode (`listenMode: 'none'`), messages flow only through `send()` / `onMessage()`.
- The programmatic `config` object is serialized to a temp file internally — `destroy()` cleans it up.
- `getWorkerCount()` returns `-1` for the Docker backend (container manages workers internally).
- The native addon is loaded from `prebuilds/<platform>-<arch>/` at runtime — no compilation step.
- On Windows, only the Docker backend is available. `backend: 'auto'` handles this transparently.

## Constants

```typescript
import { BusState, ListenMode, BackendMode } from '@stdiobus/node';

BusState.CREATED    // 0
BusState.STARTING   // 1
BusState.RUNNING    // 2
BusState.STOPPING   // 3
BusState.STOPPED    // 4

ListenMode.NONE     // 'none'
ListenMode.TCP      // 'tcp'
ListenMode.UNIX     // 'unix'

BackendMode.AUTO    // 'auto'
BackendMode.NATIVE  // 'native'
BackendMode.DOCKER  // 'docker'
```

## References

- [API Reference](references/api-reference.md) — Full type signatures and method details
- [Config Schema](references/config-schema.md) — Complete configuration format with all limits
- [Worker Protocol](references/worker-protocol.md) — NDJSON JSON-RPC 2.0 framing details and session routing
