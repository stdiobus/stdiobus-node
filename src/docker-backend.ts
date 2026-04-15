/**
 * Docker Backend for stdio_bus.
 *
 * Runs stdio_bus in a Docker container and communicates via TCP.
 * Works on Windows, macOS, Linux — anywhere Docker is available.
 */

import { spawn, execSync } from 'child_process';
import * as net from 'net';
import * as path from 'path';
import * as fs from 'fs';

import type { BusStats, MessageHandler, DockerOptions } from './types.js';

const DEFAULT_IMAGE = 'stdiobus/stdiobus:node20';
const DEFAULT_STARTUP_TIMEOUT = 15000;
const DEFAULT_CONTAINER_PORT = 8765;

const BusState = { CREATED: 0, STARTING: 1, RUNNING: 2, STOPPING: 3, STOPPED: 4 } as const;

interface DockerBackendOptions {
  configPath: string;
  docker?: DockerOptions;
}

interface ResolvedDockerOpts {
  configPath: string;
  docker: Required<DockerOptions>;
}

export class DockerBackend {
  private options: ResolvedDockerOpts;
  private containerId: string | null = null;
  private hostPort: number | null = null;
  private socket: net.Socket | null = null;
  private state: number = BusState.CREATED;
  private messageHandlers: MessageHandler[] = [];
  private buffer = '';
  private stats: BusStats = {
    messagesIn: 0, messagesOut: 0,
    bytesIn: 0, bytesOut: 0,
    workerRestarts: 0, routingErrors: 0,
    clientConnects: 0, clientDisconnects: 0,
  };

  constructor(opts: DockerBackendOptions) {
    if (!opts?.configPath) throw new Error('configPath is required');

    const configPath = path.resolve(opts.configPath);
    if (!fs.existsSync(configPath)) throw new Error(`Config file not found: ${configPath}`);

    this.options = {
      configPath,
      docker: {
        image: opts.docker?.image ?? DEFAULT_IMAGE,
        pullPolicy: opts.docker?.pullPolicy ?? 'if-missing',
        enginePath: opts.docker?.enginePath ?? 'docker',
        startupTimeoutMs: opts.docker?.startupTimeoutMs ?? DEFAULT_STARTUP_TIMEOUT,
        containerNamePrefix: opts.docker?.containerNamePrefix ?? 'stdiobus',
        extraArgs: opts.docker?.extraArgs ?? [],
        env: opts.docker?.env ?? {},
      },
    };

    this.checkDocker();
  }

  private checkDocker(): void {
    try {
      execSync(`${this.options.docker.enginePath} --version`, { stdio: 'pipe' });
    } catch {
      throw new Error(
        'Docker is not available. Install Docker Desktop or ensure docker CLI is in PATH.\n' +
        'Download: https://www.docker.com/products/docker-desktop'
      );
    }
  }

  private pullImage(): void {
    const { image, pullPolicy, enginePath } = this.options.docker;
    if (pullPolicy === 'never') return;
    if (pullPolicy === 'if-missing') {
      try { execSync(`${enginePath} image inspect ${image}`, { stdio: 'pipe' }); return; }
      catch { /* pull below */ }
    }
    console.log(`[stdio_bus:docker] Pulling image ${image}...`);
    try { execSync(`${enginePath} pull ${image}`, { stdio: 'inherit' }); }
    catch { throw new Error(`Failed to pull Docker image: ${image}`); }
  }

