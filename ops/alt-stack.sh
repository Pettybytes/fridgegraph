#!/usr/bin/env bash
# ops/alt-stack.sh — the isolated FridgeGraph test stack, as code.
#
# Reproduces, from the repo, what was previously assembled by hand:
#   subgraphs 4101-4107  (ops/stack-alt.mjs)
#   router    4012       (config GENERATED from router.yaml + supergraph.yaml)
#   MCP       5051       (config GENERATED from .apollo/mcp.local.yaml)
#
#   ops/alt-stack.sh --up      start everything, record PIDs in .alt-stack.pids
#   ops/alt-stack.sh --check   probe the running stack (read-only, never restarts it)
#   ops/alt-stack.sh --down    stop ONLY the processes this script started
#
# Why a pidfile and not a pattern kill: the same ports may be served by a stack
# someone started by hand. `--down` must never take those down.
#
# STATUS: --check, --up and --down are PROVEN. --up was proven end to end on a SPARE port range
# (ALT_STACK_SUFFIX + ALT_*_PORT overrides) so the shared stack did not have to be stopped to test
# it; see docs/handoff/STACK-LAUNCH.md. `--up` also generates and validates the MCP config, so the
# hand-rebased copy that used to be assembled by hand is no longer needed.
#
# No secret is read, printed or passed here. The .env file is only checked for existence.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

# Every port and every artefact name is overridable, so a spare copy of the stack can be proven
# without stopping the one someone else is using. Defaults are the shared alt stack.
SUFFIX="${ALT_STACK_SUFFIX:-}"
PIDFILE="$ROOT/.alt-stack${SUFFIX}.pids"
ROUTER_CONFIG="${TMPDIR:-/tmp}/fridgegraph-alt-router${SUFFIX}.yaml"
MCP_CONFIG="${TMPDIR:-/tmp}/fridgegraph-alt-mcp${SUFFIX}.yaml"
export ALT_MCP_CONFIG="$MCP_CONFIG"
SUBGRAPH_BASE="${ALT_SUBGRAPH_BASE:-4101}"
ROUTER_PORT="${ALT_ROUTER_PORT:-4012}"
HEALTH_PORT="${ALT_HEALTH_PORT:-8092}"
MCP_PORT="${ALT_MCP_PORT:-5051}"
# The check probes the stack this script just started, so it must be told the MCP port too.
export ALT_MCP_URL="${ALT_MCP_URL:-http://127.0.0.1:${MCP_PORT}/mcp}"
# Rosina is part of the stack, not an afterthought. Both URLs must point at THIS stack: the MCP URL is
# a /mcp endpoint (identity forwarding) and the GraphQL URL is the ROUTER (authorized reads). Pointing
# ROSINA_GRAPHQL_URL at the MCP port answers every notice request with 502.
ROSINA_PORT="${ALT_ROSINA_PORT:-4200}"
ROSINA_MCP_URL="${ALT_ROSINA_MCP_URL:-http://127.0.0.1:${MCP_PORT}/mcp}"
ROSINA_GRAPHQL_URL="${ALT_ROSINA_GRAPHQL_URL:-http://127.0.0.1:${ROUTER_PORT}/}"
DEMO_LOGIN_PORT="${ALT_DEMO_LOGIN_PORT:-4108}"
ROUTER_BIN="$HOME/.rover/bin/router-v2.18.0"
MCP_BIN="$HOME/.rover/bin/apollo-mcp-server-v2.1.0"

die() { printf 'alt-stack: %s\n' "$*" >&2; exit 1; }

# ---------------------------------------------------------------------------
# Preflight. A missing identity map does not error — it makes every user
# "unmapped", so every request becomes UNAUTHENTICATED and the cause looks like
# auth. That failure cost an afternoon once; it fails loudly here instead.
# ---------------------------------------------------------------------------
preflight() {
  local missing=0
  for required in .env data/identity-map.json .demo-credentials node_modules; do
    if [ ! -e "$required" ]; then
      printf 'alt-stack: MISSING %s\n' "$required" >&2
      missing=1
    fi
  done
  if [ "$missing" -ne 0 ]; then
    cat >&2 <<'MSG'
alt-stack: refusing to start.
  .env                  -> symlink to the shared env file (never copied)
  data/identity-map.json -> sub -> person map; absent means EVERY caller is unmapped
  .demo-credentials     -> demo sign-in; needed for --check as Kendra
  node_modules          -> symlink to the main checkout is fine
MSG
    exit 1
  fi
  [ -x "$ROUTER_BIN" ] || die "router binary not found: $ROUTER_BIN"
  [ -x "$MCP_BIN" ] || die "MCP binary not found: $MCP_BIN"
  [ -x "$ROOT/node_modules/.bin/tsx" ] || die "tsx not found in node_modules/.bin"
}

