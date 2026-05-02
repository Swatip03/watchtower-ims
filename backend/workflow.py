"""
workflow.py — State Design Pattern for Work Item lifecycle management.

Valid transitions (no skipping allowed):
    OPEN → INVESTIGATING → RESOLVED → CLOSED

CLOSED requires a complete RCA object.
MTTR is auto-calculated (in minutes) when transitioning to CLOSED.

Usage:
    from workflow import WorkItemStateMachine
    machine = WorkItemStateMachine(work_item_doc)
    updated = await machine.transition_to(WorkItemStatus.INVESTIGATING)
"""

import logging
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from typing import Optional

from fastapi import HTTPException
from bson import ObjectId

from models import WorkItemStatus, RCA, VALID_TRANSITIONS, WorkItemDB
from database import get_work_items_collection, doc_to_dict

logger = logging.getLogger("watchtower.workflow")


# ─────────────────────────────────────────────
# Abstract State
# ─────────────────────────────────────────────

class WorkItemState(ABC):
    """
    Each concrete state knows:
      - what status it represents
      - which transition (if any) is valid from here
      - any pre-conditions that must be met before transitioning out
    """

    @property
    @abstractmethod
    def status(self) -> WorkItemStatus:
        ...

    @property
    def next_status(self) -> Optional[WorkItemStatus]:
        return VALID_TRANSITIONS.get(self.status)

    def validate_transition(self, target: WorkItemStatus, rca: Optional[RCA] = None) -> None:
        """
        Raises HTTPException if the transition is invalid.
        Concrete states may override to add extra guards.
        """
        allowed = self.next_status
        if allowed is None:
            raise HTTPException(
                status_code=400,
                detail=f"Work item is CLOSED — no further transitions allowed."
            )
        if target != allowed:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Invalid transition: {self.status} → {target}. "
                    f"Only {self.status} → {allowed} is permitted."
                )
            )


# ─────────────────────────────────────────────
# Concrete States
# ─────────────────────────────────────────────

class OpenState(WorkItemState):
    @property
    def status(self) -> WorkItemStatus:
        return WorkItemStatus.OPEN


class InvestigatingState(WorkItemState):
    @property
    def status(self) -> WorkItemStatus:
        return WorkItemStatus.INVESTIGATING


class ResolvedState(WorkItemState):
    """
    RESOLVED → CLOSED is only valid when a complete RCA is present.
    """
    @property
    def status(self) -> WorkItemStatus:
        return WorkItemStatus.RESOLVED

    def validate_transition(self, target: WorkItemStatus, rca: Optional[RCA] = None) -> None:
        super().validate_transition(target, rca)
        # Extra guard: CLOSED requires RCA
        if target == WorkItemStatus.CLOSED:
            if rca is None:
                raise HTTPException(
                    status_code=400,
                    detail="Cannot close incident: RCA has not been submitted yet."
                )
            # Validate RCA completeness
            _validate_rca_completeness(rca)


class ClosedState(WorkItemState):
    @property
    def status(self) -> WorkItemStatus:
        return WorkItemStatus.CLOSED

    def validate_transition(self, target: WorkItemStatus, rca: Optional[RCA] = None) -> None:
        raise HTTPException(
            status_code=400,
            detail="Work item is CLOSED — it is a terminal state. No further transitions allowed."
        )


# ─────────────────────────────────────────────
# State Factory
# ─────────────────────────────────────────────

_STATE_MAP: dict[WorkItemStatus, WorkItemState] = {
    WorkItemStatus.OPEN:          OpenState(),
    WorkItemStatus.INVESTIGATING: InvestigatingState(),
    WorkItemStatus.RESOLVED:      ResolvedState(),
    WorkItemStatus.CLOSED:        ClosedState(),
}


def _get_state(status: WorkItemStatus) -> WorkItemState:
    state = _STATE_MAP.get(status)
    if state is None:
        raise HTTPException(status_code=500, detail=f"Unknown work item status: {status}")
    return state


# ─────────────────────────────────────────────
# RCA Validation Helper
# ─────────────────────────────────────────────

