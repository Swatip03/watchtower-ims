# WatchTower IMS

> Production-grade Incident Management System that monitors distributed infrastructure and manages the full incident lifecycle — from signal ingestion to root cause analysis.

---

## Architecture

```
                        ┌─────────────────────────────────────────────────┐
                        │                  WATCHTOWER IMS                  │
                        └─────────────────────────────────────────────────┘

  External Systems                  Backend (FastAPI)                  Storage
  ────────────────    ─────────────────────────────────────────    ───────────
                      ┌──────────────┐
  APIs, DBs,          │   slowapi    │  rate limit 1000 req/min
  Caches, Queues  ──► │  POST        │
  MCP Hosts           │  /api/signals│
                      └──────┬───────┘
                             │ await queue.put()         ┌─────────────────┐
                             ▼                           │                 │
                      ┌──────────────┐   drain worker   │    MongoDB      │
                      │ asyncio.Queue│ ────────────────► │  ┌───────────┐ │
                      │  cap 10,000  │                   │  │  signals  │ │
                      └──────────────┘                   │  └───────────┘ │
                             │                           │  ┌───────────┐ │
                             │  debounce logic           │  │work_items │ │
                             │  (dict registry)          │  └───────────┘ │
                             ▼                           │                 │
                      ┌──────────────┐                   └─────────────────┘
                      │  WorkItem    │ ◄── Strategy Pattern (alerting.py)
                      │  State       │ ◄── State Pattern   (workflow.py)
                      │  Machine     │
                      └──────┬───────┘
                             │
                   ┌─────────┴──────────┐
                   │    REST API         │
                   │  GET  /work-items  │
                   │  GET  /work-items/{id}│
                   │  PATCH /status     │
                   │  POST  /rca        │
                   │  GET  /health      │
                   └─────────┬──────────┘
                             │ axios (HTTP)
                             ▼
                   ┌──────────────────────┐
                   │   React 18 + Vite    │
                   │  ┌────────────────┐  │
                   │  │   LiveFeed     │  │  polls every 5s
                   │  │   (dashboard)  │  │
                   │  └────────────────┘  │
                   │  ┌────────────────┐  │
                   │  │IncidentDetail  │  │  status transitions
                   │  │   + RCAForm    │  │  signal log
                   │  └────────────────┘  │
                   └──────────────────────┘
```

---

## Tech Stack

| Layer          | Technology                          | Version  | Purpose                                |
|----------------|-------------------------------------|----------|----------------------------------------|
| Backend        | Python                              | 3.11+    | Application runtime                    |
| Backend        | FastAPI                             | 0.111    | Async REST API framework               |
| Backend        | Motor                               | 3.4      | Async MongoDB driver                   |
| Backend        | slowapi                             | 0.1.9    | Rate limiting middleware               |
| Backend        | uvicorn                             | 0.29     | ASGI server                            |
| Backend        | Pydantic                            | 1.10     | Data validation and serialisation      |
| Database       | MongoDB                             | 7        | Persistent storage for signals + work items |
| Frontend       | React                               | 18.3     | UI component framework                 |
| Frontend       | Vite                                | 5.3      | Build tool and dev server              |
| Frontend       | React Router                        | 6.24     | Client-side routing                    |
| Frontend       | Axios                               | 1.7      | HTTP client                            |
| Infrastructure | Docker + Docker Compose             | latest   | Container orchestration                |

---

## How to Run

### Prerequisites
- Docker Desktop (or Docker Engine + Compose plugin)
- Git

### Start the full stack

```bash
git clone https://github.com/<your-username>/watchtower-ims.git
cd watchtower-ims

docker compose up --build
```

Docker will:
1. Pull MongoDB 7
2. Build and start the FastAPI backend (port 8000)
3. Build the React frontend and start the Vite preview server (port 5173)

Open **http://localhost:5173** in your browser.

The `/api/health` endpoint is available at **http://localhost:8000/api/health**.

### Stop

```bash
docker compose down          # stop containers, keep data
docker compose down -v       # stop containers AND wipe MongoDB volume
```

