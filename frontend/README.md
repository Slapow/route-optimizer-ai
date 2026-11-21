# Front end

A plain HTML/CSS/JavaScript site with two pages:

- **`index.html`**, the route planner. Click the map to add stops and press
  *Optimize route*. Our route (solid blue) and OSRM's (dashed orange) are drawn
  on top of each other, with a side-by-side comparison of distance, travel
  time, compute time and nodes explored.
- **`benchmarks.html`**, the benchmark results. Summary numbers, four charts
  (distance gap, travel-time gap, compute time, nodes explored) and a full data
  table.

There are no build tools. Leaflet (maps) and Chart.js (charts) load from a CDN.

## Run it

Pages must be served over HTTP, not opened as a file (browsers block
loading JSON and JS modules from `file://`). Do either of these:

- **VS Code:** install the *Live Server* extension, right-click
  `frontend/index.html`, then *Open with Live Server*.
- **Terminal:** from the repo root, run `python -m http.server 5500 --directory frontend`
  and open <http://localhost:5500>.

It starts in **sample-data mode** (badge in the top-right says *Sample data*)
and reads the JSON in `mock/`.

## Connect the real backend

1. Start the Python API (it must allow CORS; see `docs/API_CONTRACT.md`).
2. In `CONFIG` at the top of `js/common.js`, set `useMock: false` and check `apiBaseUrl`.
   Or keep the config and add `?mock=0` to the URL, e.g. `index.html?mock=0`.
3. For benchmarks, the runner can write a file instead of serving it. Put it at
   `frontend/data/benchmarks.json` and set `benchmarksFile: "data/benchmarks.json"`.

If the backend's JSON doesn't match the contract, the page shows exactly
which field is missing.

## Project layout

```
frontend/
  index.html          route planner page (markup only)
  benchmarks.html     benchmarks page (markup only)
  css/
    style.css         all styles: colors (CSS variables), layout, both pages
  js/
    common.js         shared: CONFIG settings, fetch calls, formatting, theme colors
    planner.js        route planner: Leaflet map, stop list, results table
    benchmarks.js     benchmarks: averages, Chart.js charts, stat tiles, table
  mock/
    optimize.json     sample /api/optimize response
    benchmarks.json   sample benchmark results (synthetic)
```

Each JS file is split into labeled sections (banner comments) so you can
jump to the map code, the charts and so on.

## Notes

- **HTML, CSS and JS stay in separate files.** No `style="..."`, no
  `<style>` blocks, no inline `<script>` or `onclick`.
- **JS never builds HTML strings.** Repeated markup lives in `<template>`
  elements in the HTML; JS clones them and sets `textContent`.
- **Colors live only in `css/style.css`.** Map routes are styled with CSS
  classes, and charts read the CSS variables through `cssVar()` in `common.js`.
  Dark mode follows the OS setting.
- The one exception is the map attribution in `CONFIG`, which Leaflet
  requires as an HTML string.

## Sample data is fake

`mock/` was generated with made-up numbers and grid-shaped routes that don't
follow real streets. It exists so the front end can be built before the
backend is complete.
