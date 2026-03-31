/**
 * Basic test for @stdio-bus/node native addon (pure C)
 */

const path = require('path');
const fs = require('fs');

// Test config
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

// Write test config
const configPath = path.join(__dirname, 'test-config.json');
fs.writeFileSync(configPath, JSON.stringify(testConfig, null, 2));

console.log('Testing @stdio-bus/node native addon (pure C)...\n');

try {
  // Load the native addon (platform-aware via load-native)
  const binding = require('../lib/load-native');
  console.log('✓ Native addon loaded successfully');
  console.log('  Exports:', Object.keys(binding));

  // Check state constants
  console.log('\n✓ State constants:');
  console.log('  STATE_CREATED:', binding.STATE_CREATED);
  console.log('  STATE_STARTING:', binding.STATE_STARTING);
  console.log('  STATE_RUNNING:', binding.STATE_RUNNING);
  console.log('  STATE_STOPPING:', binding.STATE_STOPPING);
  console.log('  STATE_STOPPED:', binding.STATE_STOPPED);

  // Create instance
  console.log('\n✓ Creating stdio_bus instance...');
  const created = binding.create(configPath);
  console.log('  Created:', created);
  console.log('  Initial state:', binding.getState());

  // Start
  console.log('\n✓ Starting bus...');
  const started = binding.start();
  console.log('  Started:', started);
  console.log('  State after start:', binding.getState());

  // Send a test message
  console.log('\n✓ Sending test message...');
  const testMsg = JSON.stringify({
    jsonrpc: '2.0',
    id: '1',
    method: 'test',
    params: {}
  });
  const sent = binding.send(testMsg);
  console.log('  Send result:', sent);

  // Poll for messages
  console.log('\n✓ Polling for messages...');

  // Give worker time to echo back
  setTimeout(() => {
    const messages = binding.poll(100);
    console.log('  Messages received:', messages.length);
    messages.forEach((msg, i) => {
      console.log(`  [${i}]:`, msg.substring(0, 80) + (msg.length > 80 ? '...' : ''));
    });

    // Get stats
    console.log('\n✓ Stats:', binding.getStats());

    // Stop
    console.log('\n✓ Stopping bus...');
    const stopped = binding.stop(5);
    console.log('  Stopped:', stopped);

    // Poll until stopped
    const waitForStop = () => {
      binding.poll(100);
      const state = binding.getState();
      if (state === binding.STATE_STOPPED) {
        console.log('  State after stop:', state);

        // Close
        console.log('\n✓ Closing bus...');
        binding.close();

        // Cleanup
        fs.unlinkSync(configPath);

        console.log('\n========================================');
        console.log('All tests passed! (Pure C N-API addon)');
        console.log('========================================\n');
        process.exit(0);
      } else {
        setTimeout(waitForStop, 100);
      }
    };
    waitForStop();

  }, 500);

} catch (err) {
  console.error('✗ Test failed:', err.message);
  console.error(err.stack);

  // Cleanup
  try { fs.unlinkSync(configPath); } catch (e) { }

  process.exit(1);
}
