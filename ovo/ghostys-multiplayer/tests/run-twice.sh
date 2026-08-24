#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")/../../.."

for pass in 1 2; do
  echo "GMP regression pass $pass/2"
  node --test ovo/ghostys-multiplayer/tests/regression.test.js
done

for file in ovo/ghostys-multiplayer/*.js; do
  node --check "$file"
done

git diff --check
