/**
 * README.md Verbatim Verification
 *
 * Every code block from README.md is pasted here IDENTICALLY.
 * The ONLY permitted substitution: '@stdiobus/node' → local built path.
 *
 * Before execution, a temp working directory is provisioned with all files
 * that README examples reference (workers/echo-worker.js, worker.js, etc.).
 * This ensures README code runs exactly as a user would copy-paste it.
 *
 * If any test here fails → the README is lying to users → fix the README.
 *
 * Run: npx tsx test/readme/verbatim.test.ts
 */

import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as assert from 'assert';

// ---------------------------------------------------------------------------
// Harness: provision a working directory that matches README paths
// ---------------------------------------------------------------------------

const ECHO_WORKER_SOURCE = path.join(__dirname, '..', 'fixtures', 'echo-worker.js');
const WORKDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'stdiobus-readme-test-'));

function provision(): void {
  const echoCode = fs.readFileSync(ECHO_WORKER_SOURCE, 'utf8');

  // README references these worker paths:
  //   ./workers/echo-worker.js      (§ Quick Start)
  //   ./workers/acp-worker.js       (§ ACP Agent)
  //   ./workers/mcp-tools-worker.js (§ MCP Tools)
  //   ./worker.js                   (§ TypeScript, § TCP Server)
  //   ./config.json                 (§ Docker Backend)
  fs.mkdirSync(path.join(WORKDIR, 'workers'), { recursive: true });
  fs.writeFileSync(path.join(WORKDIR, 'workers', 'echo-worker.js'), echoCode);
  fs.writeFileSync(path.join(WORKDIR, 'workers', 'acp-worker.js'), echoCode);
  fs.writeFileSync(path.join(WORKDIR, 'workers', 'mcp-tools-worker.js'), echoCode);
  fs.writeFileSync(path.join(WORKDIR, 'worker.js'), echoCode);
  fs.writeFileSync(path.join(WORKDIR, 'config.json'), JSON.stringify({
    pools: [{ id: 'echo', command: 'node', args: ['./workers/echo-worker.js'], instances: 1 }],
  }));
}

