/**
 * Native addon loader with prebuild support
 *
 * Tries to load prebuilt binary first, falls back to compiled version.
 *
 * Usage:
 *   require('./load-native')        - Load and return the addon
 *   node load-native.js --check     - Exit 0 if prebuild exists, 1 otherwise
 */

const path = require('path');
const fs = require('fs');

function getPlatformArch() {
  const platform = process.platform;
  let arch = process.arch;

  // Normalize arch names
  if (arch === 'x64' || arch === 'amd64') {
    arch = 'x64';
  } else if (arch === 'arm64' || arch === 'aarch64') {
    arch = 'arm64';
  }

  return { platform, arch };
}

function findPrebuild() {
  const { platform, arch } = getPlatformArch();
  const addonName = 'stdio_bus_native.node';
  const prebuildPath = path.join(__dirname, '..', 'prebuilds', `${platform}-${arch}`, addonName);

  if (fs.existsSync(prebuildPath)) {
    return prebuildPath;
  }
  return null;
}

function loadNativeAddon() {
  const { platform, arch } = getPlatformArch();
  const addonName = 'stdio_bus_native.node';

  // Paths to try (in order of preference)
  const paths = [
    // 1. Prebuilt binary for this platform
    path.join(__dirname, '..', 'prebuilds', `${platform}-${arch}`, addonName),

    // 2. Locally compiled binary (Release)
    path.join(__dirname, '..', 'build', 'Release', addonName),

    // 3. Locally compiled binary (Debug)
    path.join(__dirname, '..', 'build', 'Debug', addonName),
  ];

  let lastError = null;

  for (const addonPath of paths) {
    if (fs.existsSync(addonPath)) {
      try {
        return require(addonPath);
      } catch (err) {
        lastError = err;
        // Continue to next path
      }
    }
  }

  // None found - provide helpful error message
  const triedPaths = paths.map(p => `  - ${p}`).join('\n');
  const errorMsg = `
Failed to load @stdiobus/node native addon.

Platform: ${platform}-${arch}
Tried paths:
${triedPaths}

${lastError ? `Last error: ${lastError.message}` : ''}

To fix this:
1. If prebuilt binaries are not available for your platform, you need to compile from source:
   npm rebuild @stdiobus/node

2. Make sure you have a C compiler installed:
   - macOS: Xcode Command Line Tools (xcode-select --install)
   - Linux: build-essential (apt install build-essential)

3. Make sure libstdio_bus.a is built:
   cd <project-root> && make lib
`.trim();

  throw new Error(errorMsg);
}

// CLI mode: check if prebuild exists
if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.includes('--check')) {
    const prebuild = findPrebuild();
    if (prebuild) {
      console.log(`Prebuild found: ${prebuild}`);
      process.exit(0);
    } else {
      const { platform, arch } = getPlatformArch();
      console.log(`No prebuild for ${platform}-${arch}, will compile from source`);
      process.exit(1);
    }
  }
}

module.exports = loadNativeAddon();
