/**
 * Docker Backend for stdio_bus
 *
 * Runs stdio_bus in a Docker container and communicates via TCP.
 * Works on Windows, macOS, Linux - anywhere Docker is available.
 */

const { spawn, execSync } = require('child_process');
const net = require('net');
const path = require('path');
const fs = require('fs');
const os = require('os');

const DEFAULT_IMAGE = 'stdiobus/stdiobus:node20';
const DEFAULT_STARTUP_TIMEOUT = 15000;
const DEFAULT_CONTAINER_PORT = 8765;

/**
 * Bus state constants (matching native backend)
 */
const BusState = {
  CREATED: 0,
  STARTING: 1,
  RUNNING: 2,
  STOPPING: 3,
  STOPPED: 4,
};

class DockerBackend {
  #options = null;
  #containerId = null;
  #hostPort = null;
  #socket = null;
  #state = BusState.CREATED;
  #messageHandlers = [];
  #buffer = '';
  #stats = {
    messagesIn: 0,
    messagesOut: 0,
    bytesIn: 0,
    bytesOut: 0,
    workerRestarts: 0,
    routingErrors: 0,
    clientConnects: 0,
    clientDisconnects: 0,
  };

  /**
   * @param {Object} options
   * @param {string} options.configPath - Path to config file
   * @param {Object} [options.docker] - Docker-specific options
   */
  constructor(options) {
    if (!options || !options.configPath) {
      throw new Error('configPath is required');
    }

    // Resolve config path to absolute
    const configPath = path.resolve(options.configPath);
    if (!fs.existsSync(configPath)) {
      throw new Error(`Config file not found: ${configPath}`);
    }

    this.#options = {
      configPath,
      docker: {
        image: options.docker?.image || DEFAULT_IMAGE,
        pullPolicy: options.docker?.pullPolicy || 'if-missing',
        enginePath: options.docker?.enginePath || 'docker',
        startupTimeoutMs: options.docker?.startupTimeoutMs || DEFAULT_STARTUP_TIMEOUT,
        containerNamePrefix: options.docker?.containerNamePrefix || 'stdiobus',
        extraArgs: options.docker?.extraArgs || [],
        env: options.docker?.env || {},
      },
    };

    // Check Docker availability
    this.#checkDocker();
  }

  #checkDocker() {
    try {
      execSync(`${this.#options.docker.enginePath} --version`, { stdio: 'pipe' });
    } catch (err) {
      throw new Error(
        'Docker is not available. Please install Docker Desktop or ensure docker CLI is in PATH.\n' +
        'Download: https://www.docker.com/products/docker-desktop'
      );
    }
  }

  #pullImage() {
    const { image, pullPolicy, enginePath } = this.#options.docker;

    if (pullPolicy === 'never') {
      return;
    }

    if (pullPolicy === 'if-missing') {
      try {
        execSync(`${enginePath} image inspect ${image}`, { stdio: 'pipe' });
        return; // Image exists
      } catch {
        // Image doesn't exist, pull it
      }
    }

    console.log(`[stdio_bus:docker] Pulling image ${image}...`);
    try {
      execSync(`${enginePath} pull ${image}`, { stdio: 'inherit' });
    } catch (err) {
      throw new Error(`Failed to pull Docker image: ${image}`);
    }
  }

  #findFreePort() {
    return new Promise((resolve, reject) => {
      const server = net.createServer();
      server.listen(0, '127.0.0.1', () => {
        const port = server.address().port;
        server.close(() => resolve(port));
      });
      server.on('error', reject);
    });
  }

  async #startContainer() {
    const { image, enginePath, containerNamePrefix, extraArgs, env } = this.#options.docker;
    const configPath = this.#options.configPath;

    this.#hostPort = await this.#findFreePort();
    const containerName = `${containerNamePrefix}-${Date.now()}`;

    // Build docker run command
    const args = [
      'run',
      '--rm',
      '-d',
      '--name', containerName,
      '-p', `127.0.0.1:${this.#hostPort}:${DEFAULT_CONTAINER_PORT}`,
      '-v', `${configPath}:/app/config.json:ro`,
    ];

    // Add environment variables
    for (const [key, value] of Object.entries(env)) {
      args.push('-e', `${key}=${value}`);
    }

    // Add extra args
    args.push(...extraArgs);

    // Add image and command
    args.push(image);
    args.push('--config', '/app/config.json');
    args.push('--tcp', `0.0.0.0:${DEFAULT_CONTAINER_PORT}`);

    return new Promise((resolve, reject) => {
      const proc = spawn(enginePath, args, { stdio: ['pipe', 'pipe', 'pipe'] });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (data) => { stdout += data.toString(); });
      proc.stderr.on('data', (data) => { stderr += data.toString(); });

      proc.on('close', (code) => {
        if (code === 0) {
          this.#containerId = stdout.trim().slice(0, 12);
          resolve();
        } else {
          reject(new Error(`Failed to start container: ${stderr || stdout}`));
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`Failed to run docker: ${err.message}`));
      });
    });
  }

  async #waitForReady() {
    const { startupTimeoutMs } = this.#options.docker;
    const startTime = Date.now();

    while (Date.now() - startTime < startupTimeoutMs) {
      try {
        await this.#connect();
        return;
      } catch {
        await new Promise(r => setTimeout(r, 100));
      }
    }

    throw new Error(`Container failed to become ready within ${startupTimeoutMs}ms`);
  }

  #connect() {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection({
        host: '127.0.0.1',
        port: this.#hostPort,
      });

      socket.setTimeout(1000);

      socket.on('connect', () => {
        socket.setTimeout(0);
        this.#socket = socket;
        this.#setupSocket();
        resolve();
      });

      socket.on('error', (err) => {
        socket.destroy();
        reject(err);
      });

      socket.on('timeout', () => {
        socket.destroy();
        reject(new Error('Connection timeout'));
      });
    });
  }

  #setupSocket() {
    this.#socket.on('data', (data) => {
      this.#buffer += data.toString();
      this.#stats.bytesOut += data.length;

      let newlineIndex;
      while ((newlineIndex = this.#buffer.indexOf('\n')) !== -1) {
        const line = this.#buffer.slice(0, newlineIndex);
        this.#buffer = this.#buffer.slice(newlineIndex + 1);

        if (line.trim()) {
          this.#stats.messagesOut++;
          for (const handler of this.#messageHandlers) {
            try {
              handler(line);
            } catch (err) {
              console.error('[stdio_bus:docker] Message handler error:', err);
            }
          }
        }
      }
    });

    this.#socket.on('close', () => {
      if (this.#state === BusState.RUNNING) {
        this.#state = BusState.STOPPED;
        this.#stats.clientDisconnects++;
      }
    });

    this.#socket.on('error', (err) => {
      console.error('[stdio_bus:docker] Socket error:', err.message);
    });
  }

  onMessage(handler) {
    this.#messageHandlers.push(handler);
  }

  async start() {
    if (this.#state !== BusState.CREATED) {
      throw new Error('Bus already started');
    }

    this.#state = BusState.STARTING;

    try {
      this.#pullImage();
      await this.#startContainer();
      await this.#waitForReady();
      this.#state = BusState.RUNNING;
      this.#stats.clientConnects++;
    } catch (err) {
      this.#state = BusState.STOPPED;
      throw err;
    }
  }

  async stop(timeoutSec = 30) {
    if (this.#state !== BusState.RUNNING) {
      return;
    }

    this.#state = BusState.STOPPING;

    // Close socket
    if (this.#socket) {
      this.#socket.destroy();
      this.#socket = null;
    }

    // Stop container
    if (this.#containerId) {
      const { enginePath } = this.#options.docker;
      try {
        execSync(`${enginePath} stop -t ${timeoutSec} ${this.#containerId}`, { stdio: 'pipe' });
      } catch {
        // Container may already be stopped
      }
      this.#containerId = null;
    }

    this.#state = BusState.STOPPED;
  }

  send(message) {
    if (this.#state !== BusState.RUNNING || !this.#socket) {
      return false;
    }

    try {
      const data = message.endsWith('\n') ? message : message + '\n';
      this.#socket.write(data);
      this.#stats.messagesIn++;
      this.#stats.bytesIn += data.length;
      return true;
    } catch {
      return false;
    }
  }

  getState() {
    return this.#state;
  }

  getStats() {
    return { ...this.#stats };
  }

  getClientCount() {
    return this.#socket ? 1 : 0;
  }

  getWorkerCount() {
    // Can't know from outside container, return -1 to indicate unknown
    return -1;
  }

  isRunning() {
    return this.#state === BusState.RUNNING;
  }

  destroy() {
    if (this.#socket) {
      this.#socket.destroy();
      this.#socket = null;
    }

    if (this.#containerId) {
      const { enginePath } = this.#options.docker;
      try {
        execSync(`${enginePath} kill ${this.#containerId}`, { stdio: 'pipe' });
      } catch {
        // Ignore
      }
      this.#containerId = null;
    }

    this.#state = BusState.STOPPED;
  }
}

module.exports = { DockerBackend, BusState };