  private findFreePort(): Promise<number> {
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.listen(0, '127.0.0.1', () => {
        const addr = server.address() as net.AddressInfo;
        server.close(() => resolve(addr.port));
      });
      server.on('error', reject);
    });
  }

  private async startContainer(): Promise<void> {
    const { image, enginePath, containerNamePrefix, extraArgs, env } = this.options.docker;
    this.hostPort = await this.findFreePort();
    const containerName = `${containerNamePrefix}-${Date.now()}`;

    const args = [
      'run', '--rm', '-d', '--name', containerName,
      '-p', `127.0.0.1:${this.hostPort}:${DEFAULT_CONTAINER_PORT}`,
      '-v', `${this.options.configPath}:/app/config.json:ro`,
    ];
    for (const [k, v] of Object.entries(env)) args.push('-e', `${k}=${v}`);
    args.push(...extraArgs, image, '--config', '/app/config.json', '--tcp', `0.0.0.0:${DEFAULT_CONTAINER_PORT}`);

    return new Promise((resolve, reject) => {
      const proc = spawn(enginePath, args, { stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '', stderr = '';
      proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
      proc.stderr.on('data', (d: Buffer) => { stderr += d.toString(); });
      proc.on('close', (code) => {
        if (code === 0) { this.containerId = stdout.trim().slice(0, 12); resolve(); }
        else reject(new Error(`Failed to start container: ${stderr || stdout}`));
      });
      proc.on('error', (err) => reject(new Error(`Failed to run docker: ${err.message}`)));
    });
  }

  private async waitForReady(): Promise<void> {
    const deadline = Date.now() + this.options.docker.startupTimeoutMs;
    while (Date.now() < deadline) {
      try { await this.connect(); return; }
      catch { await new Promise(r => setTimeout(r, 100)); }
    }
    throw new Error(`Container failed to become ready within ${this.options.docker.startupTimeoutMs}ms`);
  }

  private connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({ host: '127.0.0.1', port: this.hostPort! });
      socket.setTimeout(1000);
      socket.on('connect', () => { socket.setTimeout(0); this.socket = socket; this.setupSocket(); resolve(); });
      socket.on('error', (err) => { socket.destroy(); reject(err); });
      socket.on('timeout', () => { socket.destroy(); reject(new Error('Connection timeout')); });
    });
  }

  private setupSocket(): void {
    this.socket!.on('data', (data: Buffer) => {
      this.buffer += data.toString();
      this.stats.bytesOut += data.length;
      let idx: number;
      while ((idx = this.buffer.indexOf('\n')) !== -1) {
        const line = this.buffer.slice(0, idx);
        this.buffer = this.buffer.slice(idx + 1);
        if (line.trim()) {
          this.stats.messagesOut++;
          for (const h of this.messageHandlers) { try { h(line); } catch (e) { console.error('[stdio_bus:docker] Handler error:', e); } }
        }
      }
    });
    this.socket!.on('close', () => { if (this.state === BusState.RUNNING) { this.state = BusState.STOPPED; this.stats.clientDisconnects++; } });
    this.socket!.on('error', (err) => console.error('[stdio_bus:docker] Socket error:', err.message));
  }

  onMessage(handler: MessageHandler): void { this.messageHandlers.push(handler); }

  async start(): Promise<void> {
    if (this.state !== BusState.CREATED) throw new Error('Bus already started');
    this.state = BusState.STARTING;
    try { this.pullImage(); await this.startContainer(); await this.waitForReady(); this.state = BusState.RUNNING; this.stats.clientConnects++; }
    catch (err) { this.state = BusState.STOPPED; throw err; }
  }

  async stop(timeoutSec = 30): Promise<void> {
    if (this.state !== BusState.RUNNING) return;
    this.state = BusState.STOPPING;
    if (this.socket) { this.socket.destroy(); this.socket = null; }
    if (this.containerId) {
      try { execSync(`${this.options.docker.enginePath} stop -t ${timeoutSec} ${this.containerId}`, { stdio: 'pipe' }); } catch { /* ok */ }
      this.containerId = null;
    }
    this.state = BusState.STOPPED;
  }

  send(message: string): boolean {
    if (this.state !== BusState.RUNNING || !this.socket) return false;
    try { const d = message.endsWith('\n') ? message : message + '\n'; this.socket.write(d); this.stats.messagesIn++; this.stats.bytesIn += d.length; return true; }
    catch { return false; }
  }

  getState(): number { return this.state; }
  getStats(): BusStats { return { ...this.stats }; }
  getClientCount(): number { return this.socket ? 1 : 0; }
  getWorkerCount(): number { return -1; }
  isRunning(): boolean { return this.state === BusState.RUNNING; }

  destroy(): void {
    if (this.socket) { this.socket.destroy(); this.socket = null; }
    if (this.containerId) { try { execSync(`${this.options.docker.enginePath} kill ${this.containerId}`, { stdio: 'pipe' }); } catch { /* ok */ } this.containerId = null; }
    this.state = BusState.STOPPED;
  }
}
