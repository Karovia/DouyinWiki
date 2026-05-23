#!/bin/bash
set -Eeuo pipefail

echo "Building frontend with Vite..."
pnpm vite build

echo "Bundling server with tsup..."
pnpm tsup server/server.ts --format cjs --platform node --target node20 --outDir dist-server --no-splitting --no-minify --external vite --external @libsql/client

echo "Build completed successfully!"
