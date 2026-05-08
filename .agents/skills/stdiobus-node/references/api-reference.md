# API Reference

Complete type signatures for `@stdiobus/node` v2.x.

## Exports

```typescript
// Main class
import StdioBus from '@stdiobus/node';
// or
import { StdioBus } from '@stdiobus/node';

// Constants
import { BusState, ListenMode, BackendMode } from '@stdiobus/node';

// Types
import type {
  StdioBusOptions,
  StdioBusConfig,
  RequestOptions,
  BusStats,
  MessageHandler,
  DockerOptions,
  BusStateValue,
  NativeBinding,
} from '@stdiobus/node';

// Low-level native binding (for embedded worker support, used by @stdiobus/flow)
import { native } from '@stdiobus/node';
```

## StdioBusOptions

```typescript
interface StdioBusOptions {
  configPath?: string;                          // Path to JSON config file
  config?: StdioBusConfig;                      // Programmatic config object
  backend?: 'auto' | 'native' | 'docker';      // Default: 'auto'
  pollIntervalMs?: number;                      // Default: 10
  listenMode?: 'none' | 'tcp' | 'unix';        // Default: 'none'
  tcpHost?: string;                             // Default: '127.0.0.1'
  tcpPort?: number;                             // Required when listenMode='tcp'
  unixPath?: string;                            // Required when listenMode='unix'
  logLevel?: number;                            // 0=DEBUG, 1=INFO, 2=WARN, 3=ERROR. Default: 1
  docker?: DockerOptions;                       // Docker backend configuration
}
```

**Constraints:**
- `configPath` and `config` are mutually exclusive. Exactly one must be provided.
- `tcpPort` is required when `listenMode` is `'tcp'`.
- `unixPath` is required when `listenMode` is `'unix'`.

## StdioBusConfig

```typescript
interface StdioBusConfig {
  pools: Array<{
    id: string;           // Pool identifier (used as routing key)
    command: string;      // Executable path or name
    args?: string[];      // Command arguments
    instances: number;    // Number of worker processes to spawn
  }>;
  limits?: {
    max_input_buffer?: number;        // Max bytes buffered per worker input (default: 1MB)
    max_output_queue?: number;        // Max bytes queued per worker output (default: 4MB)
    max_restarts?: number;            // Max restarts before giving up (default: 5)
    restart_window_sec?: number;      // Window for counting restarts (default: 60)
    drain_timeout_sec?: number;       // Timeout for draining on stop (default: 30)
    backpressure_timeout_sec?: number; // Backpressure timeout (default: 5)
  };
}
```

## DockerOptions

```typescript
interface DockerOptions {
  image?: string;                    // Default: 'stdiobus/stdiobus:node20'
  pullPolicy?: 'never' | 'if-missing' | 'always';  // Default: 'if-missing'
  enginePath?: string;               // Default: 'docker'
  startupTimeoutMs?: number;         // Default: 15000
  containerNamePrefix?: string;      // Default: 'stdiobus'
  extraArgs?: string[];              // Additional docker run args
  env?: Record<string, string>;      // Environment variables for container
}
```

## RequestOptions

```typescript
interface RequestOptions {
  timeout?: number;      // Request timeout in ms (default: 30000)
  sessionId?: string;    // Session ID for session-aware routing
}
```

## BusStats

```typescript
interface BusStats {
  messagesIn: number;         // Messages sent to workers
  messagesOut: number;        // Messages received from workers
  bytesIn: number;            // Total bytes sent
  bytesOut: number;           // Total bytes received
  workerRestarts: number;     // Number of worker restarts
  routingErrors: number;      // Messages that couldn't be routed
  clientConnects: number;     // Client connections (TCP/Unix)
  clientDisconnects: number;  // Client disconnections
}
```

## MessageHandler

```typescript
type MessageHandler = (message: string) => void;
```

The `message` parameter is a raw JSON string (one NDJSON line). Parse it with `JSON.parse()`.

## StdioBus Class Methods

### constructor(options: StdioBusOptions)

Creates a new StdioBus instance. Does NOT start the bus — call `start()` separately.

Throws:
- `'options is required'` — if no options passed
- `'configPath and config via json are mutually exclusive'` — if both provided
- `'configPath or config via json is required'` — if neither provided
- `'Native backend not available. Use backend: "docker".'` — if native requested but unavailable

### start(): Promise<void>

Starts the bus and spawns all worker processes defined in the config.

