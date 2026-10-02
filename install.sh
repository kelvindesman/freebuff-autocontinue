#!/usr/bin/env bash
# install.sh — One-line installer for freebuff-autocontinue
# Usage: curl -fsSL https://raw.githubusercontent.com/kelvin/freebuff-autocontinue/main/install.sh | bash

set -e

REPO="kelvin/freebuff-autocontinue"
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
RELEASE_URL="https://github.com/${REPO}/releases/latest/download/freebuff-autocontinue-${BINARY_SUFFIX}"

mkdir -p "$INSTALL_DIR"

# Check if npm is available as an alternative install method
if command -v npm >/dev/null 2>&1; then
  echo "📦 Node.js & npm detected. Installing via npm..."
  if npm install -g freebuff-autocontinue 2>/dev/null; then
    echo "✅ Successfully installed globally via npm!"
    INSTALLED_VIA_NPM=1
  fi
fi

if [ -z "$INSTALLED_VIA_NPM" ]; then
  echo "⬇️ Downloading standalone binary for ${OS}-${ARCH}..."
  if command -v curl >/dev/null 2>&1; then
    curl -fsSL "$RELEASE_URL" -o "$TARGET_PATH" 2>/dev/null || true
  elif command -v wget >/dev/null 2>&1; then
    wget -qO "$TARGET_PATH" "$RELEASE_URL" 2>/dev/null || true
  fi

  if [ -f "$TARGET_PATH" ] && [ -s "$TARGET_PATH" ]; then
    chmod +x "$TARGET_PATH"
    echo "✅ Standalone binary installed to $TARGET_PATH"
  else
    echo "⚠️ Binary download fallback: fetching release bundle..."
    # Fallback to local build if inside clone
    if [ -f "./bin/freebuff-autocontinue" ]; then
      cp "./bin/freebuff-autocontinue" "$TARGET_PATH"
      chmod +x "$TARGET_PATH"
      echo "✅ Installed from local build to $TARGET_PATH"
    else
      echo "Please install via npx or npm:"
      echo "  npx freebuff-autocontinue"
      echo "  npm install -g freebuff-autocontinue"
      exit 0
    fi
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
