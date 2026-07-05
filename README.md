# Location History Card

Eine schlanke Custom Lovelace Card für Home Assistant, die den **Bewegungspfad**
einer Person oder eines `device_tracker` für einen ausgewählten Tag auf einer
Karte zeichnet.

- ✅ Kein Add-on / Docker-Container
- ✅ Kein Build-Step, eine einzige `.js`-Datei
- ✅ Datums-Picker + ◀/▶ Tages-Navigation
- ✅ Auswahl zwischen mehreren Personen/Geräten
- ✅ Start-/Endpunkt farbig, Zwischenpunkte mit Uhrzeit-Popup
- ✅ Nutzt HA-Bordmittel: Recorder-History + OpenStreetMap

## Voraussetzungen

- Home Assistant OS / Supervised / Container / Core (egal — es ist reines Frontend)
- Der **Recorder** muss die `latitude`/`longitude`-Attribute deiner
  `person.*` / `device_tracker.*` Entitäten speichern (Standard bei der
  Companion App).

> Tipp: Standardmäßig behält der Recorder nur **10 Tage** History. Für längere
> Rückblicke in `configuration.yaml` anpassen:
> ```yaml
> recorder:
>   purge_keep_days: 90
> ```

## Installation (HA OS)

1. Datei `location-history-card.js` nach `/config/www/` kopieren
   (Ordner ggf. anlegen). Erreichbar dann unter `/local/location-history-card.js`.

2. Als Ressource registrieren:
   **Einstellungen → Dashboards → ⋮ (oben rechts) → Ressourcen → Ressource hinzufügen**
   - URL: `/local/location-history-card.js`
   - Typ: **JavaScript-Modul**

   *(Oder in YAML-Mode unter `lovelace:` → `resources:`.)*

3. Browser-Cache leeren / neu laden.

## Verwendung

Karte zu einem Dashboard hinzufügen (manuelle Karte / YAML):

```yaml
type: custom:location-history-card
title: Wo war wer?
entities:
  - person.alice
  - person.bob
default_entity: person.alice
height: 500        # optional, Karten-Höhe in px
zoom: 13           # optional, Fallback-Zoom
```

### Konfigurations-Optionen

| Option           | Typ      | Pflicht | Beschreibung                                             |
| ---------------- | -------- | ------- | ------------------------------------------------------- |
| `entities`       | Liste    | ja      | Eine oder mehrere `person.*` / `device_tracker.*` IDs.  |
| `default_entity` | String   | nein    | Beim Laden vorausgewählte Entität (Standard: erste).    |
| `title`          | String   | nein    | Überschrift der Karte.                                   |
| `height`         | Zahl     | nein    | Karten-Höhe in Pixeln (Standard: `450`).                |
| `zoom`           | Zahl     | nein    | Fallback-Zoomstufe, bevor Daten geladen sind.           |

## Troubleshooting

**Die Karte bleibt (teilweise) weiß / Kacheln fehlen**
Nach dem Aktualisieren der Datei cached der Home-Assistant-Service-Worker die
alte Version aggressiv. Lösung: die Ressourcen-URL mit einem Query-Parameter
versehen (z.B. `/local/location-history-card.js?v=2`), **Home Assistant neu
starten** und die Seite hart neu laden (`Strg`+`F5`).

**Keine Punkte für einen Tag**
- Prüfe, ob die Entität an dem Tag überhaupt GPS-Positionen hatte
  (Companion App aktiv, Standortfreigabe erteilt).
- Prüfe die Recorder-Aufbewahrung (`purge_keep_days`) — ältere Daten wurden
  evtl. schon gelöscht.

## Wie es funktioniert

Die Card ruft über die WebSocket-API `history/history_during_period` die
gespeicherten Zustände der gewählten Entität für den Tag ab, filtert alle
Einträge mit gültigen GPS-Koordinaten heraus und zeichnet sie als Pfad
(Leaflet + OpenStreetMap-Kacheln).

Leaflet wird bei Bedarf einmalig vom CDN (`unpkg.com`) nachgeladen.
