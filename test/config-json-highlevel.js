/**
 * Test: StdioBus class with configJson — full E2E roundtrip.
 * Every test sends a request through the bus and verifies the response.
 */

const path = require('path');
const { StdioBus } = require('../out/dist/index.js');

const ECHO_WORKER = path.join(__dirname, 'fixtures', 'echo-worker.js');

let exitCode = 0;

function assert(condition, msg) {
  if (!condition) {
    console.error('  ✗ FAIL:', msg);
    exitCode = 1;
  } else {
    console.log('  ✓', msg);
  }
}

async function main() {
  console.log('Testing StdioBus with configJson — E2E roundtrip...\n');

  // Test 1: configJson — full roundtrip
  console.log('Test 1: configJson echo roundtrip');
  {
    const bus = new StdioBus({
      configJson: {
        pools: [{ id: 'echo', command: 'node', args: [ECHO_WORKER], instances: 1 }],
      },
    });
    await bus.start();
    await new Promise(r => setTimeout(r, 300));

    const result = await bus.request('echo', { message: 'test-1' }, { timeout: 5000 });
    assert(result && result.echo, 'Got echo response');
    assert(result.echo.message === 'test-1', `Echo matches: "${result.echo.message}"`);
    assert(result.method === 'echo', `Method matches: "${result.method}"`);

    await bus.stop(5);
    bus.destroy();
  }

  // Test 2: configJson with limits — full roundtrip
  console.log('\nTest 2: configJson with limits echo roundtrip');
  {
    const bus = new StdioBus({
      configJson: {
        pools: [{ id: 'echo', command: 'node', args: [ECHO_WORKER], instances: 1 }],
        limits: { max_restarts: 5, drain_timeout_sec: 10 },
      },
    });
    await bus.start();
    await new Promise(r => setTimeout(r, 300));

    const result = await bus.request('echo', { message: 'with-limits' }, { timeout: 5000 });
    assert(result && result.echo, 'Got echo response with limits config');
    assert(result.echo.message === 'with-limits', `Echo matches: "${result.echo.message}"`);

    await bus.stop(5);
    bus.destroy();
  }

  // Test 3: multiple requests through same bus
  console.log('\nTest 3: multiple sequential requests');
  {
    const bus = new StdioBus({
      configJson: {
        pools: [{ id: 'echo', command: 'node', args: [ECHO_WORKER], instances: 1 }],
      },
    });
    await bus.start();
    await new Promise(r => setTimeout(r, 300));

    for (let i = 0; i < 5; i++) {
      const result = await bus.request('echo', { index: i }, { timeout: 5000 });
      assert(result.echo.index === i, `Request ${i} echoed correctly`);
    }

    await bus.stop(5);
    bus.destroy();
  }

  // Test 4: mutual exclusivity
  console.log('\nTest 4: configPath + configJson throws');
  try {
    new StdioBus({ configPath: '/tmp/fake.json', configJson: { pools: [] } });
    assert(false, 'Should have thrown');
  } catch (err) {
    assert(err.message.includes('mutually exclusive'), `Correct error: ${err.message}`);
  }

  // Test 5: neither throws
  console.log('\nTest 5: no config throws');
  try {
    new StdioBus({});
    assert(false, 'Should have thrown');
  } catch (err) {
    assert(err.message.includes('required'), `Correct error: ${err.message}`);
  }

  console.log(`\n${exitCode === 0 ? 'All tests passed!' : 'SOME TESTS FAILED'}`);
  process.exit(exitCode);
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
