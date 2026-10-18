#!/bin/sh
set -e
cd "$(dirname "$0")/.."
build() {
  out=$1
  source=$2
  shift 2
  exports=""
  for name in "$@"; do exports="$exports -Wl,--export=$name"; done
  clang --target=wasm32 -O3 -msimd128 -ffp-contract=off -nostdlib -fno-builtin \
    -Wl,--no-entry $exports -Wl,--export=__heap_base \
    -Wl,--strip-all -Wl,-z,stack-size=1048576 -o "$out" "$source"
}
build src/engine/export/prores/prores.wasm native/prores/encoder.c encode_frame basis_table
build src/engine/tracking/matcher.wasm native/tracking/matcher.c match_scores
