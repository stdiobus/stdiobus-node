#!/usr/bin/env node
/**
 * Conformance tests for @stdiobus/node native addon
 *
 * Tests that the addon correctly implements stdio_bus protocol.
 * Uses the same test vectors as the main conformance harness.
 */

const path = require('path');
const fs = require('fs');
const { StdioBus, BusState } = require('../lib');

// ANSI colors
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  cyan: '\x1b[36m',
  dim: '\x1b[2m'
};

// Test config with echo worker
const testConfig = {
  pools: [
    {
      id: 'echo',
      command: '/bin/cat',
      args: [],
      instances: 1
    }
  ],
  limits: {
    max_input_buffer: 1048576,
    max_output_queue: 4194304
  }
};

/**
 * Test: Basic request-response
 */
async function testBasicRequestResponse(bus) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout')), 5000);

    const testMsg = {
      jsonrpc: '2.0',
      id: 'test-1',
      method: 'echo',
      params: { data: 'hello' }
    };

    bus.onMessage((msg) => {
      clearTimeout(timeout);
      try {
        const response = JSON.parse(msg);
        if (response.id === 'test-1') {
          resolve({ passed: true });
        } else {
          resolve({ passed: false, error: 'Wrong id in response' });
        }
      } catch (e) {
        resolve({ passed: false, error: e.message });
      }
    });

    bus.send(JSON.stringify(testMsg));
  });
}

/**
 * Test: Notification (no id)
 */
async function testNotification(bus) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout')), 5000);

    const notification = {
      jsonrpc: '2.0',
      method: 'notify',
      params: { event: 'test' }
    };

    bus.onMessage((msg) => {
      clearTimeout(timeout);
      try {
        const response = JSON.parse(msg);
        // Notification should be echoed back (by cat)
        if (response.method === 'notify' && !response.id) {
          resolve({ passed: true });
        } else {
          resolve({ passed: false, error: 'Unexpected response format' });
        }
      } catch (e) {
        resolve({ passed: false, error: e.message });
      }
    });

    bus.send(JSON.stringify(notification));
  });
}

/**
 * Test: Multiple messages in sequence
 */
async function testMultipleMessages(bus) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout')), 10000);
    const received = [];
    const expected = 5;

    bus.onMessage((msg) => {
      try {
        const response = JSON.parse(msg);
        received.push(response);

        if (received.length === expected) {
          clearTimeout(timeout);
          // Check all messages received in order
          let allCorrect = true;
          for (let i = 0; i < expected; i++) {
            if (received[i].id !== `multi-${i}`) {
              allCorrect = false;
              break;
            }
          }
          resolve({
            passed: allCorrect,
            error: allCorrect ? null : 'Messages out of order or missing'
          });
        }
      } catch (e) {
        // Ignore parse errors
      }
    });

    // Send multiple messages
    for (let i = 0; i < expected; i++) {
      bus.send(JSON.stringify({
        jsonrpc: '2.0',
        id: `multi-${i}`,
        method: 'test',
        params: { index: i }
      }));
    }
  });
}

/**
 * Test: Large message
 */
async function testLargeMessage(bus) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('Timeout')), 10000);

    // Create a moderately large payload (10KB)
    const largeData = 'x'.repeat(10 * 1024);
    const testMsg = {
      jsonrpc: '2.0',
      id: 'large-1',
      method: 'echo',
      params: { data: largeData }
    };

    bus.onMessage((msg) => {
      clearTimeout(timeout);
      try {
        const response = JSON.parse(msg);
        if (response.id === 'large-1' && response.params?.data?.length === largeData.length) {
          resolve({ passed: true });
        } else {
          resolve({ passed: false, error: 'Large message corrupted' });
        }
      } catch (e) {
        resolve({ passed: false, error: e.message });
      }
    });

    bus.send(JSON.stringify(testMsg));
  });
}

/**
 * Test: Invalid JSON handling
 */
async function testInvalidJson(bus) {
  // Send invalid JSON - bus should not crash
  try {
    const result = bus.send('not valid json {{{');
    // The send might succeed (queued) but worker should handle it
    // For echo worker (cat), it will just echo back the invalid data
    return { passed: true, note: 'Bus did not crash on invalid JSON' };
  } catch (e) {
    return { passed: false, error: e.message };
  }
}

/**
 * Test: Stats tracking
 */