# ---------------------------------------------------------------------------
# Config generation — derived, never hand-typed
# ---------------------------------------------------------------------------
gen_router_config() {
  # Compose the supergraph FIRST. The artifact is a build product under .runs/ (gitignored); the
  # committed copy was retired because it silently went stale and the MCP loaded a schema that lacked
  # fields the router served (2026-11-02: proposeAddVillager).
  mkdir -p "$ROOT/.runs"
  # Compose from COMMITTED SDL, not from supergraph.yaml. That file points each subgraph at 4001-4007,
  # so composing from it silently required another running checkout AND baked the wrong routing URLs
  # into the artifact. This launcher starts alone.
  node "$ROOT/ops/compose-offline.mjs" \
      --out "$ROOT/.runs/supergraph.graphql" \
      --base-port "$SUBGRAPH_BASE" || die "offline supergraph composition failed"
  ROUTER_SRC="$ROOT/router.yaml" SUPERGRAPH_SRC="$ROOT/supergraph.yaml" \
  OUT="$ROUTER_CONFIG" ROUTER_PORT="$ROUTER_PORT" HEALTH_PORT="$HEALTH_PORT" \
  SUBGRAPH_BASE="$SUBGRAPH_BASE" python3 - <<'PY'
import os, re, sys

router = open(os.environ['ROUTER_SRC'], encoding='utf-8').read()

# Port only. The headers block (Authorization propagation) comes from the repo file,
# so a change there can never be forgotten here.
router = router.replace('listen: 127.0.0.1:4010', f"listen: 127.0.0.1:{os.environ['ROUTER_PORT']}")
router = router.replace('listen: 127.0.0.1:8090', f"listen: 127.0.0.1:{os.environ['HEALTH_PORT']}")

if 'propagate' not in router or 'Authorization' not in router:
    sys.exit('router.yaml no longer propagates Authorization — refusing to generate a config that drops it')
if f"127.0.0.1:{os.environ['ROUTER_PORT']}" not in router:
    sys.exit('could not rewrite the router listen port; router.yaml changed shape')

# Subgraph order and names come from supergraph.yaml; ports are rebased onto the alt base.
sg = open(os.environ['SUPERGRAPH_SRC'], encoding='utf-8').read()
names = re.findall(r'^  ([a-z_]+):\s*$', sg, re.M)
if len(names) != 7:
    sys.exit(f'expected 7 subgraphs in supergraph.yaml, found {len(names)}: {names}')

base = int(os.environ['SUBGRAPH_BASE'])
lines = ['', '# generated by ops/alt-stack.sh — do not edit by hand', 'override_subgraph_url:']
for i, name in enumerate(names):
    lines.append(f'  {name}: http://127.0.0.1:{base + i}/')

open(os.environ['OUT'], 'w', encoding='utf-8').write(router.rstrip('\n') + '\n' + '\n'.join(lines) + '\n')
print(f'alt-stack: router config -> {os.environ["OUT"]} ({len(names)} subgraphs on {base}-{base + len(names) - 1})')
PY
}

gen_mcp_config() {
  # Generated FROM the committed file by the tested generator. A hand-assembled config once dropped
  # `forward_headers: [authorization]`, and every MCP tool answered UNAUTHENTICATED for a valid
  # bearer. The generator refuses to write if any committed key is missing or forward_headers does
  # not carry authorization.
  node "$ROOT/ops/gen-mcp-config.mjs" \
    --src "$ROOT/.apollo/mcp.local.yaml" \
    --out "$MCP_CONFIG" \
    --root "$ROOT" \
    --schema "$ROOT/.runs/supergraph.graphql" \
    --endpoint "http://127.0.0.1:${ROUTER_PORT}/" \
    --port "$MCP_PORT" || {
      echo 'mcp config generation REFUSED — see the reason above; not starting a config that cannot authenticate'
      exit 1
    }
}

