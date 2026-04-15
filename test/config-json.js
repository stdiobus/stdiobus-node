/**
 * E2E test: programmatic config via configJson (no config.json file)
 *
 * This is the "user-visible SDK" test. The user writes:
 *   new StdioBus({ configJson: { pools: [...] } })
 * No binary path. No config file. Everything under the hood.
 */

const path = require('path');

console.log('Testing @stdiobus/node: programmatic config (configJson)...\n');

const ECHO_WORKER = path.join(__dirname, '..', '..', '..', 'examples', 'echo-worker.js');

let binding;
try {
  const os = require('os');
  const fs = require('fs');
  const addonName = 'stdio_bus_native.node';
  const prebuildPath = path.join(__dirname, '..', 'prebuilds', `${os.platform()}-${os.arch()}`, addonName);
  const buildPath = path.join(__dirname, '..', 'build', 'Release', addonName);
  binding = require(fs.existsSync(prebuildPath) ? prebuildPath : buildPath);
  console.log('✓ Native addon loaded');
} catch (err) {
  console.log('✗ Native addon not built, skipping test');
  console.log('  Run: cd sdk/node-native && npm run build');
  process.exit(0);
}

// -------------------------------------------------------
// Test 1: configJson — programmatic config, no file
// -------------------------------------------------------
console.log('\nTest 1: configJson with echo worker');

const configJson = JSON.stringify({
  pools: [{
    id: 'echo',
    command: 'node',
    args: [ECHO_WORKER],
    instances: 1
  }]
});

try {
  const created = binding.create({ configJson: configJson, logLevel: 1 });
  console.log('  ✓ Bus created with configJson (no file)');

  const started = binding.start();
  console.log('  ✓ Bus started:', started);

  // Give worker time to start
  setTimeout(() => {
    // Send echo request
    const msg = JSON.stringify({
      jsonrpc: '2.0',
      id: 'test-1',
      method: 'echo',
      params: { message: 'hello from configJson' }
    });
    const sent = binding.send(msg);
    console.log('  ✓ Message sent:', sent);

    // Poll for response
    setTimeout(() => {
      const messages = binding.poll(200);
      console.log('  ✓ Messages received:', messages.length);

      let passed = false;
      for (const m of messages) {
        try {
          const parsed = JSON.parse(m);
          if (parsed.id === 'test-1' && parsed.result && parsed.result.echo) {
            console.log('  ✓ Echo response:', parsed.result.echo.message);
            if (parsed.result.echo.message === 'hello from configJson') {
              passed = true;
            }
          }
        } catch (e) { /* skip non-JSON */ }
      }

      if (passed) {
        console.log('  ✓ PASS: Full roundtrip with programmatic config');
      } else {
        console.log('  ✗ FAIL: Did not receive expected echo response');
        console.log('    Raw messages:', messages);
      }

      // Cleanup
      binding.stop(5);
      const waitStop = () => {
        binding.poll(100);
        if (binding.getState() === binding.STATE_STOPPED) {
          binding.close();
          console.log('\n' + (passed ? 'All tests passed!' : 'TESTS FAILED'));
          process.exit(passed ? 0 : 1);
        } else {
          setTimeout(waitStop, 100);
        }
      };
      waitStop();
    }, 500);
  }, 500);

} catch (err) {
  console.error('  ✗ Error:', err.message);
  try { binding.close(); } catch (e) { }
  process.exit(1);
}
