"""
database.py — Motor (async MongoDB) connection and collection accessors.

All other modules import `db` from here. Connection is established once
at startup via `connect_db()` called from main.py lifespan.
"""

import os
import logging
from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase, AsyncIOMotorCollection

logger = logging.getLogger("watchtower.db")

# ─────────────────────────────────────────────
# Module-level singletons (set in connect_db)
# ─────────────────────────────────────────────

_client: AsyncIOMotorClient | None = None
_db: AsyncIOMotorDatabase | None = None


# ─────────────────────────────────────────────
# Lifecycle helpers (called from main.py)
# ─────────────────────────────────────────────

async def connect_db() -> None:
    """Open the Motor connection and create indexes."""
    global _client, _db

    mongo_url = os.getenv("MONGO_URL", "mongodb://localhost:27017")
    db_name = os.getenv("MONGO_DB", "watchtower")

    _client = AsyncIOMotorClient(mongo_url)
    _db = _client[db_name]

    await _ensure_indexes()
    logger.info("MongoDB connected → %s / %s", mongo_url, db_name)


async def close_db() -> None:
    """Close the Motor connection gracefully."""
    global _client
    if _client:
        _client.close()
        logger.info("MongoDB connection closed.")


# ─────────────────────────────────────────────
# Index creation
# ─────────────────────────────────────────────

async def _ensure_indexes() -> None:
    """Create indexes for common query patterns. Safe to call on every startup."""
    signals = get_signals_collection()
    work_items = get_work_items_collection()

    # signals: look up by component and by work_item_id
    await signals.create_index("component_id")
    await signals.create_index("work_item_id")
    await signals.create_index("timestamp")

    # work_items: sort by priority + status (live feed query)
    await work_items.create_index([("priority", 1), ("status", 1)])
    await work_items.create_index("component_id")
    await work_items.create_index("status")

    logger.info("MongoDB indexes ensured.")


# ─────────────────────────────────────────────
# Collection accessors
# ─────────────────────────────────────────────

def get_db() -> AsyncIOMotorDatabase:
    if _db is None:
        raise RuntimeError("Database not initialised — call connect_db() first.")
    return _db


def get_signals_collection() -> AsyncIOMotorCollection:
    return get_db()["signals"]


def get_work_items_collection() -> AsyncIOMotorCollection:
    return get_db()["work_items"]


# ─────────────────────────────────────────────
# Utility: serialize a MongoDB document
# ─────────────────────────────────────────────

def doc_to_dict(doc: dict) -> dict:
    """
    Convert a raw MongoDB document to a plain dict safe for Pydantic / JSON.
    - Renames `_id` (ObjectId) → `id` (str)
    - Leaves all other fields untouched
    """
    if doc is None:
        return {}
    result = dict(doc)
    if "_id" in result:
        result["id"] = str(result.pop("_id"))
    return result