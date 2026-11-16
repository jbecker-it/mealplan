#!/usr/bin/env bash
# =============================================================================
#  install.sh — Mealplan Web-App Installer (Debian/Ubuntu/Linux)
#
#  Installiert:
#    1. Grundvoraussetzungen (curl, python3 — per apt nachinstalliert, wenn
#       Root; ohne Root wird mit klarer Anleitung abgebrochen)
#    2. Node.js (falls fehlt: nach ~/.local/node, ohne Root möglich;
#       fehlende System-Bibliotheken — z. B. libatomic.so.1 — per apt, wenn
#       Root; sonst Fallback auf ältere LTS-Versionen)
#    3. Die App (npm install + build)
#    4. Startet den Server im Hintergrund (Port 3100)
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
NODE_HOME="$HOME/.local/node"

log()  { echo -e "\e[1;34m[mealplan]\e[0m $*"; }
ok()   { echo -e "\e[1;32m[mealplan]\e[0m $*"; }
warn() { echo -e "\e[1;33m[mealplan]\e[0m $*"; }
die()  { echo -e "\e[1;31m[mealplan] FEHLER:\e[0m $*" >&2; exit 1; }

echo
echo "  ╔══════════════════════════════════════════════╗"
echo "  ║   Mealplan — Meal-Prep-Planer installieren   ║"
echo "  ╚══════════════════════════════════════════════╝"
echo

# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------
have_apt() { [ "$(id -u)" -eq 0 ] && command -v apt-get >/dev/null 2>&1; }

# apt_install PKG… — installiert Pakete (nur mit Root); liefert 1, wenn nicht möglich
apt_install() {
  have_apt || return 1
  apt-get update -qq >/dev/null 2>&1 || true
  apt-get install -y -qq "$@" >/dev/null 2>&1
}

# -----------------------------------------------------------------------------
log "Schritt 1/5: Grundvoraussetzungen (curl, python3) ..."
# -----------------------------------------------------------------------------
if ! command -v curl >/dev/null 2>&1; then
  log "curl fehlt — Installation per apt ..."
  if apt_install curl ca-certificates; then
    ok "curl installiert"
  else
    die "curl fehlt und konnte nicht automatisch installiert werden. Bitte ausführen (als Root/Sudo) und danach erneut 'bash install.sh':
     apt-get install curl ca-certificates"
  fi
fi
if ! command -v python3 >/dev/null 2>&1; then
  log "python3 fehlt — Installation per apt ..."
  if apt_install python3; then
    ok "python3 installiert"
  else
    die "python3 fehlt und konnte nicht automatisch installiert werden. Bitte ausführen (als Root/Sudo) und danach erneut 'bash install.sh':
     apt-get install python3"
  fi
fi
ok "curl + python3 vorhanden"

# -----------------------------------------------------------------------------
log "Schritt 2/5: Node.js prüfen ..."
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
  log "Node.js fehlt oder ist zu alt — Installation nach $NODE_HOME ..."
  ARCH="$(uname -m)"
  case "$ARCH" in
    x86_64|amd64) NARCH="x64" ;;
    aarch64|arm64) NARCH="arm64" ;;
    *) die "Nicht unterstützte CPU-Architektur: $ARCH" ;;
  esac

  # Die 3 aktuellsten LTS-Hauptversionen (neueste zuerst), nur je eine Patch-Version
  LTS_LIST="$(curl -fsSL https://nodejs.org/dist/index.json \
    | python3 -c '
import json, sys
best, order = {}, []
for x in json.load(sys.stdin):
    if not x["lts"]:
        continue
    maj = x["version"].split(".")[0]
    if maj not in best:
        best[maj] = x["version"]
        order.append(maj)
    if len(order) == 3:
        break
print(" ".join(best[m] for m in order))
')"

  SUDO_HINT=""
  NODE_OK=0
  for NODE_VER in $LTS_LIST; do
    log "Versuche Node.js $NODE_VER ($NARCH) ..."
    rm -rf "$NODE_HOME"
    mkdir -p "$NODE_HOME"
    if ! curl -fsSL -o /tmp/node.tar.xz \
         "https://nodejs.org/dist/$NODE_VER/node-$NODE_VER-linux-$NARCH.tar.xz" 2>/dev/null; then
      continue
    fi
    tar -xJf /tmp/node.tar.xz -C "$NODE_HOME" --strip-components=1
    rm -f /tmp/node.tar.xz
    if "$NODE_HOME/bin/node" -v >/dev/null 2>&1; then
      NODE_OK=1
      break
    fi
    # Diagnose: fehlende Shared Libraries (z. B. libatomic.so.1)?
    MISSING="$(ldd "$NODE_HOME/bin/node" 2>/dev/null | awk '/not found/{print $1}' | sort -u)"
    if [ -n "$MISSING" ]; then
      # libatomic.so.1 -> libatomic1 (Debian-Paketname)
      PKGS="$(printf '%s\n' $MISSING | python3 -c '
import sys
for l in sys.stdin.read().split():
    base = l.split(".so")[0]
    rest = l.rsplit(".so.", 1)[1] if ".so." in l else ""
    print(base + (rest if rest.isdigit() else ""))
')"
      warn "Fehlende System-Bibliothek(en): $MISSING"
      if apt_install $PKGS; then
        log "System-Bibliotheken installiert: $PKGS"
        if "$NODE_HOME/bin/node" -v >/dev/null 2>&1; then
          NODE_OK=1
          break
        fi
      else
        SUDO_HINT="$PKGS"
      fi
    fi
  done
  rm -f /tmp/node.tar.xz

  if [ "$NODE_OK" -ne 1 ]; then
    if [ -n "$SUDO_HINT" ]; then
      die "Fehlende System-Bibliotheken konnten nicht automatisch installiert werden. Bitte ausführen und danach erneut 'bash install.sh':
     apt-get install $SUDO_HINT"
    fi
    die "Konnte kein lauffähiges Node.js installieren (Versions-Fallback ausgeschöpft). Bitte erneut versuchen: bash install.sh"
  fi
  export PATH="$NODE_HOME/bin:$PATH"
  ok "Node.js $(node -v) installiert nach $NODE_HOME"
  log "Tipp: In die ~/.bashrc ergänzen:"
  echo "     export PATH=\"$NODE_HOME/bin:\$PATH\""
fi

# -----------------------------------------------------------------------------
log "Schritt 3/5: Abhängigkeiten installieren (npm install) ..."
# -----------------------------------------------------------------------------
cd "$DIR"
# Build-Tools für native Module (better-sqlite3) — best effort, nur mit Root
if have_apt; then
  apt_install make g++ >/dev/null 2>&1 || true
fi
npm install --no-audit --no-fund

# -----------------------------------------------------------------------------
log "Schritt 4/5: App bauen (npm run build) ..."
# -----------------------------------------------------------------------------
npm run build

# -----------------------------------------------------------------------------
log "Schritt 5/5: Server starten (Port $PORT) ..."
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
