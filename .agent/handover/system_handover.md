# Refinery Nexus — Full System Architecture, Ethos, & Handover

## 1. Core Ethos & Mandate
The overarching goal of this project is to build an **ultra-premium, industrial-grade data engine**. 
*   **No MVPs:** Everything must feel polished, modular, and fault-tolerant. Hacky workarounds and band-aids are strictly prohibited.
*   **Intuitive Complexity:** Expose highly advanced configurations (like SMTP concurrency, multi-stage pipelines) through simple, visually clear interfaces (e.g., color-coded toggles, inline helper text, pre-filled sane defaults). Provide pristine, exact definitions (e.g. what an EHLO domain is, exactly where to click to find your V550 API key, etc).
*   **Zero Hardcoding:** All configurations, endpoints, and credentials must be dynamic, environment-driven, or editable via the UI.
*   **Pristine UI:** Interactions must feel responsive and tactile, using polished hover states, animations, micro-interactions, and premium data visualization. The user experience must be idiot-proof for non-technical users while retaining full power for advanced operators.

---

## 2. Server & Deployment Topology

*   **Host:** Dedicated Server (`107.172.56.66`)
*   **OS/Env:** Ubuntu 24.04 LTS, Node.js + PM2 (`refinery-api`)
*   **Databases:**
    *   **ClickHouse:** Localhost (`8123` HTTP / `9000` TCP). Master analytical data lake on `/mnt/ssd/clickhouse` (fast SSD).
    *   **Postgres (Supabase):** Cloud-hosted for user Authentication and relational app configurations (`profiles`, `servers`, `ingestion_rules`, `verification_batches`, API keys).
*   **Storage:** 
    *   **MinIO:** Local S3-compatible storage mapped to `/mnt/sata`. Proxied to public dashboard securely at `https://iiiemail.email/minio/`.
*   **Proxy/SSL:** Nginx with Let's Encrypt handling all traffic routing (`/api` -> backend, `/play` -> ClickHouse HTTP, `/minio` -> MinIO GUI). 
*   **Caching Fix:** Nginx now forces `Cache-Control: no-cache` on `index.html` to guarantee instant frontend JS updates on browser refresh.

---

## 3. Comprehensive Module Status

### A. Ingestion Engine (`/ingestion`)
*   **Status:** **Robust & Wired**
*   **Architecture & Features:**
    *   Dynamic S3/MinIO bucket connections (Linode, AWS, custom MinIO).
    *   File parsing (CSV matching) and ingestion scheduling (`* * * * *` format, monthly, quarterly).
    *   Recently hardened with chunk-based `INSERT` logic and execution locks to prevent duplicate rule runs if previous ticks hang.
    *   Added support for `min_file_size_mb` and `max_file_size_mb` to ingestion rules directly in ClickHouse.
*   **UX Rating:** High. Features auto-completion, status badges, and clear feedback.
*   **What needs to be better:** Continue to add clarity to crontab syntax or visual builders for schedule generation if needed by non-technical users.

### B. Database Explorer (`/database`)
*   **Status:** **Backend Complete / Frontend Broken (Needs Rework)**
*   **Architecture & Features:**
    *   Backend APIs (`/browse`, `/filter-options`) are deployed and working, supporting parameterized dynamic filtering, pagination, sorting, and full-text search on 35+ allowed columns.
    *   Frontend has critical bugs that violate the core ethos:
        1.  **Double-fire Effect:** Search input and filter changes cause duplicate API calls (`useEffect` dependency array issues).
        2.  **UI/UX Flaws:** Dropdowns look like text inputs (`appearance: none` removes the chevron), column picker lacks click-outside dismissal (blocks UI flow).
        3.  **Missing Polish:** Rapid table rendering relies on empty space; it desperately needs loading states (skeletons) and smooth transitions. Unused imports clutter the codebase.
*   **Immediate Action Required:** A pristine, bug-free rewrite of `Database.tsx` adhering to the non-technical "Data Explorer" tab and power-user "SQL Editor" tab mandate.

### C. Segmentation (`/segments`)
*   **Status:** **Robust & Wired**
*   **Architecture & Features:**
    *   Visual query builder converting UI logic into ClickHouse SQL logic dynamically.
    *   Real-time audience sizing queries on billions of rows.
*   **UX Rating:** Strong.
*   **What needs to be better:** Can always benefit from richer feedback during heavy analytical query execution.

