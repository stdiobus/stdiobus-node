/**
 * @stdiobus/node — Native Node.js binding for stdio_bus
 *
 * Two backends:
 * - native: Direct C integration via N-API (macOS, Linux)
 * - docker: Runs stdio_bus in Docker container (any platform)
 */

import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

import { BusState, ListenMode, BackendMode } from './types.js';
import type {
  StdioBusOptions, RequestOptions, BusStats,
  MessageHandler,
} from './types.js';
import { loadNativeAddon } from './load-native.js';
import type { NativeBinding } from './load-native.js';
import { DockerBackend } from './docker-backend.js';

export { BusState, ListenMode, BackendMode };
export type {
  StdioBusOptions, RequestOptions, BusStats, MessageHandler,
  DockerOptions, StdioBusConfig, BusStateValue,
} from './types.js';
export type { NativeBinding } from './load-native.js';

function isNativeAvailable(): boolean {
  if (os.platform() === 'win32') return false;
  try { loadNativeAddon(); return true; } catch { return false; }
}

function resolveBackend(mode: string): 'native' | 'docker' {
  if (mode === 'native') {
    if (!isNativeAvailable()) throw new Error('Native backend not available. Use backend: "docker".');
    return 'native';
  }
  if (mode === 'docker') return 'docker';
  return isNativeAvailable() ? 'native' : 'docker';
}

export class StdioBus {
  private backend: NativeBinding | DockerBackend;
  private backendType: 'native' | 'docker';
  private messageHandlers: MessageHandler[] = [];
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private listenMode: string;
  private pollIntervalMs: number;
  private configPath: string | undefined;
  private tempConfigPath: string | null = null;

  constructor(options: StdioBusOptions) {
    if (!options) throw new Error('options is required');

    const hasPath = !!options.configPath;
    const hasJson = !!options.configJson;
    if (hasPath && hasJson) throw new Error('configPath and configJson are mutually exclusive');
    if (!hasPath && !hasJson) throw new Error('configPath or configJson is required');

    this.backendType = resolveBackend(options.backend ?? 'auto');
    this.listenMode = options.listenMode ?? ListenMode.NONE;
    this.pollIntervalMs = options.pollIntervalMs ?? 10;
    this.configPath = options.configPath;

    if (hasJson && !hasPath) {
      const tmpFile = path.join(os.tmpdir(), `stdiobus-${process.pid}-${Date.now()}.json`);
      fs.writeFileSync(tmpFile, JSON.stringify(options.configJson), { mode: 0o600 });
      this.configPath = tmpFile;
      this.tempConfigPath = tmpFile;
    }

    if (this.backendType === 'native') {
      this.backend = this.initNative({ ...options, configPath: this.configPath });
    } else {
      this.backend = new DockerBackend({ ...options, configPath: this.configPath! });
    }
  }

  private initNative(options: StdioBusOptions & { configPath?: string }): NativeBinding {
    const binding = loadNativeAddon();
    const nativeOpts: Record<string, unknown> = {
      configPath: options.configPath,
      listenMode: options.listenMode ?? 'none',
      logLevel: options.logLevel ?? 1,
    };
    if (options.listenMode === 'tcp') {
      nativeOpts.tcpHost = options.tcpHost ?? '127.0.0.1';
      nativeOpts.tcpPort = options.tcpPort;
      if (!nativeOpts.tcpPort) throw new Error('tcpPort is required for TCP mode');
    } else if (options.listenMode === 'unix') {
      nativeOpts.unixPath = options.unixPath;
      if (!nativeOpts.unixPath) throw new Error('unixPath is required for Unix mode');
    }
    if (!binding.create(nativeOpts)) throw new Error('Failed to create stdio_bus instance');
    return binding;
  }

  getBackendType(): 'native' | 'docker' { return this.backendType; }

