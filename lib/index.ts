/**
 * @stdiobus/node - Native Node.js binding for stdio_bus
 *
 * This module provides a native integration with stdio_bus,
 * the AI agent transport layer. No external binary required.
 *
 * @example
 * ```typescript
 * import { StdioBus } from '@stdiobus/node';
 *
 * const bus = new StdioBus({
 *   configJson: {
 *     pools: [{ id: 'worker', command: 'node', args: ['./worker.js'], instances: 2 }]
 *   },
 *   onMessage: (msg) => console.log('Received:', msg),
 *   onError: (code, message) => console.error('Error:', code, message)
 * });
 *
 * await bus.start();
 *
 * // Send a message
 * bus.send(JSON.stringify({
 *   jsonrpc: '2.0',
 *   id: '1',
 *   method: 'tools/list',
 *   params: {}
 * }));
 *
 * // Later...
 * await bus.stop();
 * ```
 */

// Load native addon
const binding = require('../build/Release/stdio_bus_native.node');

/**
 * Bus state constants
 */
export const BusState = {
  CREATED: binding.STATE_CREATED as number,
  STARTING: binding.STATE_STARTING as number,
  RUNNING: binding.STATE_RUNNING as number,
  STOPPING: binding.STATE_STOPPING as number,
  STOPPED: binding.STATE_STOPPED as number,
} as const;

export type BusStateType = typeof BusState[keyof typeof BusState];

/**
 * Options for creating a StdioBus instance
 */
export interface StdioBusOptions {
  /** Path to JSON configuration file (mutually exclusive with configJson) */
  configPath?: string;

  /** Programmatic config (mutually exclusive with configPath) */
  configJson?: StdioBusConfig;

  /** Callback when a message is received from workers */
  onMessage?: (message: string) => void;

  /** Callback when an error occurs */
  onError?: (code: number, message: string) => void;

  /** Callback for log messages (optional, defaults to stderr) */
  onLog?: (level: number, message: string) => void;

  /** Callback for worker lifecycle events */
  onWorker?: (workerId: number, event: string) => void;

  /** Log level: 0=DEBUG, 1=INFO, 2=WARN, 3=ERROR (default: 1) */
  logLevel?: number;
}

/**
 * Worker pool configuration
 */
export interface StdioBusPoolConfig {
  /** Unique pool identifier */
  id: string;
  /** Executable path */
  command: string;
  /** Command-line arguments */
  args?: string[];
  /** Number of worker instances (≥1) */
  instances: number;
}

/**
 * Operational limits
 */
export interface StdioBusLimitsConfig {
  /** Per-connection input buffer limit in bytes */
  max_input_buffer?: number;
  /** Per-connection output queue limit in bytes */
  max_output_queue?: number;
  /** Max restarts within time window */
  max_restarts?: number;
  /** Restart counting window in seconds */
  restart_window_sec?: number;
  /** Graceful shutdown timeout in seconds */
  drain_timeout_sec?: number;
  /** Backpressure timeout in seconds */
  backpressure_timeout_sec?: number;
}

/**
 * stdio_bus JSON configuration
 */
export interface StdioBusConfig {
  /** Worker pool definitions (at least one required) */
  pools: StdioBusPoolConfig[];
  /** Operational limits (all optional, defaults applied by C bus) */
  limits?: StdioBusLimitsConfig;
}

/**
 * Statistics from the bus
 */
export interface BusStats {
  messagesIn: number;
  messagesOut: number;
  bytesIn: number;
  bytesOut: number;
  workerRestarts: number;
  routingErrors: number;
}

/**
 * StdioBus - Native stdio_bus integration for Node.js
 *
 * This class wraps the native libstdio_bus library, providing
 * a high-performance, single-threaded message bus for AI agents.
 *
 * Key features:
 * - No external binary required (native addon)
 * - Integrates with Node.js event loop via libuv
 * - Session-based routing to worker processes
 * - Automatic worker lifecycle management
 */
export class StdioBus {
  private native: any;
  private started = false;

  constructor(options: StdioBusOptions) {
    const hasPath = !!options.configPath;
    const hasJson = !!options.configJson;

    if (hasPath && hasJson) {
      throw new Error('configPath and configJson are mutually exclusive');
    }
    if (!hasPath && !hasJson) {
      throw new Error('configPath or configJson is required');
    }

    // For configJson, serialize to string for the native binding
    const nativeOpts: any = { ...options };
    if (hasJson) {
      nativeOpts.configJson = JSON.stringify(options.configJson);
      delete nativeOpts.configPath;
    }

    this.native = new binding.StdioBus(nativeOpts);
  }

  /**
   * Start the bus and spawn worker processes
   *
   * @returns Promise that resolves when workers are ready
   */
  async start(): Promise<void> {
    if (this.started) {
      throw new Error('Bus already started');
    }

    const result = this.native.start();
    if (!result) {
      throw new Error('Failed to start bus');
    }

    this.started = true;
  }

  /**
   * Stop the bus gracefully
   *
   * @param timeoutSec - Maximum time to wait for workers to exit (default: 30)
   * @returns Promise that resolves when stopped
   */
  async stop(timeoutSec = 30): Promise<void> {
    if (!this.started) {
      return;
    }

    this.native.stop(timeoutSec);

    // Wait for state to become STOPPED
    return new Promise((resolve) => {
      const check = () => {
        const state = this.native.getState();
        if (state === BusState.STOPPED) {
          this.started = false;
          resolve();
        } else {
          setImmediate(check);
        }
      };
      check();
    });
  }

  /**
   * Send a message to workers
   *
   * The message is routed based on sessionId (if present).
   * Responses will be delivered via the onMessage callback.
   *
   * @param message - JSON-RPC message string
   * @returns true if message was queued successfully
   */
  send(message: string): boolean {
    if (!this.started) {
      throw new Error('Bus not started');
    }

    return this.native.send(message);
  }

  /**
   * Send a JSON-RPC request and wait for response
   *
   * @param method - RPC method name
   * @param params - Method parameters
   * @param options - Request options
   * @returns Promise with the response
   */
  async request<T = any>(
    method: string,
    params: Record<string, any> = {},
    options: { timeout?: number; sessionId?: string } = {}
  ): Promise<T> {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const timeout = options.timeout ?? 30000;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Request timeout: ${method}`));
      }, timeout);

      // TODO: Implement response correlation
      // This requires tracking pending requests and matching by id

      const message: any = {
        jsonrpc: '2.0',
        id,
        method,
        params,
      };

      if (options.sessionId) {
        message.params = { ...params, sessionId: options.sessionId };
      }

      const success = this.send(JSON.stringify(message));
      if (!success) {
        clearTimeout(timer);
        reject(new Error('Failed to send message'));
      }

      // Note: Response handling needs to be implemented
      // For now, this is a placeholder
    });
  }

  /**
   * Get current bus state
   */
  getState(): BusStateType {
    return this.native.getState();
  }

  /**
   * Get bus statistics
   */
  getStats(): BusStats {
    return this.native.getStats();
  }

  /**
   * Check if bus is running
   */
  isRunning(): boolean {
    return this.native.getState() === BusState.RUNNING;
  }

  /**
   * Destroy the bus and release all resources
   */
  destroy(): void {
    this.native.destroy();
    this.started = false;
  }
}

export default StdioBus;