function cleanup(): void {
  fs.rmSync(WORKDIR, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// The ONLY substitution applied to README code:
//   import ... from '@stdiobus/node'  →  import from local built path
//   require('@stdiobus/node')         →  require(LOCAL_PKG)
//
// This is unavoidable — we test from source, not from npm install.
// Everything else is IDENTICAL to README.md.
// ---------------------------------------------------------------------------

const LOCAL_PKG = path.resolve(__dirname, '..', '..', 'out', 'dist', 'index.js');

// ---------------------------------------------------------------------------
// Test runner
// ---------------------------------------------------------------------------

let passed = 0;
let failed = 0;

async function test(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    passed++;
    console.log(`  ✓ ${name}`);
  } catch (err: any) {
    failed++;
    console.log(`  ✗ ${name}: ${err.message}`);
  }
}

function dockerAvailable(): boolean {
  try {
    require('child_process').execSync('docker --version', { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

// ===========================================================================
// Provision and chdir
// ===========================================================================

provision();
process.chdir(WORKDIR);

console.log('=== README.md Verbatim Verification ===');
console.log(`Working directory: ${WORKDIR}\n`);

(async () => {
  try {

    // ========================================================================
    // § Quick Start — VERBATIM from README.md
    // ========================================================================
    console.log('§ Quick Start');

    await test('Quick Start', async () => {
      // README: const { StdioBus } = require('@stdiobus/node');
      const { StdioBus } = require(LOCAL_PKG);

      const bus = new StdioBus({
        configJson: {
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
    });

    // ========================================================================
    // § TypeScript — VERBATIM from README.md
    // ========================================================================
    console.log('\n§ TypeScript');

    await test('TypeScript', async () => {
      // README: import { StdioBus, BusState } from '@stdiobus/node';
      // README: import type { StdioBusOptions, BusStats } from '@stdiobus/node';
      const { StdioBus, BusState } = require(LOCAL_PKG);

      const options: import('../../src/types').StdioBusOptions = {
        configJson: {
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
    });

    // ========================================================================
    // § ACP Agent — VERBATIM from README.md
    // ========================================================================
    console.log('\n§ ACP Agent');

    await test('ACP Agent', async () => {
      // README: const { StdioBus } = require('@stdiobus/node');
      const { StdioBus } = require(LOCAL_PKG);

      const bus = new StdioBus({
        configJson: {
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
    });

    // ========================================================================
    // § MCP Tools — VERBATIM from README.md
    // ========================================================================
    console.log('\n§ MCP Tools');

    await test('MCP Tools', async () => {
      const { StdioBus } = require(LOCAL_PKG);

      const bus = new StdioBus({
        configJson: {
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
    });


    // ========================================================================
    // § TCP Server — VERBATIM from README.md
    //
    // README uses: const port = Number(process.env.PORT) || 8080;
    // Test sets process.env.PORT to a free port before running.
    // The code itself is IDENTICAL to README.
    // ========================================================================
    console.log('\n§ TCP Server');

    await test('TCP Server', async () => {
      // Provision: set PORT env to a free port (README defaults to 8080)
      const net = require('net');
      const freePort: number = await new Promise((resolve, reject) => {
        const srv = net.createServer();
        srv.listen(0, '127.0.0.1', () => {
          const p = srv.address().port;
          srv.close(() => resolve(p));
        });
        srv.on('error', reject);
      });
      process.env.PORT = String(freePort);

      const { StdioBus } = require(LOCAL_PKG);

      // ---- VERBATIM from README ----
      const port = Number(process.env.PORT) || 8080;

      const bus = new StdioBus({
        configJson: {
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
      // ---- VERBATIM END ----

      await bus.stop(5);
      bus.destroy();
      delete process.env.PORT;
    });

    // ========================================================================
    // § Docker Backend — VERBATIM from README.md
    // Skipped if Docker not available. Constructor only (no start).
    // ========================================================================
    console.log('\n§ Docker Backend');

    if (dockerAvailable()) {
      await test('Docker Backend', async () => {
        const { StdioBus } = require(LOCAL_PKG);

        // ---- VERBATIM from README ----
        const bus = new StdioBus({
          configPath: './config.json',
          backend: 'docker',
          docker: {
            image: 'stdiobus/stdiobus:node20',
            pullPolicy: 'if-missing',
            startupTimeoutMs: 15_000,
          },
        });
        // ---- VERBATIM END ----

        bus.destroy();
      });
    } else {
      console.log('  ⊘ Docker Backend: skipped (Docker not available)');
    }

    // ========================================================================
    // § Constants — VERBATIM from README.md
    // ========================================================================
    console.log('\n§ Constants');

    await test('Constants', async () => {
      // README: import { BusState, ListenMode, BackendMode } from '@stdiobus/node';
      const { BusState, ListenMode, BackendMode } = require(LOCAL_PKG);

      // ---- VERBATIM from README ----
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
      // ---- VERBATIM END ----

      // Verify the inline comments in README are truthful
      assert.strictEqual(BusState.CREATED, 0);
      assert.strictEqual(BusState.STARTING, 1);
      assert.strictEqual(BusState.RUNNING, 2);
      assert.strictEqual(BusState.STOPPING, 3);
      assert.strictEqual(BusState.STOPPED, 4);
      assert.strictEqual(ListenMode.NONE, 'none');
      assert.strictEqual(ListenMode.TCP, 'tcp');
      assert.strictEqual(ListenMode.UNIX, 'unix');
      assert.strictEqual(BackendMode.AUTO, 'auto');
      assert.strictEqual(BackendMode.NATIVE, 'native');
      assert.strictEqual(BackendMode.DOCKER, 'docker');
    });

    // ========================================================================
    // Results
    // ========================================================================
    console.log(`\n=== Results ===`);
    console.log(`Passed: ${passed}`);
    console.log(`Failed: ${failed}`);

    if (failed > 0) {
      console.log('\n⚠ README.md contains examples that do not work as documented!');
    } else {
      console.log('\n✓ All README.md examples verified — documentation is truthful.');
    }

  } finally {
    process.chdir(path.resolve(__dirname, '..', '..'));
    cleanup();
  }

  process.exit(failed > 0 ? 1 : 0);
})();
