/** Bus state constants */
export const BusState = {
  CREATED: 0,
  STARTING: 1,
  RUNNING: 2,
  STOPPING: 3,
  STOPPED: 4,
} as const;

export type BusStateValue = typeof BusState[keyof typeof BusState];

/** Listen mode constants */
export const ListenMode = {
  NONE: 'none',
  TCP: 'tcp',
  UNIX: 'unix',
} as const;

export type ListenModeValue = typeof ListenMode[keyof typeof ListenMode];

/** Backend mode constants */
export const BackendMode = {
  AUTO: 'auto',
  NATIVE: 'native',
  DOCKER: 'docker',
} as const;

export type BackendModeValue = typeof BackendMode[keyof typeof BackendMode];

export interface DockerOptions {
  image?: string;
  pullPolicy?: 'never' | 'if-missing' | 'always';
  enginePath?: string;
  startupTimeoutMs?: number;
  containerNamePrefix?: string;
  extraArgs?: string[];
  env?: Record<string, string>;
}

export interface StdioBusConfig {
  pools: Array<{
    id: string;
    command: string;
    args?: string[];
    instances: number;
  }>;
  limits?: {
    max_input_buffer?: number;
    max_output_queue?: number;
    max_restarts?: number;
    restart_window_sec?: number;
    drain_timeout_sec?: number;
    backpressure_timeout_sec?: number;
  };
}

export interface StdioBusOptions {
  configPath?: string;
  configJson?: StdioBusConfig;
  backend?: 'auto' | 'native' | 'docker';
  pollIntervalMs?: number;
  listenMode?: 'none' | 'tcp' | 'unix';
  tcpHost?: string;
  tcpPort?: number;
  unixPath?: string;
  logLevel?: number;
  docker?: DockerOptions;
}

export interface RequestOptions {
  timeout?: number;
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
