#!/bin/sh
# Packs the extension for Firefox (and Firefox-based browsers like Zen) into
# dist/straight-cut-<version>.xpi. Run: sh tools/build-firefox.sh
# The same manifest works in Chromium: it reads background.service_worker and
# ignores background.scripts, while Firefox does the opposite.
set -e
cd "$(dirname "$0")/.."
version=$(node -p "require('./manifest.json').version")
out="dist/straight-cut-$version.xpi"
mkdir -p dist
rm -f "$out"
zip -qr -X "$out" manifest.json LICENSE icons rules src -x '*.DS_Store'
echo "$out"
