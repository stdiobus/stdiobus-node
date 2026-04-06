/**
 * @stdiobus/node - Native Node.js binding for stdio_bus
 *
 * This module provides integration with stdio_bus, the AI agent transport layer.
 *
 * Two backends available:
 * - native: Direct C integration via N-API (macOS, Linux)
 * - docker: Runs stdio_bus in Docker container (Windows, macOS, Linux, servers)
 *
 * @example
 * ```javascript
 * const { StdioBus } = require('@stdiobus/node');
 *
 * // Native backend (default on macOS/Linux)
 * const bus = new StdioBus({ configPath: './config.json' });
 *
 * // Docker backend (required on Windows, optional elsewhere)
 * const bus = new StdioBus({
 *   configPath: './config.json',
 *   backend: 'docker',
 *   docker: { image: 'stdiobus/stdiobus:node20' }
 * });
 *
 * await bus.start();
 * bus.onMessage((msg) => console.log('Received:', msg));
 * bus.send(JSON.stringify({ jsonrpc: '2.0', id: '1', method: 'tools/list', params: {} }));
 * await bus.stop();
 * ```
 */

const os = require('os');

/**
 * Bus state constants
 */
const BusState = {
  CREATED: 0,
  STARTING: 1,
  RUNNING: 2,
  STOPPING: 3,
  STOPPED: 4,
};

/**
 * Listen mode constants
 */
const ListenMode = {
  NONE: 'none',
  TCP: 'tcp',
  UNIX: 'unix',
};

/**
 * Backend mode constants
 */
const BackendMode = {
  AUTO: 'auto',
  NATIVE: 'native',
  DOCKER: 'docker',
};

/**
 * Check if native backend is available
 */
function isNativeAvailable() {
  if (os.platform() === 'win32') {
    return false;
  }
  try {
    require('./load-native');
    return true;
  } catch {
    return false;
  }
}

/**
 * Determine which backend to use
 */
function resolveBackend(mode) {
  if (mode === 'native') {
    if (!isNativeAvailable()) {
      throw new Error(
        'Native backend not available on this platform. ' +
        'Use backend: "docker" instead.'
      );
    }
    return 'native';
  }

  if (mode === 'docker') {
    return 'docker';
  }

  // auto mode
  if (isNativeAvailable()) {
    return 'native';
  }
  return 'docker';
}

/**
 * StdioBus - stdio_bus integration for Node.js
 *
 * Supports two backends:
 * - native: Direct C integration (macOS, Linux)
 * - docker: Docker container (Windows, macOS, Linux)
 */
class StdioBus {
  #backend = null;
  #backendType = null;
  #messageHandlers = [];
  #pollInterval = null;
  #listenMode = ListenMode.NONE;

  /**
   * Create a new StdioBus instance
   * @param {Object} options
   * @param {string} options.configPath - Path to JSON configuration file
   * @param {string} [options.backend='auto'] - Backend: 'auto', 'native', or 'docker'
   * @param {number} [options.pollIntervalMs=10] - Polling interval (native only)
   * @param {string} [options.listenMode='none'] - Listen mode: 'none', 'tcp', 'unix' (native only)
   * @param {string} [options.tcpHost='127.0.0.1'] - TCP bind address (native tcp mode)
   * @param {number} [options.tcpPort] - TCP port (native tcp mode)
   * @param {string} [options.unixPath] - Unix socket path (native unix mode)
   * @param {number} [options.logLevel=1] - Log level (native only)
   * @param {Object} [options.docker] - Docker backend options
   * @param {string} [options.docker.image] - Docker image (default: stdiobus/stdiobus:node20)
   * @param {string} [options.docker.pullPolicy] - Pull policy: 'never', 'if-missing', 'always'
   * @param {string} [options.docker.enginePath] - Path to docker CLI
   * @param {number} [options.docker.startupTimeoutMs] - Container startup timeout
   * @param {string} [options.docker.containerNamePrefix] - Container name prefix
   * @param {string[]} [options.docker.extraArgs] - Extra docker run arguments
   * @param {Object} [options.docker.env] - Environment variables for container
   */
  constructor(options) {
    if (!options || !options.configPath) {
      throw new Error('configPath is required');
    }

    this.#backendType = resolveBackend(options.backend || 'auto');
    this.#listenMode = options.listenMode || ListenMode.NONE;
    this.pollIntervalMs = options.pollIntervalMs || 10;

    if (this.#backendType === 'native') {
      this.#initNativeBackend(options);
    } else {
      this.#initDockerBackend(options);
    }
  }

  #initNativeBackend(options) {
    const binding = require('./load-native');

    const nativeOpts = {
      configPath: options.configPath,
      listenMode: options.listenMode || 'none',
      logLevel: options.logLevel ?? 1,
    };

    if (options.listenMode === 'tcp') {
      nativeOpts.tcpHost = options.tcpHost || '127.0.0.1';
      nativeOpts.tcpPort = options.tcpPort;
      if (!nativeOpts.tcpPort) {
        throw new Error('tcpPort is required for TCP mode');
      }
    } else if (options.listenMode === 'unix') {
      nativeOpts.unixPath = options.unixPath;
      if (!nativeOpts.unixPath) {
        throw new Error('unixPath is required for Unix mode');
      }
    }