# Fails loudly if --up did not actually leave a usable MCP config behind.
assert_mcp_config() {
  [ -s "$MCP_CONFIG" ] || die "MCP config was not generated at $MCP_CONFIG"
  grep -q "port: ${MCP_PORT}$" "$MCP_CONFIG" || die "MCP config does not carry port ${MCP_PORT}: $MCP_CONFIG"
  grep -q "endpoint: http://127.0.0.1:${ROUTER_PORT}/" "$MCP_CONFIG" \
    || die "MCP config does not point at the alt router on ${ROUTER_PORT}: $MCP_CONFIG"
}

# ---------------------------------------------------------------------------
# Bounded readiness instead of `sleep N`: a fixed sleep is either too short (flaky) or too long (slow),
# and it hides a process that died on startup until the next step fails for an unrelated reason.
wait_for_port() {
  local port="$1" label="$2" timeout_s="${3:-45}" log="${4:-}"
  local i=0
  while [ "$i" -lt $((timeout_s * 4)) ]; do
    if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then return 0; fi
    sleep 0.25
    i=$((i + 1))
  done
  printf 'alt-stack: %s did not listen on %s within %ss' "$label" "$port" "$timeout_s" >&2
  [ -n "$log" ] && printf ' — see %s' "$log" >&2
  printf '\n' >&2
  return 1
}

plan() {
  local blockers=0
  printf 'alt-stack: PLAN (dry run — nothing will be started)\n'
  printf '  subgraphs  %s-%s   ops/stack-alt.mjs (ALT_PORT_BASE=%s, DEMO_CLOCK=%s)\n' \
    "$SUBGRAPH_BASE" "$((SUBGRAPH_BASE + 6))" "$SUBGRAPH_BASE" "${DEMO_CLOCK:-0}"
  printf '  router     %s       %s --supergraph .runs/supergraph.graphql --config %s\n' \
    "$ROUTER_PORT" "$ROUTER_BIN" "$ROUTER_CONFIG"
  printf '  mcp        %s       %s %s (schema from .runs/supergraph.graphql)\n' "$MCP_PORT" "$MCP_BIN" "$MCP_CONFIG"
  printf '  rosina     %s       ROSINA_MCP_URL=%s ROSINA_GRAPHQL_URL=%s\n' "$ROSINA_PORT" "$ROSINA_MCP_URL" "$ROSINA_GRAPHQL_URL"
  printf '  demo login %s       DEMO_LOGIN_ENABLED=1 (off without it: 4001-4007 serve while /api/demo/* 502s)\n' "$DEMO_LOGIN_PORT"

  for bin in "$ROUTER_BIN" "$MCP_BIN" "$ROOT/node_modules/.bin/tsx"; do
    [ -x "$bin" ] || { printf '  BLOCKER missing binary: %s\n' "$bin"; blockers=$((blockers + 1)); }
  done
  for port in $(seq "$SUBGRAPH_BASE" $((SUBGRAPH_BASE + 6))) "$ROUTER_PORT" "$MCP_PORT" "$ROSINA_PORT" "$DEMO_LOGIN_PORT"; do
    if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      printf '  BLOCKER port %s already in use — this launcher never takes over a stack it did not start\n' "$port"
      blockers=$((blockers + 1))
    fi
  done
  [ -f "$PIDFILE" ] && { printf '  BLOCKER %s exists — a stack may already be up\n' "$PIDFILE"; blockers=$((blockers + 1)); }

  printf '  does NOT run: reset, seed, migrations, tunnel, or any shared-stack action\n'
  if [ "$blockers" -gt 0 ]; then printf 'alt-stack: PLAN BLOCKED (%s)\n' "$blockers"; return 3; fi
  printf 'alt-stack: PLAN OK\n'
  return 0
}