---

## How to Seed Sample Data

With the stack running, open a new terminal and run:

```bash
python seed.py
```

This posts 11 signals simulating a realistic failure cascade across 4 components. Expected output:

```
  WatchTower Signal Seeder
  Backend : http://localhost:8000
  Signals : 11
  Delay   : 0.1s between each signal

  Checking backend health... ✓  Backend is up.

  [ 1/11] RDBMS_PRIMARY_01       → 202 ✓  queued=True  depth=1
  [ 2/11] RDBMS_PRIMARY_01       → 202 ✓  queued=True  depth=2
  ...
  [11/11] MCP_HOST_01            → 202 ✓  queued=True  depth=11

  ✓ All 11 signals seeded successfully.

  Next steps:
    1. Open http://localhost:5173 — the Live Feed should show 4 incidents.
    2. RDBMS_PRIMARY_01 has priority P0 and signal_count=5 (debounce in action).
    3. Click any card → detail page → transition status → fill RCA → close.
```

Custom options:

```bash
python seed.py --url http://localhost:8000   # different backend URL
python seed.py --delay 0.5                  # slower seeding
python seed.py --file my_signals.json       # custom data file
```

---

## Backpressure: How the asyncio Queue Handles Bursts

When a burst of signals arrives (e.g. an alert storm from a flapping service), the HTTP handler does exactly one thing: `await queue.put(signal)`. This returns in microseconds. The HTTP response goes back to the client immediately — MongoDB is never in the critical path.

```
Burst of 500 signals/sec
        │
        ▼
┌───────────────────┐
│  asyncio.Queue    │  ← accepts up to 10,000 signals before back-pressure
│  cap: 10,000      │
└─────────┬─────────┘
          │  drain worker processes in batches of 50
          ▼
    MongoDB writes
    (~5-10ms each)
```

If the queue fills to capacity (10,000 items), subsequent signals are dropped with a `{"queued": false}` response and a warning is logged. This is a deliberate trade-off: shedding load gracefully is safer than letting the HTTP handler block, which would cascade into connection pool exhaustion.

The background drain worker uses a two-phase loop:
1. `await queue.get()` — blocks with zero CPU when idle
2. `queue.get_nowait()` in a batch loop — drains up to 50 items opportunistically without sleeping, maximising throughput during bursts

---

## Design Patterns

### Strategy Pattern — Alerting Priority (`alerting.py`)

Each component type maps to a concrete strategy class. Adding a new component type requires adding one class and one registry entry — no if/elif chains anywhere.

```
PriorityStrategy  (abstract)
    ├── CriticalPriority  → P0  (rdbms)
    ├── HighPriority      → P1  (api, mcp_host)
    ├── MediumPriority    → P2  (cache, queue)
    └── LowPriority       → P3  (default / unknown)

PriorityAssigner.for_component("rdbms").assign()  →  Priority.P0
```

### State Pattern — Work Item Lifecycle (`workflow.py`)

Each status is a concrete state object. State-specific rules (e.g. RCA required before CLOSED) live inside the state class, not in a central switch statement.

```
WorkItemState  (abstract)
    ├── OpenState          OPEN → INVESTIGATING only
    ├── InvestigatingState INVESTIGATING → RESOLVED only
    ├── ResolvedState      RESOLVED → CLOSED only (requires RCA)
    └── ClosedState        terminal — no transitions allowed

WorkItemStateMachine.transition_to(CLOSED)
  → delegates to ResolvedState.validate_transition()
  → raises HTTP 400 if RCA is missing
  → auto-calculates MTTR on success
```

---

## Non-Functional Features

