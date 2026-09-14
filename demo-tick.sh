#!/usr/bin/env bash
#
# Drive the scheduler during a demo.
#
#   ./demo-tick.sh            poll every 10s until you stop it
#   ./demo-tick.sh --once     one tick, print the counters, exit
#   ./demo-tick.sh --every 5  poll every 5 seconds
#
# This is the third of the three honest triggers, and it is a plain curl loop on
# purpose: what runs the scheduler should be something you can point at on
# screen, not a background timer nobody can see.

set -euo pipefail
cd "$(dirname "$0")"

PORT=3001
EVERY=10
ONCE=0

while [ $# -gt 0 ]; do
  case "$1" in
    --once)  ONCE=1 ;;
    --every) shift; EVERY="${1:?--every needs seconds}" ;;
    --port)  shift; PORT="${1:?--port needs a number}" ;;
    --help|-h) awk 'NR<3{next} /^#/{sub(/^# ?/,""); print; next} {exit}' "$0"; exit 0 ;;
    *) echo "Unknown flag: $1" >&2; exit 1 ;;
  esac
  shift
done

# Read the token without sourcing .env — that file holds API keys and real
# phone numbers, and sourcing it would execute whatever is in it.
TOKEN=$(grep -E '^AFTER_VISIT_TICK_TOKEN=' .env 2>/dev/null | tail -1 | cut -d= -f2- | tr -d '"'"'" || true)

if [ -z "${TOKEN:-}" ]; then
  echo "AFTER_VISIT_TICK_TOKEN is not set in .env."
  echo "Generate one:  openssl rand -hex 32"
  exit 1
fi

tick() {
  curl -s -X POST -H "x-after-visit-tick: $TOKEN" "http://localhost:$PORT/api/tick" \
    | python3 -c 'import json,sys,datetime
try:
    d = json.load(sys.stdin)
except Exception:
    print("  no response"); raise SystemExit
now = datetime.datetime.now().strftime("%H:%M:%S")
if d.get("skipped"):
    print(f"  {now}  another tick is already running")
elif d.get("error"):
    print(f"  {now}  error: {d[\"error\"]}")
else:
    print(f"  {now}  claimed {d.get(\"claimed\",0)}  dialled {d.get(\"dialed\",0)}"
          f"  refused {d.get(\"refused\",0)}  finished {d.get(\"finished\",0)}"
          f"  escalated {d.get(\"escalated\",0)}")'
}

if [ "$ONCE" = "1" ]; then
  tick
  exit 0
fi

echo "Ticking every ${EVERY}s against :$PORT. Ctrl-C to stop."
while true; do
  tick
  sleep "$EVERY"
done
