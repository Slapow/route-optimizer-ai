/**
 * Front-end settings. These are the only values you should need to change
 * to connect the pages to the Python backend.
 *
 * Mock mode can also be switched per page load with a URL parameter:
 *   index.html?mock=0  -> use the live API
 *   index.html?mock=1  -> use the sample JSON in /mock
 */
export const CONFIG = {
  /** true = read sample JSON from /mock, false = call the Python API. */
  useMock: true,

  /** Where the Python API (Flask/FastAPI) is running. */
  apiBaseUrl: "http://localhost:8000",

  endpoints: {
    optimize: "/api/optimize",
    benchmarks: "/api/benchmarks",
  },

  /**
   * Optional: load benchmark results from a static JSON file instead of the
   * API, e.g. "data/benchmarks.json". Leave as null to use the API endpoint.
   */
  benchmarksFile: null,

  mockFiles: {
    optimize: "mock/optimize.json",
    benchmarks: "mock/benchmarks.json",
  },

  maxStops: 25,

  map: {
    center: [41.8819, -87.6278],
    zoom: 14,
    maxZoom: 19,
    tileUrl: "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
    // Leaflet requires the attribution as an HTML string.
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  },
};

/**
 * All network access lives here. Pages call these functions and never use
 * fetch() directly, so switching between mock data and the live API is a
 * single setting in CONFIG above.
 *
 * The data shapes are documented in docs/API_CONTRACT.md.
 */

/** Mock mode from the URL (?mock=0 / ?mock=1) or, failing that, CONFIG.useMock. */
export function isMockMode() {
  const param = new URLSearchParams(window.location.search).get("mock");
  if (param === "1" || param === "true") return true;
  if (param === "0" || param === "false") return false;
  return CONFIG.useMock;
}

async function requestJson(url, options = {}) {
  let response;
  try {
    response = await fetch(url, options);
  } catch {
    throw new Error(`Could not reach ${url}. Is the server running, and does it allow CORS?`);
  }

  let body = null;
  try {
    body = await response.json();
  } catch {
    // Not JSON; handled below.
  }

  if (!response.ok) {
    const message = body && typeof body.error === "string" ? body.error : `Request failed (${response.status} ${response.statusText})`;
    throw new Error(message);
  }
  if (body === null) {
    throw new Error(`${url} did not return JSON.`);
  }
  return body;
}

/* ---------- Response checks ----------
   These give teammates a clear message when the backend's JSON doesn't match
   the contract, instead of a blank map or a cryptic TypeError. */

const ROUTE_FIELDS = ["system", "algorithm", "order", "distance_m", "duration_s", "runtime_ms", "nodes_explored", "geometry"];

function checkRouteResult(result, name) {
  if (!result || typeof result !== "object") {
    throw new Error(`Response is missing results.${name}.`);
  }
  for (const field of ROUTE_FIELDS) {
    if (!(field in result)) {
      throw new Error(`Response is missing results.${name}.${field}.`);
    }
  }
  if (!Array.isArray(result.geometry) || result.geometry.length < 2) {
    throw new Error(`results.${name}.geometry must be a list of at least two [lat, lon] points.`);
  }
  const [lat, lon] = result.geometry[0];
  if (Math.abs(lat) > 90 || Math.abs(lon) > 180) {
    throw new Error(`results.${name}.geometry has an invalid point. Coordinates must be [lat, lon].`);
  }
}

export function checkOptimizeResponse(data) {
  if (!data || !Array.isArray(data.stops)) {
    throw new Error("Response is missing the stops list.");
  }
  if (!data.results) {
    throw new Error("Response is missing results.");
  }
  checkRouteResult(data.results.ours, "ours");
  checkRouteResult(data.results.osrm, "osrm");
  return data;
}

export function checkBenchmarkFile(data) {
  if (!data || !Array.isArray(data.rows)) {
    throw new Error("Benchmark file is missing the rows list.");
  }
  const required = ["case_id", "num_stops", "system", "algorithm", "distance_m", "duration_s", "runtime_ms"];
  data.rows.forEach((row, index) => {
    for (const field of required) {
      if (!(field in row)) {
        throw new Error(`Benchmark row ${index} is missing ${field}.`);
      }
    }
  });
  return data;
}

