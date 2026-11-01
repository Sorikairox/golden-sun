#!/bin/sh
# Stand-in for alchemy's old_agbcc and gcc2952_arm when those two compilers are not available (their sources,
# pret/agbcc and gcc-2.95.2.tar.gz, are downloads not yet approved). It runs alchemy-gcc's own cc1 (GCC 2.96)
# on the same preprocessed file. The code differs from the original, so tools/ref/standin_fit.py later replaces
# each stand-in object's sections with zero fill of the original size; see docs/G1.md.
# Usage (as the Makefile calls the real ones): standin_cc1.sh FILE.i -dumpbase NAME [opts] -o FILE.s
# Installed as a copy named old_agbcc (Thumb) or gcc2952_arm (ARM); the name picks the mode.
dir=$(dirname "$0")
case "$(basename "$0")" in
  old_agbcc) exec "$dir/../cc1" -mthumb "$@" ;;   # tools/out/compilers/agbcc/old_agbcc
  *) exec "$dir/cc1" "$@" ;;                       # tools/out/compilers/gcc2952_arm
esac
