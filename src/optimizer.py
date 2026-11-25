import json
import math
from time import perf_counter


def route_cost(order, matrix, round_trip=False):
    total = 0.0
    for i in range(len(order) - 1):
        total += matrix[order[i]][order[i + 1]]
    if round_trip and len(order) > 1:
        total += matrix[order[-1]][order[0]]
    return total


def nearest_neighbor(matrix):
    order = [0]
    remaining = list(range(1, len(matrix)))
    while remaining:
        closest = remaining[0]
        for stop in remaining:
            if matrix[order[-1]][stop] < matrix[order[-1]][closest]:
                closest = stop
        order.append(closest)
        remaining.remove(closest)
    return order


def two_opt(order, matrix, round_trip=False):
    order = order[:]
    best_cost = route_cost(order, matrix, round_trip)
    improved = True
    while improved:
        improved = False
        for i in range(1, len(order) - 1):
            for j in range(i + 1, len(order)):
                section = order[i:j + 1]
                section.reverse()
                candidate = order[:i] + section + order[j + 1:]
                cost = route_cost(candidate, matrix, round_trip)
                if cost < best_cost:
                    order = candidate
                    best_cost = cost
                    improved = True
    return order


def optimize(request, distance_matrix, duration_matrix, paths, osrm_result,
             nodes_explored=None, started_at=None, method="two_opt"):
    if started_at is None:
        started_at = perf_counter()
    stops = request["stops"]
    metric = request["metric"]
    round_trip = request["round_trip"]
    algorithm = request["algorithm"]
    if not 2 <= len(stops) <= 25:
        raise ValueError("Expected 2 to 25 stops")
    if metric not in ("duration", "distance"):
        raise ValueError("metric must be duration or distance")
    if algorithm not in ("astar", "dijkstra"):
        raise ValueError("algorithm must be astar or dijkstra")
    if not isinstance(round_trip, bool):
        raise ValueError("round_trip must be a boolean")
    if method not in ("nearest_neighbor", "two_opt"):
        raise ValueError("method must be nearest_neighbor or two_opt")
    ids = [stop["id"] for stop in stops]
    if any(not isinstance(stop_id, str) for stop_id in ids) or len(set(ids)) != len(ids):
        raise ValueError("Stop IDs must be unique strings")
    for matrix in (distance_matrix, duration_matrix):
        if len(matrix) != len(stops):
            raise ValueError("Matrices must have one row and column per stop")
        for row in matrix:
            if len(row) != len(stops):
                raise ValueError("Matrices must have one row and column per stop")
            for value in row:
                if isinstance(value, bool) or not isinstance(value, (int, float)):
                    raise ValueError("Matrix entries must be finite, nonnegative numbers")
                if not math.isfinite(value) or value < 0:
                    raise ValueError("Matrix entries must be finite, nonnegative numbers")

    if len(paths) != len(stops):
        raise ValueError("paths must have one row and column per stop")
    for row in paths:
        if len(row) != len(stops):
            raise ValueError("paths must have one row and column per stop")

    matrix = duration_matrix if metric == "duration" else distance_matrix
    order = nearest_neighbor(matrix)
    name = "Nearest Neighbor"
    if method == "two_opt":
        order = two_opt(order, matrix, round_trip)
        name = "2-opt"
    legs = order[:]
    if round_trip:
        legs.append(order[0])
    geometry = []
    # Path points use [latitude, longitude].
    for i in range(len(legs) - 1):
        path = paths[legs[i]][legs[i + 1]]
        if not path:
            raise ValueError("A driven path is required for every selected leg")
        if geometry and geometry[-1] == path[0]:
            geometry.extend(path[1:])
        else:
            geometry.extend(path)

    result = {
        "system": "ours",
        "algorithm": ("A*" if algorithm == "astar" else "Dijkstra") + " + " + name,
        "order": [ids[i] for i in order],
        "distance_m": route_cost(order, distance_matrix, round_trip),
        "duration_s": route_cost(order, duration_matrix, round_trip),
        "runtime_ms": (perf_counter() - started_at) * 1000,
        "nodes_explored": nodes_explored,
        "geometry": geometry,
    }
    return {
        "stops": stops,
        "metric": metric,
        "round_trip": round_trip,
        "results": {"ours": result, "osrm": osrm_result},
    }


if __name__ == "__main__":
    request = {
        "stops": [
            {"id": "s1", "lat": 41.8786, "lon": -87.6359},
            {"id": "s2", "lat": 41.8853, "lon": -87.6243},
            {"id": "s3", "lat": 41.8827, "lon": -87.6189},
            {"id": "s4", "lat": 41.8758, "lon": -87.6262},
        ],
        "algorithm": "astar",
        "metric": "duration",
        "round_trip": False,
    }
    duration_matrix = [
        [0, 10, 15, 20],
        [10, 0, 35, 25],
        [15, 35, 0, 30],
        [20, 15, 30, 0],
    ]
    distance_matrix = [[seconds * 10 for seconds in row] for row in duration_matrix]
    points = [[stop["lat"], stop["lon"]] for stop in request["stops"]]
    # This example uses made-up paths and OSRM results.
    paths = [[[start, end] for end in points] for start in points]
    osrm_result = {
        "system": "osrm",
        "algorithm": "OSRM trip",
        "order": ["s1", "s2", "s4", "s3"],
        "distance_m": 650.0,
        "duration_s": 65.0,
        "runtime_ms": 0.0,
        "nodes_explored": None,
        "geometry": [points[0], points[1], points[3], points[2]],
    }
    baseline = nearest_neighbor(duration_matrix)
    response = optimize(request, distance_matrix, duration_matrix, paths, osrm_result)
    assert route_cost(baseline, duration_matrix) == 65
    assert response["results"]["ours"]["duration_s"] == 60
    print(json.dumps(response, indent=2))
