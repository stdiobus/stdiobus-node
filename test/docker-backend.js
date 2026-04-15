#!/usr/bin/env node

// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026-present Raman Marozau <raman@worktif.com>, stdiobus contributors

/**
 * Test Docker backend for stdio_bus
 *
 * Prerequisites:
 * - Docker installed and running
 * - Image stdiobus/stdiobus:node20 available (will be pulled if missing)
 *
 * Run: node test/docker-backend.js
 */

const path = require('path');
const fs = require('fs');

// Create test config
const configPath = path.join(__dirname, 'docker-test-config.json');
const workerPath = path.join(__dirname, 'echo-worker.js');

// Create echo worker
const workerCode = `
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on('line', (line) => {
  try {
    const req = JSON.parse(line);
    if (req.method === 'echo') {
      console.log(JSON.stringify({
        jsonrpc: '2.0',
        id: req.id,
        result: { echo: req.params }
      }));
    } else if (req.method === 'tools/list') {
      console.log(JSON.stringify({
        jsonrpc: '2.0',
        id: req.id,
        result: { tools: [{ name: 'echo' }] }
      }));
    }
  } catch (e) {
    console.log(JSON.stringify({
      jsonrpc: '2.0',
      id: null,
      error: { code: -32700, message: 'Parse error' }
    }));
  }
});
`;

fs.writeFileSync(workerPath, workerCode);

// Create config that mounts the worker
const config = {
  pools: [{
    id: 'echo',
    command: 'node',
    args: ['/worker.js'],
    instances: 1
  }]
};

fs.writeFileSync(configPath, JSON.stringify(config, null, 2));

async function runTests() {
  console.log('=== Docker Backend Tests ===\n');

  // Check if Docker is available
  const { execSync } = require('child_process');
  try {
    execSync('docker --version', { stdio: 'pipe' });
    console.log('✓ Docker is available');
  } catch {
    console.log('✗ Docker is not available. Skipping tests.');
    cleanup();
    process.exit(0);
  }

  const { StdioBus } = require('../out/dist/index.js');

  let bus;
  try {
    // Test 1: Create with docker backend
    console.log('\n1. Creating StdioBus with docker backend...');
    bus = new StdioBus({
      configPath,
      backend: 'docker',
      docker: {
        image: 'stdiobus/stdiobus:node20',
        pullPolicy: 'if-missing',
        startupTimeoutMs: 30000,
        extraArgs: ['-v', `${workerPath}:/worker.js:ro`]
      }
    });
    console.log('   Backend type:', bus.getBackendType());
    if (bus.getBackendType() !== 'docker') {
      throw new Error('Expected docker backend');
    }
    console.log('   ✓ Created with docker backend');

    // Test 2: Start
    console.log('\n2. Starting bus (this may pull the image)...');
    await bus.start();
    console.log('   State:', bus.getState());
    if (!bus.isRunning()) {
      throw new Error('Bus should be running');
    }
    console.log('   ✓ Bus started');

    // Test 3: Send message and receive response
    console.log('\n3. Testing request/response...');
    const result = await bus.request('tools/list', {}, { timeout: 10000 });
    console.log('   Result:', JSON.stringify(result));
    if (!result.tools) {
      throw new Error('Expected tools in response');
    }
    console.log('   ✓ Request/response works');

    // Test 4: Echo test
    console.log('\n4. Testing echo...');
    const echoResult = await bus.request('echo', { message: 'hello docker' }, { timeout: 10000 });
    console.log('   Echo result:', JSON.stringify(echoResult));
    if (echoResult.echo?.message !== 'hello docker') {
      throw new Error('Echo mismatch');
    }
    console.log('   ✓ Echo works');

    // Test 5: Stats
    console.log('\n5. Checking stats...');
    const stats = bus.getStats();
    console.log('   Stats:', JSON.stringify(stats));
    if (stats.messagesIn < 2) {
      throw new Error('Expected at least 2 messages sent');
    }
    console.log('   ✓ Stats tracking works');

    // Test 6: Stop
    console.log('\n6. Stopping bus...');
    await bus.stop(5);
    console.log('   State:', bus.getState());
    console.log('   ✓ Bus stopped');

    console.log('\n=== All Docker Backend Tests Passed ===\n');

  } catch (err) {
    console.error('\n✗ Test failed:', err.message);
    if (bus) {
      try {
        bus.destroy();
      } catch { }
    }
    cleanup();
    process.exit(1);
  }

  cleanup();
}

function cleanup() {
  try { fs.unlinkSync(configPath); } catch { }
  try { fs.unlinkSync(workerPath); } catch { }
}

runTests();