def _validate_rca_completeness(rca: RCA) -> None:
    """Raise 400 if any required RCA field is empty/missing."""
    errors = []
    if not rca.fix_applied or not rca.fix_applied.strip():
        errors.append("fix_applied")
    if not rca.prevention_steps or not rca.prevention_steps.strip():
        errors.append("prevention_steps")
    if not rca.root_cause_category:
        errors.append("root_cause_category")
    if rca.end_time <= rca.start_time:
        errors.append("end_time must be after start_time")

    if errors:
        raise HTTPException(
            status_code=400,
            detail=f"Incomplete RCA — missing or invalid fields: {', '.join(errors)}"
        )


# ─────────────────────────────────────────────
# MTTR Calculator
# ─────────────────────────────────────────────

def _calculate_mttr(first_signal_time: datetime, rca_end_time: datetime) -> float:
    """
    MTTR (Mean Time To Repair) in minutes.
    = rca.end_time − first signal timestamp
    Both datetimes must be timezone-aware or both naive.
    """
    # Normalise to UTC-aware if needed
    def to_utc(dt: datetime) -> datetime:
        if dt.tzinfo is None:
            return dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)

    delta = to_utc(rca_end_time) - to_utc(first_signal_time)
    return round(delta.total_seconds() / 60, 2)


# ─────────────────────────────────────────────
# State Machine Context
# ─────────────────────────────────────────────

class WorkItemStateMachine:
    """
    Context class. Wraps a raw MongoDB work item document and
    exposes a single transition_to() method.

    After a successful transition the document is updated in MongoDB
    and the updated document dict is returned.
    """

    def __init__(self, work_item_doc: dict) -> None:
        self._doc = work_item_doc
        self._current_state = _get_state(WorkItemStatus(work_item_doc["status"]))

    @property
    def current_status(self) -> WorkItemStatus:
        return self._current_state.status

    async def transition_to(self, target: WorkItemStatus) -> dict:
        """
        Validate and apply a state transition.
        Persists the new status (+ MTTR if closing) to MongoDB.
        Returns the updated document dict.
        """
        # Deserialise RCA if present (needed for CLOSED guard)
        rca: Optional[RCA] = None
        if self._doc.get("rca"):
            rca = RCA(**self._doc["rca"])

        # Delegate validation to the current state
        self._current_state.validate_transition(target, rca)

        # Build the update payload
        now = datetime.now(tz=timezone.utc)
        update: dict = {
            "status": target.value,
            "updated_at": now,
        }

        # Auto-calculate MTTR when closing
        if target == WorkItemStatus.CLOSED and rca is not None:
            mttr = _calculate_mttr(self._doc["first_signal_time"], rca.end_time)
            update["mttr_minutes"] = mttr
            logger.info(
                "Incident %s CLOSED | MTTR = %.2f min", self._doc.get("id", "?"), mttr
            )

        # Persist to MongoDB
        collection = get_work_items_collection()
        work_item_id = self._doc.get("id") or str(self._doc.get("_id"))

        result = await collection.find_one_and_update(
            {"_id": ObjectId(work_item_id)},
            {"$set": update},
            return_document=True,   # return AFTER update
        )

        if result is None:
            raise HTTPException(status_code=404, detail="Work item not found.")

        logger.info(
            "Work item %s transitioned: %s → %s",
            work_item_id, self._current_state.status, target
        )

        return doc_to_dict(result)


# ─────────────────────────────────────────────
# RCA submission helper (called from main.py)
# ─────────────────────────────────────────────

async def submit_rca(work_item_id: str, rca: RCA) -> dict:
    """
    Attach an RCA to a work item in RESOLVED state.
    Does NOT transition to CLOSED — that's a separate step.
    Returns the updated document.
    """
    collection = get_work_items_collection()

    # Fetch current doc
    doc = await collection.find_one({"_id": ObjectId(work_item_id)})
    if doc is None:
        raise HTTPException(status_code=404, detail="Work item not found.")

    current_status = WorkItemStatus(doc["status"])
    if current_status not in (WorkItemStatus.RESOLVED, WorkItemStatus.INVESTIGATING):
        raise HTTPException(
            status_code=400,
            detail=f"RCA can only be submitted when status is INVESTIGATING or RESOLVED. "
                   f"Current status: {current_status}"
        )

    _validate_rca_completeness(rca)

    now = datetime.now(tz=timezone.utc)
    result = await collection.find_one_and_update(
        {"_id": ObjectId(work_item_id)},
        {"$set": {"rca": rca.dict(), "updated_at": now}},
        return_document=True,
    )

    logger.info("RCA submitted for work item %s", work_item_id)
    return doc_to_dict(result)