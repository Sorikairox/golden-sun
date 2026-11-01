#!/bin/bash
# Reference build (phase G1): alchemy tbs-en and gsret, in the golden-sun-tools Docker image, checked against
# the player's ROM. Everything runs in Docker; sources are cloned from vendor/ (read only) into the Docker
# volume golden-sun-ref, so nothing is built on the host or inside vendor/. Outputs (map, ELF, built images:
# ROM-derived, so never committed) go to the gitignored port_work/g1/.
#
#   tools/build_ref.sh [all|image|fetch|bootstrap|alchemy|gsret|symbols]   (default: all)
#
# The ROM is mounted read only. alchemy's The Broken Seal needs no ROM to build; it is used to compare.
# old_agbcc (pret/agbcc, alchemy-gcc's nested submodule) and GCC 2.95.2 (ftp.gnu.org) are not approved
# downloads yet: if their sources are absent, tools/ref/standin_cc1.sh stands in for them and
# tools/ref/standin_fix.py fits the ten objects they build to the original layout (docs/G1.md).
set -euo pipefail
export PATH=/Applications/Docker.app/Contents/Resources/bin:$PATH
cd "$(dirname "$0")/.."
ROOT=$PWD
ROM=${ROM:-$HOME/roms/Golden_Sun_USA_Europe.gba}
IMAGE=golden-sun-tools
VOL=golden-sun-ref
OUT=$ROOT/port_work/g1
ALCHEMY_GCC_SHA=9bc4e65a2540ef4717ca4c11fb34279023673ab9   # alchemy@24b72a32's gitlink
AGBCC_SHA=da598c1d918402c42c0c0d7128ba14567f3175e9         # alchemy-gcc@9bc4e65a's agbcc gitlink
GCC2952_SHA256=064e1cb06ea5d2f4a07ec46c1c64d771f74d04f404b6a6766bca2477f7d72482  # alchemy-gcc arm/Makefile
SHA1_TBS_EN=5c4695205413df7db52b9a184815a07783999971
step=${1:-all}
mkdir -p "$OUT/alchemy" "$OUT/gsret"

run() { # run in the tools image as the host user, with the volume, vendor (ro), ROM (ro) and port_work/g1
  docker run --rm -u "$(id -u):$(id -g)" -v $VOL:/ref -v "$ROOT/vendor":/vendor:ro \
    -v "$ROM":/rom/baserom.gba:ro -v "$OUT":/g1 -v "$ROOT/tools/ref":/ourtools:ro $IMAGE bash -c "$1"
}

image() {
  docker image inspect $IMAGE >/dev/null 2>&1 && { echo "image: $IMAGE present"; return; }
  docker build -q -t $IMAGE -f tools/docker/Dockerfile.tools tools/docker >/dev/null
  echo "image: built $IMAGE ($(docker image inspect -f '{{.Size}}' $IMAGE | awk '{printf "%d MB", $1/1e6}'))"
}