| Feature              | Implementation                                                                 |
|----------------------|--------------------------------------------------------------------------------|
| Rate limiting        | slowapi — 1000 requests/minute per IP on `POST /api/signals`                  |
| Health endpoint      | `GET /api/health` — returns `{status, uptime_seconds}`                        |
| Throughput logging   | asyncio background task prints signals/sec + active incidents every 5 seconds  |
| CORS                 | FastAPI CORSMiddleware — allows `http://localhost:5173`                        |
| Indexes              | MongoDB indexes on `component_id`, `work_item_id`, `timestamp`, `(priority, status)` |
| Graceful shutdown    | lifespan context manager cancels background tasks and closes DB connection     |
| Non-root container   | Backend Dockerfile runs as a dedicated `watchtower` user                      |
| Two-stage Docker     | Both Dockerfiles use multi-stage builds to minimise final image size           |

---

## API Reference

| Method | Path                            | Description                                      |
|--------|---------------------------------|--------------------------------------------------|
| POST   | `/api/signals`                  | Ingest an error signal (rate limited, async)     |
| GET    | `/api/work-items`               | List all work items sorted by priority           |
| GET    | `/api/work-items/{id}`          | Get single work item + all linked signals        |
| PATCH  | `/api/work-items/{id}/status`   | Transition status through state machine          |
| POST   | `/api/work-items/{id}/rca`      | Submit Root Cause Analysis                       |
| GET    | `/api/health`                   | Health check — returns uptime in seconds         |

### Signal payload

```json
{
  "component_id":   "CACHE_CLUSTER_01",
  "component_type": "cache",
  "error_type":     "connection_timeout",
  "severity":       "high",
  "message":        "Cache cluster unreachable",
  "timestamp":      "2026-05-01T10:00:00Z"
}
```

### Status transition payload

```json
{ "status": "INVESTIGATING" }
```

---

## Known Limitations and Future Improvements

### Current limitations

| Limitation | Reason |
|---|---|
| Single-process debounce | `_debounce_registry` is an in-memory Python dict. Running multiple backend replicas would give each its own registry, breaking debounce across replicas. |
| No authentication | All API endpoints are open. Fine for a demo, not for production. |
| No real alerting | Incidents appear in the dashboard but do not send PagerDuty/Slack notifications. |
| `uvicorn --workers 1` | Required to share the asyncio Queue and debounce registry within one process. |

### Future improvements

- **Redis** — replace the in-memory debounce registry and asyncio Queue with Redis Streams. Enables horizontal scaling and survives restarts.
- **PostgreSQL** — for RDBMS-backed audit trails with full ACID guarantees. MongoDB is fine for this use case but RDBMS gives stronger consistency.
- **Kubernetes** — Helm chart with separate `Deployment` for backend and frontend, MongoDB via a StatefulSet or Atlas, horizontal pod autoscaling on the backend.
- **PagerDuty / Slack integration** — fire webhooks when a P0 WorkItem is created.
- **JWT authentication** — protect all endpoints with Bearer token auth.
- **WebSocket live feed** — replace 5-second polling with a server-sent events or WebSocket push.
- **Metrics export** — Prometheus endpoint + Grafana dashboard for throughput, queue depth, and MTTR trends.

---

## Repository Contents

```
watchtower-ims/
├── backend/
│   ├── main.py          FastAPI app — all routes and lifespan
│   ├── models.py        Pydantic models and enums
│   ├── database.py      Motor connection + collection helpers
│   ├── ingestion.py     asyncio Queue, drain worker, debounce
│   ├── workflow.py      State Pattern — status transitions + MTTR
│   ├── alerting.py      Strategy Pattern — priority assignment
│   ├── requirements.txt Python dependencies (pinned)
│   └── Dockerfile       Multi-stage Python 3.11 image
├── frontend/
│   ├── src/
│   │   ├── App.jsx          Root app, routing, global CSS
│   │   ├── LiveFeed.jsx     Auto-refreshing incident dashboard
│   │   ├── IncidentDetail.jsx  Detail page + status controls
│   │   └── RCAForm.jsx      RCA submission form
│   ├── package.json
│   ├── vite.config.js
│   └── Dockerfile       Multi-stage Node 20 image
├── docker-compose.yml   Three-service stack with healthchecks
├── sample_data.json     11-signal failure cascade scenario
├── seed.py              CLI seeding script (stdlib only)
├── PROMPT.md            Original assignment prompt (required)
└── README.md            This file
```