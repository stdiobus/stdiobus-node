// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026-present Raman Marozau <raman@worktif.com>, stdiobus contributors

/**
 * @stdiobus/node — esbuild build configuration
 *
 * Single bundled CJS output. tsc handles .d.ts separately via tsconfig.types.json.
 *
 * Entry: src/index.ts → out/dist/index.js
 * All internal modules bundled. Node builtins resolved at runtime.
 */

import { build } from 'esbuild';
import { builtinModules } from 'node:module';

// ─── Externals ──────────────────────────────────────────────────

const nodeBuiltins = builtinModules.flatMap(m => [m, `node:${m}`]);

const external = [...nodeBuiltins];

// ─── Build targets ──────────────────────────────────────────────

const targets = {
  cjs: {
    label: 'CJS Bundle',
    entryPoints: ['src/index.ts'],
    outfile: 'out/dist/index.js',
    bundle: true,
    platform: 'node',
    target: ['node18'],
    format: 'cjs',
    treeShaking: true,
    minify: true,
    sourcemap: false,
    external,
    logLevel: 'info',
  },
};

// ─── Runner ─────────────────────────────────────────────────────

const targetFilter = process.argv[2];

for (const [name, config] of Object.entries(targets)) {
  if (targetFilter && name !== targetFilter) continue;

  const { label, ...buildConfig } = config;
  const startMs = Date.now();

  await build(buildConfig);

  const elapsed = Date.now() - startMs;
  console.log(`  ✓ ${label ?? name} → ${buildConfig.outfile ?? buildConfig.outdir} (${elapsed}ms)`);
}

console.log('\nesbuild: build complete');
