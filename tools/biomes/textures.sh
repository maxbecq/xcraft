#!/bin/sh
# Ground textures of the Volcan and Astéroïdes planets, from the chosen pictures in recherches-visuelles (out of git):
# seamless (blended with itself shifted by half, as tools/hud/gen.py does), and a normal map from the luminance.
# Run from the repository: sh tools/biomes/textures.sh   (needs ImageMagick)
set -e
SRC="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")/recherches-visuelles/iter-2026-11-20"
OUT=public/textures
mkdir -p "$OUT"
seamless() { # in out
  magick "$1" -resize 1024x1024! \( +clone -roll +512+512 \) \( -size 1024x1024 xc: -fx 'min(1,1.6*max(abs(2*i/w-1),abs(2*j/h-1)))' \) -composite "$2"
}
normal() { # albedo out strength
  magick "$1" -colorspace Gray -blur 0x1 \( +clone -morphology Convolve Sobel:0 \) \( -clone 0 -morphology Convolve Sobel:90 \) -delete 0 \
    \( -clone 0 -evaluate Multiply "$3" -evaluate Add 50% \) \( -clone 1 -evaluate Multiply "$3" -evaluate Add 50% \) -delete 0,1 \
    \( -clone 0 -fill white -colorize 100 \) -combine -resize 512x512 -quality 85 "$2"
}
seamless "$SRC/sol-basalte-openai.png" /tmp/basalte.png
# Lifted so the slabs read under the dim red light (the patches of black basalt come from the planet's patch colour).
magick /tmp/basalte.png -modulate 105,110 -level 0%,62%,1.05 -quality 88 "$OUT/volcan-sol.jpg"
normal /tmp/basalte.png "$OUT/volcan-sol-n.jpg" 2.5
seamless "$SRC/sol-asteroide-openai.png" /tmp/asteroide.png
magick /tmp/asteroide.png -quality 88 "$OUT/asteroides-sol.jpg"
normal /tmp/asteroide.png "$OUT/asteroides-sol-n.jpg" 3
ls -l "$OUT"
