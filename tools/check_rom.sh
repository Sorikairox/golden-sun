#!/bin/sh
# Check the player's ROM (read-only) against the one supported image. Usage: tools/check_rom.sh [path]
set -eu
ROM="${1:-$HOME/roms/Golden_Sun_USA_Europe.gba}"
WANT=5c4695205413df7db52b9a184815a07783999971
[ -f "$ROM" ] || { echo "missing: $ROM"; exit 2; }
SIZE=$(wc -c < "$ROM" | tr -d ' ')
SHA=$(shasum -a 1 "$ROM" | cut -d' ' -f1)
CODE=$(dd if="$ROM" bs=1 skip=172 count=4 2>/dev/null)
echo "$ROM size=$SIZE code=$CODE sha1=$SHA"
[ "$SHA" = "$WANT" ] && [ "$SIZE" = 8388608 ] && { echo OK; exit 0; }
echo "MISMATCH: expected Golden Sun (USA, Europe), 8388608 bytes, sha1 $WANT"; exit 1
