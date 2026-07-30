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
- [x] **Render-Optimierung.** Track-Punkte, die enger als 0,7 px beieinander
  liegen, werden beim Zeichnen übersprungen und direkt projiziert statt vorher
  in ein Zwischen-Array kopiert (`traceSegment()`); die Geo-Bounds werden einmal
  beim Laden berechnet statt in jedem Frame (`computeBounds()`); Renders werden
  per `requestAnimationFrame` gebündelt; die Vorschau rendert höchstens 2400 px
  lange Kante, der Export weiterhin in voller Größe (`renderExportCanvas()`).
  Gemessen an einem 60k-Punkte-Track: Track-Zeichnen 5,6 → 0,7 ms.
- [x] Linienstärke und Start-/Zielpunkt-Radius des Tracks skalieren mit der
  Postergröße (heute mit der kurzen Kante, siehe Layout-Eintrag unten). Vorher
  waren es feste Pixelwerte, dadurch war die Trackline bei Auflösung 2160
  relativ halb so dick wie bei 1080.
- [x] **Höhenmeter und Dauer aufs Poster.** Beide sitzen zusammen mit der
  Entfernung in einer gemeinsamen Kennzahlen-Zeile (`drawStatsRow()`), einzeln
  ein-/ausschaltbar. Höhenmeter werden mit einer 5-m-Schwelle summiert
  (`ELEVATION_NOISE_M`), sonst summiert GPS-Rauschen sich zu Fantasiewerten —
  an einem Testtrack mit ±2 m Rauschen: 7944 m ungefiltert, 5514 m gefiltert,
  5526 m tatsächlich. Die Dauer wird pro Segment summiert, damit Pausen
  zwischen zwei Aufzeichnungen nicht mitzählen. Fehlen `ele` oder `time` in der
  Datei, werden die Schalter deaktiviert und begründet.
- [x] **Höhenprofil als Grafik.** Volle Posterbreite, über der Kennzahlen-Zeile,
  standardmäßig aus. Aufgetragen über die zurückgelegte Distanz (nicht über den
  Punktindex), damit ungleichmäßig abgetastete Tracks nicht verzerren; einmalig
  beim Laden auf 500 Stützpunkte reduziert.
- [x] **Festes, kollisionsfreies Poster-Layout** (`computePosterLayout()`). Das
  Poster ist ein Stapel: Titel, Track, Höhenprofil, unten Kennzahlen (links) und
  Flaggen (rechts). Jeder Block wird gemessen, bevor der darüberliegende
  platziert wird — vorher saß das Profil auf einem festen Bruchteil der Höhe und
  überlappte ab fünf Ländern die Flaggen um 31 px. Dazu:
  - Flaggen stehen in einer waagerechten Reihe, wann immer sie in die verfügbare
    Breite passt. Nur wenn eine Reihe neben den Kennzahlen zu breit wäre, ein
    umgebrochener Block dort aber noch passt, wird umgebrochen.
  - Passen Kennzahlen und Flaggen gar nicht nebeneinander, ohne dass die Zahlen
    unter 90 % ihrer Größe schrumpfen, rücken die Flaggen auf eine eigene Zeile
    — dort ist immer Platz für eine einzelne Reihe.
  - Jede Kennzahl trägt ihre Beschriftung, auch wenn nur eine angezeigt wird.
  - Hat die Kennzahlen-Zeile die Zeile für sich, werden die Spalten auf die volle
    Inhaltsbreite verteilt: gleicher Rand links wie rechts, und die rechte Kante
    fluchtet mit den Flaggen darüber. Zu kurze Zeilen (< 50 % der Breite) werden
    stattdessen zentriert, sonst klaffen die Zahlen auseinander.
  - Lange Titel brechen auf zwei Zeilen um, statt auf halbe Größe zu schrumpfen.
  - Schriftgrößen und Flaggen skalieren mit der **kurzen** Kante statt mit der
    Breite. Im Querformat war die Breite die lange Kante, dadurch fraßen Text und
    Flaggen die ganze Höhe und schoben den Track aus seinem Feld.
  - Geprüft über 1680 Kombinationen aus sechs Formaten, fünf Titeln, Profil
    an/aus, 0–3 Kennzahlen und 0–12 Ländern (ad-hoc im Browser, siehe die
    offenen Testpunkte unter "Technische Schulden").
- [x] Sprachwechsel zeichnet das Poster neu. Die Beschriftungen der Kennzahlen
  kommen aus `t()`, blieben aber bis zur nächsten Änderung in der alten Sprache
  stehen (`render()` am Ende von `applyLanguage()`).
- [x] Eigenes Sprach-Dropdown statt `<select>`. Das aufgeklappte Menü eines
  nativen Selects lässt sich nicht gestalten. Jetzt Button plus
  `role="listbox"`, bedienbar per Maus und Tastatur (Pfeiltasten, Enter, Escape,
  Klick nach außen schließt).

## ToDo

