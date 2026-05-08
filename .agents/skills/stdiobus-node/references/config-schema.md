# Configuration Schema

Complete reference for `@stdiobus/node` configuration format.

## Config Object Structure

```typescript
interface StdioBusConfig {
  pools: PoolDefinition[];
  limits?: LimitsConfig;
}
```

## Pool Definition

```typescript
interface PoolDefinition {
  id: string;           // Unique pool identifier — used as routing key for messages
  command: string;      // Executable to run (absolute path or PATH-resolved name)
  args?: string[];      // Arguments passed to the command
  instances: number;    // Number of worker processes to spawn (>= 1)
}
```

### Pool ID rules

- Must be unique across all pools in the config
- Used as the routing key — the bus routes messages to the pool matching the method name or explicit routing
- Convention: use descriptive names like `'echo'`, `'mcp-tools'`, `'acp-worker'`

### Command resolution

- Absolute paths: `/usr/bin/node`
- PATH-resolved: `node`, `python3`, `npx`
- The command is spawned with `args` as separate arguments (not shell-expanded)

## Limits Configuration

```typescript
interface LimitsConfig {
  max_input_buffer?: number;         // Default: 1,048,576 (1MB)
  max_output_queue?: number;         // Default: 4,194,304 (4MB)
  max_restarts?: number;             // Default: 5
  restart_window_sec?: number;       // Default: 60
  drain_timeout_sec?: number;        // Default: 30
  backpressure_timeout_sec?: number; // Default: 5
}
```

### Limit descriptions

| Field | Default | Description |
|-------|---------|-------------|
| `max_input_buffer` | 1MB | Maximum bytes buffered per worker's stdin. If exceeded, the message is dropped. |
| `max_output_queue` | 4MB | Maximum bytes queued per worker's stdout. If exceeded, backpressure is applied. |
| `max_restarts` | 5 | Maximum number of restarts allowed within `restart_window_sec`. After this, the worker is permanently dead. |
| `restart_window_sec` | 60 | Time window (seconds) for counting restarts. Restarts outside this window don't count. |
| `drain_timeout_sec` | 30 | How long to wait for workers to drain their output queues during shutdown. |
| `backpressure_timeout_sec` | 5 | How long to wait when a worker's output queue is full before dropping messages. |

## Example: Minimal config

```json
{
  "pools": [
    {
      "id": "echo",
      "command": "node",
      "args": ["./workers/echo.js"],
      "instances": 1
    }
  ]
}
```

## Example: Production config with limits

```json
{
  "pools": [
    {
      "id": "mcp-tools",
      "command": "node",
      "args": ["./workers/mcp-tools.js"],
      "instances": 4
    },
    {
      "id": "acp-agent",
      "command": "node",
      "args": ["./workers/acp-agent.js"],
      "instances": 2
    }
  ],
  "limits": {
    "max_input_buffer": 2097152,
    "max_output_queue": 8388608,
    "max_restarts": 10,
    "restart_window_sec": 120,
    "drain_timeout_sec": 60,
    "backpressure_timeout_sec": 10
  }
}
```

## Example: Using npx for workers

```json
{
  "pools": [
    {
      "id": "registry-worker",
      "command": "npx",
      "args": ["@stdiobus/workers-registry", "acp-worker"],
      "instances": 4
    }
  ]
}
```

## Docker Backend Config

When using the Docker backend, the config file is mounted into the container at
`/app/config.json`. The container runs stdio_bus with TCP listening on port 8765
internally. The SDK maps a random host port to this container port.

Docker-specific options are passed via `StdioBusOptions.docker`:

```typescript
const bus = new StdioBus({
  configPath: './config.json',  // Must be a file path for Docker (mounted into container)
  backend: 'docker',
  docker: {
    image: 'stdiobus/stdiobus:node20',
    pullPolicy: 'if-missing',
    enginePath: 'docker',
    startupTimeoutMs: 15000,
    containerNamePrefix: 'stdiobus',
    extraArgs: ['--memory=512m'],
    env: { LOG_LEVEL: 'debug' },
  },
});
```

**Note:** Programmatic `config` also works with Docker — the SDK writes it to a temp
file and mounts that file into the container.

## Validation Rules

1. `pools` array must have at least one entry
2. Each pool `id` must be unique
3. `instances` must be >= 1
4. `command` must be a non-empty string
5. All `limits` values must be positive integers when provided
6. `max_input_buffer` and `max_output_queue` are in bytes
7. `max_restarts` of 0 means workers are never restarted
