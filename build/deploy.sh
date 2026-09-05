#!/usr/bin/env bash
# Deploy The Holographic Eye wrapper provider to the live Hermes install.
# build/ stays disposable: this copies (never symlinks) so deleting the
# build tree cannot break the running agent.
set -euo pipefail

SRC="$(cd "$(dirname "$0")/eye_provider" && pwd)"
DST="$HOME/.hermes/plugins/holographic-eye"
FRONTEND_SRC="$(cd "$(dirname "$0")" && pwd)/eye_frontend/dist"

mkdir -p "$DST"
rsync -a --exclude '__pycache__' --exclude 'frontend' "$SRC/" "$DST/"
if [ -d "$FRONTEND_SRC" ]; then
  mkdir -p "$DST/frontend"
  rsync -a --delete "$FRONTEND_SRC/" "$DST/frontend/"
fi

# companion slash-command plugin (/holo)
CMD_SRC="$(cd "$(dirname "$0")/eye_commands" && pwd)"
CMD_DST="$HOME/.hermes/plugins/holographic-eye-commands"
mkdir -p "$CMD_DST"
rsync -a --exclude '__pycache__' "$CMD_SRC/" "$CMD_DST/"

echo "deployed → $DST (+ $CMD_DST)"
ls "$DST"
