# PROMPT.md

> This file contains the original prompt used to build WatchTower IMS.
> Committed as required by the assignment.

---

# 🏗️ WatchTower — Full Stack Incident Management System

## Project Overview
Build a production-grade **Incident Management System (IMS)** called **WatchTower**. It monitors distributed infrastructure (APIs, Caches, Databases, Async Queues) and manages the full incident lifecycle from signal ingestion to root cause analysis. This must be a **fully working, runnable application.**

---

## Tech Stack (Strict — Do Not Change)

**Backend:**
- Python 3.11+
- FastAPI (async)
- MongoDB (via Motor — async MongoDB driver)
- slowapi (rate limiting)
- asyncio (concurrency)
- uvicorn (ASGI server)

**Frontend:**
- React 18 + Vite
- Axios (API calls)
- Plain CSS or Tailwind CSS

**Infrastructure:**
- Docker Compose (must run entire stack with `docker compose up`)
- MongoDB runs as a Docker container

---

## Folder Structure (Strict — Follow Exactly)
```
watchtower/
├── backend/
│   ├── main.py
│   ├── models.py
│   ├── database.py
│   ├── ingestion.py
│   ├── workflow.py
│   ├── alerting.py
│   ├── requirements.txt
│   └── Dockerfile
├── frontend/
│   ├── src/
│   │   ├── App.jsx
│   │   ├── LiveFeed.jsx
│   │   ├── IncidentDetail.jsx
│   │   └── RCAForm.jsx
│   ├── package.json
│   ├── vite.config.js
│   └── Dockerfile
├── docker-compose.yml
├── sample_data.json
└── README.md
```

---

## Backend Requirements (FastAPI + MongoDB)

### 1. Signal Ingestion (`ingestion.py`)
- POST `/api/signals` — accepts incoming error signals
- Each signal has these fields:
```json
{
  "component_id": "CACHE_CLUSTER_01",
  "component_type": "cache",
  "error_type": "connection_timeout",
  "severity": "high",
  "message": "Cache cluster unreachable",
  "timestamp": "2026-05-01T10:00:00Z"
}
```
- Use an **asyncio Queue** as an in-memory buffer (capacity: 10,000) so signals are never lost even if MongoDB is slow
- A background worker constantly drains this queue and writes to MongoDB
- Apply **debouncing logic**: if 100+ signals arrive for the same `component_id` within 10 seconds, create only ONE Work Item. All signals must still be saved to MongoDB and linked to that Work Item via `work_item_id`
- Apply **rate limiting**: max 1000 requests/minute per IP using slowapi

### 2. Alerting Priority (`alerting.py`)
- Use the **Strategy Design Pattern** to assign priority:
  - `rdbms` → P0 (Critical)
  - `api` → P1 (High)
  - `cache` → P2 (Medium)
  - `queue` → P2 (Medium)
  - `mcp_host` → P1 (High)
  - default → P3 (Low)

### 3. Work Item State Machine (`workflow.py`)
- Use the **State Design Pattern**
- Valid transitions only:
```
OPEN → INVESTIGATING → RESOLVED → CLOSED
```
- No skipping states allowed — reject invalid transitions with HTTP 400
- CLOSED state requires a complete RCA object — reject if missing or incomplete
- Auto-calculate **MTTR** (Mean Time To Repair) in minutes when moving to CLOSED:
```
MTTR = RCA.end_time - first signal timestamp
```

### 4. Data Models (`models.py`)
Define these Pydantic models:

**Signal:**
```python
component_id: str
component_type: str  # rdbms | api | cache | queue | mcp_host
error_type: str
severity: str
message: str
timestamp: datetime
work_item_id: Optional[str]  # linked after debounce
```

**WorkItem:**
```python
component_id: str
component_type: str
priority: str  # P0 | P1 | P2 | P3
status: str  # OPEN | INVESTIGATING | RESOLVED | CLOSED
signal_count: int
first_signal_time: datetime
last_signal_time: datetime
rca: Optional[RCA]
mttr_minutes: Optional[float]
created_at: datetime
updated_at: datetime
```

**RCA:**
```python
start_time: datetime
end_time: datetime
root_cause_category: str  # hardware_failure | config_error | software_bug | human_error | unknown
fix_applied: str
prevention_steps: str
```

