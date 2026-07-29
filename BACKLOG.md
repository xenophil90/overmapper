# Backlog

Ideen und offene Punkte für später — keine davon ist aktuell in Arbeit.

## Erledigt

- [x] **Mehrsprachigkeit (i18n)**: UI-Texte in Deutsch/Englisch, umschaltbar über
  die Sprachauswahl im Header, Auswahl wird in `localStorage` gemerkt
  (`data/i18n.js`, `applyLanguage()` in `app.js`).
- [x] Entfernung ohne Nachkommastelle anzeigen ("183 km" statt "183.4 km").
- [x] Einheit für die Entfernung wählbar (km/mi) — Umschalter im Panel "Text",
  Auswahl wird in `localStorage` gemerkt. Unterhalb von 1 km bzw. 1 Meile
  wird auf m bzw. ft heruntergeschaltet.
- [x] Datei-Auswahl als Drag-&-Drop-Fläche im Panel-Stil, mit Klick-Fallback
  (`bindDropzone()` in `app.js`).
- [x] Eigene/freie Export-Auflösung. Bildverhältnis und Auflösung sind getrennt:
  das Panel "Format" gibt durchgehend Verhältnisse an (Presets plus "Eigenes
  Verhältnis"), die Auflösung darunter setzt die kurze Kante (1080/1440/2160 px).
  Die Pixelgröße ergibt sich aus beidem, gedeckelt auf 8000 px lange Kante.
- [x] Falsches Preset-Label korrigiert: der "16:9"-Button lieferte 1200×630,
  also 40:21 (die Open-Graph-Größe für Link-Vorschauen). Jetzt echtes 16:9.
- [x] Barrierefreiheit: sichtbarer Fokus-Ring für die Toggle-Switches sowie für
  Segmented-Buttons, Link-Buttons und Textfelder. Die Segmented-Controls haben
  zusätzlich `aria-label` und `aria-pressed`.
- [x] Mobile Reihenfolge: unter 840 px steht die Vorschau jetzt über den Reglern.

## Mögliche Verbesserungen

- [ ] **Positionierung von Track, Titel, Entfernung und Flaggen wählbar machen.**
  Das 3×3-Zonen-System existiert bereits im Code (`getAnchor()`, `getTrackBox()`),
  ist aber im `layout`-Objekt fest verdrahtet. Es fehlt nur die UI dazu.
- [ ] **Höhenmeter und Dauer aufs Poster.** `parseGPX()` liest `ele` und `time`
  bereits ein, beide Werte werden bisher nirgends ausgewertet.
- [ ] GPX-Import erweitern: aktuell werden nur `trkpt` (Track-Punkte)
  gelesen — `rte`/`rtept` (Routen) und `wpt` (Wegpunkte) werden ignoriert.
- [ ] Download-Button-Breite an sehr schmale Formate (9:16) angleichen —
  aktuell bleibt er bei `max-width: 400px`, auch wenn das Vorschaubild
  schmaler ist.
- [ ] Dateiname des Downloads aus Titel bzw. GPX-Dateinamen ableiten —
  aktuell immer `gpx-poster.png`.
- [ ] Fehlermeldungen näher an der Ursache anzeigen. `#errorMsg` sitzt unter
  dem Download-Button in der rechten Spalte, die Fehler entstehen aber beim
  Datei-Upload in der linken.
- [ ] Vorschau auf Mobil zusätzlich `sticky` machen — sie steht jetzt oben,
  scrollt beim Bedienen der unteren Panels aber weg.
- [ ] Ladeanzeige für sehr große GPX-Dateien (aktuell kein Fortschrittsindikator
  während des Parsens).

## Technische Schulden

- [ ] Keine automatisierten Tests (aktuell nur manuell im Browser geprüft).
  Kandidaten für Unit-Tests ohne DOM: `formatDistanceParts()`, `getCanvasSize()`,
  `haversine()`, `computeMetrics()`, `pointInPolygonRings()`.
- [ ] Keine CI-Pipeline im GitHub-Repo (z. B. Lint/Build-Check bei Push).

---

Punkte gerne ergänzen, streichen oder umsortieren — das hier ist nur eine
Gedächtnisstütze, keine verbindliche Roadmap.
