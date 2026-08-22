#!/usr/bin/env bash
#
# Care Loop — the only supported way to run this app.
#
#   ./start.sh              start the dev server
#   ./start.sh --restart    kill whatever holds the port first
#   ./start.sh --clean      discard .next (stale Turbopack graph)
#   ./start.sh --migrate    apply pending migrations first
#   ./start.sh --ticker     also poll /api/tick, so the scheduler runs
#   ./start.sh --prod       build and serve production
#   ./start.sh --test       run the gate, then exit
#   ./start.sh --stop       stop the server and exit
#   ./start.sh --port N     use a different port
#
# The banner it prints before starting is the point: this app's scheduler dials
# real phone numbers on its own, with nobody pressing a button. You should never
# have to guess whether the process you just started can do that.

set -euo pipefail
cd "$(dirname "$0")"

# 3001, not 3000: OpenLine runs in a sibling repo on 3000, and these two are
# developed side by side. A shared default means one project's --stop kills the
# other project's server.
PORT=3001
RESTART=0
CLEAN=0
MIGRATE=0
TICKER=0
PROD=0

RED=$'\033[31m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'
DIM=$'\033[2m'; BOLD=$'\033[1m'; OFF=$'\033[0m'

info() { printf '%s\n' "$*"; }
ok()   { printf '%s%s%s\n' "$GREEN" "$*" "$OFF"; }
warn() { printf '%s%s%s\n' "$YELLOW" "$*" "$OFF"; }
die()  { printf '%s%s%s\n' "$RED" "$*" "$OFF" >&2; exit 1; }

# -sTCP:LISTEN matters: a bare `lsof -ti:PORT` also matches the browser's own
# client sockets, including CLOSED ones left behind after you visit the page.
# Without it the script reports Chrome as the dev server — and --stop kills it.
port_pid() { lsof -ti:"$PORT" -sTCP:LISTEN 2>/dev/null || true; }

stop_server() {
  local pid; pid=$(port_pid)
  [ -z "$pid" ] && { info "Nothing is listening on :$PORT."; return 0; }
  info "Stopping pid $pid on :${PORT}…"
  kill "$pid" 2>/dev/null || true
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    [ -z "$(port_pid)" ] && { ok "Stopped."; return 0; }
    sleep 0.3
  done
  kill -9 "$pid" 2>/dev/null || true
  ok "Stopped (forced)."
}

# Read one value out of .env without sourcing it — sourcing an env file runs
# whatever is in it, and this one holds real phone numbers and API keys.
env_value() {
  [ -f .env ] || return 0
  grep -E "^$1=" .env 2>/dev/null | tail -1 | cut -d= -f2- \
    | sed -e 's/^"//' -e 's/"$//' -e "s/^'//" -e "s/'$//" || true
}

while [ $# -gt 0 ]; do
  case "$1" in
    --restart) RESTART=1 ;;
    --clean)   CLEAN=1 ;;
    --migrate) MIGRATE=1 ;;
    --ticker)  TICKER=1 ;;
    --prod)    PROD=1 ;;
    --stop)    stop_server; exit 0 ;;
    --test)    exec pnpm run verify ;;
    --port)    shift; PORT="${1:?--port needs a number}" ;;
    --help|-h) awk 'NR<3{next} /^#/{sub(/^# ?/,""); print; next} {exit}' "$0"; exit 0 ;;
    *) die "Unknown flag: $1  (try --help)" ;;
  esac
  shift
done

command -v node >/dev/null || die "node is not installed."
command -v pnpm >/dev/null || die "pnpm is not installed. npm i -g pnpm"
node_major=$(node -v | sed 's/^v\([0-9]*\).*/\1/')
[ "$node_major" -ge 20 ] || die "node >= 20 required (found $(node -v))."

if [ ! -f .env ]; then
  warn "No .env — copying .env.example. Fill it in before expecting anything to work."
  cp .env.example .env
fi

[ "$RESTART" = "1" ] && stop_server

if [ -n "$(port_pid)" ]; then
  warn "Something is already listening on :$PORT (pid $(port_pid))."
  info "  ./start.sh --restart      stop it and start fresh"
  info "  ./start.sh --port 3002    use another port"
  info "  ./start.sh --stop         just stop it"
  info "  open http://localhost:$PORT"
  exit 1
fi

if [ ! -d node_modules ] || [ pnpm-lock.yaml -nt node_modules ]; then
  info "Installing dependencies…"
  pnpm install
fi

[ "$CLEAN" = "1" ]   && { info "Removing .next…"; rm -rf .next; }
[ "$MIGRATE" = "1" ] && { info "Applying migrations…"; pnpm run db:migrate; }

# ---------------------------------------------------------------------------
# The banner.
# ---------------------------------------------------------------------------
CALLE_KEY=$(env_value CALLE_API_KEY)
ALLOWLIST=$(env_value CARELOOP_CALL_ALLOWLIST)
DB_URL=$(env_value DATABASE_URL)
OPENAI_KEY=$(env_value OPENAI_API_KEY)
TICK_TOKEN=$(env_value CARELOOP_TICK_TOKEN)

if [ -n "$ALLOWLIST" ]; then
  ARMED=$(printf '%s' "$ALLOWLIST" | tr ',' '\n' | grep -c '[0-9]' || true)
else
  ARMED=0
fi

echo
printf '%s' "$BOLD"
echo "  ┌────────────────────────────────────────────────────────────┐"
printf '%s' "$OFF$BOLD"
echo "  │  CARE LOOP                                                 │"
echo "  └────────────────────────────────────────────────────────────┘"
printf '%s' "$OFF"
echo

if [ -z "$CALLE_KEY" ]; then
  warn "  CALLS ARE OFF — no CALLE_API_KEY. Nothing can be dialled."
elif [ "$ARMED" = "0" ]; then
  warn "  CALLS ARE LIVE, but the dial allowlist is EMPTY."
  echo "$DIM  Every scheduled call will be refused with a visible reason.$OFF"
  echo "$DIM  That is the safe default: the scheduler dials on its own.$OFF"
else
  printf '%s  CALLS ARE LIVE — %s number(s) armed to dial. This costs money%s\n' "$RED$BOLD" "$ARMED" "$OFF"
  printf '%s  and reaches real people.%s\n' "$RED$BOLD" "$OFF"
  printf '%s' "$DIM"
  printf '%s' "$ALLOWLIST" | tr ',' '\n' | sed 's/^[[:space:]]*/    → /'
  printf '%s' "$OFF"
fi
echo

status() { [ -n "$2" ] && ok "  ✓ $1" || warn "  ✗ $1 — not configured"; }
status "Database"        "$DB_URL"
status "CALL-E"          "$CALLE_KEY"
status "OpenAI compiler" "$OPENAI_KEY"
status "Tick token"      "$TICK_TOKEN"
echo

if [ "$TICKER" = "1" ]; then
  if [ -z "$TICK_TOKEN" ]; then
    warn "  --ticker needs CARELOOP_TICK_TOKEN. Skipping the poll loop."
  else
    info "  Scheduler poll loop: every 10s against /api/tick"
    (
      sleep 6
      while true; do
        curl -s -X POST -H "x-careloop-tick: $TICK_TOKEN" \
          "http://localhost:$PORT/api/tick" >/dev/null 2>&1 || true
        sleep 10
      done
    ) &
    echo "$DIM  (poll loop pid $!; it dies with this shell)$OFF"
  fi
  echo
fi

info "  http://localhost:$PORT"
echo

if [ "$PROD" = "1" ]; then
  pnpm run build
  PORT=$PORT exec pnpm run start
else
  PORT=$PORT exec pnpm run dev
fi
