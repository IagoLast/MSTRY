#!/usr/bin/env bash
set -euo pipefail

# Remote installer for MSTRY
# Usage: curl -fsSL https://raw.githubusercontent.com/IagoLast/MSTRY/main/scripts/remote-install.sh | bash

echo "==> Installing MSTRY..."

# Check prerequisites
command -v node >/dev/null 2>&1 || { echo "Error: Node.js is required. Install it from https://nodejs.org"; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "Error: npm is required."; exit 1; }
command -v tmux >/dev/null 2>&1 || { echo "Error: tmux is required. Install with: brew install tmux"; exit 1; }
command -v git >/dev/null 2>&1 || { echo "Error: git is required."; exit 1; }

TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

echo "==> Cloning repository..."
git clone --depth 1 https://github.com/IagoLast/MSTRY.git "$TMPDIR/MSTRY"

cd "$TMPDIR/MSTRY"

echo "==> Installing dependencies..."
npm install

echo "==> Building and installing..."
npm run dist:install

echo ""
echo "MSTRY installed successfully!"
echo "Open it with: open -a MSTRY"