fetch() { # alchemy-gcc (approved, GPL-2.0) into vendor/, fetched from inside Docker
  if [ -d vendor/alchemy-gcc/.git ]; then echo "fetch: vendor/alchemy-gcc present"; else
    docker run --rm -u "$(id -u):$(id -g)" -v "$ROOT/vendor":/vendor $IMAGE bash -c "
      set -e; d=/vendor/alchemy-gcc; git init -q \$d; git -C \$d remote add origin https://github.com/PascalPixel/alchemy-gcc.git
      git -C \$d fetch -q --depth 1 origin $ALCHEMY_GCC_SHA; git -C \$d checkout -q FETCH_HEAD"
    echo "fetch: vendor/alchemy-gcc -> $ALCHEMY_GCC_SHA"
  fi
  # pret/agbcc (alchemy-gcc's nested submodule) and gcc-2.95.2.tar.gz: approved 2026-11-01 (D13), in Docker only
  if [ -d vendor/agbcc/.git ]; then echo "fetch: vendor/agbcc present"; else
    docker run --rm -u "$(id -u):$(id -g)" -v "$ROOT/vendor":/vendor $IMAGE bash -c "
      set -e; d=/vendor/agbcc; git init -q \$d; git -C \$d remote add origin https://github.com/pret/agbcc.git
      git -C \$d fetch -q --depth 1 origin $AGBCC_SHA; git -C \$d checkout -q FETCH_HEAD"
    echo "fetch: vendor/agbcc -> $AGBCC_SHA"
  fi
  if [ -f vendor/downloads/gcc-2.95.2.tar.gz ]; then echo "fetch: gcc-2.95.2.tar.gz present"; else
    mkdir -p vendor/downloads
    docker run --rm -u "$(id -u):$(id -g)" -v "$ROOT/vendor":/vendor $IMAGE bash -c "
      set -e; f=/vendor/downloads/gcc-2.95.2.tar.gz
      curl --fail --location --silent --show-error -o \$f.download https://ftp.gnu.org/gnu/gcc/gcc-2.95.2.tar.gz
      echo '$GCC2952_SHA256  '\$f.download | sha256sum -c - >/dev/null; mv \$f.download \$f"
    echo "fetch: gcc-2.95.2.tar.gz, SHA-256 verified"
  fi
  docker volume inspect $VOL >/dev/null 2>&1 || docker volume create $VOL >/dev/null
  docker run --rm -v $VOL:/ref $IMAGE chown "$(id -u):$(id -g)" /ref
  run 'set -e; git config --global --add safe.directory "*"
    [ -d /ref/alchemy/.git ] || { git clone -q /vendor/alchemy /ref/alchemy 2>/dev/null; rmdir /ref/alchemy/alchemy-gcc; }
    [ -d /ref/alchemy/alchemy-gcc/.git ] || git clone -q /vendor/alchemy-gcc /ref/alchemy/alchemy-gcc 2>/dev/null
    if [ -d /vendor/agbcc/.git ] && [ ! -d /ref/alchemy/alchemy-gcc/agbcc/.git ]; then
      rmdir /ref/alchemy/alchemy-gcc/agbcc 2>/dev/null || true; git clone -q /vendor/agbcc /ref/alchemy/alchemy-gcc/agbcc 2>/dev/null; fi
    if [ -f /vendor/downloads/gcc-2.95.2.tar.gz ] && [ ! -f /ref/alchemy/alchemy-gcc/arm/sources/gcc-2.95.2.tar.gz ]; then
      mkdir -p /ref/alchemy/alchemy-gcc/arm/sources; cp /vendor/downloads/gcc-2.95.2.tar.gz /ref/alchemy/alchemy-gcc/arm/sources/; fi
    [ -d /ref/gsret/.git ] || { git clone -q /vendor/goldensun /ref/gsret 2>/dev/null; ln -s /rom/baserom.gba /ref/gsret/baserom.gba; }
    echo "fetch: volume has alchemy $(git -C /ref/alchemy rev-parse --short HEAD), alchemy-gcc $(git -C /ref/alchemy/alchemy-gcc rev-parse --short HEAD), gsret $(git -C /ref/gsret rev-parse --short HEAD)"'
}

bootstrap() { # what `make bootstrap` does (stand-ins only if the agbcc/gcc-2.95.2 sources are absent)
  run 'set -e; cd /ref/alchemy; C=tools/out/compilers; mkdir -p $C/agbcc
    make -C alchemy-gcc gcc -j8 >/ref/log.gcc 2>&1 || { tail -20 /ref/log.gcc; exit 1; }
    make -C alchemy-gcc generated-check 2>&1 | grep -E "match|differ"
    cp alchemy-gcc/build/gcc/xgcc alchemy-gcc/build/gcc/cpp0 alchemy-gcc/build/gcc/tradcpp0 alchemy-gcc/build/gcc/cc1 $C/
    if [ -f alchemy-gcc/agbcc/gcc/Makefile ] && [ -f alchemy-gcc/arm/sources/gcc-2.95.2.tar.gz ]; then
      make -C alchemy-gcc arm old-agbcc >/ref/log.gcc2 2>&1 || { tail -20 /ref/log.gcc2; exit 1; }
      cp alchemy-gcc/arm/build/gcc/cc1 $C/gcc2952_arm; cp alchemy-gcc/agbcc/gcc/old_agbcc $C/agbcc/old_agbcc
      echo "bootstrap: real old_agbcc and gcc2952_arm"
    else
      cp /ourtools/standin_cc1.sh $C/agbcc/old_agbcc; cp /ourtools/standin_cc1.sh $C/gcc2952_arm
      echo "bootstrap: old_agbcc and gcc2952_arm are STAND-INS (sources not fetched)"
    fi
    make tools -j8 >/ref/log.tools 2>&1 || { tail -20 /ref/log.tools; exit 1; }
    make tools/out/compilers/as >/ref/log.gas 2>&1 || { tail -20 /ref/log.gas; exit 1; }
    make tools/out/compiler-runtime/libgcc.a >/ref/log.libgcc 2>&1 || { tail -20 /ref/log.libgcc; exit 1; }
    echo "bootstrap: GAS $(tools/out/compilers/as --version | head -1 | cut -c1-40), libgcc ok"'
}

