#!/usr/bin/env bash
set -euo pipefail

REPO_DIR="${1:-$HOME/openunumQwen}"
SERVICE_NAME="openunum-qwen.service"
USER_SYSTEMD_DIR="$HOME/.config/systemd/user"

mkdir -p "$USER_SYSTEMD_DIR"
cp "$REPO_DIR/deploy/$SERVICE_NAME" "$USER_SYSTEMD_DIR/$SERVICE_NAME"

systemctl --user daemon-reload
systemctl --user enable "$SERVICE_NAME"
systemctl --user restart "$SERVICE_NAME"

echo "Installed and restarted $SERVICE_NAME"
