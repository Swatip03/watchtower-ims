"""
main.py — WatchTower FastAPI application entry point.

Routes:
    POST   /api/signals                  → ingest a signal
    GET    /api/work-items               → list all work items (sorted by priority)
    GET    /api/work-items/{id}          → single work item + linked signals
    PATCH  /api/work-items/{id}/status   → state machine transition
    POST   /api/work-items/{id}/rca      → submit RCA
    GET    /api/health                   → uptime check
"""

import time
import logging
from contextlib import asynccontextmanager

from bson import ObjectId
from bson.errors import InvalidId
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

from database import connect_db, close_db, get_signals_collection, get_work_items_collection, doc_to_dict
from ingestion import ingest_signal, start_background_workers, stop_background_workers
from workflow import WorkItemStateMachine, submit_rca
from models import SignalIn, RCA, StatusTransitionRequest, HealthResponse, WorkItemStatus

# ─────────────────────────────────────────────
# Logging
# ─────────────────────────────────────────────

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(name)s] %(levelname)s: %(message)s",
)
logger = logging.getLogger("watchtower.main")

# ─────────────────────────────────────────────
# Rate limiter (slowapi — 1000 req/min per IP)
# ─────────────────────────────────────────────

limiter = Limiter(key_func=get_remote_address, default_limits=["1000/minute"])

# ─────────────────────────────────────────────
# App startup time (for /health uptime)
# ─────────────────────────────────────────────

_start_time = time.time()

# ─────────────────────────────────────────────
# Priority sort order for list endpoint
# ─────────────────────────────────────────────

PRIORITY_ORDER = {"P0": 0, "P1": 1, "P2": 2, "P3": 3}


# ─────────────────────────────────────────────
# Lifespan (replaces deprecated @app.on_event)
# ─────────────────────────────────────────────

@asynccontextmanager
async def lifespan(app: FastAPI):
    # ── Startup ──────────────────────────────
    logger.info("WatchTower starting up...")
    await connect_db()
    start_background_workers()
    logger.info("WatchTower ready.")
    yield
    # ── Shutdown ─────────────────────────────
    logger.info("WatchTower shutting down...")
    stop_background_workers()
    await close_db()
    logger.info("WatchTower stopped.")


# ─────────────────────────────────────────────
# FastAPI app
# ─────────────────────────────────────────────

app = FastAPI(
    title="WatchTower IMS",
    description="Production-grade Incident Management System",
    version="1.0.0",
    lifespan=lifespan,
)

# Rate limiter state + handler
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS — allow Vite dev server
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ─────────────────────────────────────────────
# Helpers
# ─────────────────────────────────────────────

def _parse_object_id(id_str: str) -> ObjectId:
    """Parse a string to ObjectId, raising 404 on invalid format."""
    try:
        return ObjectId(id_str)
    except (InvalidId, Exception):
        raise HTTPException(status_code=404, detail=f"Invalid work item ID: {id_str}")


def _sort_key(doc: dict) -> int:
    return PRIORITY_ORDER.get(doc.get("priority", "P3"), 99)


# ─────────────────────────────────────────────
# Routes
# ─────────────────────────────────────────────

@app.get("/api/health", response_model=HealthResponse, tags=["observability"])
async def health_check():
    """Returns service status and uptime in seconds."""
    return HealthResponse(
        status="ok",
        uptime_seconds=round(time.time() - _start_time, 2),
    )


# ── Signal ingestion ──────────────────────────────────────────────────────────

@app.post("/api/signals", status_code=202, tags=["signals"])
@limiter.limit("1000/minute")
async def post_signal(signal: SignalIn, request: Request):
    """
    Ingest an error signal. The signal is placed on an asyncio Queue
    and acknowledged immediately — MongoDB write happens in the background.
    """
    result = await ingest_signal(signal)
    return result


# ── Work Items — list ─────────────────────────────────────────────────────────

@app.get("/api/work-items", tags=["work-items"])
async def list_work_items():
    """
    Return all work items sorted by priority (P0 first).
    """
    col = get_work_items_collection()
    cursor = col.find({})
    docs = [doc_to_dict(doc) async for doc in cursor]
    docs.sort(key=_sort_key)
    return docs


# ── Work Items — single ───────────────────────────────────────────────────────

@app.get("/api/work-items/{work_item_id}", tags=["work-items"])
async def get_work_item(work_item_id: str):
    """
    Return a single work item plus all raw signals linked to it.
    """
    oid = _parse_object_id(work_item_id)
    col = get_work_items_collection()

    doc = await col.find_one({"_id": oid})
    if doc is None:
        raise HTTPException(status_code=404, detail="Work item not found.")

    work_item = doc_to_dict(doc)

    # Fetch linked signals
    signals_col = get_signals_collection()
    signals_cursor = signals_col.find(
        {"work_item_id": work_item_id},
        sort=[("timestamp", 1)],
    )
    signals = [doc_to_dict(s) async for s in signals_cursor]

    return {**work_item, "signals": signals}


# ── Work Items — status transition ────────────────────────────────────────────

@app.patch("/api/work-items/{work_item_id}/status", tags=["work-items"])
async def transition_status(work_item_id: str, body: StatusTransitionRequest):
    """
    Transition a work item through the state machine.
    Valid path: OPEN → INVESTIGATING → RESOLVED → CLOSED
    CLOSED requires a submitted RCA — otherwise returns HTTP 400.
    """
    oid = _parse_object_id(work_item_id)
    col = get_work_items_collection()

    doc = await col.find_one({"_id": oid})
    if doc is None:
        raise HTTPException(status_code=404, detail="Work item not found.")

    machine = WorkItemStateMachine(doc_to_dict(doc))
    updated = await machine.transition_to(WorkItemStatus(body.status))
    return updated


# ── Work Items — RCA submission ───────────────────────────────────────────────

@app.post("/api/work-items/{work_item_id}/rca", tags=["work-items"])
async def post_rca(work_item_id: str, rca: RCA):
    """
    Attach a Root Cause Analysis to a work item.
    Status must be INVESTIGATING or RESOLVED.
    Does NOT auto-close — use PATCH /status to transition to CLOSED.
    """
    _parse_object_id(work_item_id)   # validate format early
    updated = await submit_rca(work_item_id, rca)
    return updated


# ─────────────────────────────────────────────
# Global exception handler (catch-all)
# ─────────────────────────────────────────────

@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger.exception("Unhandled exception on %s: %s", request.url.path, exc)
    return JSONResponse(
        status_code=500,
        content={"detail": "Internal server error. Check backend logs."},
    )