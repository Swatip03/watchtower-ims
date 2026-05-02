import { useState } from "react";
import axios from "axios";

const API = "http://localhost:8000";

const ROOT_CAUSE_OPTIONS = [
  { value: "hardware_failure", label: "Hardware Failure" },
  { value: "config_error",     label: "Config Error" },
  { value: "software_bug",     label: "Software Bug" },
  { value: "human_error",      label: "Human Error" },
  { value: "unknown",          label: "Unknown" },
];

/* ─────────────────────────────────────────────
   Shared input styles
───────────────────────────────────────────── */
const inputBase = {
  width: "100%",
  background: "var(--surface)",
  border: "1px solid var(--border)",
  borderRadius: "var(--radius)",
  color: "var(--text-bright)",
  fontFamily: "var(--font-mono)",
  fontSize: 12,
  padding: "8px 11px",
  outline: "none",
  transition: "border-color 0.2s",
};

function Field({ label, hint, error, children }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
        <label style={{
          fontSize: 10,
          fontWeight: 600,
          letterSpacing: "0.1em",
          color: "var(--text-dim)",
          textTransform: "uppercase",
        }}>
          {label}
        </label>
        {hint && <span style={{ fontSize: 10, color: "var(--text-dim)" }}>{hint}</span>}
      </div>
      {children}
      {error && (
        <span style={{ fontSize: 10, color: "var(--p0)" }}>⚠ {error}</span>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────
   MTTR result display
───────────────────────────────────────────── */
function MttrBadge({ mttr, onClose }) {
  return (
    <div style={{
      background: "rgba(34,197,94,0.07)",
      border: "1px solid rgba(34,197,94,0.25)",
      borderLeft: "3px solid var(--status-resolved)",
      borderRadius: "var(--radius)",
      padding: "14px 18px",
      display: "flex",
      alignItems: "center",
      gap: 14,
      animation: "fadeUp 0.3s ease both",
    }}>
      <span style={{ fontSize: 24 }}>✓</span>
      <div>
        <div style={{ fontSize: 11, color: "var(--status-resolved)", fontWeight: 700, letterSpacing: "0.08em" }}>
          RCA SUBMITTED
        </div>
        <div style={{ fontSize: 13, color: "var(--text-bright)", marginTop: 2 }}>
          Mean Time To Repair:{" "}
          <span style={{
            fontFamily: "var(--font-display)",
            fontWeight: 800,
            fontSize: 18,
            color: "var(--status-resolved)",
          }}>
            {mttr}
          </span>
          <span style={{ fontSize: 11, color: "var(--text-dim)", marginLeft: 4 }}>minutes</span>
        </div>
      </div>
      {onClose && (
        <button
          onClick={onClose}
          style={{
            marginLeft: "auto",
            background: "none",
            color: "var(--text-dim)",
            fontSize: 16,
            padding: "2px 6px",
          }}
        >
          ×
        </button>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────
   RCAForm component
   Props:
     workItemId  — string
     onSuccess   — callback(updatedWorkItem)
───────────────────────────────────────────── */
export default function RCAForm({ workItemId, onSuccess }) {
  const [form, setForm] = useState({
    start_time: "",
    end_time: "",
    root_cause_category: "",
    fix_applied: "",
    prevention_steps: "",
  });
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [apiError, setApiError] = useState(null);
  const [mttr, setMttr] = useState(null);   // set on success

  /* ── Validation ── */
  function validate() {
    const e = {};
    if (!form.start_time) e.start_time = "Required";
    if (!form.end_time)   e.end_time   = "Required";
    if (form.start_time && form.end_time && new Date(form.end_time) <= new Date(form.start_time))
      e.end_time = "End time must be after start time";
    if (!form.root_cause_category) e.root_cause_category = "Required";
    if (!form.fix_applied.trim())  e.fix_applied          = "Required";
    if (!form.prevention_steps.trim()) e.prevention_steps = "Required";
    return e;
  }

  function set(key, value) {
    setForm((f) => ({ ...f, [key]: value }));
    setErrors((e) => ({ ...e, [key]: undefined }));
  }

  /* ── Submit ── */
  async function handleSubmit() {
    const e = validate();
    if (Object.keys(e).length) { setErrors(e); return; }

    setSubmitting(true);
    setApiError(null);

    try {
      const payload = {
        start_time: new Date(form.start_time).toISOString(),
        end_time:   new Date(form.end_time).toISOString(),
        root_cause_category: form.root_cause_category,
        fix_applied:      form.fix_applied.trim(),
        prevention_steps: form.prevention_steps.trim(),
      };

      const { data } = await axios.post(
        `${API}/api/work-items/${workItemId}/rca`,
        payload
      );

      // Show MTTR if backend calculated it (only available after CLOSED)
      // For now we compute locally from the form values
      const diffMs  = new Date(form.end_time) - new Date(form.start_time);
      const diffMin = (diffMs / 60000).toFixed(1);
      setMttr(diffMin);

      if (onSuccess) onSuccess(data);
    } catch (err) {
      const msg = err?.response?.data?.detail || "Failed to submit RCA. Check backend logs.";
      setApiError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  /* ── Focus glow helper ── */
  function onFocus(e)  { e.target.style.borderColor = "var(--accent)"; }
  function onBlur(e)   { e.target.style.borderColor = "var(--border)"; }

  /* ── Render ── */
  if (mttr !== null) {
    return <MttrBadge mttr={mttr} onClose={() => setMttr(null)} />;
  }

  return (
    <div style={{
      background: "var(--surface)",
      border: "1px solid var(--border)",
      borderRadius: "var(--radius)",
      padding: "20px 22px",
      display: "flex",
      flexDirection: "column",
      gap: 16,
      animation: "fadeUp 0.3s ease both",
    }}>
      {/* Header */}
      <div style={{ borderBottom: "1px solid var(--border)", paddingBottom: 12 }}>
        <div style={{
          fontFamily: "var(--font-display)",
          fontWeight: 700,
          fontSize: 13,
          color: "var(--text-bright)",
          marginBottom: 3,
        }}>
          Root Cause Analysis
        </div>
        <div style={{ fontSize: 10, color: "var(--text-dim)" }}>
          All fields are mandatory. RCA must be complete before closing the incident.
        </div>
      </div>

      {/* Time range */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Incident Start Time" error={errors.start_time}>
          <input
            type="datetime-local"
            value={form.start_time}
            onChange={(e) => set("start_time", e.target.value)}
            onFocus={onFocus} onBlur={onBlur}
            style={{ ...inputBase, colorScheme: "dark" }}
          />
        </Field>

        <Field label="Incident End Time" error={errors.end_time}>
          <input
            type="datetime-local"
            value={form.end_time}
            onChange={(e) => set("end_time", e.target.value)}
            onFocus={onFocus} onBlur={onBlur}
            style={{ ...inputBase, colorScheme: "dark" }}
          />
        </Field>
      </div>

      {/* Root cause category */}
      <Field label="Root Cause Category" error={errors.root_cause_category}>
        <select
          value={form.root_cause_category}
          onChange={(e) => set("root_cause_category", e.target.value)}
          onFocus={onFocus} onBlur={onBlur}
          style={{ ...inputBase, cursor: "pointer" }}
        >
          <option value="">— select category —</option>
          {ROOT_CAUSE_OPTIONS.map(({ value, label }) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </Field>

      {/* Fix applied */}
      <Field
        label="Fix Applied"
        hint={`${form.fix_applied.length} chars`}
        error={errors.fix_applied}
      >
        <textarea
          value={form.fix_applied}
          onChange={(e) => set("fix_applied", e.target.value)}
          onFocus={onFocus} onBlur={onBlur}
          placeholder="Describe the fix that was applied to resolve the incident..."
          rows={3}
          style={{ ...inputBase, resize: "vertical", lineHeight: 1.7 }}
        />
      </Field>

      {/* Prevention steps */}
      <Field
        label="Prevention Steps"
        hint={`${form.prevention_steps.length} chars`}
        error={errors.prevention_steps}
      >
        <textarea
          value={form.prevention_steps}
          onChange={(e) => set("prevention_steps", e.target.value)}
          onFocus={onFocus} onBlur={onBlur}
          placeholder="What steps will prevent this from happening again?..."
          rows={3}
          style={{ ...inputBase, resize: "vertical", lineHeight: 1.7 }}
        />
      </Field>

      {/* API error */}
      {apiError && (
        <div style={{
          background: "rgba(255,59,59,0.07)",
          border: "1px solid rgba(255,59,59,0.25)",
          borderRadius: "var(--radius)",
          padding: "10px 14px",
          color: "var(--p0)",
          fontSize: 11,
        }}>
          ⚠ {apiError}
        </div>
      )}

      {/* Submit */}
      <button
        onClick={handleSubmit}
        disabled={submitting}
        style={{
          alignSelf: "flex-end",
          background: submitting ? "var(--surface-3)" : "var(--accent)",
          color: submitting ? "var(--text-dim)" : "#fff",
          fontSize: 11,
          fontWeight: 700,
          letterSpacing: "0.1em",
          padding: "9px 22px",
          borderRadius: "var(--radius)",
          transition: "background 0.2s, opacity 0.2s",
          opacity: submitting ? 0.6 : 1,
          cursor: submitting ? "not-allowed" : "pointer",
        }}
      >
        {submitting ? "SUBMITTING..." : "SUBMIT RCA →"}
      </button>
    </div>
  );
}