/* ---------- Public API ---------- */

/**
 * Ask the backend to optimize a route.
 * In mock mode the request is ignored and the sample result is returned.
 */
export async function optimizeRoute(request) {
  const data = isMockMode()
    ? await requestJson(CONFIG.mockFiles.optimize)
    : await requestJson(CONFIG.apiBaseUrl + CONFIG.endpoints.optimize, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });
  return checkOptimizeResponse(data);
}

/** Load benchmark results (mock file, static file, or API). */
export async function fetchBenchmarks() {
  let url;
  if (isMockMode()) {
    url = CONFIG.mockFiles.benchmarks;
  } else if (CONFIG.benchmarksFile) {
    url = CONFIG.benchmarksFile;
  } else {
    url = CONFIG.apiBaseUrl + CONFIG.endpoints.benchmarks;
  }
  return checkBenchmarkFile(await requestJson(url));
}

/** The stops from the sample file, for the "Load sample stops" button. */
export async function fetchSampleStops() {
  const data = await requestJson(CONFIG.mockFiles.optimize);
  return data.stops;
}

/** Number formatting shared by both pages. Every function returns plain text. */

const DASH = "—";
const MINUS = "−";

function isMissing(value) {
  return value === null || value === undefined || Number.isNaN(value);
}

export function formatDistance(meters) {
  if (isMissing(meters)) return DASH;
  if (meters < 1000) return `${Math.round(meters)} m`;
  return `${(meters / 1000).toFixed(2)} km`;
}

export function formatDuration(seconds) {
  if (isMissing(seconds)) return DASH;
  const total = Math.round(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hours > 0) return `${hours} h ${minutes} min`;
  if (minutes > 0) return `${minutes} min ${secs} s`;
  return `${secs} s`;
}

export function formatRuntime(ms) {
  if (isMissing(ms)) return DASH;
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`;
  if (ms >= 100) return `${Math.round(ms)} ms`;
  return `${ms.toFixed(1)} ms`;
}

export function formatCount(value) {
  if (isMissing(value)) return DASH;
  return Math.round(value).toLocaleString("en-US");
}

/** 1,284 / 12.9K / 4.2M - for axis ticks. */
export function formatCompact(value) {
  if (isMissing(value)) return DASH;
  return new Intl.NumberFormat("en-US", { notation: "compact", maximumFractionDigits: 1 }).format(value);
}

/** Signed percentage, e.g. "+3.2%", "−1.0%", "0.0%". */
export function formatPercent(value, digits = 1) {
  if (isMissing(value)) return DASH;
  const rounded = Number(value.toFixed(digits));
  if (rounded === 0) return `${(0).toFixed(digits)}%`;
  const sign = rounded > 0 ? "+" : MINUS;
  return `${sign}${Math.abs(rounded).toFixed(digits)}%`;
}

/** How our runtime compares with OSRM's, e.g. "15.6× slower". */
export function formatSpeedRatio(ours, reference) {
  if (isMissing(ours) || isMissing(reference) || ours <= 0 || reference <= 0) return DASH;
  const ratio = ours / reference;
  if (Math.abs(ratio - 1) < 0.05) return "about the same";
  return ratio > 1 ? `${ratio.toFixed(1)}× slower` : `${(1 / ratio).toFixed(1)}× faster`;
}

/** Percentage difference of value from reference. */
export function percentGap(value, reference) {
  if (isMissing(value) || isMissing(reference) || reference === 0) return null;
  return ((value - reference) / reference) * 100;
}

export function formatCoords(lat, lon) {
  return `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
}

/**
 * Reads colors from the CSS custom properties in css/style.css, so Chart.js
 * and Leaflet use the same colors as the stylesheet. Never hard-code a color
 * in JavaScript; add a variable to style.css instead.
 */

export function cssVar(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

/** Calls back when the OS switches between light and dark mode. */
export function onColorSchemeChange(callback) {
  const query = window.matchMedia("(prefers-color-scheme: dark)");
  query.addEventListener("change", callback);
}