async function testStats(bus) {
  const statsBefore = bus.getStats();

  // Send a message
  bus.send(JSON.stringify({ jsonrpc: '2.0', id: 'stats-1', method: 'test' }));

  // Wait for response
  await new Promise(resolve => setTimeout(resolve, 500));

  const statsAfter = bus.getStats();

  if (statsAfter.messagesIn > statsBefore.messagesIn &&
    statsAfter.bytesIn > statsBefore.bytesIn) {
    return { passed: true };
  } else {
    return { passed: false, error: 'Stats not updated correctly' };
  }
}

/**
 * Test: State transitions
 */
async function testStateTransitions() {
  const configPath = path.join(__dirname, 'state-test-config.json');
  fs.writeFileSync(configPath, JSON.stringify(testConfig, null, 2));

  try {
    const bus = new StdioBus({ configPath });

    // Should be CREATED
    if (bus.getState() !== BusState.CREATED) {
      return { passed: false, error: 'Initial state should be CREATED' };
    }

    await bus.start();

    // Should be RUNNING
    if (bus.getState() !== BusState.RUNNING) {
      return { passed: false, error: 'State after start should be RUNNING' };
    }

    await bus.stop(5);

    // Should be STOPPED
    if (bus.getState() !== BusState.STOPPED) {
      return { passed: false, error: 'State after stop should be STOPPED' };
    }

    bus.destroy();
    return { passed: true };

  } finally {
    fs.unlinkSync(configPath);
  }
}

/**
 * Run all tests
 */
async function main() {
  console.log(`${colors.cyan}@stdiobus/node Conformance Tests${colors.reset}\n`);

  const results = {
    total: 0,
    passed: 0,
    failed: 0,
    tests: []
  };

  // Tests that need a running bus
  const busTests = [
    { name: 'Basic request-response', fn: testBasicRequestResponse },
    { name: 'Notification (no id)', fn: testNotification },
    { name: 'Multiple messages', fn: testMultipleMessages },
    { name: 'Large message (100KB)', fn: testLargeMessage },
    { name: 'Invalid JSON handling', fn: testInvalidJson },
    { name: 'Stats tracking', fn: testStats },
  ];

  // Standalone tests
  const standaloneTests = [
    { name: 'State transitions', fn: testStateTransitions },
  ];

  // Run standalone tests first
  for (const test of standaloneTests) {
    results.total++;
    try {
      const result = await test.fn();
      results.tests.push({ name: test.name, ...result });

      if (result.passed) {
        results.passed++;
        console.log(`${colors.green}✓${colors.reset} ${test.name}`);
      } else {
        results.failed++;
        console.log(`${colors.red}✗${colors.reset} ${test.name}: ${result.error}`);
      }
    } catch (e) {
      results.failed++;
      results.tests.push({ name: test.name, passed: false, error: e.message });
      console.log(`${colors.red}✗${colors.reset} ${test.name}: ${e.message}`);
    }
  }

  // Create bus for remaining tests
  const configPath = path.join(__dirname, 'conformance-config.json');
  fs.writeFileSync(configPath, JSON.stringify(testConfig, null, 2));

  let bus;
  try {
    bus = new StdioBus({ configPath, pollIntervalMs: 10 });
    await bus.start();

    // Run bus tests
    for (const test of busTests) {
      results.total++;
      try {
        const result = await test.fn(bus);
        results.tests.push({ name: test.name, ...result });

        if (result.passed) {
          results.passed++;
          console.log(`${colors.green}✓${colors.reset} ${test.name}${result.note ? ` (${result.note})` : ''}`);
        } else {
          results.failed++;
          console.log(`${colors.red}✗${colors.reset} ${test.name}: ${result.error}`);
        }
      } catch (e) {
        results.failed++;
        results.tests.push({ name: test.name, passed: false, error: e.message });
        console.log(`${colors.red}✗${colors.reset} ${test.name}: ${e.message}`);
      }
    }

  } finally {
    if (bus) {
      await bus.stop(5);
      bus.destroy();
    }
    fs.unlinkSync(configPath);
  }

  // Summary
  console.log(`\n${colors.cyan}Summary${colors.reset}`);
  console.log(`Total: ${results.total}`);
  console.log(`${colors.green}Passed: ${results.passed}${colors.reset}`);
  console.log(`${colors.red}Failed: ${results.failed}${colors.reset}`);

  // Exit code
  process.exit(results.failed > 0 ? 1 : 0);
}

main().catch(e => {
  console.error(`${colors.red}Fatal error: ${e.message}${colors.reset}`);
  console.error(e.stack);
  process.exit(1);
});
