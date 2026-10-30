#!/usr/bin/env bash
# ops/set-env-secret.sh — the ONLY sanctioned way a value enters .env.
#
# The operator types the value at a hidden prompt in their own terminal. The value never appears in
# this file, in argv of any process, in a log, or in an agent's context. Only the variable NAME is
# ever passed as an argument.
#
#   usage: ops/set-env-secret.sh NAME
#
# Behaviour:
#   1. resolves .env through a worktree symlink to the real file
#   2. backs it up outside the repo to ~/.fridgegraph-env-backups/.env.<unix-ts> (mode 600)
#   3. prompts with `read -rs`, so the input is not echoed
#   4. refuses empty values and values containing whitespace or a newline
#   5. replaces the existing NAME= line (or appends it) via a python3 process that reads the value
#      from stdin, writing through a temp file and an atomic rename, keeping mode 600
#   6. prints only "<NAME> updated (length N)"
set -euo pipefail

if [ "$#" -ne 1 ]; then
  printf 'usage: %s NAME\n' "$(basename "$0")" >&2
  exit 2
fi

NAME="$1"
case "$NAME" in
  ''|*[!A-Za-z0-9_]*)
    printf 'invalid variable name: %s\n' "$NAME" >&2; exit 2 ;;
  [0-9]*)
    printf 'invalid variable name: %s\n' "$NAME" >&2; exit 2 ;;
esac

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_LINK="$SCRIPT_DIR/../.env"
if [ ! -e "$ENV_LINK" ]; then
  printf 'no .env at %s\n' "$ENV_LINK" >&2; exit 2
fi
ENV_REAL="$(python3 -c 'import os,sys;print(os.path.realpath(sys.argv[1]))' "$ENV_LINK")"
if [ ! -f "$ENV_REAL" ]; then
  printf '.env does not resolve to a regular file\n' >&2; exit 2
fi

BACKUP_DIR="$HOME/.fridgegraph-env-backups"
mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"
BACKUP="$BACKUP_DIR/.env.$(date +%s)"
cp "$ENV_REAL" "$BACKUP"
chmod 600 "$BACKUP"

printf 'Enter %s (input hidden): ' "$NAME"
IFS= read -rs VALUE || true
printf '\n'

if [ -z "${VALUE:-}" ]; then
  printf 'refused: empty value (backup kept at %s)\n' "$BACKUP" >&2; exit 3
fi
case "$VALUE" in
  *[[:space:]]*)
    printf 'refused: value contains whitespace (backup kept at %s)\n' "$BACKUP" >&2; exit 3 ;;
esac

HELPER="$(mktemp "${TMPDIR:-/tmp}/set-env-secret.XXXXXX")"
trap 'rm -f "$HELPER"' EXIT
cat > "$HELPER" <<'PY'
import os, sys, tempfile

env_path, name = sys.argv[1], sys.argv[2]
value = sys.stdin.read()

if not value or any(c.isspace() for c in value):
    sys.exit("refused: bad value")

try:
    with open(env_path, encoding="utf-8") as fh:
        lines = fh.read().splitlines()
except FileNotFoundError:
    lines = []

out, replaced = [], False
for line in lines:
    if line.startswith(name + "="):
        out.append(f"{name}={value}")
        replaced = True
    else:
        out.append(line)
if not replaced:
    out.append(f"{name}={value}")

directory = os.path.dirname(env_path) or "."
fd, tmp = tempfile.mkstemp(dir=directory, prefix=".env.", suffix=".tmp")
try:
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        fh.write("\n".join(out) + "\n")
    os.chmod(tmp, 0o600)
    os.replace(tmp, env_path)
except BaseException:
    try:
        os.unlink(tmp)
    except OSError:
        pass
    raise

print(f"{name} updated (length {len(value)})")
PY

printf '%s' "$VALUE" | python3 "$HELPER" "$ENV_REAL" "$NAME"
unset VALUE
