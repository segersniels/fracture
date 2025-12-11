#!/bin/bash
set -e

REPO="segersniels/fracture"
INSTALL_DIR="/usr/local/bin"
BINARY_NAME="fracture"

# Detect OS
case "$(uname -s)" in
    Darwin) os="darwin" ;;
    Linux) os="linux" ;;
    *) echo "Unsupported OS" >&2; exit 1 ;;
esac

# Detect architecture
case "$(uname -m)" in
    x86_64|amd64) arch="x64" ;;
    arm64|aarch64) arch="arm64" ;;
    *) echo "Unsupported architecture" >&2; exit 1 ;;
esac

platform="${os}-${arch}"

# Only darwin-arm64 supported for now
if [ "$platform" != "darwin-arm64" ]; then
    echo "Currently only macOS Apple Silicon (darwin-arm64) is supported" >&2
    exit 1
fi

echo "Downloading fracture for ${platform}..."

# Get latest release download URL
download_url=$(curl -s "https://api.github.com/repos/${REPO}/releases/latest" | grep "browser_download_url.*${platform}" | cut -d '"' -f 4)

if [ -z "$download_url" ]; then
    echo "Failed to find download URL for ${platform}" >&2
    exit 1
fi

# Download to temp file
tmp_file=$(mktemp)
curl -sL "$download_url" -o "$tmp_file"

# Make executable and move to install dir
chmod +x "$tmp_file"
sudo mv "$tmp_file" "${INSTALL_DIR}/${BINARY_NAME}"

echo "Installed fracture to ${INSTALL_DIR}/${BINARY_NAME}"
