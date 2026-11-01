#!/bin/sh
# Clone the three reference projects into vendor/ at the pinned commits (read-only references; see docs/VENDOR.md).
# vendor/ is gitignored: none of the three has a licence and alchemy ships game-derived assets.
set -eu
cd "$(dirname "$0")/.."
mkdir -p vendor
fetch() { # name url sha
  if [ -d "vendor/$1/.git" ]; then echo "vendor/$1 present at $(git -C "vendor/$1" rev-parse --short HEAD)"; return; fi
  git init -q "vendor/$1"
  git -C "vendor/$1" remote add origin "$2"
  git -C "vendor/$1" fetch -q --depth 1 origin "$3"
  git -C "vendor/$1" checkout -q FETCH_HEAD
  echo "vendor/$1 -> $3"
}
fetch alchemy          https://github.com/PascalPixel/alchemy          24b72a325ea53017e22052eafb4f82cf3ee23ce4
fetch goldensun        https://github.com/gsret/goldensun              0fa7b312199c10b96544e825be86cfc476493eb7
fetch goldensun-decomp https://github.com/Coaltergeist/goldensun-decomp d8f140af2524babf5d4a2bd2123b7df156d8ac84
