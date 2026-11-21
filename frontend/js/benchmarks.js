/**
 * Benchmarks page (benchmarks.html): data processing, charts, stat tiles,
 * data table and the page controller.
 */
import {
  CONFIG,
  cssVar,
  fetchBenchmarks,
  formatCompact,
  formatCount,
  formatDistance,
  formatDuration,
  formatPercent,
  formatRuntime,
  formatSpeedRatio,
  isMockMode,
  onColorSchemeChange,
  percentGap,
} from "./common.js";

/**
 * Pure data helpers for the benchmarks page: no DOM, no Chart.js.
 * Input is the `rows` array of a BenchmarkFile (docs/API_CONTRACT.md).
 */

function unique(values) {
  return [...new Set(values)];
}

function mean(values) {
  const valid = values.filter((value) => value !== null && value !== undefined && !Number.isNaN(value));
  if (valid.length === 0) return null;
  return valid.reduce((sum, value) => sum + value, 0) / valid.length;
}

/** Names of our algorithms, sorted, so colors stay stable between loads. */
function listOurAlgorithms(rows) {
  return unique(rows.filter((row) => row.system === "ours").map((row) => row.algorithm)).sort();
}

/** Display name of the OSRM rows (e.g. "OSRM trip"). */
function osrmName(rows) {
  const row = rows.find((item) => item.system === "osrm");
  return row ? row.algorithm : "OSRM";
}

function listStopCounts(rows) {
  return unique(rows.map((row) => row.num_stops)).sort((a, b) => a - b);
}

function addGaps(rows) {
  const osrmByCase = new Map(rows.filter((row) => row.system === "osrm").map((row) => [row.case_id, row]));
  const result = [];
  let skipped = 0;

  for (const row of rows) {
    const osrm = osrmByCase.get(row.case_id);
    if (!osrm) {
      skipped += 1;
      continue;
    }
    if (row.system === "osrm") {
      result.push({ ...row, distance_gap: null, duration_gap: null, runtime_ratio: null });
      continue;
    }
    result.push({
      ...row,
      distance_gap: percentGap(row.distance_m, osrm.distance_m),
      duration_gap: percentGap(row.duration_s, osrm.duration_s),
      runtime_ratio: osrm.runtime_ms > 0 ? row.runtime_ms / osrm.runtime_ms : null,
    });
  }
  return { rows: result, skipped };
}

/**
 * One series per algorithm: the average of `field` at each stop count.
 * @returns {{ name: string, values: (number|null)[] }[]}
 */
function averageSeries(rows, algorithms, stopCounts, field) {
  return algorithms.map((name) => ({
    name,
    values: stopCounts.map((count) =>
      mean(rows.filter((row) => row.algorithm === name && row.num_stops === count).map((row) => row[field])),
    ),
  }));
}

/** Numbers for the stat tiles, over our rows for the chosen algorithms. */
function summarize(rows, algorithms) {
  const ours = rows.filter((row) => row.system === "ours" && algorithms.includes(row.algorithm));
  const osrm = rows.filter((row) => row.system === "osrm");
  const stopCounts = listStopCounts(rows);

  return {
    cases: unique(rows.map((row) => row.case_id)).length,
    minStops: stopCounts[0],
    maxStops: stopCounts[stopCounts.length - 1],
    distanceGap: mean(ours.map((row) => row.distance_gap)),
    durationGap: mean(ours.map((row) => row.duration_gap)),
    oursRuntime: mean(ours.map((row) => row.runtime_ms)),
    osrmRuntime: mean(osrm.map((row) => row.runtime_ms)),
  };
}

/**
 * Builds the four Chart.js charts. Colors come from CSS variables
 * (css/style.css) via cssVar(), so nothing visual is hard-coded here except
 * chart geometry (bar thickness, line width, point size).
 *
 * Chart.js is loaded as a global `Chart` from benchmarks.html.
 */

/** Categorical slots for our algorithms. Slot 2 is reserved for OSRM. */
const OUR_SLOTS = [1, 3, 4, 5, 6, 7, 8];

let charts = [];

