#!/usr/bin/env bash
# =============================================================================
#  install.sh — Mealplan Web-App Installer (ohne Root, Debian/Ubuntu/Linux)
#
#  Installiert:
#    1. Node.js (falls fehlt: nach ~/.local/node — ohne Root)
#    2. Die App (npm install + build)
#    3. Startet den Server im Hintergrund (Port 3100)
#
#  So wird's ausgeführt:
#    git clone https://github.com/jbecker-it/mealplan.git
#    cd mealplan
#    bash install.sh
#
#  Optionale Umgebungsvariablen:
#    MP_PORT   Web-Port (Default: 3100)
#
#  Der Installer ist idempotent — er kann beliebig oft erneut ausgeführt
#  werden (z. B. nach einem git pull zum Aktualisieren).
# =============================================================================
set -euo pipefail

PORT="${MP_PORT:-3100}"
DIR="$(cd "$(dirname "$0")" && pwd)"
NODE_MIN=20

log()  { echo -e "\e[1;34m[mealplan]\e[0m $*"; }
ok()   { echo -e "\e[1;32m[mealplan]\e[0m $*"; }
die()  { echo -e "\e[1;31m[mealplan] FEHLER:\e[0m $*" >&2; exit 1; }

echo
echo "  ╔══════════════════════════════════════════════╗"
echo "  ║   Mealplan — Meal-Prep-Planer installieren   ║"
echo "  ╚══════════════════════════════════════════════╝"
echo

# -----------------------------------------------------------------------------
log "Schritt 1/4: Node.js prüfen ... "
# -----------------------------------------------------------------------------
node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  local major
  major="$(node -v | sed 's/^v\([0-9]*\).*/\1/')"
  [ "${major:-0}" -ge "$NODE_MIN" ]
}

if node_ok; then
  ok "Node.js $(node -v) vorhanden"
else
  log "Node.js fehlt oder ist zu alt — Installation nach ~/.local/node (ohne Root) ..."
  if ! command -v curl >/dev/null 2>&1; then die "curl fehlt — bitte curl installieren"; fi
  ARCH="$(uname -m)"
  case "$ARCH" in
    x86_64|amd64) NARCH="x64" ;;
    aarch64|arm64) NARCH="arm64" ;;
    *) die "Nicht unterstützte CPU-Architektur: $ARCH" ;;
  esac
  NODE_VER="$(curl -fsSL https://nodejs.org/dist/index.json \
    | python3 -c 'import json,sys; print([x["version"] for x in json.load(sys.stdin) if x["lts"]][0][1:])')"
  log "Lade Node.js v$NODE_VER ($NARCH) ..."
  curl -fsSL -o /tmp/node.tar.xz \
    "https://nodejs.org/dist/v$NODE_VER/node-v$NODE_VER-linux-$NARCH.tar.xz"
  mkdir -p "$HOME/.local/node"
  tar -xJf /tmp/node.tar.xz -C "$HOME/.local/node" --strip-components=1
  rm -f /tmp/node.tar.xz
  export PATH="$HOME/.local/node/bin:$PATH"
  ok "Node.js $(node -v) installiert nach ~/.local/node"
  log "Tipp: Diese Zeile in die ~/.bashrc ergänzen:"
  echo "     export PATH=\"$HOME/.local/node/bin:\$PATH\""
fi

# -----------------------------------------------------------------------------
log "Schritt 2/4: Abhängigkeiten installieren (npm install) ..."
# -----------------------------------------------------------------------------
cd "$DIR"
npm install --no-audit --no-fund

# -----------------------------------------------------------------------------
log "Schritt 3/4: App bauen (npm run build) ..."
# -----------------------------------------------------------------------------
npm run build

# -----------------------------------------------------------------------------
log "Schritt 4/4: Server starten (Port $PORT) ..."
# -----------------------------------------------------------------------------
mkdir -p "$DIR/logs"
echo "PORT=$PORT" > "$DIR/.mealplan.env"

# Bereits laufende Instanz stoppen (idempotent)
if [ -f "$DIR/.mealplan.pid" ] && kill -0 "$(cat "$DIR/.mealplan.pid")" 2>/dev/null; then
  log "Bestehende Instanz (PID $(cat "$DIR/.mealplan.pid")) wird neu gestartet ..."
  kill "$(cat "$DIR/.mealplan.pid")" 2>/dev/null || true
  sleep 2
fi
pkill -f "next start" 2>/dev/null || true
sleep 1

nohup npm start -- -p "$PORT" > "$DIR/logs/server.log" 2>&1 &
echo $! > "$DIR/.mealplan.pid"

# Auf Bereitschaft warten (max. 30 s)
READY=0
for _ in $(seq 1 30); do
  if curl -s -o /dev/null "http://127.0.0.1:$PORT/"; then READY=1; break; fi
  sleep 1
done
[ "$READY" -eq 1 ] || die "Server nicht erreichbar — Log prüfen: $DIR/logs/server.log"

# Lokale IP für die Anzeige
IP="$(hostname -I 2>/dev/null | awk '{print $1}')"
[ -n "$IP" ] || IP="<server-ip>"

echo
ok "Installation erfolgreich!"
echo
echo "  URL:            http://$IP:$PORT"
echo "  Erster Start:   Passwort im Browser wählen (einmalig, kein CLI-Input)"
echo "  Daten:          $DIR/data/mealplan.db  (Backup = diese Datei kopieren)"
echo
echo "  Verwalten:      ./mealplan.sh status | stop | restart | logs"
echo
