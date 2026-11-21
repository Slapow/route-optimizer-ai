/**
 * Route planner page (index.html): map, stop list, results table and the
 * controller that wires them together.
 */
import {
  CONFIG,
  fetchSampleStops,
  formatCoords,
  formatCount,
  formatDistance,
  formatDuration,
  formatPercent,
  formatRuntime,
  formatSpeedRatio,
  isMockMode,
  optimizeRoute,
  percentGap,
} from "./common.js";

/**
 * Everything Leaflet-related for the route planner. Styling of markers and
 * route lines is done with CSS classes (see css/style.css), not here.
 *
 * Leaflet is loaded as a global `L` from index.html.
 */

const MARKER_SIZE = 28;

class MapView {
  /**
   * @param {string} elementId  id of the map container
   * @param {object} handlers   { onMapClick(lat, lon), onStopMoved(id, lat, lon) }
   */
  constructor(elementId, handlers) {
    this.handlers = handlers;
    this.markers = new Map();
    this.routeLayers = new Map();

    this.map = L.map(elementId, { zoomControl: true }).setView(CONFIG.map.center, CONFIG.map.zoom);

    L.tileLayer(CONFIG.map.tileUrl, {
      maxZoom: CONFIG.map.maxZoom,
      attribution: CONFIG.map.attribution,
    }).addTo(this.map);

    this.map.on("click", (event) => {
      this.handlers.onMapClick(event.latlng.lat, event.latlng.lng);
    });
  }

  /** Redraw all stop markers. `stops` is [{ id, lat, lon }], first = start. */
  setStops(stops) {
    for (const marker of this.markers.values()) {
      marker.remove();
    }
    this.markers.clear();

    stops.forEach((stop, index) => {
      const marker = L.marker([stop.lat, stop.lon], {
        icon: this.createIcon(index + 1, index === 0),
        draggable: true,
        keyboard: true,
        title: index === 0 ? `Stop ${index + 1} (start)` : `Stop ${index + 1}`,
        riseOnHover: true,
      });

      marker.on("dragend", () => {
        const { lat, lng } = marker.getLatLng();
        this.handlers.onStopMoved(stop.id, lat, lng);
      });

      marker.addTo(this.map);
      this.markers.set(stop.id, marker);
    });
  }

  createIcon(number, isStart) {
    const label = document.createElement("span");
    label.textContent = String(number);

    return L.divIcon({
      className: isStart ? "stop-marker stop-marker--start" : "stop-marker",
      html: label,
      iconSize: [MARKER_SIZE, MARKER_SIZE],
      iconAnchor: [MARKER_SIZE / 2, MARKER_SIZE / 2],
    });
  }

  /** Draw both routes. `results` is the `results` object from the API. */
  showRoutes(results) {
    this.clearRoutes();

    for (const system of ["ours", "osrm"]) {
      const result = results[system];
      if (!result) continue;

      const line = L.polyline(result.geometry, {
        className: `route-line route-line--${system}`,
        interactive: false,
      });
      this.routeLayers.set(system, line);
    }

    // Draw ours underneath, OSRM's dashed line on top.
    this.routeLayers.get("ours")?.addTo(this.map);
    this.routeLayers.get("osrm")?.addTo(this.map);
  }

  setRouteVisible(system, visible) {
    const layer = this.routeLayers.get(system);
    if (!layer) return;
    if (visible) {
      layer.addTo(this.map);
    } else {
      layer.remove();
    }
  }

  clearRoutes() {
    for (const layer of this.routeLayers.values()) {
      layer.remove();
    }
    this.routeLayers.clear();
  }

  /** Zoom to show every stop and route. */
  fitToContent() {
    const bounds = L.latLngBounds([]);
    for (const marker of this.markers.values()) {
      bounds.extend(marker.getLatLng());
    }
    for (const layer of this.routeLayers.values()) {
      bounds.extend(layer.getBounds());
    }
    if (bounds.isValid()) {
      this.map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
    }
  }
}

/**
 * Renders the stop list in the side panel by cloning the
 * <template id="stop-item-template"> defined in index.html.
 */

class StopList {
  /** @param {object} handlers  { onRemove(id) } */
  constructor(handlers) {
    this.handlers = handlers;
    this.list = document.getElementById("stop-list");
    this.empty = document.getElementById("stop-empty");
    this.count = document.getElementById("stop-count");
    this.template = document.getElementById("stop-item-template");
  }