    const created = binding.create(nativeOpts);
    if (!created) {
      throw new Error('Failed to create stdio_bus instance');
    }

    this.#backend = binding;
  }

  #initDockerBackend(options) {
    const { DockerBackend } = require('./docker-backend');
    this.#backend = new DockerBackend(options);
  }

  /**
   * Get the backend type being used
   * @returns {string} 'native' or 'docker'
   */
  getBackendType() {
    return this.#backendType;
  }

  /**
   * Register a message handler
   * @param {Function} handler - Called with (message: string)
   */
  onMessage(handler) {
    this.#messageHandlers.push(handler);

    if (this.#backendType === 'docker') {
      this.#backend.onMessage(handler);
    }
  }

  /**
   * Start the bus
   * @returns {Promise<void>}
   */
  async start() {
    if (this.#backendType === 'native') {
      await this.#startNative();
    } else {
      await this.#backend.start();
    }
  }

  async #startNative() {
    const result = this.#backend.start();
    if (!result) {
      throw new Error('Failed to start bus');
    }

    // Start polling for messages
    this.#pollInterval = setInterval(() => {
      const messages = this.#backend.poll(0);
      for (const msg of messages) {
        for (const handler of this.#messageHandlers) {
          try {
            handler(msg);
          } catch (err) {
            console.error('[stdio_bus] Message handler error:', err);
          }
        }
      }
    }, this.pollIntervalMs);
  }

  /**
   * Stop the bus gracefully
   * @param {number} [timeoutSec=30] - Maximum time to wait
   * @returns {Promise<void>}
   */
  async stop(timeoutSec = 30) {
    if (this.#backendType === 'native') {
      await this.#stopNative(timeoutSec);
    } else {
      await this.#backend.stop(timeoutSec);
    }
  }

  async #stopNative(timeoutSec) {
    if (this.#pollInterval) {
      clearInterval(this.#pollInterval);
      this.#pollInterval = null;
    }

    this.#backend.stop(timeoutSec);

    return new Promise((resolve) => {
      const check = () => {
        this.#backend.poll(100);
        const state = this.#backend.getState();
        if (state === BusState.STOPPED) {
          resolve();
        } else {
          setTimeout(check, 50);
        }
      };
      check();
    });
  }

  /**
   * Send a message to workers
   * @param {string} message - JSON-RPC message string
   * @returns {boolean}
   */
  send(message) {
    return this.#backend.send(message);
  }

  /**
   * Send a JSON-RPC request and wait for response
   * @param {string} method - RPC method name
   * @param {Object} [params={}] - Method parameters
   * @param {Object} [options={}] - Request options
   * @param {number} [options.timeout=30000] - Timeout in milliseconds
   * @param {string} [options.sessionId] - Session ID for routing
   * @returns {Promise<any>}
   */
  async request(method, params = {}, options = {}) {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const timeout = options.timeout ?? 30000;

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error(`Request timeout: ${method}`));
      }, timeout);

      const handler = (msg) => {
        try {
          const response = JSON.parse(msg);
          if (response.id === id) {
            cleanup();
            if (response.error) {
              reject(new Error(response.error.message || 'RPC error'));
            } else {
              resolve(response.result);
            }
          }
        } catch {
          // Not JSON or not our response
        }
      };

      const cleanup = () => {
        clearTimeout(timer);
        this.#messageHandlers = this.#messageHandlers.filter(h => h !== handler);
        if (this.#backendType === 'docker') {
          // Docker backend manages its own handlers
        }
      };

      this.#messageHandlers.push(handler);
      if (this.#backendType === 'docker') {
        this.#backend.onMessage(handler);
      }

      const message = {
        jsonrpc: '2.0',
        id,
        method,
        params: options.sessionId ? { ...params, sessionId: options.sessionId } : params,
      };

      const success = this.send(JSON.stringify(message));
      if (!success) {
        cleanup();
        reject(new Error('Failed to send message'));
      }
    });
  }

  /**
   * Get current bus state
   * @returns {number}
   */
  getState() {
    return this.#backend.getState();
  }

  /**
   * Get bus statistics
   * @returns {Object}
   */
  getStats() {
    return this.#backend.getStats();
  }

  /**
   * Get number of connected clients (TCP/Unix modes)
   * @returns {number}
   */
  getClientCount() {
    return this.#backend.getClientCount();
  }

  /**
   * Get number of running workers
   * @returns {number}
   */
  getWorkerCount() {
    return this.#backend.getWorkerCount();
  }

  /**
   * Get the listen mode
   * @returns {string}
   */
  getListenMode() {
    return this.#listenMode;
  }

  /**
   * Check if bus is running
   * @returns {boolean}
   */
  isRunning() {
    return this.#backend.getState() === BusState.RUNNING;
  }

  /**
   * Destroy the bus and release all resources
   */
  destroy() {
    if (this.#pollInterval) {
      clearInterval(this.#pollInterval);
      this.#pollInterval = null;
    }

    if (this.#backendType === 'native') {
      this.#backend.close();
    } else {
      this.#backend.destroy();
    }
  }
}

module.exports = { StdioBus, BusState, ListenMode, BackendMode };
module.exports.default = StdioBus;
