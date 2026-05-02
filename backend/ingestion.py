"""
ingestion.py — Signal ingestion pipeline.

Architecture:
    HTTP POST /api/signals
        └─► asyncio.Queue (cap 10,000)            ← never blocks the HTTP handler
                └─► background drain worker        ← runs forever in the background
                        ├─► writes signal to MongoDB (signals collection)
                        └─► debounce logic
                                ├─► existing window? → increment signal_count, update last_signal_time
                                └─► new window?     → create WorkItem, link signal via work_item_id

Debounce rule:
    If 100+ signals arrive for the same component_id within 10 seconds,
    only ONE WorkItem is created. All signals are still saved individually
    and linked to that WorkItem via work_item_id.

Throughput logging:
    Every 5 seconds a background task prints:
    [WatchTower] Throughput: N signals/sec | Active incidents: M | Queue depth: K
"""

import asyncio
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

from bson import ObjectId

from models import SignalIn, SignalDB, WorkItemDB, WorkItemStatus
from alerting import get_priority
from database import get_signals_collection, get_work_items_collection, doc_to_dict

logger = logging.getLogger("watchtower.ingestion")

# ─────────────────────────────────────────────
# Constants
# ─────────────────────────────────────────────

QUEUE_CAPACITY      = 10_000
DEBOUNCE_THRESHOLD  = 100           # signals from same component within window
DEBOUNCE_WINDOW_SEC = 10            # seconds
THROUGHPUT_INTERVAL = 5             # seconds between throughput log lines
DRAIN_BATCH_SIZE    = 50            # signals processed per drain iteration

# ─────────────────────────────────────────────
# Module-level state
# ─────────────────────────────────────────────

# The in-memory queue — HTTP handlers put() here; drain worker get()s from here
signal_queue: asyncio.Queue = asyncio.Queue(maxsize=QUEUE_CAPACITY)

# Debounce registry:
#   key   → component_id  (str)
#   value → {
#       "window_start":  datetime,   # when this window opened
#       "signal_count":  int,        # signals seen in this window
#       "work_item_id":  str | None, # set once WorkItem is created
#   }
_debounce_registry: dict[str, dict] = {}

# Metrics counters (reset every THROUGHPUT_INTERVAL seconds)
_signals_in_window: int = 0

# Background task handles (stored so they can be cancelled on shutdown)
_drain_task: Optional[asyncio.Task] = None
_throughput_task: Optional[asyncio.Task] = None


# ─────────────────────────────────────────────
# Lifecycle — called from main.py
# ─────────────────────────────────────────────

def start_background_workers() -> None:
    """Spin up drain worker + throughput logger. Call once at app startup."""
    global _drain_task, _throughput_task
    _drain_task = asyncio.create_task(_drain_worker(), name="drain-worker")
    _throughput_task = asyncio.create_task(_throughput_logger(), name="throughput-logger")
    logger.info("Background workers started.")


def stop_background_workers() -> None:
    """Cancel background tasks gracefully. Call on app shutdown."""
    if _drain_task and not _drain_task.done():
        _drain_task.cancel()
    if _throughput_task and not _throughput_task.done():
        _throughput_task.cancel()
    logger.info("Background workers stopped.")


# ─────────────────────────────────────────────
# Public ingestion entry point
# ─────────────────────────────────────────────

async def ingest_signal(signal: SignalIn) -> dict:
    """
    Called by POST /api/signals.
    Validates the signal, puts it on the queue, and returns immediately.
    Never blocks waiting for MongoDB.
    """
    if signal_queue.full():
        logger.warning("Signal queue full — dropping signal from %s", signal.component_id)
        return {"queued": False, "reason": "Queue at capacity. Try again shortly."}

    await signal_queue.put(signal)

    global _signals_in_window
    _signals_in_window += 1

    return {"queued": True, "queue_depth": signal_queue.qsize()}


# ─────────────────────────────────────────────
# Background: drain worker
# ─────────────────────────────────────────────

async def _drain_worker() -> None:
    """
    Continuously drains the queue and processes signals.
    Runs as a background asyncio Task for the lifetime of the app.
    """
    logger.info("Drain worker running.")
    while True:
        try:
            # Block until at least one signal is available
            signal: SignalIn = await signal_queue.get()
            await _process_signal(signal)
            signal_queue.task_done()

            # Opportunistically drain more without blocking
            batch = 1
            while not signal_queue.empty() and batch < DRAIN_BATCH_SIZE:
                try:
                    signal = signal_queue.get_nowait()
                    await _process_signal(signal)
                    signal_queue.task_done()
                    batch += 1
                except asyncio.QueueEmpty:
                    break

        except asyncio.CancelledError:
            logger.info("Drain worker cancelled.")
            break
        except Exception as exc:
            logger.exception("Drain worker error (continuing): %s", exc)
            await asyncio.sleep(0.1)   # brief back-off before retrying


