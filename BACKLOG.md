# Backlog

Ideen und offene Punkte für später — keine davon ist aktuell in Arbeit.

## Geplant

- [ ] **Mehrsprachigkeit (i18n)**: UI-Texte (Labels, Hinweise, Fehlermeldungen) und
  ggf. die Poster-Beschriftung (z. B. Einheiten, Datumsformat) in mehreren
  Sprachen anbieten. Vermutlich per Sprachauswahl im UI, mit Deutsch/Englisch
  als Start.

## Mögliche Verbesserungen

- [ ] Entfernung ohne Nachkommastelle anzeigen (z. B. "183 km" statt "183.4 km").
- [ ] GPX-Import erweitern: aktuell werden nur `trkpt` (Track-Punkte)
  gelesen — `rte`/`rtept` (Routen) und `wpt` (Wegpunkte) werden ignoriert.
- [ ] Download-Button-Breite an sehr schmale Formate (9:16) angleichen —
  aktuell bleibt er bei einer festen Breite, auch wenn das Vorschaubild
  schmaler ist.
- [ ] Barrierefreiheit: Tastaturbedienung/ARIA-Labels für die Toggle-Switches
  und den Format-Umschalter verbessern.
- [ ] Ladeanzeige für sehr große GPX-Dateien (aktuell kein Fortschrittsindikator
  während des Parsens).
- [ ] Eigene/freie Export-Auflösung statt nur der vier festen Formate.

## Technische Schulden

- [ ] Keine automatisierten Tests (aktuell nur manuell im Browser geprüft).
- [ ] Keine CI-Pipeline im GitHub-Repo (z. B. Lint/Build-Check bei Push).

---

Punkte gerne ergänzen, streichen oder umsortieren — das hier ist nur ein
Gedächtnisstütze, keine verbindliche Roadmap.
