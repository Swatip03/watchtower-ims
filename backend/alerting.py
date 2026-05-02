"""
alerting.py — Strategy Design Pattern for incident priority assignment.

Each component type maps to a concrete PriorityStrategy. The
PriorityAssigner acts as the context — it accepts a strategy at runtime
and delegates the priority decision to it.

Usage:
    from alerting import PriorityAssigner
    priority = PriorityAssigner.for_component("rdbms").assign()
    # → "P0"
"""

from abc import ABC, abstractmethod
from models import ComponentType, Priority


# ─────────────────────────────────────────────
# Abstract Strategy
# ─────────────────────────────────────────────

class PriorityStrategy(ABC):
    """Base strategy — all concrete strategies implement assign()."""

    @abstractmethod
    def assign(self) -> Priority:
        ...

    def __repr__(self) -> str:
        return f"<{self.__class__.__name__}>"


# ─────────────────────────────────────────────
# Concrete Strategies
# ─────────────────────────────────────────────

class CriticalPriority(PriorityStrategy):
    """P0 — rdbms failures are catastrophic; data loss risk."""
    def assign(self) -> Priority:
        return Priority.P0


class HighPriority(PriorityStrategy):
    """P1 — api and mcp_host failures impact end-users directly."""
    def assign(self) -> Priority:
        return Priority.P1


class MediumPriority(PriorityStrategy):
    """P2 — cache and queue failures degrade but don't halt the system."""
    def assign(self) -> Priority:
        return Priority.P2


class LowPriority(PriorityStrategy):
    """P3 — unknown or future component types; investigate when bandwidth allows."""
    def assign(self) -> Priority:
        return Priority.P3


# ─────────────────────────────────────────────
# Strategy Registry
# ─────────────────────────────────────────────

_STRATEGY_MAP: dict[str, PriorityStrategy] = {
    ComponentType.rdbms:    CriticalPriority(),
    ComponentType.api:      HighPriority(),
    ComponentType.mcp_host: HighPriority(),
    ComponentType.cache:    MediumPriority(),
    ComponentType.queue:    MediumPriority(),
}

_DEFAULT_STRATEGY = LowPriority()


# ─────────────────────────────────────────────
# Context (Assigner)
# ─────────────────────────────────────────────

class PriorityAssigner:
    """
    Context class that selects the correct strategy for a given
    component type and delegates priority assignment to it.
    """

    def __init__(self, strategy: PriorityStrategy) -> None:
        self._strategy = strategy

    @classmethod
    def for_component(cls, component_type: str) -> "PriorityAssigner":
        """
        Factory method — resolves the right strategy from the registry.
        Falls back to LowPriority for any unrecognised component type.
        """
        strategy = _STRATEGY_MAP.get(component_type, _DEFAULT_STRATEGY)
        return cls(strategy)

    def assign(self) -> Priority:
        """Execute the strategy and return the priority string."""
        return self._strategy.assign()


# ─────────────────────────────────────────────
# Convenience function (used in ingestion.py)
# ─────────────────────────────────────────────

def get_priority(component_type: str) -> Priority:
    """
    One-liner helper for callers that don't need the full assigner object.

        priority = get_priority("rdbms")   # → Priority.P0
    """
    return PriorityAssigner.for_component(component_type).assign()