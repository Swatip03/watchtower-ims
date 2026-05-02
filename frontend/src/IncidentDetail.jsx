import { useState, useEffect, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import axios from "axios";
import RCAForm from "./RCAForm";

const API = "http://localhost:8000";

/* ─────────────────────────────────────────────
   Helpers
───────────────────────────────────────────── */
function timeAgo(isoStr) {
  if (!isoStr) return "—";
  const diff = Math.floor((Date.now() - new Date(isoStr)) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}

function fmtDate(isoStr) {
  if (!isoStr) return "—";
  return new Date(isoStr).toLocaleString("en-IN", {
    dateStyle: "medium", timeStyle: "medium",
  });
}

const NEXT_STATUS = {
  OPEN:          { label: "Start Investigating", next: "INVESTIGATING" },
  INVESTIGATING: { label: "Mark Resolved",       next: "RESOLVED" },
  RESOLVED:      { label: "Close Incident",      next: "CLOSED" },
  CLOSED:        null,
};

const SEVERITY_COLOR = {
  critical: "var(--p0)",
  high:     "var(--p1)",
  medium:   "var(--p2)",
  low:      "var(--text-dim)",
};

/* ─────────────────────────────────────────────
   Section header
───────────────────────────────────────────── */
function SectionHeader({ title, count }) {
  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      marginBottom: 12,
      paddingBottom: 8,
      borderBottom: "1px solid var(--border)",
    }}>
      <span style={{
        fontFamily: "var(--font-display)", fontWeight: 700,
        fontSize: 12, color: "var(--text-bright)", letterSpacing: "0.04em",
      }}>
        {title}
      </span>
      {count !== undefined && (
        <span style={{
          background: "var(--surface-3)", borderRadius: 2,
          fontSize: 10, color: "var(--text-dim)",
          padding: "1px 6px",
        }}>
          {count}
        </span>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────
   Meta row (label + value pairs)
───────────────────────────────────────────── */
function MetaGrid({ rows }) {
  return (
    <div style={{
      display: "grid",
      gridTemplateColumns: "repeat(auto-fill, minmax(200px, 1fr))",
      gap: "10px 24px",
    }}>
      {rows.map(({ label, value, accent }) => (
        <div key={label}>
          <div style={{ fontSize: 9, color: "var(--text-dim)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 3 }}>
            {label}
          </div>
          <div style={{ fontSize: 12, color: accent || "var(--text-bright)", fontWeight: 500 }}>
            {value}
          </div>
        </div>
      ))}
    </div>
  );
}

/* ─────────────────────────────────────────────
   Signal row
───────────────────────────────────────────── */
function SignalRow({ signal, index }) {
  const sevColor = SEVERITY_COLOR[signal.severity?.toLowerCase()] || "var(--text-dim)";

  return (
    <div
      className="fade-up"
      style={{
        display: "grid",
        gridTemplateColumns: "130px 70px 130px 1fr",
        gap: "0 16px",
        alignItems: "center",
        padding: "7px 14px",
        background: index % 2 === 0 ? "var(--surface)" : "var(--surface-2)",
        borderBottom: "1px solid var(--border)",
        fontSize: 11,
        animationDelay: `${Math.min(index * 20, 400)}ms`,
      }}
    >
      <span style={{ color: "var(--text-dim)", fontFamily: "var(--font-mono)" }}>
        {fmtDate(signal.timestamp)}
      </span>
      <span style={{ color: sevColor, fontWeight: 600, textTransform: "uppercase", fontSize: 10 }}>
        {signal.severity}
      </span>
      <span style={{ color: "var(--text-dim)" }}>
        {signal.error_type}
      </span>
      <span style={{ color: "var(--text-bright)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
        {signal.message}
      </span>
    </div>
  );
}

/* ─────────────────────────────────────────────
   RCA display (read-only, when already submitted)
───────────────────────────────────────────── */
function RCADisplay({ rca, mttr }) {
  const labelMap = {
    hardware_failure: "Hardware Failure",
    config_error:     "Config Error",
    software_bug:     "Software Bug",
    human_error:      "Human Error",
    unknown:          "Unknown",
  };

  return (
    <div style={{
      background: "rgba(34,197,94,0.04)",
      border: "1px solid rgba(34,197,94,0.2)",
      borderLeft: "3px solid var(--status-resolved)",
      borderRadius: "var(--radius)",
      padding: "16px 20px",
      display: "flex",
      flexDirection: "column",
      gap: 14,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span style={{ fontSize: 11, fontWeight: 700, color: "var(--status-resolved)", letterSpacing: "0.08em" }}>
          RCA ON FILE
        </span>
        {mttr != null && (
          <span style={{ marginLeft: "auto", fontSize: 11, color: "var(--text-dim)" }}>
            MTTR:{" "}
            <span style={{ color: "var(--status-resolved)", fontWeight: 700, fontFamily: "var(--font-display)", fontSize: 15 }}>
              {mttr}
            </span>
            {" "}min
          </span>
        )}
      </div>

      <MetaGrid rows={[
        { label: "Root Cause", value: labelMap[rca.root_cause_category] || rca.root_cause_category },
        { label: "Start Time", value: fmtDate(rca.start_time) },
        { label: "End Time",   value: fmtDate(rca.end_time) },
      ]} />

      <div>
        <div style={{ fontSize: 9, color: "var(--text-dim)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 5 }}>
          Fix Applied
        </div>
        <div style={{ fontSize: 12, color: "var(--text-bright)", lineHeight: 1.7 }}>{rca.fix_applied}</div>
      </div>
      <div>
        <div style={{ fontSize: 9, color: "var(--text-dim)", letterSpacing: "0.1em", textTransform: "uppercase", marginBottom: 5 }}>
          Prevention Steps
        </div>
        <div style={{ fontSize: 12, color: "var(--text-bright)", lineHeight: 1.7 }}>{rca.prevention_steps}</div>
      </div>
    </div>
  );
}

/* ─────────────────────────────────────────────
   Status transition button
───────────────────────────────────────────── */
function TransitionButton({ status, hasRca, onTransition, transitioning }) {
  const cfg = NEXT_STATUS[status];
  if (!cfg) return null;

  const isClosing = cfg.next === "CLOSED";
  const disabled  = (isClosing && !hasRca) || transitioning;

  const tooltip = isClosing && !hasRca ? "Submit RCA before closing" : cfg.label;

  const colors = {
    INVESTIGATING: { bg: "var(--status-investigating)", text: "#fff" },
    RESOLVED:      { bg: "var(--status-resolved)",      text: "#fff" },
    CLOSED:        { bg: "var(--status-closed)",         text: "#fff" },
  };
  const { bg, text } = colors[cfg.next] || { bg: "var(--accent)", text: "#fff" };

  return (
    <button
      onClick={() => !disabled && onTransition(cfg.next)}
      title={tooltip}
      style={{
        background: disabled ? "var(--surface-3)" : bg,
        color: disabled ? "var(--text-dim)" : text,
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: "0.1em",
        padding: "9px 20px",
        borderRadius: "var(--radius)",
        opacity: disabled ? 0.5 : 1,
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "background 0.2s, opacity 0.2s",
        whiteSpace: "nowrap",
      }}
    >
      {transitioning ? "UPDATING..." : `${cfg.label} →`}
    </button>
  );
}

/* ─────────────────────────────────────────────
   Main IncidentDetail page
───────────────────────────────────────────── */
export default function IncidentDetail() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [item, setItem]                   = useState(null);
  const [signals, setSignals]             = useState([]);
  const [loading, setLoading]             = useState(true);
  const [error, setError]                 = useState(null);
  const [transitioning, setTransitioning] = useState(false);
  const [transitionError, setTransitionError] = useState(null);
  const [showRcaForm, setShowRcaForm]     = useState(false);

  /* ── Fetch ── */
  const fetchItem = useCallback(async () => {
    try {
      const { data } = await axios.get(`${API}/api/work-items/${id}`);
      const { signals: sigs, ...workItem } = data;
      setItem(workItem);
      setSignals(sigs || []);
      setError(null);
    } catch (err) {
      setError(err?.response?.data?.detail || "Failed to load incident.");
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => { fetchItem(); }, [fetchItem]);

  /* ── Status transition ── */
  async function handleTransition(nextStatus) {
    setTransitioning(true);
    setTransitionError(null);
    try {
      const { data } = await axios.patch(
        `${API}/api/work-items/${id}/status`,
        { status: nextStatus }
      );
      setItem(data);
    } catch (err) {
      const msg = err?.response?.data?.detail || "Transition failed.";
      setTransitionError(msg);
    } finally {
      setTransitioning(false);
    }
  }

  /* ── RCA submitted ── */
  function handleRcaSuccess(updatedItem) {
    setItem(updatedItem);
    setShowRcaForm(false);
  }

  /* ── Loading / error ── */
  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: 80, color: "var(--text-dim)" }}>
        Loading incident...
      </div>
    );
  }

  if (error || !item) {
    return (
      <div style={{ maxWidth: 700, margin: "0 auto" }}>
        <div style={{
          background: "rgba(255,59,59,0.06)", border: "1px solid rgba(255,59,59,0.25)",
          borderRadius: "var(--radius)", padding: "20px 24px", color: "var(--p0)",
        }}>
          ⚠ {error || "Incident not found."}
        </div>
        <button onClick={() => navigate("/")} style={{
          marginTop: 16, background: "none", color: "var(--accent)",
          fontSize: 11, letterSpacing: "0.08em",
        }}>
          ← Back to Live Feed
        </button>
      </div>
    );
  }

  const hasRca = Boolean(item.rca);
  const showRcaSection = ["RESOLVED", "INVESTIGATING", "CLOSED"].includes(item.status);

  /* ── Render ── */
  return (
    <div style={{ maxWidth: 960, margin: "0 auto", display: "flex", flexDirection: "column", gap: 20 }}>

      {/* Back link */}
      <button
        onClick={() => navigate("/")}
        style={{ alignSelf: "flex-start", background: "none", color: "var(--text-dim)", fontSize: 11, letterSpacing: "0.06em" }}
      >
        ← LIVE FEED
      </button>

      {/* ── Header card ── */}
      <div
        className="fade-up"
        style={{
          background: "var(--surface)",
          border: "1px solid var(--border)",
          borderLeft: `3px solid var(--${item.priority.toLowerCase()})`,
          borderRadius: "var(--radius)",
          padding: "20px 24px",
          display: "flex",
          flexDirection: "column",
          gap: 16,
        }}
      >
        {/* Title row */}
        <div style={{ display: "flex", alignItems: "flex-start", gap: 12, flexWrap: "wrap" }}>
          <div style={{ flex: 1 }}>
            <h2 style={{
              fontFamily: "var(--font-display)", fontWeight: 800,
              fontSize: 18, color: "var(--text-bright)", letterSpacing: "0.02em",
              marginBottom: 4,
            }}>
              {item.component_id}
            </h2>
            <span style={{ fontSize: 10, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: "0.1em" }}>
              {item.component_type} · ID: {item.id}
            </span>
          </div>

          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span className={`badge badge-${item.priority.toLowerCase()}`}>{item.priority}</span>
            <span className={`badge badge-${item.status.toLowerCase()}`}>{item.status}</span>
          </div>
        </div>

        {/* Meta grid */}
        <MetaGrid rows={[
          { label: "Signal Count",  value: item.signal_count },
          { label: "First Signal",  value: fmtDate(item.first_signal_time) },
          { label: "Last Signal",   value: fmtDate(item.last_signal_time) },
          { label: "Created",       value: timeAgo(item.created_at) },
          { label: "Last Updated",  value: timeAgo(item.updated_at) },
          ...(item.mttr_minutes != null
            ? [{ label: "MTTR", value: `${item.mttr_minutes} minutes`, accent: "var(--status-resolved)" }]
            : []),
        ]} />

        {/* Transition controls */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          flexWrap: "wrap", gap: 10,
          paddingTop: 12, borderTop: "1px solid var(--border)",
        }}>
          <div>
            {transitionError && (
              <span style={{ fontSize: 11, color: "var(--p0)" }}>⚠ {transitionError}</span>
            )}
            {item.status === "RESOLVED" && !hasRca && (
              <span style={{ fontSize: 11, color: "var(--p2)" }}>
                ⚠ RCA required before closing
              </span>
            )}
            {item.status === "CLOSED" && (
              <span style={{ fontSize: 11, color: "var(--status-closed)" }}>
                This incident is closed — no further transitions.
              </span>
            )}
          </div>

          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            {showRcaSection && !hasRca && item.status !== "CLOSED" && (
              <button
                onClick={() => setShowRcaForm((v) => !v)}
                style={{
                  background: "var(--surface-2)",
                  color: "var(--text-dim)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius)",
                  fontSize: 11,
                  padding: "8px 16px",
                  letterSpacing: "0.08em",
                }}
              >
                {showRcaForm ? "HIDE RCA FORM" : "FILL RCA →"}
              </button>
            )}

            <TransitionButton
              status={item.status}
              hasRca={hasRca}
              onTransition={handleTransition}
              transitioning={transitioning}
            />
          </div>
        </div>
      </div>

      {/* ── RCA section ── */}
      {showRcaSection && (
        <div className="fade-up" style={{ animationDelay: "60ms" }}>
          <SectionHeader title="Root Cause Analysis" />

          {hasRca ? (
            <RCADisplay rca={item.rca} mttr={item.mttr_minutes} />
          ) : showRcaForm ? (
            <RCAForm workItemId={id} onSuccess={handleRcaSuccess} />
          ) : (
            <div style={{
              border: "1px dashed var(--border)", borderRadius: "var(--radius)",
              padding: "18px 22px", color: "var(--text-dim)", fontSize: 12, textAlign: "center",
            }}>
              No RCA submitted yet — click "FILL RCA →" above to add one.
            </div>
          )}
        </div>
      )}

      {/* ── Signal log ── */}
      <div className="fade-up" style={{ animationDelay: "100ms" }}>
        <SectionHeader title="Signal Log" count={signals.length} />

        {signals.length === 0 ? (
          <div style={{
            padding: "20px 14px", color: "var(--text-dim)",
            fontSize: 12, textAlign: "center",
            border: "1px dashed var(--border)", borderRadius: "var(--radius)",
          }}>
            No signals linked yet.
          </div>
        ) : (
          <div style={{
            background: "var(--surface)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius)",
            overflow: "hidden",
          }}>
            {/* Table header */}
            <div style={{
              display: "grid",
              gridTemplateColumns: "130px 70px 130px 1fr",
              gap: "0 16px",
              padding: "6px 14px",
              background: "var(--surface-3)",
              borderBottom: "1px solid var(--border)",
              fontSize: 9, fontWeight: 600,
              letterSpacing: "0.1em", color: "var(--text-dim)",
              textTransform: "uppercase",
            }}>
              <span>Timestamp</span>
              <span>Severity</span>
              <span>Error Type</span>
              <span>Message</span>
            </div>

            {/* Scrollable rows */}
            <div style={{ maxHeight: 360, overflowY: "auto" }}>
              {signals.map((s, i) => (
                <SignalRow key={s._id || i} signal={s} index={i} />
              ))}
            </div>
          </div>
        )}
      </div>

    </div>
  );
}