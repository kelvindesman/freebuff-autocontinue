#!/usr/bin/env bash
# install.sh — One-line installer for freebuff-autocontinue
# Usage: curl -fsSL https://raw.githubusercontent.com/kelvindesman/freebuff-autocontinue/main/install.sh | bash

set -euo pipefail

REPO="kelvindesman/freebuff-autocontinue"
INSTALL_DIR="${HOME}/.local/bin"
BIN_NAME="freebuff-autocontinue"
TARGET_PATH="${INSTALL_DIR}/${BIN_NAME}"

echo "=========================================================="
echo "          freebuff-autocontinue Installer                 "
echo "=========================================================="

# Check OS and Architecture
OS="$(uname -s | tr '[:upper:]' '[:lower:]')"
ARCH="$(uname -m)"

case "$ARCH" in
  x86_64|amd64)
    ARCH="x64"
    ;;
  arm64|aarch64)
    ARCH="arm64"
    ;;
  *)
    echo "❌ Unsupported architecture: $ARCH"
    exit 1
    ;;
esac

case "$OS" in
  darwin|linux)
    ;;
  *)
    echo "❌ Unsupported operating system: $OS"
    echo "On Windows, please run within WSL2 (Ubuntu): wsl --install"
    exit 1
    ;;
esac

BINARY_SUFFIX="${OS}-${ARCH}"
RELEASE_BASE="https://github.com/${REPO}/releases/latest/download"
RELEASE_URL="${RELEASE_BASE}/freebuff-autocontinue-${BINARY_SUFFIX}"

mkdir -p "$INSTALL_DIR"

# Check if npm is available as an alternative install method
if command -v npm >/dev/null 2>&1; then
  echo "📦 Node.js & npm detected. Installing via npm..."
  if npm install -g freebuff-autocontinue; then
    echo "✅ Successfully installed globally via npm!"
    INSTALLED_VIA_NPM=1
  else
    echo "⚠️ npm install failed, falling back to standalone binary..."
  fi
fi

if [ -z "${INSTALLED_VIA_NPM:-}" ]; then
  echo "⬇️ Downloading standalone binary for ${OS}-${ARCH}..."
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$RELEASE_URL" -o "$TARGET_PATH"
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$TARGET_PATH" "$RELEASE_URL"
  else
    echo "❌ Neither curl nor wget found. Install one and retry."
    exit 1
  fi

  # Verify checksum against the release SHA256SUMS.txt manifest
  SUMS_TMP="$(mktemp)"
  if curl -fsSL "${RELEASE_BASE}/SHA256SUMS.txt" -o "$SUMS_TMP" 2>/dev/null; then
    BIN_FILE="freebuff-autocontinue-${BINARY_SUFFIX}"
    EXPECTED="$(grep "  ${BIN_FILE}\$" "$SUMS_TMP" | awk '{print $1}' || true)"
    if [ -n "$EXPECTED" ]; then
      if command -v sha256sum >/dev/null 2>&1; then
        ACTUAL="$(sha256sum "$TARGET_PATH" | awk '{print $1}')"
      elif command -v shasum >/dev/null 2>&1; then
        ACTUAL="$(shasum -a 256 "$TARGET_PATH" | awk '{print $1}')"
      else
        ACTUAL=""
        echo "⚠️ No sha256 tool found; skipping checksum verification."
      fi
      if [ -n "${ACTUAL:-}" ] && [ "$ACTUAL" != "$EXPECTED" ]; then
        echo "❌ Checksum mismatch for $TARGET_PATH. Aborting."
        echo "   expected: $EXPECTED"
        echo "   actual:   $ACTUAL"
        rm -f "$TARGET_PATH" "$SUMS_TMP"
        exit 1
      elif [ -n "${ACTUAL:-}" ]; then
        echo "✅ Checksum verified (sha256:$ACTUAL)"
      fi
    else
      echo "⚠️ No checksum entry for ${BIN_FILE}; skipping verification."
    fi
  else
    echo "⚠️ Could not fetch SHA256SUMS.txt; skipping checksum verification."
  fi
  rm -f "$SUMS_TMP"

  if [ -f "$TARGET_PATH" ] && [ -s "$TARGET_PATH" ]; then
    chmod +x "$TARGET_PATH"
    echo "✅ Standalone binary installed to $TARGET_PATH"
  else
    echo "❌ Binary download failed."
    echo "Please install via npx or npm:"
    echo "  npx freebuff-autocontinue"
    echo "  npm install -g freebuff-autocontinue"
    exit 1
  fi
fi

# Verify tmux requirement
if ! command -v tmux >/dev/null 2>&1; then
  echo ""
  echo "⚠️ tmux is not installed on this system."
  if [ "$OS" = "darwin" ]; then
    echo "👉 Install with Homebrew: brew install tmux"
  else
    echo "👉 Install with package manager: sudo apt-get install tmux"
  fi
fi

# PATH check
case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *)
    echo ""
    echo "💡 Note: Add $INSTALL_DIR to your PATH by adding this line to ~/.zshrc or ~/.bashrc:"
    echo "   export PATH=\"\$HOME/.local/bin:\$PATH\""
    ;;
esac

echo ""
echo "🎉 Installation complete! Run: freebuff-autocontinue --help"
