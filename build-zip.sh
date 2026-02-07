#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="${ROOT_DIR}/market-iq-worker.zip"

cd "$ROOT_DIR"
rm -f "$OUT"

zip -r "$OUT" \
  index.final.deploy.walletbot.js \
  wrangler.toml \
  README.md \
  build-zip.sh \
  -x "*.git*" "node_modules/*"

echo "Created: $OUT"
