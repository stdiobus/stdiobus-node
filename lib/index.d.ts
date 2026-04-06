/**
 * @stdiobus/node - Native Node.js binding for stdio_bus
 */

export interface BusState {
  CREATED: 0;
  STARTING: 1;
  RUNNING: 2;
  STOPPING: 3;
  STOPPED: 4;
}

export interface ListenMode {
  NONE: 'none';
  TCP: 'tcp';
  UNIX: 'unix';
}

export interface BackendMode {
  AUTO: 'auto';
  NATIVE: 'native';
  DOCKER: 'docker';
}

export const BusState: BusState;
export const ListenMode: ListenMode;
export const BackendMode: BackendMode;

export interface DockerOptions {
  /** Docker image (default: stdiobus/stdiobus:node20) */
  image?: string;
  /** Pull policy: 'never', 'if-missing', 'always' (default: 'if-missing') */
  pullPolicy?: 'never' | 'if-missing' | 'always';
  /** Path to docker CLI (default: 'docker') */
  enginePath?: string;
  /** Container startup timeout in ms (default: 15000) */
  startupTimeoutMs?: number;
  /** Container name prefix (default: 'stdiobus') */
  containerNamePrefix?: string;
  /** Extra docker run arguments */
  extraArgs?: string[];
  /** Environment variables for container */
  env?: Record<string, string>;
}

export interface StdioBusOptions {
  /** Path to JSON configuration file (required) */
  configPath: string;
  /** Backend mode: 'auto', 'native', or 'docker' (default: 'auto') */
  backend?: 'auto' | 'native' | 'docker';
  /** Polling interval in milliseconds (native backend only, default: 10) */
  pollIntervalMs?: number;
  /** Listen mode: 'none', 'tcp', or 'unix' (native backend only) */
  listenMode?: 'none' | 'tcp' | 'unix';
  /** TCP bind address (native tcp mode, default: '127.0.0.1') */
  tcpHost?: string;
  /** TCP port number (required for native tcp mode) */
  tcpPort?: number;
  /** Unix socket path (required for native unix mode) */
  unixPath?: string;
  /** Log level: 0=DEBUG, 1=INFO, 2=WARN, 3=ERROR (native backend only) */
  logLevel?: number;
  /** Docker backend options */
  docker?: DockerOptions;
}

export interface RequestOptions {
  /** Timeout in milliseconds (default: 30000) */
  timeout?: number;
  /** Session ID for routing */
  sessionId?: string;
}

export interface BusStats {
  messagesIn: number;
  messagesOut: number;
  bytesIn: number;
  bytesOut: number;
  workerRestarts: number;
  routingErrors: number;
  clientConnects: number;
  clientDisconnects: number;
}

export type MessageHandler = (message: string) => void;

export class StdioBus {
  /**
   * Create a new StdioBus instance
   *
   * @example
   * // Native backend (default on macOS/Linux)
   * const bus = new StdioBus({ configPath: './config.json' });
   *
   * @example
   * // Docker backend (required on Windows, optional elsewhere)
   * const bus = new StdioBus({
   *   configPath: './config.json',
   *   backend: 'docker',
   *   docker: { image: 'stdiobus/stdiobus:node20' }
   * });
   */
  constructor(options: StdioBusOptions);

  /** Get the backend type being used: 'native' or 'docker' */
  getBackendType(): 'native' | 'docker';

  /** Register a message handler */
  onMessage(handler: MessageHandler): void;

  /** Start the bus and spawn worker processes */
  start(): Promise<void>;

  /** Stop the bus gracefully */
  stop(timeoutSec?: number): Promise<void>;

  /** Send a message to workers */
  send(message: string): boolean;

  /** Send a JSON-RPC request and wait for response */
  request<T = any>(method: string, params?: object, options?: RequestOptions): Promise<T>;

  /** Get current bus state */
  getState(): number;

  /** Get bus statistics */
  getStats(): BusStats;

  /** Get number of connected clients (TCP/Unix modes) */
  getClientCount(): number;

  /** Get number of running workers (-1 if unknown for docker backend) */
  getWorkerCount(): number;

  /** Get the listen mode */
  getListenMode(): string;

  /** Check if bus is running */
  isRunning(): boolean;

  /** Destroy the bus and release all resources */
  destroy(): void;
}

export default StdioBus;