  render(stops) {
    const items = stops.map((stop, index) => this.createItem(stop, index));
    this.list.replaceChildren(...items);
    this.empty.hidden = stops.length > 0;
    this.count.textContent = `${stops.length} / ${CONFIG.maxStops}`;
  }

  createItem(stop, index) {
    const item = this.template.content.firstElementChild.cloneNode(true);
    const isStart = index === 0;
    const name = isStart ? `Stop ${index + 1} (start)` : `Stop ${index + 1}`;

    item.classList.toggle("stop-item--start", isStart);
    item.querySelector(".stop-item__badge").textContent = String(index + 1);
    item.querySelector(".stop-item__name").textContent = name;
    item.querySelector(".stop-item__coords").textContent = formatCoords(stop.lat, stop.lon);

    const remove = item.querySelector(".stop-item__remove");
    remove.setAttribute("aria-label", `Remove ${name}`);
    remove.addEventListener("click", () => this.handlers.onRemove(stop.id));

    return item;
  }
}

/**
 * Fills the "Ours vs OSRM" table. The table itself is written in index.html;
 * this module only puts text into cells marked with data-system/data-field.
 */

class ResultsPanel {
  /** @param {object} handlers  { onToggleLayer(system, visible) } */
  constructor(handlers) {
    this.root = document.getElementById("results");
    this.breakdown = document.getElementById("breakdown");

    for (const toggle of this.root.querySelectorAll("[data-layer]")) {
      toggle.addEventListener("change", () => {
        handlers.onToggleLayer(toggle.dataset.layer, toggle.checked);
      });
    }
  }

  cell(system, field) {
    return this.root.querySelector(`[data-system="${system}"][data-field="${field}"]`);
  }

  setText(system, field, text) {
    this.cell(system, field).textContent = text;
  }

  /**
   * @param {object} response  the full /api/optimize response
   */
  show(response) {
    const { ours, osrm } = response.results;
    const numberById = new Map(response.stops.map((stop, index) => [stop.id, index + 1]));

    this.setText("ours", "algorithm", ours.algorithm);
    this.setText("osrm", "algorithm", osrm.algorithm);

    for (const [system, result] of [["ours", ours], ["osrm", osrm]]) {
      this.setText(system, "distance", formatDistance(result.distance_m));
      this.setText(system, "duration", formatDuration(result.duration_s));
      this.setText(system, "runtime", formatRuntime(result.runtime_ms));
      this.setText(system, "nodes", formatCount(result.nodes_explored));
      this.setText(system, "order", this.formatOrder(result.order, numberById, response.round_trip));
    }

    this.setText("diff", "distance", formatPercent(percentGap(ours.distance_m, osrm.distance_m)));
    this.setText("diff", "duration", formatPercent(percentGap(ours.duration_s, osrm.duration_s)));
    this.setText("diff", "runtime", formatSpeedRatio(ours.runtime_ms, osrm.runtime_ms));
    this.setText("diff", "nodes", "—");

    this.showBreakdown(ours.runtime_breakdown_ms);

    // A fresh result means both routes are drawn, so reset the toggles.
    for (const toggle of this.root.querySelectorAll("[data-layer]")) {
      toggle.checked = true;
    }

    this.root.dataset.stale = "false";
    this.root.hidden = false;
  }

  formatOrder(order, numberById, roundTrip) {
    const numbers = order.map((id) => numberById.get(id) ?? id);
    if (roundTrip && numbers.length > 0) {
      numbers.push(numbers[0]);
    }
    return numbers.join(" → ");
  }

  showBreakdown(breakdown) {
    if (!breakdown) {
      this.breakdown.hidden = true;
      return;
    }
    for (const element of this.breakdown.querySelectorAll("[data-breakdown]")) {
      element.textContent = formatRuntime(breakdown[element.dataset.breakdown]);
    }
    this.breakdown.hidden = false;
  }

  /** Dim the results when the stops have changed since they were computed. */
  markStale() {
    if (!this.root.hidden) {
      this.root.dataset.stale = "true";
    }
  }

  hide() {
    this.root.hidden = true;
  }
}

/**
 * Route planner page controller: holds the list of stops and wires the
 * map, stop list, form and results panel together.
 */

const state = {
  stops: [], // [{ id, lat, lon }], first = start
  nextId: 1,
  busy: false,
};

const form = document.getElementById("route-form");
const optimizeButton = document.getElementById("optimize-button");
const sampleButton = document.getElementById("sample-button");
const clearButton = document.getElementById("clear-button");
const statusLine = document.getElementById("status");
const modeBadge = document.getElementById("mode-badge");