/**
 * Color follows the algorithm, never its position in a filtered list:
 * the index comes from the full, sorted list of our algorithms.
 */
function seriesColor(name, palette) {
  if (name === palette.osrmName) return cssVar("--series-2");
  const index = palette.allOurAlgorithms.indexOf(name);
  if (index < 0 || index >= OUR_SLOTS.length) return cssVar("--text-muted");
  return cssVar(`--series-${OUR_SLOTS[index]}`);
}

function themeColors() {
  return {
    surface: cssVar("--surface-1"),
    textPrimary: cssVar("--text-primary"),
    textSecondary: cssVar("--text-secondary"),
    textMuted: cssVar("--text-muted"),
    border: cssVar("--border"),
    gridline: cssVar("--gridline"),
    baseline: cssVar("--baseline"),
    font: cssVar("--font-sans"),
  };
}

/** Log-axis ticks: only label 1, 2 and 5 × 10ⁿ so the axis stays readable. */
function logTick(value) {
  const mantissa = Math.round(value / 10 ** Math.floor(Math.log10(value)));
  return [1, 2, 5].includes(mantissa) ? formatCompact(value) : "";
}

function baseOptions({ kind, yTitle, yTick, valueFormat, logY = false }) {
  const theme = themeColors();
  const keyStyle = kind === "bar" ? "rect" : "line";

  return {
    responsive: true,
    maintainAspectRatio: false,
    animation: { duration: 250 },
    interaction: { mode: "index", intersect: false },
    font: { family: theme.font },
    plugins: {
      legend: {
        position: "top",
        align: "start",
        labels: {
          color: theme.textSecondary,
          usePointStyle: true,
          pointStyle: keyStyle,
          padding: 16,
          font: { family: theme.font, size: 13 },
          // Chart.js colors line keys with the point's ring (surface) color;
          // use the series color and dash so the key mirrors the line.
          generateLabels: (chart) =>
            Chart.defaults.plugins.legend.labels.generateLabels(chart).map((item) => {
              const dataset = chart.data.datasets[item.datasetIndex];
              return {
                ...item,
                fillStyle: dataset.backgroundColor,
                strokeStyle: dataset.borderColor ?? dataset.backgroundColor,
                lineWidth: kind === "bar" ? 0 : 3,
                lineDash: dataset.borderDash ?? [],
                pointStyle: keyStyle,
              };
            }),
        },
      },
      tooltip: {
        backgroundColor: theme.surface,
        titleColor: theme.textSecondary,
        bodyColor: theme.textPrimary,
        borderColor: theme.border,
        borderWidth: 1,
        padding: 10,
        usePointStyle: true,
        titleFont: { family: theme.font, weight: "normal" },
        bodyFont: { family: theme.font, weight: "600" },
        callbacks: {
          title: (items) => `${items[0].label} stops`,
          // Value first, series name second.
          label: (item) => ` ${valueFormat(item.parsed.y)}   ${item.dataset.label}`,
          labelPointStyle: () => ({ pointStyle: keyStyle, rotation: 0 }),
          labelColor: (item) => {
            const color = item.dataset.borderColor ?? item.dataset.backgroundColor;
            return { borderColor: color, backgroundColor: color, borderWidth: 2 };
          },
        },
      },
    },
    scales: {
      x: {
        title: { display: true, text: "Number of stops", color: theme.textMuted, font: { family: theme.font } },
        grid: { display: false },
        border: { color: theme.baseline },
        ticks: { color: theme.textMuted, font: { family: theme.font } },
      },
      y: {
        type: logY ? "logarithmic" : "linear",
        beginAtZero: !logY,
        title: { display: true, text: yTitle, color: theme.textMuted, font: { family: theme.font } },
        grid: { color: theme.gridline },
        border: { display: false },
        ticks: { color: theme.textMuted, font: { family: theme.font }, callback: yTick },
      },
    },
  };
}

function barDatasets(series, palette) {
  return series.map(({ name, values }) => {
    const color = seriesColor(name, palette);
    return {
      label: name,
      data: values,
      backgroundColor: color,
      hoverBackgroundColor: color,
      borderRadius: 4,
      borderSkipped: "start",
      maxBarThickness: 24,
      barPercentage: 0.85,
      categoryPercentage: 0.7,
    };
  });
}