### D. Verification (`/verification` & `/email-verifier`)
*   **Status:** **Robust & Wired (Recently Overhauled & Fixed)**
*   **Architecture (Verify550 API):**
    *   Fully wired to V550 APIs (credits, single check, bulk CSV upload, running/completed jobs, and filtered ZIP exports for CSV/XLSX).
    *   **UX Improvements Applied (Idiot-Proofing):**
        *   Fixed double-port connection bugs in DB.
        *   Added comprehensive Job Detail Modal breaking down all 27 V550 suppression categories into 4 visual, color-coded groups (Safe, Risky, Dead, Threats) with precise counts.
        *   Replaced confusing endpoint fields with read-only info and precise helper text for exactly where to find API secrets (`app.verify550.com → Settings → API`). The `secret` parameter now holds the actual alphanumeric string.
*   **Architecture (Native SMTP built-in engine):**
    *   Built-in Native Node API for direct MX hunting and HELO/RCPT TO checks. Port 25 is confirmed open natively on the dedicated server.
*   **Pipeline Studio (`/email-verifier`):**
    *   Standalone tool independent of the ClickHouse ingested segments. Accepts raw text strings or single CSV uploads (up to 50k), runs the native multi-stage pipeline, and returns instantaneous tabular results in-browser. 
    *   *Note: This is an instant testing ground, whereas the `/verification` route is for batch-processing segments that are already ingested into ClickHouse.*

### E. Email Targets (`/targets`)
*   **Status:** **Static Mockup (Needs Implementation)**
*   **Architecture & Features:**
    *   Currently, the frontend is entirely a static UI (`Targets.tsx`) with zero API wiring.
    *   Backend routes exist (`/api/targets`) but are not hooked up to the frontend UI.
*   **Immediate Action Required:** Connect the UI to the backend to create, manage, and export target lists natively.

### F. Mail Queue (`/queue`)
*   **Status:** **Static Mockup (Needs Implementation)**
*   **Architecture & Features:**
    *   Frontend (`Queue.tsx`) is a static UI.
    *   Backend routes (`/api/queue`) exist but are not linked to the frontend.
*   **Immediate Action Required:** Wire up the UI to fetch queue statistics, control jobs (start, pause, resume, flush), and view live queue status.

### G. Daemon Logs (`/logs`)
*   **Status:** **Static Mockup (Needs Implementation)**
*   **Architecture & Features:**
    *   Frontend (`Logs.tsx`) is a static placeholder.
    *   No backend wiring for real-time daemon logs exists.
*   **Immediate Action Required:** Implement real-time log tailing from the server (using WebSockets or polling) and display it in the secure UI viewer with working level filters.

### H. Interactive Tutorials (`/tutorial`)
*   **Status:** **Needs Complete Expansion**
*   **Architecture & Features:**
    *   Current structure is an interactive abstract timeline.
    *   **What needs to be better:** The visual demos are currently basic CSS circles and pulsing abstract elements. The user demands highly elaborate actual examples, explanations (like exactly what an EHLO domain is and why it matters for SMTP), micro-interactions (hover states, zooms), and real interface mockups within the learning modules.
*   **Immediate Action Required:** Overhaul the visual demos to be instructional, hyper-detailed, and visually robust.

### I. Server Config (`/config`) & Dashboard (`/`)
*   **Status:** **Robust & Wired**
*   **Architecture & Features:**
    *   Dashboard provides an overview of DB stats and system health.
    *   Server Config allows adding Supabase/ClickHouse credentials, and MinIO details safely to the database.

---

## 4. Immediate Action Plan

1.  **Refactor `/database` Frontend (Priority 1):** Execute the rewrite of `Database.tsx` outlined in the handover notes (`.agent/handover/database-explorer-handover.md`). Fix the duplicate renders, loading skeletons, and broken UI chevron dropdowns. Make it pristine and un-breakable.
2.  **Rewrite Interactive Tutorials (Priority 2):** Scrap the "pulsing circles" visual demos in `/tutorial`. Replace them with deep, concrete, content-heavy explanations that hold the user's hand at a technical level (e.g., teaching them why role-based emails bounce, how SMTP handshakes work, what credentials go where) combined with luxurious, smooth micro-interactions.
3.  **Wire Static Mockups (Priority 3):** Hook up `/targets`, `/queue`, and `/logs` to their respective backend routes. Ensure data flows smoothly and UI handles empty states, loading states, and error states gracefully.
4.  **Audits (Ongoing):** Continue strict auditing of modules (like the Squads UI and Autoresponder Phase 3 Sequence Engine) to root out MVP-level hacks. Ensure modular hooks and clean state management.

---
*Documented on March 18, 2026. This document must serve as the authoritative standard for all subsequent architectural decisions. Compromising quality for speed is explicitly forbidden.*
