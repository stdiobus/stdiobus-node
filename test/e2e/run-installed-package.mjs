#!/usr/bin/env node
/**
 * E2E test: verify @stdiobus/node works when installed from npm pack tarball.
 *
 * This script runs INSIDE the target environment (macOS native or Docker Linux).
 * It installs the package from a .tgz, imports it, starts a bus with an echo
 * worker, sends a JSON-RPC message, and verifies the response.
 *
 * Usage:
 *   node run-installed-package.mjs <path-to-tgz> <path-to-echo-worker>
 *
 * Exit codes:
 *   0 — all checks passed
 *   1 — failure
 */

import { execSync } from 'child_process';
import { mkdtempSync, writeFileSync, readFileSync, existsSync, cpSync } from 'fs';
import { join, resolve } from 'path';
import { tmpdir } from 'os';

const [tgzPath, echoWorkerPath] = process.argv.slice(2);

if (!tgzPath || !echoWorkerPath) {
  console.error('Usage: node run-installed-package.mjs <tgz> <echo-worker.js>');
  process.exit(1);
}

if (!existsSync(tgzPath)) {
  console.error(`Tarball not found: ${tgzPath}`);
  process.exit(1);
}

if (!existsSync(echoWorkerPath)) {
  console.error(`Echo worker not found: ${echoWorkerPath}`);
  process.exit(1);
}

// Use /tmp as fallback — os.tmpdir() can return stale paths on macOS
function safeTmpdir() {
  const t = tmpdir();
  try { if (existsSync(t)) return t; } catch { }
  return '/tmp';
}

const workDir = mkdtempSync(join(safeTmpdir(), 'stdiobus-e2e-'));
console.log(`[e2e] Work directory: ${workDir}`);
console.log(`[e2e] Platform: ${process.platform}-${process.arch}`);
console.log(`[e2e] Node: ${process.version}`);
console.log('');

let exitCode = 1;

try {
  // 1. Init a fresh npm project
  console.log('[e2e] Step 1: npm init');
  execSync('npm init -y', { cwd: workDir, stdio: 'pipe' });

  // 2. Copy echo worker into work dir
  const workerDst = join(workDir, 'echo-worker.js');
  cpSync(echoWorkerPath, workerDst);

  // 3. Install from tarball
  console.log(`[e2e] Step 2: npm install ${tgzPath}`);
  const installOut = execSync(`npm install "${tgzPath}"`, {
    cwd: workDir,
    stdio: 'pipe',
    encoding: 'utf8',
  });
  console.log(`[e2e]   ${installOut.trim().split('\n').pop()}`);

  // 4. Write and run the actual test script
  //    This imports from the installed package, not from local paths.
  const testScript = `
const path = require('path');
const { StdioBus } = require('@stdiobus/node');

const echoWorker = path.join(__dirname, 'echo-worker.js');

async function main() {
  console.log('[test] Creating StdioBus with configJson...');
  const bus = new StdioBus({
    configJson: {
      pools: [
        { id: 'echo', command: 'node', args: [echoWorker], instances: 1 }
      ],
      limits: { max_input_buffer: 1048576, max_output_queue: 4194304 }
    }
  });
  console.log('[test] Backend:', bus.getBackendType());

  if (bus.getBackendType() !== 'native') {
    console.error('[test] FAIL: expected native backend, got', bus.getBackendType());
    process.exit(1);
  }

  console.log('[test] Worker count:', bus.getWorkerCount());

  const messages = [];
  bus.onMessage((msg) => messages.push(msg));

  console.log('[test] Starting bus...');
  await bus.start();
  console.log('[test] State:', bus.getState(), '(expected 2 = RUNNING)');

  if (!bus.isRunning()) {
    console.error('[test] FAIL: bus not running');
    await bus.stop();
    bus.destroy();
    process.exit(1);
  }

  // Send JSON-RPC request
  const request = JSON.stringify({
    jsonrpc: '2.0',
    id: 'e2e-1',
    method: 'tools/list',
    params: { hello: 'world' },
  });
  console.log('[test] Sending:', request);
  const sent = bus.send(request);
  console.log('[test] Send result:', sent);

  // Wait for response (up to 5 seconds)
  const deadline = Date.now() + 5000;
  while (messages.length === 0 && Date.now() < deadline) {
    await new Promise(r => setTimeout(r, 50));
  }

  console.log('[test] Messages received:', messages.length);

  if (messages.length === 0) {
    console.error('[test] FAIL: no response received within 5s');
    await bus.stop();
    bus.destroy();
    process.exit(1);
  }

  // Validate response
  const response = JSON.parse(messages[0]);
  console.log('[test] Response:', JSON.stringify(response));

  if (response.id !== 'e2e-1') {
    console.error('[test] FAIL: response id mismatch:', response.id);
    await bus.stop();
    bus.destroy();
    process.exit(1);
  }

  if (!response.result || response.result.method !== 'tools/list') {
    console.error('[test] FAIL: unexpected result:', response.result);
    await bus.stop();
    bus.destroy();
    process.exit(1);
  }

  // Stats check
  const stats = bus.getStats();
  console.log('[test] Stats:', JSON.stringify(stats));

  // Cleanup
  console.log('[test] Stopping bus...');
  await bus.stop(5);
  bus.destroy();

  console.log('[test] PASS');
  process.exit(0);
}

main().catch(err => {
  console.error('[test] FAIL:', err.message);
  console.error(err.stack);
  process.exit(1);
});
`;

  const testPath = join(workDir, 'test-e2e.js');
  writeFileSync(testPath, testScript);

  console.log('[e2e] Step 3: Running test from installed package...');
  console.log('');
  execSync(`"${process.execPath}" "${testPath}"`, {
    cwd: workDir,
    stdio: 'inherit',
    timeout: 30000,
  });

  exitCode = 0;
} catch (err) {
  console.error('');
  console.error(`[e2e] FAILED: ${err.message}`);
  if (err.stdout) console.error(err.stdout.toString());
  if (err.stderr) console.error(err.stderr.toString());
  exitCode = 1;
}

process.exit(exitCode);
