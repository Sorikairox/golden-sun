#!/bin/bash
# Reference build of The Lost Age (phase TLA1): alchemy tla-en in the golden-sun-tools image, checked against the
# player's TLA ROM (make compare-tla-en). Same image and volume as tools/build_ref.sh (GS1, D12/D13). vendor/alchemy
# (read only) is cloned into the volume as /ref/alchemy-tla, so /ref/alchemy (GS1's reference, alchemy 24b72a32 with
# alchemy-gcc 9bc4e65a) is left alone. TLA's compilers come from alchemy-gcc at the vendor's own gitlink (641764a5 for
# f6c08e64), checked out in vendor/alchemy-gcc-tla (approved 2026-11-03, D13 f), with the same agbcc (vendor/agbcc) and
# gcc-2.95.2 (vendor/downloads) as GS1; GAS 2.10 (unchanged binutils) is copied from /ref/alchemy. The ROM is mounted
# read only and reached at the vendor's expected path roms/tla-en.gba through a symlink inside the volume clone
# (never in our tree). Outputs (map, ELFs, built image: ROM-derived, never committed) go to the gitignored
# port_work/tla1/.
#
#   tools/build_ref_tla.sh [fetch|bootstrap|build|all]   (default: all)
#
# (TLA1 first ran a near-match build with GS1's 9bc4e65a compilers and the three options alchemy 34c36297 removed:
# make compare-tla-en CFLAGS_tla="... -mthumb-split-constants -mthumb-call-via-lr -mthumb-slow-loads"; docs/TLA1.md 2.)
set -euo pipefail
export PATH=/Applications/Docker.app/Contents/Resources/bin:$PATH
cd "$(dirname "$0")/.."
ROOT=$PWD
ROM=${ROM:-$HOME/roms/Golden_Sun_The_Lost_Age_USA_Europe.gba}
IMAGE=golden-sun-tools
VOL=golden-sun-ref
OUT=$ROOT/port_work/tla1
step=${1:-all}
mkdir -p "$OUT"
tools/check_rom_tla.sh "$ROM" >/dev/null || { tools/check_rom_tla.sh "$ROM"; exit 1; }

run() {
  docker run --rm -u "$(id -u):$(id -g)" -e HOME=/tmp -v $VOL:/ref -v "$ROOT/vendor":/vendor:ro \
    -v "$ROM":/rom/tla-en.gba:ro -v "$OUT":/tla1 $IMAGE bash -c "git config --global --add safe.directory '*'; $1"
}

fetch() { # local clones: the vendor's current commit, alchemy-gcc at its gitlink, agbcc, gcc-2.95.2
  want_gcc=$(git -C vendor/alchemy ls-tree HEAD alchemy-gcc | awk '{print $3}')
  have_gcc=$(git -C vendor/alchemy-gcc-tla rev-parse HEAD 2>/dev/null || echo none)
  [ "$want_gcc" = "$have_gcc" ] || { echo "fetch: vendor/alchemy-gcc-tla is $have_gcc, the vendor pins $want_gcc (approval needed to fetch)"; exit 1; }
  run 'set -e; want=$(git -C /vendor/alchemy rev-parse HEAD)
    [ -d /ref/alchemy-tla/.git ] || git clone -q /vendor/alchemy /ref/alchemy-tla 2>/dev/null
    git -C /ref/alchemy-tla fetch -q origin; git -C /ref/alchemy-tla checkout -q --detach $want
    g=/ref/alchemy-tla/alchemy-gcc
    if [ "$(git -C $g rev-parse HEAD 2>/dev/null)" != "'$want_gcc'" ]; then
      rm -rf $g; git clone -q /vendor/alchemy-gcc-tla $g 2>/dev/null; git -C $g checkout -q --detach '$want_gcc'; fi
    [ -d $g/agbcc/.git ] || { rmdir $g/agbcc 2>/dev/null || true; git clone -q /vendor/agbcc $g/agbcc 2>/dev/null; }
    mkdir -p $g/arm/sources; [ -f $g/arm/sources/gcc-2.95.2.tar.gz ] || cp /vendor/downloads/gcc-2.95.2.tar.gz $g/arm/sources/
    mkdir -p /ref/alchemy-tla/tools/out /ref/alchemy-tla/roms
    ln -sf /rom/tla-en.gba /ref/alchemy-tla/roms/tla-en.gba
    echo "fetch: /ref/alchemy-tla at $(git -C /ref/alchemy-tla rev-parse --short HEAD), alchemy-gcc $(git -C $g rev-parse --short HEAD), agbcc $(git -C $g/agbcc rev-parse --short HEAD)"'
}

