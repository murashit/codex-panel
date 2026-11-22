#!/usr/bin/env bash
set -euo pipefail
stage=$(mktemp -d)
image=panel-smoke-$(basename "$stage" | tr '[:upper:]' '[:lower:]')
screenshot=
cleanup() {
  docker rm -f "$image" >/dev/null 2>&1 || true
  docker image rm "$image" >/dev/null 2>&1 || true
  if [[ -n "${screenshot:-}" && ! -s "$screenshot" ]]; then rm -f "$screenshot"; fi
  rm -rf "$stage"
}
trap cleanup EXIT
gh api repos/obsidianmd/obsidian-releases/releases/latest > "$stage/release.json"
version=$(jq -er .tag_name "$stage/release.json")
asset=$(jq -ec --arg name "Obsidian-${version#v}.AppImage" '.assets[] | select(.name == $name)' "$stage/release.json")
digest=$(jq -er '.digest | select(test("^sha256:[0-9a-f]{64}$"))' <<< "$asset")
echo "Obsidian $version $digest"
curl -fLsS --retry 3 "$(jq -r .browser_download_url <<< "$asset")" -o "$stage/image"
(
  cd "$stage"
  echo "${digest#sha256:}  image" | sha256sum -c -
  chmod +x image
  ./image --appimage-extract >/dev/null
  rm image
)
chmod -R a+rX "$stage/squashfs-root"
cp scripts/smoke/{Dockerfile,desktop.mjs} main.js manifest.json styles.css "$stage/"
cp "$PANEL_CODEX_BINARY" "$stage/codex"
cp "$(node -p 'process.execPath')" "$stage/node"
chmod a+rx "$stage/codex" "$stage/node"
docker build -q -t "$image" "$stage"
mkdir -p reports/desktop
screenshot="$PWD/reports/desktop/obsidian.png"
install -m 666 /dev/null "$screenshot"
timeout 180 docker run --name "$image" --rm --init --network none --read-only --cap-drop ALL \
  --security-opt no-new-privileges --shm-size 256m --tmpfs /tmp:rw,nosuid,nodev,mode=1777 \
  -v "$screenshot:/tmp/obsidian.png" "$image" 2>&1 | tee reports/desktop/obsidian.log
