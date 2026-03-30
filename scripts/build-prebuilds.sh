#!/bin/bash
#
# Build prebuilt binaries for all supported platforms
#
# This script builds native addons for multiple platforms using Docker
# for cross-compilation (Linux) and native builds (macOS).
#
# Output: prebuilds/<platform>-<arch>/stdio_bus_native.node
#

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SDK_DIR="$(dirname "$SCRIPT_DIR")"
ROOT_DIR="$(dirname "$(dirname "$SDK_DIR")")"

echo "=== Building prebuilt binaries for @stdio-bus/node ==="
echo "Root: $ROOT_DIR"
echo "SDK: $SDK_DIR"
echo ""

# Create prebuilds directory
mkdir -p "$SDK_DIR/prebuilds"

# Detect current platform
CURRENT_OS=$(uname -s | tr '[:upper:]' '[:lower:]')
CURRENT_ARCH=$(uname -m)
if [ "$CURRENT_ARCH" = "x86_64" ]; then
    CURRENT_ARCH="x64"
elif [ "$CURRENT_ARCH" = "aarch64" ] || [ "$CURRENT_ARCH" = "arm64" ]; then
    CURRENT_ARCH="arm64"
fi

echo "Current platform: $CURRENT_OS-$CURRENT_ARCH"
echo ""

# Build for current platform (native)
build_native() {
    local platform=$1
    local arch=$2
    
    echo "Building for $platform-$arch (native)..."
    
    # First build libstdio_bus.a
    echo "  Building libstdio_bus.a..."
    (cd "$ROOT_DIR" && make clean >/dev/null 2>&1 || true)
    (cd "$ROOT_DIR" && make lib BUILD=release)
    
    # Then build the addon
    echo "  Building addon..."
    (cd "$SDK_DIR" && node-gyp rebuild --release)
    
    # Copy to prebuilds
    local prebuild_dir="$SDK_DIR/prebuilds/$platform-$arch"
    mkdir -p "$prebuild_dir"
    cp "$SDK_DIR/build/Release/stdio_bus_native.node" "$prebuild_dir/"
    
    echo "  Done: $prebuild_dir/stdio_bus_native.node"
}

# Build for Linux using Docker
build_linux_docker() {
    local arch=$1
    local docker_platform=""
    local docker_image="node:18-bullseye"
    
    if [ "$arch" = "x64" ]; then
        docker_platform="linux/amd64"
    elif [ "$arch" = "arm64" ]; then
        docker_platform="linux/arm64"
    else
        echo "  Unsupported arch: $arch"
        return 1
    fi
    
    echo "Building for linux-$arch (Docker: $docker_platform)..."
    
    local prebuild_dir="$SDK_DIR/prebuilds/linux-$arch"
    mkdir -p "$prebuild_dir"
    
    # Build in Docker with volume mount
    docker run --rm --platform "$docker_platform" \
        -v "$ROOT_DIR:/workspace:rw" \
        -w /workspace \
        "$docker_image" \
        bash -c "
            set -e
            echo 'Installing build tools...'
            apt-get update -qq && apt-get install -y -qq build-essential python3 >/dev/null 2>&1
            
            echo 'Building libstdio_bus.a...'
            make clean >/dev/null 2>&1 || true
            make lib BUILD=release
            
            echo 'Building Node.js addon...'
            cd sdk/node-native
            npm install --ignore-scripts >/dev/null 2>&1
            npx node-gyp rebuild --release
            
            echo 'Copying prebuild...'
            mkdir -p prebuilds/linux-$arch
            cp build/Release/stdio_bus_native.node prebuilds/linux-$arch/
            
            echo 'Done!'
        "
    
    # Verify the file was created
    if [ -f "$prebuild_dir/stdio_bus_native.node" ]; then
        echo "  Done: $prebuild_dir/stdio_bus_native.node"
    else
        echo "  ERROR: Prebuild not found at $prebuild_dir/stdio_bus_native.node"
        return 1
    fi
}

# Parse arguments
BUILD_DARWIN=false
BUILD_LINUX=false
BUILD_ALL=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --darwin)
            BUILD_DARWIN=true
            shift
            ;;
        --linux)
            BUILD_LINUX=true
            shift
            ;;
        --all)
            BUILD_ALL=true
            shift
            ;;
        *)
            echo "Unknown option: $1"
            echo "Usage: $0 [--darwin] [--linux] [--all]"
            exit 1
            ;;
    esac
done

# Default: build for current platform only
if [ "$BUILD_ALL" = false ] && [ "$BUILD_DARWIN" = false ] && [ "$BUILD_LINUX" = false ]; then
    echo "No platform specified, building for current platform only."
    echo "Use --all to build for all platforms, or --darwin/--linux for specific ones."
    echo ""
    
    if [ "$CURRENT_OS" = "darwin" ]; then
        build_native "darwin" "$CURRENT_ARCH"
    elif [ "$CURRENT_OS" = "linux" ]; then
        build_native "linux" "$CURRENT_ARCH"
    fi
else
    # Build requested platforms
    if [ "$BUILD_ALL" = true ] || [ "$BUILD_DARWIN" = true ]; then
        if [ "$CURRENT_OS" = "darwin" ]; then
            build_native "darwin" "$CURRENT_ARCH"
            
            # Note: cross-compilation for other darwin arch not supported
            if [ "$CURRENT_ARCH" = "arm64" ]; then
                echo ""
                echo "Note: To build darwin-x64, run this script on an Intel Mac."
            else
                echo ""
                echo "Note: To build darwin-arm64, run this script on an Apple Silicon Mac."
            fi
        else
            echo "Skipping darwin builds (requires macOS host)"
        fi
    fi
    
    if [ "$BUILD_ALL" = true ] || [ "$BUILD_LINUX" = true ]; then
        if command -v docker &> /dev/null; then
            echo ""
            build_linux_docker "x64"
            echo ""
            build_linux_docker "arm64"
        else
            echo "Skipping Linux builds (Docker not available)"
        fi
    fi
fi

echo ""
echo "=== Prebuild Summary ==="
if [ -d "$SDK_DIR/prebuilds" ]; then
    for dir in "$SDK_DIR/prebuilds"/*/; do
        if [ -d "$dir" ]; then
            platform=$(basename "$dir")
            if [ -f "$dir/stdio_bus_native.node" ]; then
                size=$(ls -lh "$dir/stdio_bus_native.node" | awk '{print $5}')
                echo "  ✓ $platform ($size)"
            else
                echo "  ✗ $platform (missing)"
            fi
        fi
    done
else
    echo "  No prebuilds found"
fi

echo ""
echo "Done!"
