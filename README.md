# Mealplan — Meal-Prep-Planer

Web-App zum Planen der Meal-Prep-Woche: Rezepte mit Makros pro Portion,
intelligente Rezept-Kombination für zwei Personen, Einkaufsliste mit
Zutaten-Deduplizierung. Läuft als einzelner Node-Prozess auf einem LXC —
kein Docker, kein Root.

## Installation (2 Befehle)

```bash
git clone https://github.com/jbecker-it/mealplan.git
cd mealplan && bash install.sh
```

Der Installer richtet automatisch ein: curl, python3 und Node.js
(neueste LTS, bei Problemen Fallback auf ältere Versionen), fehlende
System-Bibliotheken (z. B. `libatomic1`) und Build-Tools — per `apt`, wenn
als Root ausgeführt; ohne Root wird mit klarer Anleitung abgebrochen.
Danach installiert er die Abhängigkeiten, baut die App und startet den
Server auf **Port 3100**.

Danach: Browser öffnen → `http://<server-ip>:3100` → beim ersten Start das
App-Passwort wählen (einmalig, im Browser — kein Terminal-Input nötig).
Fertig.

Zum Aktualisieren:

```bash
cd mealplan && git pull && bash install.sh
```

## Alltag

```bash
./mealplan.sh status     # läuft sie?
./mealplan.sh stop       # stoppen
./mealplan.sh start      # starten
./mealplan.sh restart    # neu starten
./mealplan.sh logs       # letztes Log
```

## Funktionen

- **Zwei Profile** mit getrennten Makro-Zielen (kcal / Protein / KH / Fett)
  und pro-Slot kcal-Anteilen (Frühstück / Mittag / Abend / Snack)
- **Rezepte** per Text-Import (Makros, Zutaten, Zubereitung) oder
  manuell — mit Tags, Favoriten und **Kategorien**
  (Frühstück / Mittag / Abend / Snack — je Rezept wählbar, Default: alle)
- **Wochenplan 2×2**: Template A und B, dauerhaft (unabhängig von der
  Kalenderwoche) — gleiche Rezepte an jedem Wochentag, frei umschaltbar.
  „Neu generieren“ betrifft nur das aktive Template; vorher wird der alte
  Stand im **Verlauf** gesichert und ist als A oder B wiederherstellbar
- **Kochmodus**: Rezept auf beliebig viele Portionen hochrechnen
  (Mengen im Rezept = 1 Portion), Zutaten/Schritte abhaken
- **Tags**: direkt im Rezept vergeben, in der Rezeptliste filtern,
  pro Profil ein-/ausschließen
- **Einheiten**: g, ml, EL, TL, Stück, Prise, Bund, Zehe … — EL/TL werden
  auf der Einkaufsliste pro Zutat in g/ml umgerechnet („1 EL = x g“)
- Pro Slot wählbar: **gemeinsam** (eine Portion geteilt) oder
  **getrennt** (jeder eigene Rezeptvorschlag)
- Portionsgrößen: 0.5 / 1 / 1.5 — keine freie Skalierung
- **Einkaufsliste** aus dem Plan, Zutaten als einzigartige Entitäten
  (Kein Doppelzählen durch Alias-Auflösung)
- Ein gemeinsames App-Passwort (1 Haushalt), Server-Sessions

## Rezept-Format (Text-Import)

```
# Kokos-Curry mit Reis
Makros: 640 kcal | 30 g Protein | 70 g KH | 25 g Fett
Slot: Mittag, Abend          ← optional, Default: Frühstück, Mittag, Abend, Snack
Tags: schnell, vegan
Zutaten:
- 200 g Reis
- 400 g Kokosmilch
- 1 1/2 EL Sojasoße       ← Brüche, ½, 1,5, kg/l werden umgerechnet
- 2 Zwiebeln              ← ohne Einheit = Stück
Zubereitung:
1. Reis kochen.
2. Curry anrühren.
```

## Daten & Backup

Alle Daten (Rezepte, Profile, Plan, Einkaufsliste, Auth) liegen in einer
einzigen SQLite-Datei:

```
data/mealplan.db
```

**Backup = diese eine Datei kopieren** (am besten während die App gestoppt
ist: `./mealplan.sh stop` → Datei kopieren → `start`).
Bei einem Umzug: Datei auf dem neuen System an denselben Ort legen,
fertig — der Rest ist im Git-Repo.

## Betrieb

- Node.js ≥ 20 (Installer besorgt es bei Bedarf)
- Port 3100 (via `MP_PORT=8080 bash install.sh` änderbar)
- Logs: `logs/server.log`
- Kein Root, kein Docker, keine Systemdienste nötig
