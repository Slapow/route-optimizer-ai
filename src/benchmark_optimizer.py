import argparse
import json
import math
from datetime import datetime, timezone

from src.optimizer import optimize


def run_benchmarks(data):
    rows = []
    case_ids = set()
    for case in data["cases"]:
        case_id = case["case_id"]
        if case_id in case_ids:
            raise ValueError("Each case_id must be unique")
        case_ids.add(case_id)
        request = case["request"]
        if request["metric"] != data["metric"]:
            raise ValueError("All cases must use the benchmark metric")
        ids = [stop["id"] for stop in request["stops"]]
        osrm = case["osrm_result"]
        if osrm["system"] != "osrm" or osrm["nodes_explored"] is not None:
            raise ValueError("Expected an OSRM RouteResult")
        if not osrm["order"] or osrm["order"][0] != ids[0]:
            raise ValueError("OSRM must start at the same stop")
        if sorted(osrm["order"]) != sorted(ids):
            raise ValueError("OSRM must visit the same stops exactly once")
        for field in ("distance_m", "duration_s", "runtime_ms"):
            value = osrm[field]
            if not isinstance(value, (int, float)) or not math.isfinite(value) or value < 0:
                raise ValueError("OSRM totals and runtime must be finite and nonnegative")
        upstream_ms = case["upstream_runtime_ms"]
        if not math.isfinite(upstream_ms) or upstream_ms < 0:
            raise ValueError("upstream_runtime_ms must be finite and nonnegative")

        results = []
        for method in ("nearest_neighbor", "two_opt"):
            response = optimize(
                request, case["distance_matrix"], case["duration_matrix"],
                case["paths"], osrm, case.get("nodes_explored"), method=method,
            )
            result = response["results"]["ours"]
            result["runtime_ms"] += upstream_ms
            results.append(result)
        results.append(osrm)
        for result in results:
            rows.append({
                "case_id": case_id,
                "num_stops": len(ids),
                "seed": case["seed"],
                "system": result["system"],
                "algorithm": result["algorithm"],
                "distance_m": result["distance_m"],
                "duration_s": result["duration_s"],
                "runtime_ms": result["runtime_ms"],
                "nodes_explored": result["nodes_explored"],
            })
    if not rows:
        raise ValueError("At least one benchmark case is required")
    return {
        "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "area": data["area"],
        "metric": data["metric"],
        "osrm_profile": data["osrm_profile"],
        "rows": rows,
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("input", help="JSON cases supplied by the backend")
    parser.add_argument("output", help="Benchmark JSON file to create")
    args = parser.parse_args()
    with open(args.input, encoding="utf-8") as file:
        data = json.load(file)
    result = run_benchmarks(data)
    with open(args.output, "w", encoding="utf-8") as file:
        json.dump(result, file, indent=2, allow_nan=False)
        file.write("\n")
    print("Saved", len(result["rows"]), "benchmark rows to", args.output)
