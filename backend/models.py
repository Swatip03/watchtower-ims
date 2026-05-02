from pydantic import BaseModel, Field, validator
from typing import Optional
from datetime import datetime
from enum import Enum


# ─────────────────────────────────────────────
# Enums
# ─────────────────────────────────────────────

class ComponentType(str, Enum):
    rdbms = "rdbms"
    api = "api"
    cache = "cache"
    queue = "queue"
    mcp_host = "mcp_host"


class Priority(str, Enum):
    P0 = "P0"
    P1 = "P1"
    P2 = "P2"
    P3 = "P3"


class WorkItemStatus(str, Enum):
    OPEN = "OPEN"
    INVESTIGATING = "INVESTIGATING"
    RESOLVED = "RESOLVED"
    CLOSED = "CLOSED"


class RootCauseCategory(str, Enum):
    hardware_failure = "hardware_failure"
    config_error = "config_error"
    software_bug = "software_bug"
    human_error = "human_error"
    unknown = "unknown"


# ─────────────────────────────────────────────
# Valid state transitions (State Pattern)
# ─────────────────────────────────────────────

VALID_TRANSITIONS = {
    WorkItemStatus.OPEN: WorkItemStatus.INVESTIGATING,
    WorkItemStatus.INVESTIGATING: WorkItemStatus.RESOLVED,
    WorkItemStatus.RESOLVED: WorkItemStatus.CLOSED,
    WorkItemStatus.CLOSED: None,  # terminal state
}


# ─────────────────────────────────────────────
# RCA Model
# ─────────────────────────────────────────────

class RCA(BaseModel):
    start_time: datetime
    end_time: datetime
    root_cause_category: RootCauseCategory
    fix_applied: str = Field(..., min_length=1)
    prevention_steps: str = Field(..., min_length=1)

    @validator("end_time")
    def end_must_be_after_start(cls, v, values):
        if "start_time" in values and v <= values["start_time"]:
            raise ValueError("end_time must be after start_time")
        return v


# ─────────────────────────────────────────────
# Signal Models
# ─────────────────────────────────────────────

class SignalIn(BaseModel):
    """Payload accepted at POST /api/signals"""
    component_id: str = Field(..., min_length=1)
    component_type: ComponentType
    error_type: str = Field(..., min_length=1)
    severity: str = Field(..., min_length=1)
    message: str = Field(..., min_length=1)
    timestamp: datetime


class SignalDB(SignalIn):
    """Signal as stored in MongoDB (includes work_item_id after debounce linking)"""
    work_item_id: Optional[str] = None
    received_at: datetime = Field(default_factory=datetime.utcnow)


# ─────────────────────────────────────────────
# Work Item Models
# ─────────────────────────────────────────────

class WorkItemDB(BaseModel):
    """Work item as stored in MongoDB"""
    component_id: str
    component_type: ComponentType
    priority: Priority
    status: WorkItemStatus = WorkItemStatus.OPEN
    signal_count: int = 1
    first_signal_time: datetime
    last_signal_time: datetime
    rca: Optional[RCA] = None
    mttr_minutes: Optional[float] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)
    updated_at: datetime = Field(default_factory=datetime.utcnow)


class WorkItemOut(WorkItemDB):
    """Work item returned in API responses — includes Mongo _id as string id"""
    id: str


# ─────────────────────────────────────────────
# Request Bodies
# ─────────────────────────────────────────────

class StatusTransitionRequest(BaseModel):
    status: WorkItemStatus


class HealthResponse(BaseModel):
    status: str = "ok"
    uptime_seconds: float