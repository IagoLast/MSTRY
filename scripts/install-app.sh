#!/usr/bin/env bash
set -euo pipefail

# Installs the freshly-built Electree.app into /Applications.
# Usage: ./scripts/install-app.sh

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
APP_NAME="Electree.app"
DEST="/Applications/${APP_NAME}"

# electron-builder outputs to release/mac-arm64 on Apple Silicon and release/mac on Intel.
CANDIDATES=(
  "${ROOT_DIR}/release/mac-arm64/${APP_NAME}"
  "${ROOT_DIR}/release/mac/${APP_NAME}"
  "${ROOT_DIR}/release/mac-universal/${APP_NAME}"
)

SRC=""
for candidate in "${CANDIDATES[@]}"; do
  if [ -d "$candidate" ]; then
    SRC="$candidate"
    break
  fi
done

if [ -z "$SRC" ]; then
  echo "Error: no se encontró ${APP_NAME} en release/. Ejecuta primero: npm run dist" >&2
  exit 1
fi

echo "Fuente:  $SRC"
echo "Destino: $DEST"

# Quit the running app (if any) so we can overwrite it.
if pgrep -x "Electree" >/dev/null 2>&1; then
  echo "Cerrando Electree en ejecución..."
  osascript -e 'tell application "Electree" to quit' >/dev/null 2>&1 || true
  # Give it a moment; force-kill leftovers.
  sleep 1
  pkill -x "Electree" >/dev/null 2>&1 || true
fi

# Remove previous install and copy the new bundle.
if [ -d "$DEST" ]; then
  echo "Eliminando instalación previa..."
  rm -rf "$DEST"
fi

echo "Copiando..."
cp -R "$SRC" "$DEST"

# Clear the macOS quarantine attribute so Gatekeeper doesn't block an unsigned build.
xattr -dr com.apple.quarantine "$DEST" 2>/dev/null || true

echo "Listo. Electree instalado en $DEST"
echo "Ábrelo con: open -a Electree"
