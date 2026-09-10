#!/bin/bash
set -euo pipefail
project_dir="$(cd "$(dirname "$0")/../.." && pwd)"
build_dir="$(mktemp -d "${TMPDIR:-/tmp}/orbit-vector-build.XXXXXX")"
# Build exactly the vendored code used by Arduino; ASan checks parser/raster memory accesses.
for source_file in "$project_dir"/firmware/orbit_puck/src/plutovg/*.c; do
  clang -O1 -g -fsanitize=address -std=c11 -I "$project_dir/firmware/orbit_puck/src/plutovg" -c "$source_file" -o "$build_dir/$(basename "$source_file" .c).o"
done
clang++ -O1 -g -fsanitize=address -std=c++17 "$project_dir/firmware/tests/vector-runner.cpp" "$build_dir"/*.o -o "$build_dir/runner"
cd "$project_dir/platform"
ORBIT_VECTOR_RUNNER="$build_dir/runner" bun scripts/verify-native-renderer.ts
