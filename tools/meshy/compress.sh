#!/usr/bin/env bash
# Shrinks Meshy models for the web, in place: textures down to 512 px and WebP, meshes
# quantised and compressed with meshopt (the game loads them with MeshoptDecoder).
# Usage: bash tools/meshy/compress.sh public/models/<name>-meshy.glb ...
set -euo pipefail
G="npx -y @gltf-transform/cli@4.1.1"
tmp=$(mktemp -d)
for f in "$@"; do
  $G resize "$f" "$tmp/a.glb" --width 512 --height 512 >/dev/null
  $G webp "$tmp/a.glb" "$tmp/b.glb" >/dev/null
  $G meshopt "$tmp/b.glb" "$tmp/c.glb" >/dev/null
  echo "$f: $(wc -c < "$f") -> $(wc -c < "$tmp/c.glb")"
  mv "$tmp/c.glb" "$f"
done
rm -rf "$tmp"