function lineDatasets(series, palette) {
  const surface = cssVar("--surface-1");
  return series.map(({ name, values }) => {
    const color = seriesColor(name, palette);
    const isOsrm = name === palette.osrmName;
    return {
      label: name,
      data: values,
      borderColor: color,
      backgroundColor: color,
      borderWidth: 2,
      borderDash: isOsrm ? [6, 4] : [],
      borderCapStyle: "round",
      borderJoinStyle: "round",
      pointRadius: 4,
      pointHoverRadius: 6,
      pointHitRadius: 12,
      pointBackgroundColor: color,
      pointBorderColor: surface,
      pointBorderWidth: 2,
      spanGaps: true,
    };
  });
}

function create(canvasId, type, labels, datasets, options) {
  const canvas = document.getElementById(canvasId);
  return new Chart(canvas, { type, data: { labels, datasets }, options });
}

function destroyCharts() {
  for (const chart of charts) {
    chart.destroy();
  }
  charts = [];
}

/**
 * @param {object} model  {
 *   stopCounts, palette: { allOurAlgorithms, osrmName },
 *   distanceGaps, durationGaps, runtime, nodes   // arrays of { name, values }
 * }
 */
function renderCharts(model) {
  destroyCharts();
  const labels = model.stopCounts.map(String);
  const percentTick = (value) => formatPercent(value, 0);

  charts.push(
    create("chart-distance", "bar", labels, barDatasets(model.distanceGaps, model.palette),
      baseOptions({ kind: "bar", yTitle: "% longer than OSRM", yTick: percentTick, valueFormat: (v) => formatPercent(v) })),

    create("chart-duration", "bar", labels, barDatasets(model.durationGaps, model.palette),
      baseOptions({ kind: "bar", yTitle: "% slower than OSRM", yTick: percentTick, valueFormat: (v) => formatPercent(v) })),

    create("chart-runtime", "line", labels, lineDatasets(model.runtime, model.palette),
      baseOptions({ kind: "line", yTitle: "Milliseconds (log scale)", yTick: logTick, valueFormat: formatRuntime, logY: true })),

    create("chart-nodes", "line", labels, lineDatasets(model.nodes, model.palette),
      baseOptions({ kind: "line", yTitle: "Nodes explored", yTick: formatCompact, valueFormat: formatCount })),
  );
}

/* ==========================================================================
   Stat tiles and page header line
   ========================================================================== */

/** Fills the page header line and the four stat tiles. */

function setStat(name, text) {
  document.querySelector(`[data-stat="${name}"]`).textContent = text;
}

function renderMeta(file) {
  const parts = [];
  if (file.area) parts.push(file.area);
  if (file.osrm_profile) parts.push(`OSRM ${file.osrm_profile} profile`);
  if (file.metric) parts.push(`optimizing ${file.metric === "distance" ? "distance" : "travel time"}`);
  if (file.generated_at) {
    const date = new Date(file.generated_at);
    if (!Number.isNaN(date.getTime())) {
      parts.push(`run ${date.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" })}`);
    }
  }
  document.getElementById("bench-meta").textContent = parts.join(" · ");
}

function renderSummary(summary) {
  setStat("cases", String(summary.cases));
  document.querySelector('[data-stat-note="cases"]').textContent =
    summary.minStops === summary.maxStops ? `${summary.minStops} stops each` : `${summary.minStops}–${summary.maxStops} stops per case`;
  setStat("distance", formatPercent(summary.distanceGap));
  setStat("duration", formatPercent(summary.durationGap));
  setStat("runtime", formatSpeedRatio(summary.oursRuntime, summary.osrmRuntime));
}

/* ==========================================================================
   Data table
   ========================================================================== */

/**
 * Renders the data table (the accessible, no-hover view of every value)
 * by cloning <template id="bench-row-template"> from benchmarks.html.
 */

