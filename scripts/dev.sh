#!/bin/bash
set -Eeuo pipefail


PORT="${PORT:-5000}"

echo "Starting express + Vite dev server on port ${PORT}..."

PORT=$PORT pnpm tsx watch server/server.ts
