#!/bin/bash
# Alt-port stack: 7 subgraphs (4101-4107) + offline router (4012) + MCP (5051).
# Never the GraphOS-connected router (4010, 60 req/min plan limit) and never the main stack
# (4001-4007). Safe to run alongside both.
#
#   ops/alt-stack.sh start [DEMO_CLOCK]   — raise the stack, wait for health, print PIDs
#   ops/alt-stack.sh stop                 — kill everything this script started, by port
#   ops/alt-stack.sh status               — show what's listening on the alt ports
#
# PIDs are written to /tmp/fg-alt-stack.pids so `stop` works from a fresh shell.
set -uo pipefail
cd "$(dirname "$0")/.." || exit 1

PIDFILE=/tmp/fg-alt-stack.pids
PORTS="4101 4102 4103 4104 4105 4106 4107 4012 5051"

stop() {
  echo "[alt-stack] stopping (by port, then by pidfile)"
  for p in $PORTS; do
    pid=$(lsof -ti tcp:$p 2>/dev/null)
    if [ -n "$pid" ]; then kill "$pid" 2>/dev/null; fi
  done
  if [ -f "$PIDFILE" ]; then
    while read -r pid; do kill "$pid" 2>/dev/null; done < "$PIDFILE"
    rm -f "$PIDFILE"
  fi
}

status() {
  for p in $PORTS; do
    pid=$(lsof -ti tcp:$p 2>/dev/null)
    echo "$p: ${pid:-free}"
  done
}

start() {
  if [ ! -f .env ]; then echo "[alt-stack] BLOCKED: no .env in $(pwd)"; exit 1; fi
  set -a; . ./.env; set +a

  for p in $PORTS; do
    pid=$(lsof -ti tcp:$p 2>/dev/null)
    if [ -n "$pid" ]; then kill "$pid" 2>/dev/null; fi
  done
  sleep 1
  : > "$PIDFILE"

  DEMO_CLOCK="${1:-0}" ALT_PORT_BASE=4101 npx tsx ops/stack-alt.mjs > /tmp/fg-alt-subgraphs.log 2>&1 &
  echo $! >> "$PIDFILE"
  sleep 3

  if ! grep -q "7 subgraphs" /tmp/fg-alt-subgraphs.log; then
    echo "[alt-stack] BLOCKED: alt subgraphs did not report ready — see /tmp/fg-alt-subgraphs.log"
    cat /tmp/fg-alt-subgraphs.log
    exit 1
  fi

  ROUTER_BIN="$HOME/.rover/bin/router-v2.18.0"
  if [ ! -x "$ROUTER_BIN" ]; then echo "[alt-stack] BLOCKED: $ROUTER_BIN not found"; exit 1; fi
  "$ROUTER_BIN" --config router.alt.yaml --supergraph supergraph.graphql > /tmp/fg-alt-router.log 2>&1 &
  echo $! >> "$PIDFILE"

  for _ in $(seq 1 20); do
    if curl -sf http://127.0.0.1:8092/health > /dev/null 2>&1; then break; fi
    sleep 0.5
  done
  if ! curl -sf http://127.0.0.1:8092/health > /dev/null 2>&1; then
    echo "[alt-stack] BLOCKED: alt router health check never passed — see /tmp/fg-alt-router.log"
    tail -30 /tmp/fg-alt-router.log
    exit 1
  fi

  MCP_BIN="$HOME/.rover/bin/apollo-mcp-server-v2.1.0"
  if [ ! -x "$MCP_BIN" ]; then echo "[alt-stack] BLOCKED: $MCP_BIN not found"; exit 1; fi
  "$MCP_BIN" .apollo/mcp.alt.yaml > /tmp/fg-alt-mcp.log 2>&1 &
  echo $! >> "$PIDFILE"
  sleep 2

  echo "[alt-stack] up: subgraphs 4101-4107, router 4012 (health 8092), MCP 5051 — DEMO_CLOCK=${1:-0}"
  status
}

case "${1:-start}" in
  start) start "${2:-0}" ;;
  stop) stop ;;
  status) status ;;
  *) echo "usage: $0 {start [DEMO_CLOCK]|stop|status}"; exit 1 ;;
esac
