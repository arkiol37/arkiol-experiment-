#!/usr/bin/env bash
# scripts/dev.sh — Cross-platform development runner
# Uses npx concurrently for reliable multi-process dev on Unix and Windows (Git Bash/WSL).
#
# Usage:
#   ./scripts/dev.sh             # Run arkiol-core + animation-studio
#   ./scripts/dev.sh core        # Run arkiol-core only
#   ./scripts/dev.sh studio      # Run animation-studio only

set -e

MODE="${1:-all}"

case "$MODE" in
  core)
    echo "[arkiol] Starting arkiol-core only..."
    npm run dev --workspace=apps/arkiol-core
    ;;
  studio)
    echo "[arkiol] Starting animation-studio only..."
    npm run dev --workspace=apps/animation-studio
    ;;
  all|*)
    echo "[arkiol] Starting all services with concurrently..."
    npx concurrently \
      --names="core,studio" \
      --prefix-colors="cyan,magenta" \
      --kill-others-on-fail \
      "npm run dev --workspace=apps/arkiol-core" \
      "npm run dev --workspace=apps/animation-studio"
    ;;
esac
