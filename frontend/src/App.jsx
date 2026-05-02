import { useState, useEffect } from "react";
import { BrowserRouter, Routes, Route, useNavigate, useLocation } from "react-router-dom";
import LiveFeed from "./LiveFeed";
import IncidentDetail from "./IncidentDetail";

/* ─────────────────────────────────────────────
   Global CSS injected once at root level
   Design direction: industrial / terminal ops
   Fonts: JetBrains Mono (mono data) + Syne (display)
───────────────────────────────────────────── */
const GLOBAL_CSS = `
  @import url('https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@300;400;500;700&family=Syne:wght@400;600;700;800&display=swap');

  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

  :root {
    --bg:          #080b12;
    --surface:     #0e1320;
    --surface-2:   #141926;
    --surface-3:   #1c2236;
    --border:      #1f2a40;
    --border-glow: #2a3a5c;

    --text:        #c8d4e8;
    --text-dim:    #5a6a84;
    --text-bright: #eaf0fb;

    --p0: #ff3b3b;
    --p1: #ff7a00;
    --p2: #f5c400;
    --p3: #4a5568;

    --p0-glow: rgba(255,59,59,0.18);
    --p1-glow: rgba(255,122,0,0.15);
    --p2-glow: rgba(245,196,0,0.13);

    --status-open:          #3b82f6;
    --status-investigating: #f97316;
    --status-resolved:      #22c55e;
    --status-closed:        #4a5568;

    --accent: #3b82f6;
    --accent-dim: rgba(59,130,246,0.12);

    --radius: 4px;
    --font-mono: 'JetBrains Mono', monospace;
    --font-display: 'Syne', sans-serif;
  }

  html, body, #root {
    height: 100%;
    background: var(--bg);
    color: var(--text);
    font-family: var(--font-mono);
    font-size: 13px;
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }

  /* Scanline overlay — subtle CRT texture */
  body::before {
    content: '';
    position: fixed;
    inset: 0;
    background: repeating-linear-gradient(
      0deg,
      transparent,
      transparent 2px,
      rgba(0,0,0,0.06) 2px,
      rgba(0,0,0,0.06) 4px
    );
    pointer-events: none;
    z-index: 9999;
  }

  ::-webkit-scrollbar { width: 4px; }
  ::-webkit-scrollbar-track { background: var(--surface); }
  ::-webkit-scrollbar-thumb { background: var(--border-glow); border-radius: 2px; }

  a { color: inherit; text-decoration: none; }

  button {
    font-family: var(--font-mono);
    cursor: pointer;
    border: none;
    outline: none;
  }

  /* Utility classes */
  .mono { font-family: var(--font-mono); }
  .display { font-family: var(--font-display); }
  .dim { color: var(--text-dim); }
  .bright { color: var(--text-bright); }

  /* Priority badge */
  .badge-p0 { color: var(--p0); background: var(--p0-glow); border: 1px solid rgba(255,59,59,0.3); }
  .badge-p1 { color: var(--p1); background: var(--p1-glow); border: 1px solid rgba(255,122,0,0.3); }
  .badge-p2 { color: var(--p2); background: rgba(245,196,0,0.1); border: 1px solid rgba(245,196,0,0.3); }
  .badge-p3 { color: var(--p3); background: rgba(74,85,104,0.15); border: 1px solid rgba(74,85,104,0.3); }

  .badge {
    display: inline-flex;
    align-items: center;
    padding: 1px 7px;
    border-radius: 2px;
    font-size: 10px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }

  /* Status badge */
  .badge-open          { color: var(--status-open); background: rgba(59,130,246,0.12); border: 1px solid rgba(59,130,246,0.3); }
  .badge-investigating { color: var(--status-investigating); background: rgba(249,115,22,0.12); border: 1px solid rgba(249,115,22,0.3); }
  .badge-resolved      { color: var(--status-resolved); background: rgba(34,197,94,0.1); border: 1px solid rgba(34,197,94,0.3); }
  .badge-closed        { color: var(--status-closed); background: rgba(74,85,104,0.1); border: 1px solid rgba(74,85,104,0.3); }

  /* Fade-in */
  @keyframes fadeUp {
    from { opacity: 0; transform: translateY(8px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .fade-up { animation: fadeUp 0.3s ease both; }

  @keyframes pulse-dot {
    0%, 100% { opacity: 1; }
    50%       { opacity: 0.2; }
  }
`;

/* ─────────────────────────────────────────────
   Top nav bar
───────────────────────────────────────────── */
function NavBar() {
  const navigate = useNavigate();
  const location = useLocation();
  const onFeed = location.pathname === "/";
  const [tick, setTick] = useState(0);

  // Live clock
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const now = new Date();
  const timeStr = now.toISOString().replace("T", " ").slice(0, 19) + " UTC";

  return (
    <header style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      padding: "0 24px",
      height: 52,
      background: "var(--surface)",
      borderBottom: "1px solid var(--border)",
      position: "sticky",
      top: 0,
      zIndex: 100,
    }}>
      {/* Logo */}
      <div
        onClick={() => navigate("/")}
        style={{
          display: "flex", alignItems: "center", gap: 10,
          cursor: "pointer", userSelect: "none",
        }}
      >
        {/* Animated status dot */}
        <span style={{
          width: 8, height: 8, borderRadius: "50%",
          background: "var(--status-resolved)",
          display: "inline-block",
          animation: "pulse-dot 2s ease-in-out infinite",
          boxShadow: "0 0 6px var(--status-resolved)",
        }} />
        <span style={{
          fontFamily: "var(--font-display)",
          fontWeight: 800,
          fontSize: 16,
          letterSpacing: "0.04em",
          color: "var(--text-bright)",
        }}>
          WATCH<span style={{ color: "var(--accent)" }}>TOWER</span>
        </span>
        <span style={{
          fontSize: 9,
          color: "var(--text-dim)",
          letterSpacing: "0.1em",
          marginLeft: 2,
        }}>
          IMS v1.0
        </span>
      </div>

      {/* Nav links */}
      <nav style={{ display: "flex", gap: 0 }}>
        {[{ label: "LIVE FEED", path: "/" }].map(({ label, path }) => (
          <button
            key={path}
            onClick={() => navigate(path)}
            style={{
              background: "none",
              color: location.pathname === path ? "var(--text-bright)" : "var(--text-dim)",
              fontSize: 10,
              fontWeight: 600,
              letterSpacing: "0.12em",
              padding: "6px 14px",
              borderBottom: location.pathname === path
                ? "2px solid var(--accent)"
                : "2px solid transparent",
              transition: "color 0.2s",
            }}
          >
            {label}
          </button>
        ))}
      </nav>

      {/* Live clock */}
      <span style={{ fontSize: 10, color: "var(--text-dim)", letterSpacing: "0.05em" }}>
        {timeStr}
      </span>
    </header>
  );
}

/* ─────────────────────────────────────────────
   Root app
───────────────────────────────────────────── */
export default function App() {
  // Inject global styles once
  useEffect(() => {
    const style = document.createElement("style");
    style.textContent = GLOBAL_CSS;
    document.head.appendChild(style);
    document.title = "WatchTower IMS";
    return () => document.head.removeChild(style);
  }, []);

  return (
    <BrowserRouter>
      <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
        <NavBar />
        <main style={{ flex: 1, padding: "24px" }}>
          <Routes>
            <Route path="/" element={<LiveFeed />} />
            <Route path="/incidents/:id" element={<IncidentDetail />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}