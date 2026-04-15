#!/bin/bash

# SPDX-License-Identifier: Apache-2.0
# Copyright (c) 2026-present Raman Marozau <raman@worktif.com>, stdiobus contributors

#
# E2E test: npm pack → install from tarball → verify stdiobus works.
#
# Runs on:
#   - macOS (native, current arch)
#   - Linux x64 (Docker, node:18-bullseye)
#   - Linux arm64 (Docker, node:18-bullseye, optional — slow on Intel Mac)
#
# Prerequisites:
#   - prebuilds/ must contain .node files for target platforms
#   - Docker must be running (for Linux tests)
#
# Usage:
#   ./test/e2e/pack-and-test.sh [--skip-docker] [--skip-arm64] [--skip-native]
#

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SDK_DIR="$(cd "$SCRIPT_DIR/../.." && pwd)"
RUNNER="$SCRIPT_DIR/run-installed-package.mjs"
ECHO_WORKER="$SDK_DIR/test/fixtures/echo-worker.js"

SKIP_DOCKER=false
SKIP_ARM64=false
SKIP_NATIVE=false

while [[ $# -gt 0 ]]; do
    case $1 in
        --skip-docker) SKIP_DOCKER=true; shift ;;
        --skip-arm64)  SKIP_ARM64=true; shift ;;
        --skip-native) SKIP_NATIVE=true; shift ;;
        *) echo "Unknown: $1"; exit 1 ;;
    esac
done

echo "============================================"
echo "  @stdiobus/node E2E: npm pack → install"
echo "============================================"
echo ""

# ── Step 1: npm pack ──────────────────────────────────────────────
echo "[pack] Creating tarball..."
TGZ_NAME=$(cd "$SDK_DIR" && npm pack --json 2>/dev/null | node -e "
  let d=''; process.stdin.on('data',c=>d+=c);
  process.stdin.on('end',()=>{
    try { console.log(JSON.parse(d)[0].filename); }
    catch(e) { console.error('parse error'); process.exit(1); }
  });
")

if [ -z "$TGZ_NAME" ]; then
    echo "[pack] FAIL: npm pack produced no output"
    exit 1
fi

TGZ_PATH="$SDK_DIR/$TGZ_NAME"
echo "[pack] Created: $TGZ_PATH"
echo "[pack] Size: $(ls -lh "$TGZ_PATH" | awk '{print $5}')"

# Verify tarball contents — no C source should be inside
echo "[pack] Checking tarball for leaked private files..."
LEAKED=$(tar tzf "$TGZ_PATH" | grep -E '(binding\.gyp|src/binding\.c|/include/)' || true)
if [ -n "$LEAKED" ]; then
    echo "[pack] LEAK DETECTED in tarball:"
    echo "$LEAKED"
    rm -f "$TGZ_PATH"
    exit 1
fi
echo "[pack] OK — no private files in tarball"
echo ""

PASS=0
FAIL=0
SKIP=0

# ── Step 2: macOS native ─────────────────────────────────────────
if [ "$SKIP_NATIVE" = false ] && [ "$(uname -s)" = "Darwin" ]; then
    echo "────────────────────────────────────────────"
    echo "[native] macOS $(uname -m)"
    echo "────────────────────────────────────────────"
    if node "$RUNNER" "$TGZ_PATH" "$ECHO_WORKER"; then
        echo "[native] ✓ PASS"
        PASS=$((PASS + 1))
    else
        echo "[native] ✗ FAIL"
        FAIL=$((FAIL + 1))
    fi
    echo ""
else
    echo "[native] SKIPPED"
    SKIP=$((SKIP + 1))
fi

# ── Step 3: Docker Linux x64 ─────────────────────────────────────
run_docker_test() {
    local platform=$1
    local label=$2
    local image="node:18-bullseye"

    echo "────────────────────────────────────────────"
    echo "[docker] $label ($image, $platform)"
    echo "────────────────────────────────────────────"

    docker run --rm \
        --platform "$platform" \
        -v "$TGZ_PATH:/artifacts/package.tgz:ro" \
        -v "$RUNNER:/artifacts/run-installed-package.mjs:ro" \
        -v "$ECHO_WORKER:/artifacts/echo-worker.js:ro" \
        "$image" \
        node /artifacts/run-installed-package.mjs \
            /artifacts/package.tgz \
            /artifacts/echo-worker.js
}

if [ "$SKIP_DOCKER" = false ] && command -v docker &>/dev/null; then
    # Linux x64
    if run_docker_test "linux/amd64" "Linux x64 glibc"; then
        echo "[docker] ✓ PASS (linux-x64)"
        PASS=$((PASS + 1))
    else
        echo "[docker] ✗ FAIL (linux-x64)"
        FAIL=$((FAIL + 1))
    fi
    echo ""

    # Linux arm64 (optional)
    if [ "$SKIP_ARM64" = false ]; then
        if run_docker_test "linux/arm64" "Linux arm64 glibc"; then
            echo "[docker] ✓ PASS (linux-arm64)"
            PASS=$((PASS + 1))
        else
            echo "[docker] ✗ FAIL (linux-arm64)"
            FAIL=$((FAIL + 1))
        fi
        echo ""
    else
        echo "[docker] SKIPPED (linux-arm64)"
        SKIP=$((SKIP + 1))
    fi
else
    echo "[docker] SKIPPED (Docker not available or --skip-docker)"
    SKIP=$((SKIP + 2))
fi

# ── Cleanup ───────────────────────────────────────────────────────
rm -f "$TGZ_PATH"

# ── Summary ───────────────────────────────────────────────────────
echo "============================================"
echo "  Results: $PASS passed, $FAIL failed, $SKIP skipped"
echo "============================================"

if [ "$FAIL" -gt 0 ]; then
    exit 1
fi