bootstrap() { # what `make bootstrap` does, from the local sources; GAS 2.10 copied from GS1's volume clone
  run 'set -e; cd /ref/alchemy-tla; C=tools/out/compilers; rm -rf $C tools/out/compiler-runtime tools/out/toolchain/libgcc; mkdir -p $C/agbcc
    make -C alchemy-gcc gcc -j8 >/ref/log.tla-gcc 2>&1 || { tail -20 /ref/log.tla-gcc; exit 1; }
    make -C alchemy-gcc generated-check 2>&1 | grep -E "match|differ" || true
    make -C alchemy-gcc arm old-agbcc >/ref/log.tla-gcc2 2>&1 || { tail -20 /ref/log.tla-gcc2; exit 1; }
    cp alchemy-gcc/build/gcc/xgcc alchemy-gcc/build/gcc/cpp0 alchemy-gcc/build/gcc/tradcpp0 alchemy-gcc/build/gcc/cc1 $C/
    cp alchemy-gcc/arm/build/gcc/cc1 $C/gcc2952_arm; cp alchemy-gcc/agbcc/gcc/old_agbcc $C/agbcc/old_agbcc
    cp /ref/alchemy/tools/out/compilers/as $C/as
    make tools -j8 >/ref/log.tla-tools 2>&1 || { tail -20 /ref/log.tla-tools; exit 1; }
    make tools/out/compiler-runtime/libgcc.a >/ref/log.tla-libgcc 2>&1 || { tail -20 /ref/log.tla-libgcc; exit 1; }
    for f in xgcc cc1 cpp0 gcc2952_arm agbcc/old_agbcc as; do echo "  $f $(sha1sum $C/$f | cut -c1-12) (GS1: $(sha1sum /ref/alchemy/$C/$f | cut -c1-12))"; done
    echo "bootstrap: compilers from alchemy-gcc $(git -C alchemy-gcc rev-parse --short HEAD), libgcc ok"'
}

build() {
  run 'set -e; cd /ref/alchemy-tla; rm -rf out/tla-en
    rc=0; make -j8 compare-tla-en >/ref/log.tla-en 2>&1 || rc=$?
    grep -m3 -E "^out/tla-en/tla-en.gba: |\*\*\*" /ref/log.tla-en
    [ -f out/tla-en/tla-en.elf ] || exit 1
    cp out/tla-en/tla-en.map out/tla-en/tla-en.elf out/tla-en/tla-en.gba /tla1/
    arm-none-eabi-readelf -sW out/tla-en/tla-en.elf | awk "NF>=8 {print \$8, \$2, \$3, \$4}" | sort -u > /tla1/syms.txt
    rm -rf /tla1/overlays; mkdir /tla1/overlays; cp out/tla-en/overlays/*.{map,elf,lz} /tla1/overlays/
    echo "tla-en: $(sha1sum out/tla-en/tla-en.gba | cut -c1-40) (make rc=$rc)"'
}

case $step in
  fetch) fetch ;; bootstrap) bootstrap ;; build) build ;; all) fetch; bootstrap; build ;;
  *) echo "usage: $0 [fetch|bootstrap|build|all]" >&2; exit 2 ;;
esac