  onMessage(handler: MessageHandler): void {
    this.messageHandlers.push(handler);
    if (this.backendType === 'docker') (this.backend as DockerBackend).onMessage(handler);
  }

  async start(): Promise<void> {
    if (this.backendType === 'native') {
      const b = this.backend as NativeBinding;
      if (!b.start()) throw new Error('Failed to start bus');
      this.pollInterval = setInterval(() => {
        for (const msg of b.poll(0)) {
          for (const h of this.messageHandlers) { try { h(msg); } catch (e) { console.error('[stdio_bus] Handler error:', e); } }
        }
      }, this.pollIntervalMs);
    } else {
      await (this.backend as DockerBackend).start();
    }
  }

  async stop(timeoutSec = 30): Promise<void> {
    if (this.backendType === 'native') {
      if (this.pollInterval) { clearInterval(this.pollInterval); this.pollInterval = null; }
      const b = this.backend as NativeBinding;
      b.stop(timeoutSec);
      await new Promise<void>((resolve) => {
        const check = () => { b.poll(100); if (b.getState() === BusState.STOPPED) resolve(); else setTimeout(check, 50); };
        check();
      });
    } else {
      await (this.backend as DockerBackend).stop(timeoutSec);
    }
  }

  send(message: string): boolean {
    return this.backendType === 'native'
      ? (this.backend as NativeBinding).send(message)
      : (this.backend as DockerBackend).send(message);
  }

  async request<T = unknown>(method: string, params: Record<string, unknown> = {}, options: RequestOptions = {}): Promise<T> {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const timeout = options.timeout ?? 30000;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(new Error(`Request timeout: ${method}`)); }, timeout);

      const handler: MessageHandler = (msg) => {
        try {
          const resp = JSON.parse(msg);
          if (resp.id === id) {
            cleanup();
            if (resp.error) reject(new Error(resp.error.message ?? 'RPC error'));
            else resolve(resp.result as T);
          }
        } catch { /* not our response */ }
      };

      const cleanup = () => {
        clearTimeout(timer);
        this.messageHandlers = this.messageHandlers.filter(h => h !== handler);
      };

      this.messageHandlers.push(handler);
      if (this.backendType === 'docker') (this.backend as DockerBackend).onMessage(handler);

      const msg = JSON.stringify({
        jsonrpc: '2.0', id, method,
        params: options.sessionId ? { ...params, sessionId: options.sessionId } : params,
      });
      if (!this.send(msg)) { cleanup(); reject(new Error('Failed to send message')); }
    });
  }

  getState(): number {
    return this.backendType === 'native'
      ? (this.backend as NativeBinding).getState()
      : (this.backend as DockerBackend).getState();
  }

  getStats(): BusStats {
    return this.backendType === 'native'
      ? (this.backend as NativeBinding).getStats() as unknown as BusStats
      : (this.backend as DockerBackend).getStats();
  }

  getClientCount(): number {
    return this.backendType === 'native'
      ? (this.backend as NativeBinding).getClientCount()
      : (this.backend as DockerBackend).getClientCount();
  }

  getWorkerCount(): number {
    return this.backendType === 'native'
      ? (this.backend as NativeBinding).getWorkerCount()
      : (this.backend as DockerBackend).getWorkerCount();
  }

  getListenMode(): string { return this.listenMode; }

  isRunning(): boolean {
    return this.getState() === BusState.RUNNING;
  }

  destroy(): void {
    if (this.pollInterval) { clearInterval(this.pollInterval); this.pollInterval = null; }
    if (this.backendType === 'native') (this.backend as NativeBinding).close();
    else (this.backend as DockerBackend).destroy();
    if (this.tempConfigPath) { try { fs.unlinkSync(this.tempConfigPath); } catch { /* ok */ } this.tempConfigPath = null; }
  }
}

/** Native binding primitives for embedded worker support. Used by @stdiobus/flow. */
export const native: NativeBinding = loadNativeAddon();

export default StdioBus;
