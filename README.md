# @stdiobus/node

[![npm](https://img.shields.io/npm/v/@stdiobus/node?style=for-the-badge&logo=npm)](https://www.npmjs.com/package/@stdiobus/node)
[![stdioBus](https://img.shields.io/badge/ecosystem-stdio%20Bus-ff4500?style=for-the-badge)](https://github.com/stdiobus)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen?style=for-the-badge&logo=nodedotjs)](https://nodejs.org)
[![Native](https://img.shields.io/badge/native-macOS%20%7C%20Linux-lightgrey?style=for-the-badge&logo=linux)](https://github.com/stdiobus/stdiobus)
[![Docker](https://img.shields.io/badge/docker-Windows%20fallback-blue?style=for-the-badge&logo=docker)](https://hub.docker.com/r/stdiobus/stdiobus)
[![Build](https://img.shields.io/badge/build-esbuild-yellow?style=for-the-badge&logo=esbuild)](https://esbuild.github.io)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue?style=for-the-badge&logo=opensourceinitiative)](https://github.com/stdiobus/stdiobus/blob/main/sdk/node-native/LICENSE)
[![TypeScript](https://img.shields.io/badge/typescript-strict-blue?style=for-the-badge&logo=typescript)](https://www.typescriptlang.org)
[![Stable](https://img.shields.io/badge/status-stable-brightgreen?style=for-the-badge)](https://github.com/stdiobus/stdiobus)

Native Node.js SDK for the [stdio Bus kernel](https://github.com/stdiobus/stdiobus) — a deterministic C runtime that routes NDJSON-framed JSON-RPC messages between your application and worker processes. Session-aware routing, automatic worker lifecycle management, and prebuilt native binaries for macOS and Linux. Docker fallback for Windows and unsupported platforms.

## Installation

```bash
npm install @stdiobus/node
```

Prebuilt native binaries are included. No C compiler or build tools required.

**Requirements:**

- Node.js >= 18.0.0
- macOS (x64, arm64) or Linux (x64, arm64) for native backend
- Docker (optional) — required only on Windows or unsupported platforms

## Quick Start

```javascript
const { StdioBus } = require('@stdiobus/node');

const bus = new StdioBus({
  config: {
    pools: [{
      id: 'echo',
      command: 'node',
      args: ['./workers/echo-worker.js'],
      instances: 1,
    }],
  },
});

await bus.start();

const result = await bus.request('echo', { message: 'hello' });
console.log(result);

await bus.stop();
bus.destroy();
```

## TypeScript

The package ships with full type declarations.

```typescript
import { StdioBus, BusState } from '@stdiobus/node';
import type { StdioBusOptions, BusStats } from '@stdiobus/node';

const options: StdioBusOptions = {
  config: {
    pools: [{
      id: 'worker',
      command: 'node',
      args: ['./worker.js'],
      instances: 2,
    }],
    limits: {
      max_input_buffer: 1_048_576,
      max_output_queue: 4_194_304,
      max_restarts: 5,
      restart_window_sec: 60,
    },
  },
};

const bus = new StdioBus(options);

try {
  await bus.start();

  bus.onMessage((msg: string) => {
    console.log('Received:', msg);
  });

  const result = await bus.request('tools/list', {}, { timeout: 10_000 });
  console.log('Tools:', result);
} finally {
  await bus.stop();
  bus.destroy();
}
```

## Use Cases

### ACP Agent

> For typed streaming events, use [`@stdiobus/agentic`](https://www.npmjs.com/package/@stdiobus/agentic) with `promptStream()` or `prompt()`. The example below shows the low-level transport approach.

```javascript
const { StdioBus } = require('@stdiobus/node');

const bus = new StdioBus({
  config: {
    pools: [{
      id: 'acp-worker',
      command: 'node',
      args: ['./workers/acp-worker.js'],
      instances: 1,
    }],
  },
});

await bus.start();

const init = await bus.request('initialize', {
  protocolVersion: 1,
  clientInfo: { name: 'my-app', version: '1.0.0' },
  clientCapabilities: {},
}, { timeout: 60_000 });

const session = await bus.request('session/new', {
  cwd: process.cwd(),
  mcpServers: [],
});

const result = await bus.request('session/prompt', {
  sessionId: session.sessionId,
  prompt: [{ type: 'text', text: 'What is 2+2?' }],
});

console.log('Response:', result);
await bus.stop();
bus.destroy();
```

### MCP Tools

```javascript
const bus = new StdioBus({
  config: {
    pools: [{
      id: 'mcp-tools',
      command: 'node',
      args: ['./workers/mcp-tools-worker.js'],
      instances: 2,
    }],
  },
});

await bus.start();

const tools = await bus.request('tools/list');
const output = await bus.request('tools/call', {
  name: 'search_docs',
  arguments: { query: 'retry policy' },
});

console.log('Tools:', tools);
console.log('Output:', output);

await bus.stop();
bus.destroy();
```

### TCP Server

Accept external client connections over TCP:

```javascript
const port = Number(process.env.PORT) || 8080;

const bus = new StdioBus({
  config: {
    pools: [{
      id: 'worker',
      command: 'node',
      args: ['./worker.js'],
      instances: 4,
    }],
  },
  listenMode: 'tcp',
  tcpHost: '0.0.0.0',
  tcpPort: port,
});

await bus.start();
console.log(`Listening on TCP port ${port}`);
// Clients connect and send NDJSON: nc localhost 8080
```

## Docker Backend

On Windows or when native binaries are unavailable, the SDK runs stdio Bus inside a Docker container and communicates over TCP:

```javascript
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

Set `backend: 'auto'` (default) to use native when available, Docker otherwise.

## Platform Support

| Platform | Architecture | Native | Docker |
|----------|-------------|--------|--------|
| macOS | x64 | ✓ | ✓ |
| macOS | arm64 | ✓ | ✓ |
| Linux | x64 | ✓ | ✓ |
| Linux | arm64 | ✓ | ✓ |
| Windows | x64 | — | ✓ |

## API Reference

### Constructor

```typescript
new StdioBus(options: StdioBusOptions)
```

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `configJson` | `object` | — | Programmatic config (recommended) |
| `configPath` | `string` | — | Path to JSON config file |
| `backend` | `'auto' \| 'native' \| 'docker'` | `'auto'` | Backend selection |
| `listenMode` | `'none' \| 'tcp' \| 'unix'` | `'none'` | External listener mode |
| `tcpHost` | `string` | `'127.0.0.1'` | TCP bind address |
| `tcpPort` | `number` | — | TCP port (required for tcp mode) |
| `unixPath` | `string` | — | Unix socket path (required for unix mode) |
| `logLevel` | `number` | `1` | 0=DEBUG, 1=INFO, 2=WARN, 3=ERROR |
| `pollIntervalMs` | `number` | `10` | Native backend poll interval |
| `docker` | `DockerOptions` | — | Docker backend configuration |

`configJson` and `configPath` are mutually exclusive. One is required.

### Lifecycle

| Method | Returns | Description |
|--------|---------|-------------|
| `start()` | `Promise<void>` | Start bus and spawn workers |
| `stop(timeoutSec?)` | `Promise<void>` | Graceful shutdown (default: 30s) |
| `destroy()` | `void` | Release all resources |

### Messaging

| Method | Returns | Description |
|--------|---------|-------------|
| `request(method, params?, options?)` | `Promise<T>` | Send request, await response |
| `send(message)` | `boolean` | Send raw JSON-RPC string |
| `onMessage(handler)` | `void` | Register message handler |

### State

| Method | Returns | Description |
|--------|---------|-------------|
| `getState()` | `number` | Bus state (0–4) |
| `getStats()` | `BusStats` | Runtime statistics |
| `getWorkerCount()` | `number` | Running workers |
| `getClientCount()` | `number` | Connected clients (TCP/Unix) |
| `getBackendType()` | `'native' \| 'docker'` | Active backend |
| `getListenMode()` | `string` | Listen mode |
| `isRunning()` | `boolean` | Convenience check |

### Constants

```typescript
import { BusState, ListenMode, BackendMode } from '@stdiobus/node';

BusState.CREATED   // 0
BusState.STARTING  // 1
BusState.RUNNING   // 2
BusState.STOPPING  // 3
BusState.STOPPED   // 4

ListenMode.NONE    // 'none'
ListenMode.TCP     // 'tcp'
ListenMode.UNIX    // 'unix'

BackendMode.AUTO   // 'auto'
BackendMode.NATIVE // 'native'
BackendMode.DOCKER // 'docker'
```

## Known Behavior

- Workers that crash beyond `max_restarts` within `restart_window_sec` are not restarted.
- `stop()` sends SIGTERM to workers and waits up to `timeoutSec` for graceful exit.
- `request()` correlates responses by JSON-RPC `id`. Each request gets a unique ID.
- In embedded mode (`listenMode: 'none'`), messages flow through `send()` / `onMessage()`.
- In TCP/Unix modes, external clients connect and send NDJSON directly.
- `configJson` is serialized to a temp file internally, cleaned up on `destroy()`.
- Always call `destroy()` after `stop()` to release native resources and clean up temp files.

## Development

```bash
npm install                # install dependencies
npm run build              # esbuild (JS) + tsc (declarations)
npm run typecheck          # type-check without emit
npm run test:e2e           # npm pack → install → verify on macOS + Docker Linux
npm run test:e2e:native    # macOS only
npm run test:e2e:docker    # Docker Linux only
```

Build output:

```
out/
  dist/index.js       # CJS bundle (esbuild, minified)
  tsc/*.d.ts          # Type declarations (tsc)
```

## Contributing

1. Open an issue describing the change before submitting a PR.
2. All PRs must include tests covering the change.
3. Run `npm run typecheck && npm run test:e2e` before submitting.

## Security

To report a security vulnerability, email [raman@stdiobus.com](mailto:raman@stdiobus.com). Do not open a public issue.

## License

[Apache-2.0](./LICENSE)
