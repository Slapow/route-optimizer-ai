import copy
import itertools
import json
import random
import unittest
from pathlib import Path
from time import perf_counter

from src.benchmark_optimizer import run_benchmarks
from src.optimizer import nearest_neighbor, optimize, route_cost, two_opt


def sample_case():
    stops = []
    for i in range(4):
        stops.append({"id": "s" + str(i + 1), "lat": 41.0 + i, "lon": -87.0})
    points = [[stop["lat"], stop["lon"]] for stop in stops]
    matrix = [[0, 10, 15, 20], [10, 0, 35, 25], [15, 35, 0, 30], [20, 15, 30, 0]]
    return {
        "case_id": "demo-four-stops",
        "seed": 1,
        "upstream_runtime_ms": 0.0,
        "request": {"stops": stops, "algorithm": "astar", "metric": "duration", "round_trip": False},
        "distance_matrix": [[value * 10 for value in row] for row in matrix],
        "duration_matrix": matrix,
        "paths": [[[a, b] for b in points] for a in points],
        "osrm_result": {
            "system": "osrm", "algorithm": "OSRM trip",
            "order": ["s1", "s2", "s4", "s3"], "distance_m": 650.0,
            "duration_s": 65.0, "runtime_ms": 0.0, "nodes_explored": None,
            "geometry": [points[0], points[1], points[3], points[2]],
        },
    }


def solve(case, **options):
    return optimize(case["request"], case["distance_matrix"], case["duration_matrix"],
                    case["paths"], case["osrm_result"], **options)


