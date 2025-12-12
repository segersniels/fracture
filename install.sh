#!/bin/bash
set -e

REPO="segersniels/fracture"
INSTALL_DIR="${HOME}/.local/bin"
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

# Supported platforms: darwin-arm64, linux-arm64, linux-x64
case "$platform" in
    darwin-arm64|linux-arm64|linux-x64) ;;
    *) echo "Unsupported platform: ${platform}" >&2; exit 1 ;;
esac

echo "Downloading fracture for ${platform}..."

# Get latest release download URL
download_url=$(curl -s "https://api.github.com/repos/${REPO}/releases/latest" | grep "browser_download_url.*${platform}" | cut -d '"' -f 4)

if [ -z "$download_url" ]; then
    echo "Failed to find download URL for ${platform}" >&2
    exit 1
fi

# Create install directory if it doesn't exist
mkdir -p "$INSTALL_DIR"

# Download to temp file
tmp_file=$(mktemp)
curl -sL "$download_url" -o "$tmp_file"

# Make executable and move to install dir
chmod +x "$tmp_file"
mv "$tmp_file" "${INSTALL_DIR}/${BINARY_NAME}"

echo "Installed fracture to ${INSTALL_DIR}/${BINARY_NAME}"

# Check if ~/.local/bin is in PATH
if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
    echo ""
    echo "Note: $INSTALL_DIR is not in your PATH"
    echo ""
    echo "Add it to your shell config:"

    # Detect configured shells
    current_shell="$(basename "$SHELL")"
    show_bash=false
    show_zsh=false
    show_fish=false

    case "${current_shell}" in
        bash) show_bash=true ;;
        zsh) show_zsh=true ;;
        fish) show_fish=true ;;
    esac

    # Also check for config file existence
    if [ -f "$HOME/.bashrc" ] || [ -f "$HOME/.bash_profile" ]; then show_bash=true; fi
    if [ -f "$HOME/.zshrc" ]; then show_zsh=true; fi
    if [ -f "$HOME/.config/fish/config.fish" ]; then show_fish=true; fi

    if [ "$show_bash" = true ]; then
        echo ""
        echo "  # bash"
        echo "  echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.bashrc"
        echo "  source ~/.bashrc"
    fi

    if [ "$show_zsh" = true ]; then
        echo ""
        echo "  # zsh"
        echo "  echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.zshrc"
        echo "  source ~/.zshrc"
    fi

    if [ "$show_fish" = true ]; then
        echo ""
        echo "  # fish"
        echo "  echo 'fish_add_path \$HOME/.local/bin' >> ~/.config/fish/config.fish"
        echo "  source ~/.config/fish/config.fish"
    fi

    # Fallback if no known shells detected
    if [ "$show_bash" != true ] && [ "$show_zsh" != true ] && [ "$show_fish" != true ]; then
        echo ""
        echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
    fi

    echo ""
fi
