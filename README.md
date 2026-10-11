# Route Optimizer Benchmarked Against OSRM

AI search route optimizer evaluated on OpenStreetMap road data and benchmarked against the Open Source Routing Machine (OSRM).

## Overview
This project evaluates an informed A* graph search algorithm against OSRM across route length and execution latency.

## Team Contributions
- Repository setup, project structure, environment configuration, and pipeline integration.
- Graph ingestion and coordinate mapping.
- AI heuristic implementation and OSRM benchmark execution.

## Setup
```bash
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python main.py
