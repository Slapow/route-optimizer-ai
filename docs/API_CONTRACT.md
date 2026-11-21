# Front-end data contract

This is the JSON the front end expects. If the Python side returns this exactly,
the web pages work with issues. Sample files with this exact shape live in `frontend/mock/`.
The front end reads them while `useMock` is `true` in `CONFIG` at the top of `frontend/js/common.js`.

## Conventions

| Thing | Rule |
|---|---|
| Coordinates | `[lat, lon]` everywhere (Leaflet order). **OSRM returns GeoJSON `[lon, lat]` — flip it before sending.** |
| Distance | meters, field names end in `_m` |
| Time | seconds for travel time (`duration_s`), milliseconds for compute time (`runtime_ms`) |
| Missing values | `null` (for example, OSRM has no `nodes_explored`) |
| Stop IDs | strings, e.g. `"s1"`. The front end creates them and expects the same IDs back |

## 1. `POST /api/optimize`

Finds the best visiting order for the stops with our algorithms **and** with
OSRM, and returns both so the map can draw them side by side.

### Request

```json
{
  "stops": [
    { "id": "s1", "lat": 41.8786, "lon": -87.6359 },
    { "id": "s2", "lat": 41.8853, "lon": -87.6243 },
    { "id": "s3", "lat": 41.8827, "lon": -87.6189 }
  ],
  "algorithm": "astar",
  "metric": "duration",
  "round_trip": false
}
```

| Field | Type | Meaning |
|---|---|---|
| `stops` | array | 2–25 stops. **The first stop is the start.** |
| `algorithm` | `"astar"` \| `"dijkstra"` | Shortest-path algorithm used to build the distance matrix |
| `metric` | `"duration"` \| `"distance"` | What the optimizer minimizes |
| `round_trip` | boolean | `true` = route returns to the start at the end |

### Response (200)

```json
{
  "stops": [
    { "id": "s1", "lat": 41.8786, "lon": -87.6359, "label": "Stop 1" }
  ],
  "metric": "duration",
  "round_trip": false,
  "results": {
    "ours": {
      "system": "ours",
      "algorithm": "A* + 2-opt",
      "order": ["s1", "s3", "s2"],
      "distance_m": 4932.0,
      "duration_s": 608.9,
      "runtime_ms": 184.6,
      "nodes_explored": 14532,
      "runtime_breakdown_ms": { "matrix": 151.2, "ordering": 21.9, "path": 11.5 },
      "geometry": [[41.8786, -87.6359], [41.8790, -87.6359]]
    },
    "osrm": {
      "system": "osrm",
      "algorithm": "OSRM trip",
      "order": ["s1", "s2", "s3"],
      "distance_m": 4353.8,
      "duration_s": 506.3,
      "runtime_ms": 11.8,
      "nodes_explored": null,
      "geometry": [[41.8786, -87.6359], [41.8801, -87.6359]]
    }
  }
}
```

`stops` echoes the request. `label` is optional; the coordinates may be
snapped to the nearest road.

Each item in `results` is a **RouteResult**:

| Field | Type | Required | Meaning |
|---|---|---|---|
| `system` | `"ours"` \| `"osrm"` | yes | Who produced it |
| `algorithm` | string | yes | Display name, e.g. `"A* + 2-opt"` |
| `order` | string[] | yes | Stop IDs in visiting order, each stop once, starting with the start stop. Don't repeat the start for round trips; `geometry` shows the return leg. |
| `distance_m` | number | yes | Total route length |
| `duration_s` | number | yes | Total estimated travel time |
| `runtime_ms` | number | yes | Wall-clock compute time for the whole request |
| `nodes_explored` | integer \| null | yes | Graph nodes popped from the open set, summed over all searches. `null` for OSRM |
| `runtime_breakdown_ms` | object | no | Optional `{ "matrix", "ordering", "path" }` split of `runtime_ms`. Shown when present |
| `geometry` | `[lat, lon][]` | yes | The full driven path, in order, as a polyline |

### Errors

Return a 4xx or 5xx status code with:

```json
{ "error": "Stop s3 is not reachable from the road network" }
```

The front end shows `error` to the user.

## 2. Benchmarks: `GET /api/benchmarks` (or a static file)

The charts page reads one **BenchmarkFile**. The benchmark runner can either
serve it from the API or write it to `frontend/data/benchmarks.json`. Set
`benchmarksFile` in `CONFIG` (`frontend/js/common.js`) to match.

```json
{
  "generated_at": "2026-11-21T12:00:00Z",
  "area": "Chicago Loop",
  "metric": "duration",
  "osrm_profile": "car",
  "rows": [
    {
      "case_id": "n05-s1",
      "num_stops": 5,
      "seed": 1,
      "system": "ours",
      "algorithm": "A* + 2-opt",
      "distance_m": 5120.4,
      "duration_s": 601.2,
      "runtime_ms": 212.7,
      "nodes_explored": 41022
    },
    {
      "case_id": "n05-s1",
      "num_stops": 5,
      "seed": 1,
      "system": "osrm",
      "algorithm": "OSRM trip",
      "distance_m": 4987.0,
      "duration_s": 580.9,
      "runtime_ms": 9.4,
      "nodes_explored": null
    }
  ]
}
```

- **One row per (test case × algorithm).** Every `case_id` needs exactly one
  `osrm` row. The percentage gaps are measured against it.
- Several of our algorithms can share a `case_id` (e.g. `A* + 2-opt` and
  `Dijkstra + 2-opt`). Each `algorithm` name becomes one series in the charts.
- The rows are flat on purpose. In pandas this is
  `df.to_dict(orient="records")`.

## CORS (for whoever writes the API)

The front end runs on its own port (for example, VS Code Live Server on
`:5500`), so the API must allow cross-origin requests.

FastAPI:

```python
from fastapi.middleware.cors import CORSMiddleware
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
```

Flask: `pip install flask-cors`, then `CORS(app)`.
