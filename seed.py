#!/usr/bin/env python3
"""
seed.py — Seeds WatchTower with the sample failure-cascade scenario.

Usage:
    # Default (localhost:8000)
    python seed.py

    # Custom backend URL
    python seed.py --url http://localhost:8000

    # Faster seeding (0.05s delay)
    python seed.py --delay 0.05

What it does:
    Reads sample_data.json and POSTs each signal to POST /api/signals
    with a 0.1s delay between signals (configurable via --delay).

Expected output:
    [1/11] RDBMS_PRIMARY_01 → 202 ✓  queued=True  depth=1
    [2/11] RDBMS_PRIMARY_01 → 202 ✓  queued=True  depth=2
    ...
    ✓ All 11 signals seeded successfully.

Debounce note:
    All 5 RDBMS_PRIMARY_01 signals arrive within ~0.5s (5 × 0.1s),
    well within the 10s debounce window. After seeding, check the
    Live Feed — you should see ONE WorkItem for RDBMS_PRIMARY_01
    with signal_count=5.
"""

import json
import time
import sys
import argparse
import urllib.request
import urllib.error


def parse_args():
    p = argparse.ArgumentParser(description="Seed WatchTower with sample signals.")
    p.add_argument("--url",   default="http://localhost:8000", help="Backend base URL")
    p.add_argument("--delay", type=float, default=0.1, help="Delay between signals (seconds)")
    p.add_argument("--file",  default="sample_data.json", help="Path to signal data file")
    return p.parse_args()


def post_signal(base_url: str, signal: dict) -> dict:
    """POST a single signal; returns the parsed JSON response."""
    payload = json.dumps(signal).encode("utf-8")
    req = urllib.request.Request(
        f"{base_url}/api/signals",
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=10) as resp:
        return json.loads(resp.read())


def check_health(base_url: str) -> bool:
    """Return True if the backend /health endpoint is reachable."""
    try:
        with urllib.request.urlopen(f"{base_url}/api/health", timeout=5) as r:
            data = json.loads(r.read())
            return data.get("status") == "ok"
    except Exception:
        return False


def main():
    args = parse_args()
    base_url = args.url.rstrip("/")

    # ── Load data ────────────────────────────────────────────────────────────
    try:
        with open(args.file) as f:
            signals = json.load(f)
    except FileNotFoundError:
        print(f"✗ Cannot find {args.file} — run this script from the repo root.")
        sys.exit(1)

    print(f"\n  WatchTower Signal Seeder")
    print(f"  Backend : {base_url}")
    print(f"  Signals : {len(signals)}")
    print(f"  Delay   : {args.delay}s between each signal")
    print()

    # ── Health check ─────────────────────────────────────────────────────────
    print("  Checking backend health...", end=" ", flush=True)
    if not check_health(base_url):
        print("✗")
        print(f"\n  Cannot reach {base_url}/api/health")
        print("  Is the backend running? Try: docker compose up --build")
        sys.exit(1)
    print("✓  Backend is up.\n")

    # ── Seed signals ──────────────────────────────────────────────────────────
    success = 0
    failures = []

    for i, signal in enumerate(signals, start=1):
        label = f"[{i:>2}/{len(signals)}] {signal['component_id']:<22}"
        try:
            resp = post_signal(base_url, signal)
            queued = resp.get("queued", "?")
            depth  = resp.get("queue_depth", "?")
            print(f"  {label} → 202 ✓  queued={queued}  depth={depth}")
            success += 1
        except urllib.error.HTTPError as e:
            body = e.read().decode()
            print(f"  {label} → {e.code} ✗  {body[:80]}")
            failures.append((i, signal["component_id"], str(e)))
        except Exception as e:
            print(f"  {label} → ERR ✗  {e}")
            failures.append((i, signal["component_id"], str(e)))

        if i < len(signals):
            time.sleep(args.delay)

    # ── Summary ───────────────────────────────────────────────────────────────
    print()
    if not failures:
        print(f"  ✓ All {success} signals seeded successfully.")
        print()
        print("  Next steps:")
        print("    1. Open http://localhost:5173 — the Live Feed should show 4 incidents.")
        print("    2. RDBMS_PRIMARY_01 has priority P0 and signal_count=5 (debounce in action).")
        print("    3. Click any card → detail page → transition status → fill RCA → close.")
        print()
    else:
        print(f"  ✓ {success} succeeded   ✗ {len(failures)} failed")
        for idx, cid, err in failures:
            print(f"    [{idx}] {cid}: {err}")
        sys.exit(1)


if __name__ == "__main__":
    main()