Gemeinsam priorisiert. Reihenfolge innerhalb der Blöcke ist grob nach
Nutzen pro Aufwand sortiert.

### Layout

- [ ] Linienstärke des Tracks einstellbar machen.
- [ ] Poster-Vorlagen/Presets: fertige Kombinationen aus Farben und
  eingeblendeten Elementen.

### Export

- [ ] Dateiname des Downloads aus Titel bzw. GPX-Dateinamen ableiten —
  aktuell immer `gpx-poster.png`.
- [ ] Ladeindikator während des Exports. Die PNG-Kodierung dauert gemessen
  ~1,1 s bei 2160×3840, aktuell ohne jede Rückmeldung.
- [ ] JPEG als Exportformat zusätzlich zu PNG. Ein 2160×3840-PNG ist ~1,5 MB,
  für Messenger und Social Media unnötig viel.
- [ ] Druckformate: A4/A3 bei 300 dpi als eigene Presets neben den
  Bildschirm-Auflösungen.

### UI-Kleinkram

- [ ] Fehlermeldungen näher an der Ursache anzeigen. `#errorMsg` sitzt unter
  dem Download-Button in der rechten Spalte, die Fehler entstehen aber beim
  Datei-Upload in der linken.
- [ ] Download-Button-Breite an sehr schmale Formate (9:16) angleichen —
  aktuell bleibt er bei `max-width: 400px`, auch wenn das Vorschaubild
  schmaler ist.
- [ ] Vorschau auf Mobil zusätzlich `sticky` machen — sie steht jetzt oben,
  scrollt beim Bedienen der unteren Panels aber weg.
- [ ] Ladeanzeige für sehr große GPX-Dateien. Gemessen sind 60k Punkte in
  ~130 ms geparst, kritisch wird es erst im zweistelligen MB-Bereich.

## Technische Schulden

- [ ] Keine automatisierten Tests im Repo. Die Layout-Invarianten wurden zwar
  über 1680 Kombinationen geprüft, aber ad-hoc in der Browser-Konsole — nichts
  davon ist eingecheckt oder wiederholbar. Lohnendste Kandidaten:
  - `computePosterLayout()` — dass sich keine zwei Blöcke überlappen, nichts das
    Poster verlässt und die Ränder der Kennzahlen-Zeile gleich sind. Braucht nur
    einen Canvas-Kontext zum Messen von Text, kein DOM.
  - Reine Funktionen ohne jede Umgebung: `formatDistanceParts()`,
    `formatElevationParts()`, `formatDurationParts()`, `getCanvasSize()`,
    `haversine()`, `computeMetrics()`, `computeBounds()`,
    `computeElevationProfile()`, `pointInPolygonRings()`.
- [ ] Keine CI-Pipeline im GitHub-Repo (z. B. Lint/Build-Check bei Push).
- [ ] `app.js` ist auf ~1500 Zeilen gewachsen und mischt Parsing, Geometrie,
  Zeichnen und UI-Verdrahtung in einer Datei. Eine Aufteilung in Module würde
  erst mit einem Build-Schritt oder ES-Modulen sinnvoll — beides bisher bewusst
  vermieden.

## Bewusst nicht geplant

Damit diese Fragen nicht alle paar Monate neu diskutiert werden:

- **Frei wählbare Positionen für Track, Titel, Kennzahlen und Flaggen.** War kurz
  als 3×3-Picker umgesetzt und wurde wieder entfernt: vier Picker machten das
  Panel unübersichtlich, und frei kombinierbare Positionen lassen sich nicht
  gegen Überlappungen absichern. Stattdessen jetzt ein festes Layout, das die
  Blöcke garantiert kollisionsfrei stapelt.

- **FIT- und TCX-Import.** Alle relevanten Plattformen können GPX exportieren,
  es ist dort nur teils ein Klick mehr. FIT wäre zudem ein Binärformat und
  bräuchte entweder einen eigenen Parser oder eine Fremdbibliothek — Letzteres
  bricht die Abhängigkeitsfreiheit.
- **`rte`/`rtept` und `wpt` aus GPX lesen.** Gleiche Begründung: der Fokus
  bleibt auf aufgezeichneten Tracks.
- **Mehrere Tracks auf einem Poster.**
- **Poster ohne Hintergrundfoto** (einfarbig/Verlauf). Das Foto ist das
  Konzept der App, nicht nur eine Option.
- **Kartenhintergrund mit Straßen/Topografie.** Bräuchte Kartentiles aus dem
  Netz und würde das Versprechen "läuft komplett offline, keine Daten
  verlassen das Gerät" brechen.
- **Start-/Zielort-Namen per Reverse-Geocoding.** Würde Koordinaten an einen
  fremden Server schicken. Ginge nur mit einem gebündelten Offline-Ortsdatensatz.

---

Punkte gerne ergänzen, streichen oder umsortieren — das hier ist nur eine
Gedächtnisstütze, keine verbindliche Roadmap.