up() {
  preflight
  if [ -f "$PIDFILE" ]; then
    die "$PIDFILE exists — a stack may already be up. Run --down first, or remove the file if it is stale."
  fi
  for port in $(seq "$SUBGRAPH_BASE" $((SUBGRAPH_BASE + 6))) "$ROUTER_PORT" "$MCP_PORT"; do
    if lsof -nP -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
      die "port $port is already in use — refusing to start over a stack I did not start"
    fi
  done

  gen_router_config
  gen_mcp_config
  assert_mcp_config
  : > "$PIDFILE"

  DEMO_CLOCK="${DEMO_CLOCK:-0}" ALT_PORT_BASE="$SUBGRAPH_BASE" \
    nohup "$ROOT/node_modules/.bin/tsx" "$ROOT/ops/stack-alt.mjs" \
    > "${TMPDIR:-/tmp}/fridgegraph-alt-subgraphs${SUFFIX}.log" 2>&1 &
  echo "subgraphs $!" >> "$PIDFILE"

  wait_for_port "$((SUBGRAPH_BASE + 6))" "subgraphs" 45 "${TMPDIR:-/tmp}/fridgegraph-alt-subgraphs${SUFFIX}.log" \
    || { down; return 1; }
  nohup "$ROUTER_BIN" --supergraph "$ROOT/.runs/supergraph.graphql" --config "$ROUTER_CONFIG" --log error \
    > "${TMPDIR:-/tmp}/fridgegraph-alt-router${SUFFIX}.log" 2>&1 &
  echo "router $!" >> "$PIDFILE"

  wait_for_port "$ROUTER_PORT" "router" 30 "${TMPDIR:-/tmp}/fridgegraph-alt-router${SUFFIX}.log" \
    || { down; return 1; }
  nohup "$MCP_BIN" "$MCP_CONFIG" > "${TMPDIR:-/tmp}/fridgegraph-alt-mcp${SUFFIX}.log" 2>&1 &
  echo "mcp $!" >> "$PIDFILE"

  wait_for_port "$MCP_PORT" "mcp" 30 "${TMPDIR:-/tmp}/fridgegraph-alt-mcp${SUFFIX}.log" \
    || { down; return 1; }

  ROSINA_PORT="$ROSINA_PORT" ROSINA_MCP_URL="$ROSINA_MCP_URL" ROSINA_GRAPHQL_URL="$ROSINA_GRAPHQL_URL" \
    nohup "$ROOT/node_modules/.bin/tsx" "$ROOT/src/rosina/server.ts" \
    > "${TMPDIR:-/tmp}/fridgegraph-alt-rosina${SUFFIX}.log" 2>&1 &
  echo "rosina $!" >> "$PIDFILE"

  wait_for_port "$ROSINA_PORT" "rosina" 30 "${TMPDIR:-/tmp}/fridgegraph-alt-rosina${SUFFIX}.log" \
    || { down; return 1; }

  printf 'alt-stack: up (pids in %s)\n' "$PIDFILE"
  check
}

# ---------------------------------------------------------------------------
down() {
  [ -f "$PIDFILE" ] || die "no $PIDFILE — nothing started by this script is running"
  while read -r name pid; do
    [ -n "${pid:-}" ] || continue
    if kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      printf 'alt-stack: stopped %s (pid %s)\n' "$name" "$pid"
    else
      printf 'alt-stack: %s (pid %s) already gone\n' "$name" "$pid"
    fi
  done < "$PIDFILE"
  sleep 2
  while read -r name pid; do
    [ -n "${pid:-}" ] || continue
    if kill -0 "$pid" 2>/dev/null; then kill -9 "$pid" 2>/dev/null || true; fi
  done < "$PIDFILE"
  rm -f "$PIDFILE"
  printf 'alt-stack: down\n'
}

# ---------------------------------------------------------------------------
check() {
  local ok=0
  printf 'alt-stack: checking the RUNNING stack (read-only, nothing restarted)\n'

  if curl -fsS -o /dev/null "http://127.0.0.1:${HEALTH_PORT}/health?ready" 2>/dev/null; then
    printf '  router health      OK\n'
  else
    printf '  router health      FAIL\n'; ok=1
  fi

  if curl -fsS -o /dev/null -X POST -H 'content-type: application/json' \
      -d '{"query":"{__typename}"}' "http://127.0.0.1:${ROUTER_PORT}/" 2>/dev/null; then
    printf '  router graphql     OK\n'
  else
    printf '  router graphql     FAIL\n'; ok=1
  fi

  if NODE_NO_WARNINGS=1 node "$ROOT/ops/alt-stack-check.mjs"; then
    printf '  mcp PickupCandidates OK\n'
  else
    printf '  mcp PickupCandidates FAIL\n'; ok=1
  fi

  if [ "$ok" -eq 0 ]; then printf 'alt-stack: CHECK PASSED\n'; else printf 'alt-stack: CHECK FAILED\n'; fi
  return "$ok"
}

case "${1:-}" in
  --up) up ;;
  --dry-run) plan ;;
  --check) check ;;
  --down) down ;;
  --gen)
    gen_router_config
    gen_mcp_config
    assert_mcp_config
    printf 'alt-stack: configs generated and validated (no process started)\n'
    ;;
  *) printf 'usage: %s --up | --dry-run | --check | --down | --gen\n' "$0" >&2; exit 2 ;;
esac
