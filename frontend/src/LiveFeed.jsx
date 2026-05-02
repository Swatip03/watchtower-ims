import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import axios from "axios";

const API = "http://localhost:8000";

/* ─────────────────────────────────────────────
   Helpers
───────────────────────────────────────────── */
function priorityClass(p) {
  return `badge badge-${p.toLowerCase()}`;
}

function statusClass(s) {
  return `badge badge-${s.toLowerCase()}`;
}

function timeAgo(isoStr) {
  if (!isoStr) return "—";
  const diff = Math.floor((Date.now() - new Date(isoStr)) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

const STATUS_ORDER = { OPEN: 0, INVESTIGATING: 1, RESOLVED: 2, CLOSED: 3 };

/* ─────────────────────────────────────────────
   P0 alert banner (shown when any P0 is OPEN/INVESTIGATING)
───────────────────────────────────────────── */
function CriticalBanner({ items }) {
  const critical = items.filter(
    (i) => i.priority === "P0" && ["OPEN", "INVESTIGATING"].includes(i.status)
  );
  if (!critical.length) return null;

  return (
    <div style={{
      background: "rgba(255,59,59,0.08)",
      border: "1px solid rgba(255,59,59,0.35)",
      borderLeft: "3px solid var(--p0)",
      borderRadius: "var(--radius)",
      padding: "10px 16px",
      marginBottom: 20,
      display: "flex",
      alignItems: "center",
      gap: 10,
      animation: "fadeUp 0.3s ease both",
    }}>
      <span style={{
        width: 8, height: 8, borderRadius: "50%",
        background: "var(--p0)",
        boxShadow: "0 0 8px var(--p0)",
        flexShrink: 0,
        animation: "pulse-dot 1s ease-in-out infinite",
      }} />
      <span style={{ color: "var(--p0)", fontWeight: 700, fontSize: 11, letterSpacing: "0.08em" }}>
        CRITICAL ALERT
      </span>
      <span style={{ color: "var(--text-dim)", fontSize: 11 }}>
        {critical.length} P0 incident{critical.length > 1 ? "s" : ""} active —{" "}
        {critical.map((i) => i.component_id).join(", ")}
      </span>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Stat strip at the top
───────────────────────────────────────────── */
function StatStrip({ items }) {
  const counts = { OPEN: 0, INVESTIGATING: 0, RESOLVED: 0, CLOSED: 0 };
  items.forEach((i) => counts[i.status]++);

  const stats = [
    { label: "OPEN",          value: counts.OPEN,          color: "var(--status-open)" },
    { label: "INVESTIGATING", value: counts.INVESTIGATING, color: "var(--status-investigating)" },
    { label: "RESOLVED",      value: counts.RESOLVED,       color: "var(--status-resolved)" },
    { label: "CLOSED",        value: counts.CLOSED,         color: "var(--status-closed)" },
    { label: "TOTAL",         value: items.length,          color: "var(--text-bright)" },
  ];

  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(5, 1fr)",
      gap: 1,
      marginBottom: 20,
      background: "var(--border)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius)",
      overflow: "hidden",
    }}>
      {stats.map(({ label, value, color }) => (
        <div key={label} style={{
          background: "var(--surface)",
          padding: "12px 16px",
          textAlign: "center",
        }}>
          <div style={{ fontSize: 22, fontWeight: 700, color, fontFamily: "var(--font-display)" }}>
            {value}
          </div>
          <div style={{ fontSize: 9, color: "var(--text-dim)", letterSpacing: "0.1em", marginTop: 2 }}>
            {label}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────────────────────────────
   Individual incident card
───────────────────────────────────────────── */
function IncidentCard({ item, index }) {
  const navigate = useNavigate();

  const p0glow = item.priority === "P0"
    ? { boxShadow: "0 0 0 1px rgba(255,59,59,0.2), 0 4px 24px rgba(255,59,59,0.06)" }
    : {};

  return (
    <div
      onClick={() => navigate(`/incidents/${item.id}`)}
      className="fade-up"
      style={{
        background: "var(--surface)",
        border: "1px solid var(--border)",
        borderLeft: `3px solid var(--${item.priority.toLowerCase()})`,
        borderRadius: "var(--radius)",
        padding: "14px 18px",
        cursor: "pointer",
        transition: "border-color 0.2s, background 0.2s",
        animationDelay: `${index * 40}ms`,
        ...p0glow,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = "var(--surface-2)";
        e.currentTarget.style.borderColor = "var(--border-glow)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "var(--surface)";
        e.currentTarget.style.borderColor = "var(--border)";
      }}
    >
      {/* Top row: component + badges */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{
          fontFamily: "var(--font-display)",
          fontWeight: 700,
          fontSize: 13,
          color: "var(--text-bright)",
          flex: 1,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}>
          {item.component_id}
        </span>
        <span className={priorityClass(item.priority)}>{item.priority}</span>
        <span className={statusClass(item.status)}>{item.status}</span>
      </div>

      {/* Component type + signal count + time */}
      <div style={{ display: "flex", gap: 20, alignItems: "center" }}>
        <span style={{ color: "var(--text-dim)", fontSize: 11, textTransform: "uppercase", letterSpacing: "0.08em" }}>
          {item.component_type}
        </span>

        <span style={{ color: "var(--text-dim)", fontSize: 11, display: "flex", alignItems: "center", gap: 5 }}>
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
            <circle cx="5" cy="5" r="4" stroke="currentColor" strokeWidth="1.2" />
            <line x1="5" y1="2" x2="5" y2="5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
            <line x1="5" y1="5" x2="7" y2="7" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
          </svg>
          {timeAgo(item.first_signal_time)}
        </span>

        <span style={{ marginLeft: "auto", color: "var(--text-dim)", fontSize: 11 }}>
          <span style={{ color: "var(--text-bright)", fontWeight: 600 }}>{item.signal_count}</span>
          {" "}signal{item.signal_count !== 1 ? "s" : ""}
        </span>

        {item.mttr_minutes != null && (
          <span style={{ fontSize: 10, color: "var(--status-resolved)", letterSpacing: "0.05em" }}>
            MTTR {item.mttr_minutes}m
          </span>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Filter / sort bar
───────────────────────────────────────────── */
function FilterBar({ filter, setFilter, sortBy, setSortBy, total }) {
  const statuses = ["ALL", "OPEN", "INVESTIGATING", "RESOLVED", "CLOSED"];

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 12,
      marginBottom: 16, flexWrap: "wrap",
    }}>
      <div style={{ display: "flex", gap: 1, background: "var(--border)", borderRadius: "var(--radius)", overflow: "hidden" }}>
        {statuses.map((s) => (
          <button
            key={s}
            onClick={() => setFilter(s)}
            style={{
              background: filter === s ? "var(--surface-3)" : "var(--surface)",
              color: filter === s ? "var(--text-bright)" : "var(--text-dim)",
              fontSize: 10,
              fontWeight: filter === s ? 700 : 400,
              letterSpacing: "0.08em",
              padding: "5px 12px",
              transition: "all 0.15s",
            }}
          >
            {s}
          </button>
        ))}
      </div>

      <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ color: "var(--text-dim)", fontSize: 10 }}>SORT</span>
        {["priority", "time", "signals"].map((opt) => (
          <button
            key={opt}
            onClick={() => setSortBy(opt)}
            style={{
              background: sortBy === opt ? "var(--accent-dim)" : "none",
              color: sortBy === opt ? "var(--accent)" : "var(--text-dim)",
              border: sortBy === opt ? "1px solid rgba(59,130,246,0.3)" : "1px solid transparent",
              borderRadius: "var(--radius)",
              fontSize: 10,
              letterSpacing: "0.08em",
              padding: "3px 9px",
              textTransform: "uppercase",
              transition: "all 0.15s",
            }}
          >
            {opt}
          </button>
        ))}
      </div>

      <span style={{ color: "var(--text-dim)", fontSize: 10 }}>
        {total} incident{total !== 1 ? "s" : ""}
      </span>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Main LiveFeed page
───────────────────────────────────────────── */
export default function LiveFeed() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [filter, setFilter] = useState("ALL");
  const [sortBy, setSortBy] = useState("priority");
  const intervalRef = useRef(null);

  const PRIORITY_ORDER = { P0: 0, P1: 1, P2: 2, P3: 3 };

  async function fetchItems() {
    try {
      const { data } = await axios.get(`${API}/api/work-items`);
      setItems(data);
      setLastRefresh(new Date());
      setError(null);
    } catch (err) {
      setError("Cannot reach backend — is it running?");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    fetchItems();
    intervalRef.current = setInterval(fetchItems, 5000);
    return () => clearInterval(intervalRef.current);
  }, []);

  // Filter
  const filtered = filter === "ALL" ? items : items.filter((i) => i.status === filter);

  // Sort
  const sorted = [...filtered].sort((a, b) => {
    if (sortBy === "priority") {
      const pd = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      if (pd !== 0) return pd;
      return STATUS_ORDER[a.status] - STATUS_ORDER[b.status];
    }
    if (sortBy === "time") {
      return new Date(b.first_signal_time) - new Date(a.first_signal_time);
    }
    if (sortBy === "signals") {
      return b.signal_count - a.signal_count;
    }
    return 0;
  });

  /* ── Render ── */
  return (
    <div style={{ maxWidth: 900, margin: "0 auto" }}>
      {/* Page header */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 20 }}>
        <h1 style={{
          fontFamily: "var(--font-display)",
          fontWeight: 800,
          fontSize: 20,
          color: "var(--text-bright)",
          letterSpacing: "0.02em",
        }}>
          Live Incident Feed
        </h1>
        <span style={{ fontSize: 10, color: "var(--text-dim)" }}>
          auto-refresh 5s
        </span>
        {lastRefresh && (
          <span style={{ fontSize: 10, color: "var(--text-dim)", marginLeft: "auto" }}>
            updated {lastRefresh.toLocaleTimeString()}
          </span>
        )}
        <button
          onClick={fetchItems}
          style={{
            background: "var(--surface-2)",
            color: "var(--text-dim)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            fontSize: 10,
            padding: "4px 10px",
            letterSpacing: "0.08em",
          }}
        >
          ↺ REFRESH
        </button>
      </div>

      {/* Critical banner */}
      <CriticalBanner items={items} />

      {/* Stat strip */}
      {!loading && !error && <StatStrip items={items} />}

      {/* Filter bar */}
      {!loading && !error && (
        <FilterBar
          filter={filter} setFilter={setFilter}
          sortBy={sortBy} setSortBy={setSortBy}
          total={sorted.length}
        />
      )}

      {/* States */}
      {loading && (
        <div style={{ textAlign: "center", padding: 60, color: "var(--text-dim)", fontSize: 12 }}>
          <div style={{ marginBottom: 12, fontSize: 20 }}>⟳</div>
          Connecting to WatchTower backend...
        </div>
      )}

      {error && (
        <div style={{
          background: "rgba(255,59,59,0.06)",
          border: "1px solid rgba(255,59,59,0.25)",
          borderRadius: "var(--radius)",
          padding: "20px 24px",
          color: "var(--p0)",
          fontSize: 12,
        }}>
          ⚠ {error}
        </div>
      )}

      {!loading && !error && sorted.length === 0 && (
        <div style={{
          textAlign: "center", padding: 60,
          color: "var(--text-dim)", fontSize: 12,
          border: "1px dashed var(--border)",
          borderRadius: "var(--radius)",
        }}>
          <div style={{ fontSize: 28, marginBottom: 12 }}>✓</div>
          No incidents{filter !== "ALL" ? ` matching "${filter}"` : ""} — all systems nominal
        </div>
      )}

      {/* Incident cards */}
      {!loading && !error && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {sorted.map((item, i) => (
            <IncidentCard key={item.id} item={item} index={i} />
          ))}
        </div>
      )}
    </div>
  );
}