#!/usr/bin/env bash
set -euo pipefail

# Build a local V2 Raccoon binary after verifying the Korean IME submit fix.
# Usage: RACCOON_SRC=/path/to/raccoon-code ./patches/install-korean-ime-fix.sh

source_dir="${RACCOON_SRC:-$(cd "$(dirname "$0")/.." && pwd)}"
prompt="$source_dir/packages/tui/src/component/prompt/index.tsx"
installer="$source_dir/install"

if [ ! -f "$prompt" ] || [ ! -f "$installer" ]; then
  echo "Raccoon V2 source checkout not found at $source_dir" >&2
  exit 1
fi

if ! grep -q 'IME: double-defer' "$prompt" || ! grep -q 'setTimeout(() => setTimeout' "$prompt"; then
  echo "The V2 Korean IME submit fix is absent. Refusing to install an unverified binary." >&2
  exit 1
fi

(cd "$source_dir/packages/cli" && bunx bun@1.4.2 script/build.ts --raccoon-only --single --skip-install)

platform=$(uname -s | tr '[:upper:]' '[:lower:]')
arch=$(uname -m)
case "$arch" in
  aarch64) arch=arm64 ;;
  x86_64) arch=x64 ;;
esac
binary="$source_dir/packages/cli/dist/raccoon/raccoon-$platform-$arch/bin/raccoon"
if [ ! -f "$binary" ]; then
  echo "Raccoon binary not found at $binary" >&2
  exit 1
fi

bash "$installer" --raccoon --binary "$binary"
