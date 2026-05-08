#!/usr/bin/env node

// SPDX-License-Identifier: Apache-2.0
// Scaffolds a new @stdiobus/node worker file.
// Usage: node scripts/scaffold-worker.js --output ./workers/my-worker.js --methods "echo,tools/list,tools/call"
//        node scripts/scaffold-worker.js --output ./workers/my-worker.ts --typescript

const fs = require('fs');
const path = require('path');

function generateJsWorker(methods) {
  const cases = methods.map(m => `    case '${m}':\n      return { /* TODO: implement ${m} */ };`).join('\n');

  return `#!/usr/bin/env node
// Worker for @stdiobus/node
// Protocol: NDJSON JSON-RPC 2.0 over stdin/stdout

const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on('line', (line) => {
  try {
    const msg = JSON.parse(line);

    if (msg.id !== undefined && msg.method !== undefined) {
      const result = dispatch(msg.method, msg.params || {});
      console.log(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }));
    }
    // Notifications (no id) can be handled here if needed
  } catch (e) {
    console.error('[worker] Error:', e.message);
  }
});

function dispatch(method, params) {
  switch (method) {
${cases}
    default:
      return { error: \`Unknown method: \${method}\` };
  }
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.error('[worker] Received SIGTERM, shutting down');
  process.exit(0);
});

console.error('[worker] Started');
`;
}

function generateTsWorker(methods) {
  const cases = methods.map(m => `    case '${m}':\n      return { /* TODO: implement ${m} */ };`).join('\n');

  return `#!/usr/bin/env npx tsx
// Worker for @stdiobus/node
// Protocol: NDJSON JSON-RPC 2.0 over stdin/stdout

import * as readline from 'readline';

interface JsonRpcRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: { code: number; message: string };
}

const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on('line', (line: string) => {
  try {
    const msg: JsonRpcRequest = JSON.parse(line);

    if (msg.id !== undefined && msg.method !== undefined) {
      const result = dispatch(msg.method, msg.params ?? {});
      const response: JsonRpcResponse = { jsonrpc: '2.0', id: msg.id, result };
      process.stdout.write(JSON.stringify(response) + '\\n');
    }
  } catch (e) {
    process.stderr.write(\`[worker] Error: \${(e as Error).message}\\n\`);
  }
});

function dispatch(method: string, params: Record<string, unknown>): unknown {
  switch (method) {
${cases}
    default:
      return { error: \`Unknown method: \${method}\` };
  }
}

process.on('SIGTERM', () => {
  process.stderr.write('[worker] Received SIGTERM, shutting down\\n');
  process.exit(0);
});

process.stderr.write('[worker] Started\\n');
`;
}

function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`Usage: node scaffold-worker.js [OPTIONS]

Scaffolds a new @stdiobus/node worker file.

Options:
  --output <path>     Output file path (required)
  --methods <list>    Comma-separated method names (default: "echo")
  --typescript        Generate TypeScript worker (auto-detected from .ts extension)
  --help              Show this help message

Examples:
  node scaffold-worker.js --output ./workers/echo.js
  node scaffold-worker.js --output ./workers/tools.js --methods "tools/list,tools/call"
  node scaffold-worker.js --output ./workers/agent.ts --methods "initialize,session/new,session/prompt"`);
    process.exit(0);
  }

  const outputIdx = args.indexOf('--output');
  if (outputIdx === -1 || !args[outputIdx + 1]) {
    console.error('Error: --output <path> is required');
    process.exit(2);
  }
  const outputPath = path.resolve(args[outputIdx + 1]);

  const methodsIdx = args.indexOf('--methods');
  const methods = methodsIdx !== -1 && args[methodsIdx + 1]
    ? args[methodsIdx + 1].split(',').map(m => m.trim())
    : ['echo'];

  const isTs = args.includes('--typescript') || outputPath.endsWith('.ts');

  const content = isTs ? generateTsWorker(methods) : generateJsWorker(methods);

  const dir = path.dirname(outputPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(outputPath, content, { mode: 0o755 });
  console.log(JSON.stringify({
    created: outputPath,
    language: isTs ? 'typescript' : 'javascript',
    methods,
  }));
}

main();
