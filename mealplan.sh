#!/usr/bin/env bash
# =============================================================================
#  mealplan.sh — App verwalten:  start | stop | restart | status | logs
# =============================================================================
set -euo pipefail

DIR="$(cd "$(dirname "$0")" && pwd)"
PIDFILE="$DIR/.mealplan.pid"
LOG="$DIR/logs/server.log"
PORT=3100
if [ -f "$DIR/.mealplan.env" ]; then
  . "$DIR/.mealplan.env"
fi

log() { echo -e "\e[1;34m[mealplan]\e[0m $*"; }
ok()  { echo -e "\e[1;32m[mealplan]\e[0m $*"; }
warn(){ echo -e "\e[1;33m[mealplan]\e[0m $*"; }

running_pid() {
  if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    cat "$PIDFILE"
    return 0
  fi
  pgrep -f "next start" | head -1 || true
}

do_start() {
  local pid
  if pid="$(running_pid)" && [ -n "$pid" ]; then
    ok "Läuft bereits (PID $pid)"
    return 0
  fi
  if ! command -v node >/dev/null 2>&1; then
    if [ -x "$HOME/.local/node/bin/node" ]; then
      export PATH="$HOME/.local/node/bin:$PATH"
    else
      warn "Node.js nicht gefunden — bash install.sh ausführen?"
      exit 1
    fi
  fi
  mkdir -p "$DIR/logs"
  ( cd "$DIR" && nohup npm start -- -p "$PORT" > "$LOG" 2>&1 & echo $! > "$PIDFILE" )
  for _ in $(seq 1 15); do
    curl -s -o /dev/null "http://127.0.0.1:$PORT/" && { ok "Gestartet (Port $PORT)"; return 0; }
    sleep 1
  done
  warn "Startet noch nicht — Log: $LOG"
}

do_stop() {
  local pid
  if pid="$(running_pid)" && [ -n "$pid" ]; then
    kill "$pid" 2>/dev/null || true
    # Kinderprozess (next start → node server.js) ggf. ebenfalls
    pkill -f "next start" 2>/dev/null || true
    pkill -f "next-server" 2>/dev/null || true
    sleep 1
    ok "Gestoppt (war PID $pid)"
  else
    ok "Läuft nicht"
  fi
  rm -f "$PIDFILE"
}

do_status() {
  local pid
  if pid="$(running_pid)" && [ -n "$pid" ]; then
    ok "Läuft (PID $pid, Port $PORT)"
  else
    warn "Läuft nicht — ./mealplan.sh start"
  fi
}

case "${1:-status}" in
  start)   do_start ;;
  stop)    do_stop ;;
  restart) do_stop; do_start ;;
  status)  do_status ;;
  logs)    tail -n 40 "$LOG" 2>/dev/null || echo "Noch kein Log ($LOG)" ;;
  *)
    echo "Verwendung: ./mealplan.sh {start|stop|restart|status|logs}"
    exit 1
    ;;
esac