const mapView = new MapView("map", {
  onMapClick: addStop,
  onStopMoved: moveStop,
});

const stopList = new StopList({ onRemove: removeStop });

const resultsPanel = new ResultsPanel({
  onToggleLayer: (system, visible) => mapView.setRouteVisible(system, visible),
});

/* ---------- Status ---------- */

function setStatus(message, tone = "info") {
  statusLine.textContent = message;
  statusLine.dataset.tone = tone;
  if (tone === "error") {
    statusLine.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
}

function showMode() {
  const mock = isMockMode();
  modeBadge.dataset.mode = mock ? "mock" : "live";
  modeBadge.textContent = mock ? "Sample data" : "Live API";
  modeBadge.title = mock ? "Using the JSON files in /mock. Set useMock: false in js/common.js to use the API." : `Using ${CONFIG.apiBaseUrl}`;
}

/* ---------- Stops ---------- */

function newStopId() {
  const id = `s${state.nextId}`;
  state.nextId += 1;
  return id;
}

/** Called whenever the stops change: redraw and invalidate old results. */
function stopsChanged() {
  stopList.render(state.stops);
  mapView.setStops(state.stops);
  mapView.clearRoutes();
  resultsPanel.markStale();
  updateButtons();
}

function addStop(lat, lon) {
  if (state.busy) return;
  if (state.stops.length >= CONFIG.maxStops) {
    setStatus(`You can add up to ${CONFIG.maxStops} stops.`, "error");
    return;
  }
  state.stops.push({ id: newStopId(), lat, lon });
  setStatus(state.stops.length < 2 ? "Add at least one more stop." : "");
  stopsChanged();
}

function moveStop(id, lat, lon) {
  const stop = state.stops.find((item) => item.id === id);
  if (!stop) return;
  stop.lat = lat;
  stop.lon = lon;
  stopsChanged();
}

function removeStop(id) {
  state.stops = state.stops.filter((stop) => stop.id !== id);
  setStatus("");
  stopsChanged();
}

function setStops(stops) {
  state.stops = stops.map((stop) => ({ id: stop.id, lat: stop.lat, lon: stop.lon }));
  const highest = Math.max(0, ...state.stops.map((stop) => Number.parseInt(stop.id.slice(1), 10) || 0));
  state.nextId = highest + 1;
}

function clearAll() {
  state.stops = [];
  stopsChanged();
  resultsPanel.hide();
  setStatus("");
}

async function loadSampleStops() {
  try {
    setStops(await fetchSampleStops());
    stopsChanged();
    mapView.fitToContent();
    setStatus("Sample stops loaded. Press Optimize route.");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

/* ---------- Optimize ---------- */

function updateButtons() {
  optimizeButton.disabled = state.busy || state.stops.length < 2;
  sampleButton.disabled = state.busy;
  clearButton.disabled = state.busy || state.stops.length === 0;
}

function setBusy(busy) {
  state.busy = busy;
  form.setAttribute("aria-busy", String(busy));
  optimizeButton.textContent = busy ? "Optimizing…" : "Optimize route";
  updateButtons();
}

function buildRequest() {
  const data = new FormData(form);
  return {
    stops: state.stops.map(({ id, lat, lon }) => ({ id, lat, lon })),
    algorithm: data.get("algorithm"),
    metric: data.get("metric"),
    round_trip: data.get("round_trip") === "on",
  };
}

async function handleOptimize(event) {
  event.preventDefault();
  if (state.busy || state.stops.length < 2) return;

  setBusy(true);
  setStatus("Finding the best route…");

  try {
    const response = await optimizeRoute(buildRequest());

    // The backend echoes the stops (possibly snapped to roads); use them.
    setStops(response.stops);
    stopList.render(state.stops);
    mapView.setStops(state.stops);
    mapView.showRoutes(response.results);
    mapView.fitToContent();
    resultsPanel.show(response);

    setStatus(isMockMode() ? "Showing the sample result. In sample-data mode your own stops are replaced by the sample stops." : "Route found.", isMockMode() ? "info" : "success");
  } catch (error) {
    setStatus(error.message, "error");
  } finally {
    setBusy(false);
  }
}

/* ---------- Start ---------- */

form.addEventListener("submit", handleOptimize);
sampleButton.addEventListener("click", loadSampleStops);
clearButton.addEventListener("click", clearAll);

showMode();
stopsChanged();
