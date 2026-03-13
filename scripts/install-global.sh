#!/bin/sh
set -eu

ROOT_DIR="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
BIN_DIR="${BRIDGE_GLOBAL_BIN:-/opt/homebrew/bin}"

corepack pnpm -C "$ROOT_DIR" build

mkdir -p "$BIN_DIR"

cat >"$BIN_DIR/bridge" <<EOF
#!/bin/sh
exec node "$ROOT_DIR/packages/bridge-cli/dist/bridge-cli/src/index.js" "\$@"
EOF

cat >"$BIN_DIR/bridge-daemon" <<EOF
#!/bin/sh
exec node "$ROOT_DIR/packages/daemon-cli/dist/daemon-cli/src/index.js" "\$@"
EOF

cat >"$BIN_DIR/bridge-server" <<EOF
#!/bin/sh
exec node "$ROOT_DIR/packages/server/dist/server/src/index.js" "\$@"
EOF

chmod +x "$BIN_DIR/bridge" "$BIN_DIR/bridge-daemon" "$BIN_DIR/bridge-server"

echo "Installed bridge commands to $BIN_DIR"
