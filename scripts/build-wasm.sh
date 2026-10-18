#!/bin/sh
set -e
cd "$(dirname "$0")/.."
clang --target=wasm32 -O3 -msimd128 -ffp-contract=off -nostdlib -fno-builtin \
  -Wl,--no-entry -Wl,--export=encode_frame -Wl,--export=basis_table -Wl,--export=__heap_base \
  -Wl,--growable-table -Wl,--strip-all -Wl,-z,stack-size=1048576 \
  -o src/engine/export/prores/prores.wasm native/prores/encoder.c
