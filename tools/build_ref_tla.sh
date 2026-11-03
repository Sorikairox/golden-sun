#!/bin/bash
# Reference build of The Lost Age (phase TLA1): alchemy tla-en in the golden-sun-tools image, checked against the
# player's TLA ROM (make compare-tla-en). Same image, volume and compilers as tools/build_ref.sh (GS1, D12/D13):
# vendor/alchemy (read only) is cloned into the volume as /ref/alchemy-tla, so /ref/alchemy (GS1's reference at
# its own pin) is left alone; the compilers, GAS and libgcc built there by `make bootstrap` are copied over (no
# download, no alchemy-gcc checkout needed). The ROM is mounted read only and reached at the vendor's expected path
# roms/tla-en.gba through a symlink inside the volume clone (never in our tree). Outputs (map, ELF, built image:
# ROM-derived, never committed) go to the gitignored port_work/tla1/.
#
#   tools/build_ref_tla.sh [fetch|build|all]   (default: all)
#   NEARMATCH=1 tools/build_ref_tla.sh build   GS1's alchemy-gcc 9bc4e65a cannot match f6c08e64 (alchemy 34c36297
#     moved three options into alchemy-gcc 641764a5): this passes the three old options as CFLAGS_tla on the make
#     command line (no vendor file changes) and writes to port_work/tla1/oldcc; the main image then has the cart's
#     layout (docs/TLA1.md 2). The compare is expected to fail in that mode.
set -euo pipefail
export PATH=/Applications/Docker.app/Contents/Resources/bin:$PATH
cd "$(dirname "$0")/.."
ROOT=$PWD
ROM=${ROM:-$HOME/roms/Golden_Sun_The_Lost_Age_USA_Europe.gba}
IMAGE=golden-sun-tools
VOL=golden-sun-ref
OUT=$ROOT/port_work/tla1
MK=""
if [ -n "${NEARMATCH:-}" ]; then
  OUT=$ROOT/port_work/tla1/oldcc
  MK='CFLAGS_tla="-O2 -mthumb -nostdinc -fcall-used-r4 -mtune=arm9tdmi -mthumb-split-constants -mthumb-call-via-lr -mthumb-slow-loads"'
fi
step=${1:-all}
mkdir -p "$OUT"
tools/check_rom_tla.sh "$ROM" >/dev/null || { tools/check_rom_tla.sh "$ROM"; exit 1; }

run() {
  docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -v $VOL:/ref -v "$ROOT/vendor":/vendor:ro \
    -v "$ROM":/rom/tla-en.gba:ro -v "$OUT":/tla1 $IMAGE bash -c "git config --global --add safe.directory '*'; $1"
}

fetch() { # local clone of the vendor's current commit; compilers from GS1's bootstrap
  run 'set -e; want=$(git -C /vendor/alchemy rev-parse HEAD)
    [ -d /ref/alchemy-tla/.git ] || git clone -q /vendor/alchemy /ref/alchemy-tla 2>/dev/null
    git -C /ref/alchemy-tla fetch -q origin; git -C /ref/alchemy-tla checkout -q --detach $want
    mkdir -p /ref/alchemy-tla/tools/out /ref/alchemy-tla/roms
    for d in compilers compiler-runtime; do rm -rf /ref/alchemy-tla/tools/out/$d; cp -a /ref/alchemy/tools/out/$d /ref/alchemy-tla/tools/out/; done
    ln -sf /rom/tla-en.gba /ref/alchemy-tla/roms/tla-en.gba
    echo "fetch: /ref/alchemy-tla at $(git -C /ref/alchemy-tla rev-parse --short HEAD), compilers from /ref/alchemy"'
}

build() {
  run 'set -e; cd /ref/alchemy-tla; rm -rf out/tla-en
    rc=0; make -j8 compare-tla-en '"$MK"' >/ref/log.tla-en 2>&1 || rc=$?
    grep -m3 -E "^out/tla-en/tla-en.gba: |\*\*\*" /ref/log.tla-en
    [ -f out/tla-en/tla-en.elf ] || exit 1
    cp out/tla-en/tla-en.map out/tla-en/tla-en.elf out/tla-en/tla-en.gba /tla1/
    arm-none-eabi-readelf -sW out/tla-en/tla-en.elf | awk "NF>=8 {print \$8, \$2, \$3, \$4}" | sort -u > /tla1/syms.txt
    rm -rf /tla1/overlays; mkdir /tla1/overlays; cp out/tla-en/overlays/*.{map,elf,lz} /tla1/overlays/
    echo "tla-en: $(sha1sum out/tla-en/tla-en.gba | cut -c1-40) (make rc=$rc)"'
}

case $step in
  fetch) fetch ;; build) build ;; all) fetch; build ;;
  *) echo "usage: $0 [fetch|build|all]" >&2; exit 2 ;;
esac
