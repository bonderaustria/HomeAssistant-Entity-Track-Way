/**
 * Location History Card for Home Assistant
 * ----------------------------------------
 * Lightweight custom Lovelace card that draws the movement path of a
 * person / device_tracker for a chosen day on a Leaflet map.
 *
 * No build step, no add-on, single file. Uses HA's history WebSocket API.
 *
 * Example config:
 *   type: custom:location-history-card
 *   title: Wo war wer?
 *   entities:
 *     - person.alice
 *     - person.bob
 *   default_entity: person.alice
 *   height: 500        # map height in px (optional)
 *   zoom: 13           # fallback zoom (optional)
 */

const LEAFLET_CSS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
const LEAFLET_JS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";

// Load Leaflet once, shared across all card instances.
let _leafletPromise = null;
function loadLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (_leafletPromise) return _leafletPromise;

  _leafletPromise = new Promise((resolve, reject) => {
    if (!document.querySelector(`link[href="${LEAFLET_CSS}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = LEAFLET_CSS;
      document.head.appendChild(link);
    }
    const script = document.createElement("script");
    script.src = LEAFLET_JS;
    script.onload = () => resolve(window.L);
    script.onerror = () => reject(new Error("Leaflet konnte nicht geladen werden"));
    document.head.appendChild(script);
  });
  return _leafletPromise;
}

function todayISO() {
  const d = new Date();
  const off = d.getTimezoneOffset();
  return new Date(d.getTime() - off * 60000).toISOString().slice(0, 10);
}

function fmtTime(ts) {
  return new Date(ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

class LocationHistoryCard extends HTMLElement {
  constructor() {
    super();
    this.attachShadow({ mode: "open" });
    this._config = {};
    this._hass = null;
    this._map = null;
    this._layer = null;
    this._selectedEntity = null;
    this._selectedDate = todayISO();
    this._rendered = false;
    this._loading = false;
  }

  setConfig(config) {
    if (!config.entities || !Array.isArray(config.entities) || config.entities.length === 0) {
      throw new Error("Bitte mindestens eine Entität unter 'entities' angeben.");
    }
    this._config = config;
    this._selectedEntity = config.default_entity || config.entities[0];
    this._buildUI();
  }

  set hass(hass) {
    const first = !this._hass;
    this._hass = hass;
    if (first && this._rendered) {
      // First hass after UI built -> load initial data.
      this._loadAndDraw();
    }
  }

  getCardSize() {
    return 6;
  }

  _buildUI() {
    const height = this._config.height || 450;
    this.shadowRoot.innerHTML = `
      <style>
        ha-card { overflow: hidden; }
        .header {
          display: flex; flex-wrap: wrap; gap: 8px; align-items: center;
          padding: 12px 16px; border-bottom: 1px solid var(--divider-color, #e0e0e0);
        }
        .title { font-size: 1.1rem; font-weight: 500; margin-right: auto; }
        select, input[type="date"], button {
          font-size: 0.9rem; padding: 6px 8px; border-radius: 6px;
          border: 1px solid var(--divider-color, #ccc);
          background: var(--card-background-color, #fff);
          color: var(--primary-text-color, #000);
        }
        button { cursor: pointer; }
        button:hover { background: var(--secondary-background-color, #f0f0f0); }
        #map { width: 100%; height: ${height}px; background: #eee; }
        .info {
          padding: 6px 16px; font-size: 0.85rem;
          color: var(--secondary-text-color, #666);
          border-top: 1px solid var(--divider-color, #e0e0e0);
        }
      </style>
      <ha-card>
        <div class="header">
          ${this._config.title ? `<span class="title">${this._config.title}</span>` : ""}
          <select id="entity"></select>
          <button id="prev" title="Vorheriger Tag">◀</button>
          <input type="date" id="date" value="${this._selectedDate}" max="${todayISO()}" />
          <button id="next" title="Nächster Tag">▶</button>
        </div>
        <div id="map"></div>
        <div class="info" id="info">Lade…</div>
      </ha-card>
    `;

    const sel = this.shadowRoot.getElementById("entity");
    for (const e of this._config.entities) {
      const opt = document.createElement("option");
      opt.value = e;
      opt.textContent = e;
      if (e === this._selectedEntity) opt.selected = true;
      sel.appendChild(opt);
    }
    sel.addEventListener("change", (ev) => {
      this._selectedEntity = ev.target.value;
      this._loadAndDraw();
    });

    const dateInput = this.shadowRoot.getElementById("date");
    dateInput.addEventListener("change", (ev) => {
      this._selectedDate = ev.target.value;
      this._loadAndDraw();
    });

    this.shadowRoot.getElementById("prev").addEventListener("click", () => this._shiftDay(-1));
    this.shadowRoot.getElementById("next").addEventListener("click", () => this._shiftDay(1));

    this._rendered = true;
    if (this._hass) this._loadAndDraw();
  }

  _shiftDay(delta) {
    const d = new Date(this._selectedDate + "T12:00:00");
    d.setDate(d.getDate() + delta);
    const iso = d.toISOString().slice(0, 10);
    if (iso > todayISO()) return;
    this._selectedDate = iso;
    this.shadowRoot.getElementById("date").value = iso;
    this._loadAndDraw();
  }

  _setInfo(text) {
    const el = this.shadowRoot.getElementById("info");
    if (el) el.textContent = text;
  }

  _injectLeafletCss() {
    // The map lives in this Shadow DOM; CSS from document.head does NOT reach
    // it, so Leaflet tiles get no position:absolute and render as scattered
    // blocks on white. Inject the stylesheet into the shadow root itself.
    if (this.shadowRoot.querySelector('link[data-leaflet]')) return;
    const link = document.createElement("link");
    link.rel = "stylesheet";
    link.href = LEAFLET_CSS;
    link.setAttribute("data-leaflet", "");
    this.shadowRoot.appendChild(link);
  }

  async _ensureMap() {
    if (this._map) return;
    const L = await loadLeaflet();
    this._injectLeafletCss();
    const el = this.shadowRoot.getElementById("map");
    this._map = L.map(el, { zoomControl: true }).setView([51.1657, 10.4515], this._config.zoom || 6);
    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "© OpenStreetMap",
    }).addTo(this._map);
    this._layer = L.layerGroup().addTo(this._map);

    // Leaflet renders "half white" when the container size changes after init
    // (very common inside Lovelace). Recalculate on every resize + a few
    // delayed passes after first render.
    this._ro = new ResizeObserver(() => {
      if (this._map) this._map.invalidateSize(false);
    });
    this._ro.observe(el);
    [50, 250, 600, 1200].forEach((t) =>
      setTimeout(() => this._map && this._map.invalidateSize(false), t)
    );
  }

  disconnectedCallback() {
    if (this._ro) {
      this._ro.disconnect();
      this._ro = null;
    }
  }

  connectedCallback() {
    // Card may have been re-attached (tab switch) -> size likely changed.
    if (this._map) setTimeout(() => this._map.invalidateSize(false), 50);
  }

  async _loadAndDraw() {
    if (!this._hass || !this._rendered || this._loading) return;
    this._loading = true;
    try {
      await this._ensureMap();
      this._setInfo("Lade Positions-Historie…");

      const start = new Date(this._selectedDate + "T00:00:00");
      const end = new Date(this._selectedDate + "T23:59:59.999");

      const result = await this._hass.callWS({
        type: "history/history_during_period",
        start_time: start.toISOString(),
        end_time: end.toISOString(),
        entity_ids: [this._selectedEntity],
        minimal_response: false,
        no_attributes: false,
      });

      const raw = result[this._selectedEntity] || [];
      const points = this._extractPoints(raw);
      this._draw(points);
    } catch (err) {
      console.error("location-history-card:", err);
      this._setInfo("Fehler beim Laden: " + err.message);
    } finally {
      this._loading = false;
    }
  }

  // The history WS returns compressed states: attributes only appear when
  // they change, so we carry them forward.
  _extractPoints(raw) {
    const points = [];
    let lastAttrs = {};
    for (const item of raw) {
      const attrs = item.a || {};
      lastAttrs = { ...lastAttrs, ...attrs };
      const lat = lastAttrs.latitude;
      const lng = lastAttrs.longitude;
      const ts = (item.lu || item.lc) * 1000;
      if (typeof lat === "number" && typeof lng === "number") {
        points.push({ lat, lng, ts, state: item.s, gps_accuracy: lastAttrs.gps_accuracy });
      }
    }
    return points;
  }

  async _draw(points) {
    const L = await loadLeaflet();
    this._layer.clearLayers();

    if (points.length === 0) {
      this._setInfo("Keine Positionsdaten für diesen Tag gefunden.");
      return;
    }

    const latlngs = points.map((p) => [p.lat, p.lng]);

    // Path
    L.polyline(latlngs, { color: "#03a9f4", weight: 4, opacity: 0.8 }).addTo(this._layer);

    // Intermediate points
    points.forEach((p, i) => {
      const isFirst = i === 0;
      const isLast = i === points.length - 1;
      const color = isFirst ? "#4caf50" : isLast ? "#f44336" : "#03a9f4";
      const radius = isFirst || isLast ? 8 : 4;
      L.circleMarker([p.lat, p.lng], {
        radius,
        color: "#fff",
        weight: 2,
        fillColor: color,
        fillOpacity: 1,
      })
        .bindPopup(
          `<b>${fmtTime(p.ts)}</b><br>${p.state || ""}` +
            (p.gps_accuracy != null ? `<br>±${Math.round(p.gps_accuracy)} m` : "")
        )
        .addTo(this._layer);
    });

    this._map.invalidateSize(false);
    this._map.fitBounds(L.latLngBounds(latlngs).pad(0.15));
    setTimeout(() => this._map && this._map.invalidateSize(false), 200);

    const first = points[0];
    const last = points[points.length - 1];
    this._setInfo(
      `${points.length} Punkte · von ${fmtTime(first.ts)} bis ${fmtTime(last.ts)}`
    );
  }
}

customElements.define("location-history-card", LocationHistoryCard);

// Register in the card picker.
window.customCards = window.customCards || [];
window.customCards.push({
  type: "location-history-card",
  name: "Location History Card",
  description: "Zeigt den Bewegungspfad einer Person/eines Geräts für einen Tag auf der Karte.",
});

console.info("%c LOCATION-HISTORY-CARD %c v1.2.0 ", "background:#03a9f4;color:#fff", "background:#555;color:#fff");