- Native backend: calls the C addon's `start()` and begins polling for messages.
- Docker backend: pulls image (if needed), starts container, connects via TCP.

Throws if the bus fails to start.

### stop(timeoutSec?: number): Promise<void>

Graceful shutdown. Sends SIGTERM to workers and waits up to `timeoutSec` (default: 30) for them to exit.

- Native backend: stops polling, signals workers, waits for STOPPED state.
- Docker backend: disconnects socket, runs `docker stop -t <timeout>`.

### destroy(): void

Releases all resources. Must be called after `stop()`.

- Native backend: calls `close()` on the binding.
- Docker backend: kills container if still running.
- Both: cleans up temp config file if programmatic config was used.

### send(message: string): boolean

Sends a raw JSON-RPC string to the bus. Returns `true` if queued successfully.

The message must be valid JSON. The bus adds the newline delimiter internally.

### request<T>(method: string, params?: Record<string, unknown>, options?: RequestOptions): Promise<T>

High-level request/response. Generates a unique ID, sends the request, and resolves when a response with the matching ID arrives.

- `method` — JSON-RPC method name
- `params` — Parameters object (merged with `sessionId` if provided in options)
- `options.timeout` — Timeout in ms (default: 30000)
- `options.sessionId` — Session ID for session-aware routing

Rejects with:
- `'Request timeout: <method>'` — if no response within timeout
- `'Failed to send message'` — if `send()` returns false
- RPC error message — if response contains `error` field

### onMessage(handler: MessageHandler): void

Registers a handler that receives every message from workers. Multiple handlers can be registered.

Handlers receive raw JSON strings. Parse them yourself.

### getState(): number

Returns current bus state as a number:
- `0` — CREATED (constructed, not started)
- `1` — STARTING (start in progress)
- `2` — RUNNING (accepting messages)
- `3` — STOPPING (shutdown in progress)
- `4` — STOPPED (fully stopped)

### isRunning(): boolean

Returns `true` if `getState() === BusState.RUNNING`.

### getStats(): BusStats

Returns a snapshot of runtime statistics.

### getWorkerCount(): number

Returns the number of running worker processes. Returns `-1` for Docker backend.

### getClientCount(): number

Returns the number of connected external clients (TCP/Unix mode). Returns `0` or `1` for Docker backend.

### getBackendType(): 'native' | 'docker'

Returns which backend is active.

### getListenMode(): string

Returns the configured listen mode (`'none'`, `'tcp'`, or `'unix'`).

## NativeBinding Interface (Low-Level)

The `native` export provides direct access to the N-API binding. Used by `@stdiobus/flow` for embedded worker support.

```typescript
interface NativeBinding {
  // Lifecycle
  create(opts: string | Record<string, unknown>): boolean;
  start(): boolean;
  stop(timeoutSec: number): boolean;
  close(): void;

  // Messaging
  send(message: string): boolean;
  poll(timeoutMs: number): string[];

  // State
  getState(): number;
  getStats(): Record<string, number>;
  getClientCount(): number;
  getWorkerCount(): number;

  // Embedded worker (socketpair-based)
  createSocketpair(): { kernelFd: number; jsFd: number };
  registerEmbeddedWorker(kernelFd: number, poolId: string): number;
  unregisterEmbeddedWorker(workerId: number): boolean;
  closeFd(fd: number): boolean;
  writeFd(fd: number, data: string): number;
  readFd(fd: number, maxBytes: number): string | null;
  getFdFlags(fd: number): number;
  setMessageCallback(cb: (msg: string) => void): void;

  // Constants
  STATE_CREATED: number;
  STATE_STARTING: number;
  STATE_RUNNING: number;
  STATE_STOPPING: number;
  STATE_STOPPED: number;
  LISTEN_NONE: number;
  LISTEN_TCP: number;
  LISTEN_UNIX: number;
  O_NONBLOCK: number;
}
```

**Warning:** The native binding is a low-level API. Prefer the `StdioBus` class for application code.

## BusState Constants

```typescript
const BusState = {
  CREATED: 0,
  STARTING: 1,
  RUNNING: 2,
  STOPPING: 3,
  STOPPED: 4,
} as const;
```

## ListenMode Constants

```typescript
const ListenMode = {
  NONE: 'none',
  TCP: 'tcp',
  UNIX: 'unix',
} as const;
```

## BackendMode Constants

```typescript
const BackendMode = {
  AUTO: 'auto',
  NATIVE: 'native',
  DOCKER: 'docker',
} as const;
```
