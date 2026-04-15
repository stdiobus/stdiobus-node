#!/usr/bin/env node

// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026-present Raman Marozau <raman@worktif.com>, stdiobus contributors

/**
 * Echo worker for testing. Reads NDJSON from stdin, echoes back on stdout.
 */
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin, terminal: false });

rl.on('line', (line) => {
  try {
    const msg = JSON.parse(line);
    if (msg.id !== undefined && msg.method !== undefined) {
      const resp = {
        jsonrpc: '2.0',
        id: msg.id,
        result: { echo: msg.params || {}, method: msg.method },
      };
      if (msg.sessionId) resp.sessionId = msg.sessionId;
      console.log(JSON.stringify(resp));
    }
  } catch (e) {
    console.error('[echo-worker] parse error:', e.message);
  }
});

rl.on('close', () => process.exit(0));
process.on('SIGTERM', () => { rl.close(); });
console.error('[echo-worker] Started');
