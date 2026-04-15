// SPDX-License-Identifier: Apache-2.0
// Copyright (c) 2026-present Raman Marozau <raman@worktif.com>, stdiobus contributors

/**
 * Native addon loader with prebuild support.
 *
 * Resolution order:
 *   1. Prebuild for current platform (prebuilds/<platform>-<arch>/)
 *   2. Locally compiled (build/Release/ or build/Debug/) — dev only
 */

import * as path from 'path';
import * as fs from 'fs';

export interface NativeBinding {
  // Lifecycle
  create(opts: string | Record<string, unknown>): boolean;
  start(): boolean;
  stop(timeoutSec: number): boolean;
  close(): void;

  // Messaging
  send(message: string): boolean;
  poll(timeoutMs: number): string[];

  // State
  getState(): number;
  getStats(): Record<string, number>;
  getClientCount(): number;
  getWorkerCount(): number;

  // Embedded worker
  createSocketpair(): { kernelFd: number; jsFd: number };
  registerEmbeddedWorker(kernelFd: number, poolId: string): number;
  unregisterEmbeddedWorker(workerId: number): boolean;
  closeFd(fd: number): boolean;
  writeFd(fd: number, data: string): number;
  readFd(fd: number, maxBytes: number): string | null;
  getFdFlags(fd: number): number;
  setMessageCallback(cb: (msg: string) => void): void;

  // Constants
  STATE_CREATED: number;
  STATE_STARTING: number;
  STATE_RUNNING: number;
  STATE_STOPPING: number;
  STATE_STOPPED: number;
  LISTEN_NONE: number;
  LISTEN_TCP: number;
  LISTEN_UNIX: number;
  O_NONBLOCK: number;
}

function getPlatformArch(): { platform: string; arch: string } {
  const platform = process.platform;
  let arch = process.arch;
  if (arch === 'x64') arch = 'x64'; // already correct
  else if (arch === 'arm64') arch = 'arm64'; // already correct
  return { platform, arch };
}

export function loadNativeAddon(): NativeBinding {
  const { platform, arch } = getPlatformArch();
  const addonName = 'stdio_bus_native.node';

  // __dirname at runtime points to out/dist/ — prebuilds are at ../../prebuilds/
  const searchPaths = [
    path.join(__dirname, '..', '..', 'prebuilds', `${platform}-${arch}`, addonName),
    path.join(__dirname, '..', '..', 'build', 'Release', addonName),
    path.join(__dirname, '..', '..', 'build', 'Debug', addonName),
  ];

  for (const p of searchPaths) {
    if (fs.existsSync(p)) {
      try {
        // Dynamic require — must stay runtime, not bundled
        return require(p);
      } catch {
        continue;
      }
    }
  }

  const tried = searchPaths.map(p => `  - ${p}`).join('\n');
  throw new Error(
    `Failed to load @stdiobus/node native addon.\n\n` +
    `Platform: ${platform}-${arch}\n` +
    `Tried:\n${tried}\n\n` +
    `No prebuild available for this platform.\n` +
    `Use the Docker backend instead:\n` +
    `  const bus = new StdioBus({ configPath: './config.json', backend: 'docker' });`
  );
}