alchemy() {
  run 'set -e; cd /ref/alchemy; rm -rf out/tbs-en
    make -j8 tbs-en >/ref/log.tbs-en 2>&1 || { grep -m5 -i error /ref/log.tbs-en; exit 1; }
    mkdir -p /g1/alchemy/pass1; cp out/tbs-en/tbs-en.{gba,map,elf} /g1/alchemy/pass1/
    arm-none-eabi-readelf -sW out/tbs-en/tbs-en.elf | awk "NF>=8 {print \$8, \$2, \$4}" | sort -u > /g1/alchemy/pass1/syms.txt
    echo "alchemy pass 1: $(sha1sum out/tbs-en/tbs-en.gba | cut -c1-40)"'
  rm -rf "$OUT/alchemy/standin" "$OUT/alchemy/standin_fit.tsv" "$OUT/alchemy/standin_fit.log"
  if grep -q "Stand-in for alchemy" <(run 'cat /ref/alchemy/tools/out/compilers/gcc2952_arm | head -3'); then
    rm -rf "$OUT/alchemy/standin"
    python3 tools/ref/standin_fix.py "$OUT"/alchemy/pass1/tbs-en.{map,gba} "$ROM" "$OUT/alchemy/pass1/syms.txt" \
      "$OUT/alchemy/standin" > "$OUT/alchemy/standin_fit.tsv" 2> "$OUT/alchemy/standin_fit.log"
    echo "stand-in fit: $(grep -c . "$OUT/alchemy/standin_fit.log") notes; symbols by evidence: $(awk -F'\t' '$6=="xref"' "$OUT/alchemy/standin_fit.tsv" | wc -l | tr -d ' ')"
    run 'set -e; cd /ref/alchemy
      for s in $(cd /g1/alchemy/standin && find . -name "*.s"); do o=out/tbs-en/obj/${s#./}; o=${o%.s}.o
        arm-none-eabi-as -mcpu=arm7tdmi -mthumb-interwork -o $o /g1/alchemy/standin/$s; done
      make tbs-en >/ref/log.tbs-en2 2>&1 || { grep -m5 -i error /ref/log.tbs-en2; exit 1; }'
  fi
  run 'set -e; cd /ref/alchemy; cp out/tbs-en/tbs-en.{gba,map,elf} /g1/alchemy/
    cp -r out/tbs-en/overlays /g1/alchemy/ 2>/dev/null; rm -rf /g1/alchemy/obj; cp -r out/tbs-en/obj /g1/alchemy/obj
    cp out/tbs-en/objects.mk /g1/alchemy/; mkdir -p /g1/gen/text; cp out/tbs-en/text/msg_ids.h /g1/gen/text/
    arm-none-eabi-readelf -sW out/tbs-en/tbs-en.elf | awk "NF>=8 {print \$8, \$2, \$4}" | sort -u > /g1/alchemy/syms.txt
    s=$(sha1sum out/tbs-en/tbs-en.gba | cut -c1-40); echo "alchemy tbs-en: $s $([ $s = '$SHA1_TBS_EN' ] && echo MATCH || echo differs)"'
  python3 tools/ref/romdiff.py "$OUT/alchemy/tbs-en.gba" "$ROM" "$OUT/alchemy/tbs-en.map" 12
}

gsret() {
  run 'cd /ref/gsret; make -j8 compare >/ref/log.gsret 2>&1; rc=$?
    echo "gsret: rom $(grep -o "goldensun.gba: .*" /ref/log.gsret), overlays compared $(grep -c "^cmp" /ref/log.gsret) (make rc=$rc)"
    cp goldensun.map goldensun.elf /g1/gsret/ 2>/dev/null; arm-none-eabi-nm -n goldensun.elf > /g1/gsret/nm.txt'
}

symbols() { # the committed address map (addresses and names only) from the build above
  python3 tools/ref/make_symbols.py "$OUT/alchemy" "$ROM" port/symbols vendor/alchemy
}

case $step in
  image) image ;; fetch) fetch ;; bootstrap) bootstrap ;; alchemy) alchemy ;; gsret) gsret ;; symbols) symbols ;;
  all) image; fetch; bootstrap; alchemy; gsret; symbols ;;
  *) echo "usage: $0 [all|image|fetch|bootstrap|alchemy|gsret|symbols]" >&2; exit 2 ;;
esac
