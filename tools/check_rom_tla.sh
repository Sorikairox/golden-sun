#!/bin/sh
# Check the player's Lost Age ROM (read-only) against the one supported image (tla-en in alchemy's rom.sha1).
# Usage: tools/check_rom_tla.sh [path]
set -eu
ROM="${1:-$HOME/roms/Golden_Sun_The_Lost_Age_USA_Europe.gba}"
WANT=b500663220cb9bf56b9f8e8c0c544f1d6fa3a824
[ -f "$ROM" ] || { echo "missing: $ROM"; exit 2; }
SIZE=$(wc -c < "$ROM" | tr -d ' ')
SHA=$(shasum -a 1 "$ROM" | cut -d' ' -f1)
CODE=$(dd if="$ROM" bs=1 skip=172 count=4 2>/dev/null)
echo "$ROM size=$SIZE code=$CODE sha1=$SHA"
[ "$SHA" = "$WANT" ] && [ "$SIZE" = 16777216 ] && [ "$CODE" = AGFE ] && { echo OK; exit 0; }
echo "MISMATCH: expected Golden Sun: The Lost Age (USA, Europe), 16777216 bytes, code AGFE, sha1 $WANT"; exit 1