### 5. API Endpoints (all async)
```
POST   /api/signals                     → ingest a signal
GET    /api/work-items                  → list all work items (sorted by priority)
GET    /api/work-items/{id}             → get single work item with all linked signals
PATCH  /api/work-items/{id}/status      → transition status (body: {status: "INVESTIGATING"})
POST   /api/work-items/{id}/rca         → submit RCA form
GET    /api/health                      → health check (returns {status: "ok", uptime: seconds})
```

### 6. MongoDB Collections
```
signals      → all raw signals (audit log)
work_items   → structured incidents with RCA
```

### 7. Observability
- Print throughput to console every 5 seconds:
```
[WatchTower] Throughput: 243 signals/sec | Active incidents: 7 | Queue depth: 12
```
- Background asyncio task — do not block main thread

### 8. CORS
- Enable CORS for `http://localhost:5173` (Vite dev server)

---

## Frontend Requirements (React + Vite)

### Page 1 — Live Feed (`LiveFeed.jsx`)
- Shows all active Work Items sorted by priority (P0 first)
- Each card shows: Component ID and type, Priority badge, Current status badge, Signal count, Time since first signal
- Auto-refreshes every 5 seconds (polling)
- Click any card → navigates to Incident Detail page

### Page 2 — Incident Detail (`IncidentDetail.jsx`)
- Shows full Work Item info at the top
- Shows a scrollable list of all raw signals linked to this incident
- Shows current status with a "Move to Next Status" button
- If status is RESOLVED and no RCA yet → show RCA Form inline

### Page 3 — RCA Form (`RCAForm.jsx`)
- Fields: Incident Start Time, Incident End Time, Root Cause Category, Fix Applied, Prevention Steps
- Submit button → POST to `/api/work-items/{id}/rca`
- On success → show MTTR in minutes and enable "Close Incident" button
- Validation: all fields mandatory, end_time must be after start_time

### Styling Rules
- Dark theme (background: #0f1117, cards: #1a1d27)
- Priority colors: P0 = #ff4444, P1 = #ff8800, P2 = #ffcc00, P3 = #888888
- Status colors: OPEN = blue, INVESTIGATING = orange, RESOLVED = green, CLOSED = grey
- Clean, minimal, professional — like a real ops dashboard
- Fully responsive

---

## Docker Compose (`docker-compose.yml`)
Must define these 3 services:
- `mongodb` — official mongo:7 image, port 27017, named volume for persistence
- `backend` — built from `./backend/Dockerfile`, port 8000, depends on mongodb, env var `MONGO_URL=mongodb://mongodb:27017`
- `frontend` — built from `./frontend/Dockerfile`, port 5173, depends on backend

Single command to run everything:
```bash
docker compose up --build
```

---

## Sample Data (`sample_data.json`)
Create a JSON file that simulates a realistic failure cascade:
- 5 signals from `RDBMS_PRIMARY_01` (component_type: rdbms) — all within 8 seconds
- 3 signals from `API_GATEWAY_01` (component_type: api) — within 5 seconds
- 2 signals from `CACHE_CLUSTER_01` (component_type: cache)
- 1 signal from `MCP_HOST_01` (component_type: mcp_host)

Also provide a Python script `seed.py` that reads this file and POSTs each signal to `POST /api/signals` with a 0.1 second delay between them.

---

## README.md Must Include
1. Project name + one line description
2. Architecture Diagram (ASCII art)
3. Tech Stack table
4. How to Run
5. How to seed sample data
6. Backpressure section
7. Design Patterns used
8. Non-functional features
9. Known limitations & future improvements

---

## Critical Rules
1. Every backend route must be `async def`
2. Use Motor (not PyMongo) for all MongoDB operations
3. Debouncing must use an in-memory Python dict
4. State transitions must be validated server-side
5. RCA validation must happen server-side before allowing CLOSED status
6. The app must fully work with just `docker compose up --build`
7. All prompts, plans, and markdown files used to build this must be committed to the GitHub repo
8. Name the GitHub repo: `watchtower-ims`

---

## Deliverables Checklist
- [ ] Running app via `docker compose up --build`
- [ ] All 6 API endpoints working
- [ ] Debouncing logic tested with sample_data.json
- [ ] State machine rejecting invalid transitions
- [ ] RCA form blocking CLOSED without complete data
- [ ] MTTR auto-calculated
- [ ] Live dashboard auto-refreshing
- [ ] /health endpoint returning uptime
- [ ] Throughput printed every 5 seconds
- [ ] README.md complete with architecture diagram
- [ ] sample_data.json + seed.py committed
- [ ] This prompt committed to repo as `PROMPT.md`