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

ensure_node() {
  if ! command -v node >/dev/null 2>&1; then
    if [ -x "$HOME/.local/node/bin/node" ]; then
      export PATH="$HOME/.local/node/bin:$PATH"
    else
      warn "Node.js nicht gefunden — bash install.sh ausführen?"
      exit 1
    fi
  fi
}

# Baut neu, wenn sich Code seit dem letzten Build geändert hat (git pull
# ohne Build würde sonst den alten Server weiterlaufen lassen).
build_if_stale() {
  if [ ! -f "$DIR/.next/BUILD_ID" ] || \
     [ -n "$(find "$DIR/src" -type f -newer "$DIR/.next/BUILD_ID" -print -quit 2>/dev/null)" ] || \
     [ ! -d "$DIR/node_modules" ]; then
    warn "Code/Abhängigkeiten geändert — neuer Build (dauert ca. 1 Min) ..."
    ( cd "$DIR" && ensure_node && npm install --no-audit --no-fund && npm run build ) \
      || { warn "Build fehlgeschlagen — Details: npm run build"; return 1; }
    ok "Build abgeschlossen"
  else
    ok "Build aktuell"
  fi
}

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
  if ! command -v node >/dev/null 2>&1 && [ ! -x "$HOME/.local/node/bin/node" ]; then
    warn "Node.js nicht gefunden — bash install.sh ausführen?"
    exit 1
  fi
  ensure_node
  build_if_stale
  mkdir -p "$DIR/logs"
  ( cd "$DIR" && nohup npm start -- -p "$PORT" > "$LOG" 2>&1 & echo $! > "$PIDFILE" )
  for _ in $(seq 1 15); do
    curl -s -o /dev/null "http://127.0.0.1:$PORT/" && { ok "Gestartet (Port $PORT)"; return 0; }
    sleep 1
  done
  warn "Startet noch nicht — Log: $LOG"
}

do_stop() {
  # Robust: Prozess über den PORT identifizieren (Prozessnamen ändern Next.js
  # zu "next-server (v…)" — pgrep-Muster treffen das nicht immer).
  local pids="" p
  if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    pids="$(cat "$PIDFILE")"
  fi
  for p in $(port_pids); do
    case " $pids " in *" $p "*) ;; *) pids="$pids $p" ;; esac
  done
  pids="${pids# }"
  if [ -n "$pids" ]; then
    for p in $pids; do kill "$p" 2>/dev/null || true; done
    for _ in 1 2 3 4 5 6 7 8 9 10; do
      [ -z "$(port_pids)" ] && break
      sleep 1
    done
    for p in $(port_pids); do kill -9 "$p" 2>/dev/null || true; done
    sleep 1
    if [ -z "$(port_pids)" ]; then
      ok "Gestoppt (PID: $pids)"
    else
      warn "Port $PORT ist weiterhin belegt — Start abgebrochen"
      exit 1
    fi
  else
    ok "Läuft nicht"
  fi
  rm -f "$PIDFILE"
}

port_pids() {
  ss -ltnp 2>/dev/null | grep -E "[:.]${PORT}[[:space:]]" \
    | grep -oP 'pid=\K[0-9]+' | sort -u
}

do_status() {
  local pid
  if pid="$(running_pid)" && [ -n "$pid" ]; then
    ok "Läuft (PID $pid, Port $PORT)"
  else
    warn "Läuft nicht — ./mealplan.sh start"
  fi
}

do_update() {
  if command -v git >/dev/null 2>&1; then
    ( cd "$DIR" && git pull --ff-only ) \
      && ok "Aktualisiert (git pull)" \
      || warn "git pull fehlgeschlagen — lokal gestartet"
  else
    warn "git nicht gefunden — nur (Re-)Start"
  fi
  do_stop
  do_start
}

case "${1:-status}" in
  start)   do_start ;;
  stop)    do_stop ;;
  restart) do_stop; do_start ;;
  update)  do_update ;;
  status)  do_status ;;
  logs)    tail -n 40 "$LOG" 2>/dev/null || echo "Noch kein Log ($LOG)" ;;
  *)
    echo "Verwendung: ./mealplan.sh {start|stop|restart|update|status|logs}"
    echo "  update = git pull + Build (bei Bedarf) + Neustart — nach Updates das Einzige, was du brauchst"
    exit 1
    ;;
esac