class OptimizerTests(unittest.TestCase):
    def test_four_stop_example(self):
        case = sample_case()
        baseline = solve(case, method="nearest_neighbor")["results"]["ours"]
        result = solve(case)["results"]["ours"]
        self.assertEqual(baseline["duration_s"], 65)
        self.assertEqual(result["duration_s"], 60)
        self.assertEqual(result["order"], ["s1", "s3", "s4", "s2"])
        self.assertEqual(result["distance_m"], 600)

    def test_optimize_contract(self):
        case = sample_case()
        before = copy.deepcopy(case)
        mock_path = Path(__file__).resolve().parents[1] / "frontend/mock/optimize.json"
        mock = json.loads(mock_path.read_text(encoding="utf-8"))
        response = solve(case, nodes_explored=123, started_at=perf_counter() - 0.1)
        ours = response["results"]["ours"]
        self.assertEqual(set(response), set(mock))
        self.assertEqual(set(response["results"]), {"ours", "osrm"})
        required = set(mock["results"]["ours"]) - {"runtime_breakdown_ms"}
        self.assertEqual(set(ours), required)
        self.assertEqual(ours["nodes_explored"], 123)
        self.assertGreaterEqual(ours["runtime_ms"], 100)
        self.assertEqual(response["results"]["osrm"], case["osrm_result"])
        self.assertEqual(case, before)
        json.dumps(response, allow_nan=False)

    def test_round_trip_and_geometry(self):
        case = sample_case()
        case["request"]["round_trip"] = True
        result = solve(case)["results"]["ours"]
        order = [int(stop_id[1:]) - 1 for stop_id in result["order"]]
        self.assertEqual(order[0], 0)
        self.assertEqual(len(set(order)), 4)
        self.assertEqual(result["duration_s"], route_cost(order, case["duration_matrix"], True))
        self.assertEqual(result["distance_m"], route_cost(order, case["distance_matrix"], True))
        self.assertEqual(result["geometry"][0], [41.0, -87.0])
        self.assertEqual(result["geometry"][-1], [41.0, -87.0])
        self.assertEqual(len(result["geometry"]), 5)

    def test_distance_metric_and_dijkstra(self):
        case = sample_case()
        case["distance_matrix"] = [[0, 1, 9, 9], [9, 0, 1, 9], [9, 9, 0, 1], [9, 9, 9, 0]]
        case["request"].update(metric="distance", algorithm="dijkstra")
        result = solve(case)["results"]["ours"]
        self.assertEqual(result["order"], ["s1", "s2", "s3", "s4"])
        self.assertEqual(result["distance_m"], 3)
        self.assertEqual(result["duration_s"], 75)
        self.assertEqual(result["algorithm"], "Dijkstra + 2-opt")

    def test_keeps_road_points_between_stops(self):
        case = sample_case()
        midpoint = [41.5, -86.5]
        case["paths"][0][2].insert(1, midpoint)
        geometry = solve(case)["results"]["ours"]["geometry"]
        self.assertEqual(geometry[:3], [[41.0, -87.0], midpoint, [43.0, -87.0]])

    def test_two_stops(self):
        case = sample_case()
        case["request"]["stops"] = case["request"]["stops"][:2]
        for field in ("distance_matrix", "duration_matrix", "paths"):
            case[field] = [row[:2] for row in case[field][:2]]
        for round_trip, duration in ((False, 10), (True, 20)):
            case["request"]["round_trip"] = round_trip
            result = solve(case)["results"]["ours"]
            self.assertEqual(result["order"], ["s1", "s2"])
            self.assertEqual(result["duration_s"], duration)

    def test_directed_matrices_and_local_minimum(self):
        rng = random.Random(7)
        for size in (2, 4, 8, 25):
            for round_trip in (False, True):
                for trial in range(5):
                    matrix = [[0 if i == j else rng.randint(1, 100) for j in range(size)] for i in range(size)]
                    baseline = nearest_neighbor(matrix)
                    order = two_opt(baseline, matrix, round_trip)
                    cost = route_cost(order, matrix, round_trip)
                    self.assertEqual(order[0], 0)
                    self.assertEqual(sorted(order), list(range(size)))
                    self.assertLessEqual(cost, route_cost(baseline, matrix, round_trip))
                    for i in range(1, size - 1):
                        for j in range(i + 1, size):
                            candidate = order[:i] + order[i:j + 1][::-1] + order[j + 1:]
                            self.assertGreaterEqual(route_cost(candidate, matrix, round_trip), cost)

    def test_four_stop_cost_matches_exhaustive_search(self):
        case = sample_case()
        matrix = case["duration_matrix"]
        for round_trip in (False, True):
            best = min(route_cost([0] + list(tail), matrix, round_trip)
                       for tail in itertools.permutations(range(1, 4)))
            order = two_opt(nearest_neighbor(matrix), matrix, round_trip)
            self.assertEqual(route_cost(order, matrix, round_trip), best)

    def test_invalid_matrices_and_paths(self):
        for value in (None, -1, float("inf"), float("nan"), True):
            case = sample_case()
            case["duration_matrix"][0][1] = value
            with self.assertRaises(ValueError):
                solve(case)
        for field in ("distance_matrix", "duration_matrix", "paths"):
            case = sample_case()
            case[field].pop()
            with self.assertRaises(ValueError):
                solve(case)
        case = sample_case()
        case["paths"][0][2] = []
        with self.assertRaises(ValueError):
            solve(case)

    def test_invalid_requests(self):
        for field, value in (("metric", "speed"), ("algorithm", "other"), ("round_trip", "false")):
            case = sample_case()
            case["request"][field] = value
            with self.assertRaises(ValueError):
                solve(case)
        case = sample_case()
        case["request"]["stops"][1]["id"] = "s1"
        with self.assertRaises(ValueError):
            solve(case)
        with self.assertRaises(ValueError):
            solve(sample_case(), method="other")
        for count in (1, 26):
            case = sample_case()
            case["request"]["stops"] = [case["request"]["stops"][0]] * count
            with self.assertRaises(ValueError):
                solve(case)

    def test_benchmark_contract_and_timings(self):
        case = sample_case()
        case["upstream_runtime_ms"] = 50
        data = {"area": "Synthetic test", "metric": "duration", "osrm_profile": "car", "cases": [case]}
        result = run_benchmarks(data)
        mock_path = Path(__file__).resolve().parents[1] / "frontend/mock/benchmarks.json"
        mock = json.loads(mock_path.read_text(encoding="utf-8"))
        self.assertEqual(set(result), set(mock))
        self.assertEqual(len(result["rows"]), 3)
        self.assertEqual([row["duration_s"] for row in result["rows"]], [65, 60, 65])
        for row in result["rows"]:
            self.assertEqual(set(row), set(mock["rows"][0]))
        self.assertGreaterEqual(result["rows"][0]["runtime_ms"], 50)
        self.assertEqual(sum(row["system"] == "osrm" for row in result["rows"]), 1)
        json.dumps(result, allow_nan=False)
        data["cases"].append(copy.deepcopy(case))
        with self.assertRaises(ValueError):
            run_benchmarks(data)

    def test_benchmark_rejects_mismatched_comparisons(self):
        case = sample_case()
        data = {"area": "Synthetic test", "metric": "duration", "osrm_profile": "car", "cases": [case]}
        case["osrm_result"]["order"] = ["s2", "s1", "s4", "s3"]
        with self.assertRaises(ValueError):
            run_benchmarks(data)
        case["osrm_result"]["order"] = ["s1", "s2", "s3"]
        with self.assertRaises(ValueError):
            run_benchmarks(data)


if __name__ == "__main__":
    unittest.main()