async def _process_signal(signal: SignalIn) -> None:
    """
    Core per-signal logic:
      1. Resolve/update the debounce window for this component.
      2. Create a WorkItem if this is the first signal in the window.
      3. Save the signal to MongoDB (with work_item_id linked).
    """
    signals_col    = get_signals_collection()
    work_items_col = get_work_items_collection()

    now = datetime.now(tz=timezone.utc)
    component_id = signal.component_id

    # ── Debounce logic ──────────────────────────────────────────────────
    entry = _debounce_registry.get(component_id)
    window_expired = (
        entry is None
        or (now - entry["window_start"]) > timedelta(seconds=DEBOUNCE_WINDOW_SEC)
    )

    if window_expired:
        # Start a fresh debounce window
        _debounce_registry[component_id] = {
            "window_start": now,
            "signal_count": 1,
            "work_item_id": None,
        }
        entry = _debounce_registry[component_id]
    else:
        entry["signal_count"] += 1

    signal_count = entry["signal_count"]
    work_item_id: Optional[str] = entry["work_item_id"]

    # ── Create WorkItem once threshold is hit ───────────────────────────
    if signal_count >= DEBOUNCE_THRESHOLD and work_item_id is None:
        work_item_id = await _create_work_item(signal, now, work_items_col)
        entry["work_item_id"] = work_item_id
        logger.info(
            "WorkItem %s created for component %s (debounce threshold reached)",
            work_item_id, component_id
        )

    # ── Also create a WorkItem for the very first signal in any window ──
    # (so incidents appear immediately, not only after 100 signals)
    if signal_count == 1 and work_item_id is None:
        work_item_id = await _create_work_item(signal, now, work_items_col)
        entry["work_item_id"] = work_item_id
        logger.debug(
            "WorkItem %s created for first signal from %s",
            work_item_id, component_id
        )

    # ── Update existing WorkItem (signal count + timestamps) ────────────
    if work_item_id is not None and signal_count > 1:
        await work_items_col.update_one(
            {"_id": ObjectId(work_item_id)},
            {
                "$inc": {"signal_count": 1},
                "$set": {"last_signal_time": now, "updated_at": now},
            }
        )

    # ── Persist signal to MongoDB ────────────────────────────────────────
    signal_doc = SignalDB(
        **signal.dict(),
        work_item_id=work_item_id,
        received_at=now,
    )
    await signals_col.insert_one(signal_doc.dict())


async def _create_work_item(signal: SignalIn, now: datetime, col) -> str:
    """Insert a new WorkItem and return its string ID."""
    priority = get_priority(signal.component_type)

    work_item = WorkItemDB(
        component_id=signal.component_id,
        component_type=signal.component_type,
        priority=priority,
        status=WorkItemStatus.OPEN,
        signal_count=1,
        first_signal_time=signal.timestamp,
        last_signal_time=signal.timestamp,
        created_at=now,
        updated_at=now,
    )

    result = await col.insert_one(work_item.dict())
    return str(result.inserted_id)


# ─────────────────────────────────────────────
# Background: throughput logger
# ─────────────────────────────────────────────

async def _throughput_logger() -> None:
    """
    Every THROUGHPUT_INTERVAL seconds, prints:
        [WatchTower] Throughput: N signals/sec | Active incidents: M | Queue depth: K
    """
    global _signals_in_window
    logger.info("Throughput logger running.")

    while True:
        try:
            await asyncio.sleep(THROUGHPUT_INTERVAL)

            work_items_col = get_work_items_collection()
            active_count = await work_items_col.count_documents(
                {"status": {"$in": ["OPEN", "INVESTIGATING"]}}
            )

            throughput = _signals_in_window / THROUGHPUT_INTERVAL
            _signals_in_window = 0   # reset counter

            print(
                f"[WatchTower] Throughput: {throughput:.1f} signals/sec | "
                f"Active incidents: {active_count} | "
                f"Queue depth: {signal_queue.qsize()}",
                flush=True,
            )

        except asyncio.CancelledError:
            logger.info("Throughput logger cancelled.")
            break
        except Exception as exc:
            logger.exception("Throughput logger error: %s", exc)