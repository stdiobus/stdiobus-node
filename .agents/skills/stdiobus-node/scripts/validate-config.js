#!/usr/bin/env node

// SPDX-License-Identifier: Apache-2.0
// Validates a @stdiobus/node configuration file or JSON string.
// Usage: node scripts/validate-config.js <path-to-config.json>
//        echo '{"pools":[...]}' | node scripts/validate-config.js --stdin

const fs = require('fs');
const path = require('path');

function validate(config) {
  const errors = [];

  if (!config || typeof config !== 'object') {
    errors.push('Config must be a JSON object');
    return { valid: false, errors };
  }

  // pools validation
  if (!Array.isArray(config.pools)) {
    errors.push('Missing required field: pools (must be an array)');
  } else if (config.pools.length === 0) {
    errors.push('pools array must have at least one entry');
  } else {
    const ids = new Set();
    config.pools.forEach((pool, i) => {
      const prefix = `pools[${i}]`;
      if (!pool.id || typeof pool.id !== 'string') {
        errors.push(`${prefix}.id must be a non-empty string`);
      } else if (ids.has(pool.id)) {
        errors.push(`${prefix}.id "${pool.id}" is duplicated — pool IDs must be unique`);
      } else {
        ids.add(pool.id);
      }

      if (!pool.command || typeof pool.command !== 'string') {
        errors.push(`${prefix}.command must be a non-empty string`);
      }

      if (pool.args !== undefined && !Array.isArray(pool.args)) {
        errors.push(`${prefix}.args must be an array of strings`);
      }

      if (typeof pool.instances !== 'number' || pool.instances < 1 || !Number.isInteger(pool.instances)) {
        errors.push(`${prefix}.instances must be a positive integer (>= 1)`);
      }
    });
  }

  // limits validation
  if (config.limits !== undefined) {
    if (typeof config.limits !== 'object' || config.limits === null) {
      errors.push('limits must be an object');
    } else {
      const numericFields = [
        'max_input_buffer', 'max_output_queue', 'max_restarts',
        'restart_window_sec', 'drain_timeout_sec', 'backpressure_timeout_sec'
      ];
      for (const field of numericFields) {
        if (config.limits[field] !== undefined) {
          const val = config.limits[field];
          if (typeof val !== 'number' || val < 0 || !Number.isInteger(val)) {
            errors.push(`limits.${field} must be a non-negative integer (got: ${val})`);
          }
        }
      }

      // Warn about unknown fields
      const knownFields = new Set(numericFields);
      for (const key of Object.keys(config.limits)) {
        if (!knownFields.has(key)) {
          errors.push(`limits.${key} is not a recognized field. Known: ${[...knownFields].join(', ')}`);
        }
      }
    }
  }

  // Warn about unknown top-level fields
  const knownTopLevel = new Set(['pools', 'limits']);
  for (const key of Object.keys(config)) {
    if (!knownTopLevel.has(key)) {
      errors.push(`Unknown top-level field: "${key}". Known fields: pools, limits`);
    }
  }

  return { valid: errors.length === 0, errors };
}

function main() {
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    console.log(`Usage: node validate-config.js <config.json>
       echo '{"pools":[...]}' | node validate-config.js --stdin

Validates a @stdiobus/node configuration file.

Options:
  --stdin    Read config from stdin instead of a file
  --help     Show this help message

Exit codes:
  0  Config is valid
  1  Config has validation errors
  2  File not found or parse error`);
    process.exit(0);
  }

  let configText;

  if (args.includes('--stdin')) {
    configText = fs.readFileSync(0, 'utf-8');
  } else if (args.length > 0) {
    const filePath = path.resolve(args[0]);
    if (!fs.existsSync(filePath)) {
      console.error(`Error: File not found: ${filePath}`);
      process.exit(2);
    }
    configText = fs.readFileSync(filePath, 'utf-8');
  } else {
    console.error('Error: Provide a config file path or use --stdin');
    console.error('Usage: node validate-config.js <config.json>');
    process.exit(2);
  }

  let config;
  try {
    config = JSON.parse(configText);
  } catch (e) {
    console.error(`Error: Invalid JSON — ${e.message}`);
    process.exit(2);
  }

  const result = validate(config);

  if (result.valid) {
    console.log(JSON.stringify({ valid: true, pools: config.pools.length, message: 'Configuration is valid' }));
    process.exit(0);
  } else {
    console.error(JSON.stringify({ valid: false, errors: result.errors }, null, 2));
    process.exit(1);
  }
}

main();