function renderTable(rows) {
  const body = document.getElementById("bench-table-body");
  const template = document.getElementById("bench-row-template");

  const sorted = [...rows].sort(
    (a, b) =>
      a.num_stops - b.num_stops ||
      a.case_id.localeCompare(b.case_id) ||
      (a.system === "osrm") - (b.system === "osrm") ||
      a.algorithm.localeCompare(b.algorithm),
  );

  const items = sorted.map((row) => {
    const tr = template.content.firstElementChild.cloneNode(true);
    tr.dataset.system = row.system;
    const values = {
      case: row.case_id,
      stops: String(row.num_stops),
      algorithm: row.algorithm,
      distance: formatDistance(row.distance_m),
      "distance-gap": row.system === "osrm" ? "baseline" : formatPercent(row.distance_gap),
      duration: formatDuration(row.duration_s),
      "duration-gap": row.system === "osrm" ? "baseline" : formatPercent(row.duration_gap),
      runtime: formatRuntime(row.runtime_ms),
      nodes: formatCount(row.nodes_explored),
    };
    for (const cell of tr.querySelectorAll("[data-col]")) {
      cell.textContent = values[cell.dataset.col];
    }
    return tr;
  });

  body.replaceChildren(...items);
}

/* ==========================================================================
   Page controller: load, filter, render
   ========================================================================== */

/**
 * Benchmarks page controller: loads the BenchmarkFile, applies the
 * algorithm filter, and re-renders tiles, charts and table together.
 */

const filter = document.getElementById("algorithm-filter");
const content = document.getElementById("bench-content");
const statusLine = document.getElementById("status");
const modeBadge = document.getElementById("mode-badge");

let dataset = null; // { rows, allOurAlgorithms, osrmName, stopCounts }

function setStatus(message, tone = "info") {
  statusLine.textContent = message;
  statusLine.dataset.tone = tone;
}

function showMode() {
  const mock = isMockMode();
  modeBadge.dataset.mode = mock ? "mock" : "live";
  modeBadge.textContent = mock ? "Sample data" : "Live API";
  modeBadge.title = mock ? "Using the JSON files in /mock. Set useMock: false in js/common.js to use real results." : `Using ${CONFIG.benchmarksFile ?? CONFIG.apiBaseUrl}`;
}

function fillFilter(algorithms) {
  for (const name of algorithms) {
    filter.add(new Option(name, name));
  }
}

function selectedAlgorithms() {
  return filter.value === "all" ? dataset.allOurAlgorithms : [filter.value];
}

function render() {
  const algorithms = selectedAlgorithms();
  const { stopCounts } = dataset;
  const inScope = dataset.rows.filter((row) => row.system === "osrm" || algorithms.includes(row.algorithm));

  renderSummary(summarize(inScope, algorithms));

  renderCharts({
    stopCounts,
    palette: { allOurAlgorithms: dataset.allOurAlgorithms, osrmName: dataset.osrmName },
    distanceGaps: averageSeries(inScope, algorithms, stopCounts, "distance_gap"),
    durationGaps: averageSeries(inScope, algorithms, stopCounts, "duration_gap"),
    runtime: averageSeries(inScope, [...algorithms, dataset.osrmName], stopCounts, "runtime_ms"),
    nodes: averageSeries(inScope, algorithms, stopCounts, "nodes_explored"),
  });

  renderTable(inScope);
}

async function start() {
  showMode();
  setStatus("Loading benchmark results…");

  try {
    const file = await fetchBenchmarks();
    const { rows, skipped } = addGaps(file.rows);
    if (rows.length === 0) {
      throw new Error("No usable benchmark rows. Every case_id needs an OSRM row.");
    }

    dataset = {
      rows,
      allOurAlgorithms: listOurAlgorithms(rows),
      osrmName: osrmName(rows),
      stopCounts: listStopCounts(rows),
    };

    renderMeta(file);
    fillFilter(dataset.allOurAlgorithms);
    content.hidden = false;
    render();

    setStatus(skipped > 0 ? `${skipped} rows were skipped because their case has no OSRM row.` : "");
  } catch (error) {
    setStatus(error.message, "error");
  }
}

filter.addEventListener("change", render);
onColorSchemeChange(() => {
  if (dataset) render();
});

start();
