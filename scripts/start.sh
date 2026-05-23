#!/bin/bash
set -Eeuo pipefail

PORT="${PORT:-5000}"

echo "Starting express production server on port ${PORT}..."
PORT=$PORT node dist-server/server.cjs
