#!/usr/bin/env bash
set -euo pipefail
version=$(node scripts/app-server/compatibility.mjs --tested-cli-version)
platform=$(node -p 'process.platform + "-" + process.arch')
stage=$(mktemp -d)
archive=$(npm pack "@openai/codex@$version-$platform" --silent --pack-destination "$stage")
tar -xf "$stage/$archive" -C "$stage"
binary=$(find "$stage/package/vendor" -type f \( -name codex -o -name codex.exe \) -print -quit)
test -n "$binary"
if [[ "$platform" == win32-* ]]; then binary=$(cygpath -w "$binary"); fi
echo "PANEL_CODEX_BINARY=$binary" >> "$GITHUB_ENV"
