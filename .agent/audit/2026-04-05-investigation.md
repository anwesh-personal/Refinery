# Refinery Nexus System Audit
**Date:** 2026-04-05
**Focus:** Ingestion Pipeline Stability (`EPIPE`, PM2 Crash Loops, Contention Locks) & Segment Builder Search Mismatch
**Investigator:** Antigravity

---

## 1. Segment Builder Search Mismatch

### Investigation findings
During the self-audit, it was highlighted that segments created directly from the Data Explorer display different rows than what is previewed in the Data Explorer UI. 

Our investigation revealed that the mismatch stems from exactly where and how SQL generation occurs:
- **Backend Rendering (What the user sees):** The Data Explorer table populates its data via the backend `services/database.ts` using `buildWhereConditions(params)`. This function is highly sophisticated—it uses smart intent detection to route searches intelligently (e.g., if it detects an email, it searches `business_email` and `personal_emails`; if it detects a domain, it restricts the query to `DOMAIN_COLS`).
- **Frontend Generation (What the Segment saves):** The "Create Segment" action inside the `Database.tsx` page bypasses this intelligence. Instead, it blindly relies on a hardcoded string template pushing `_search_text LIKE '%<query>%'`.

This results in a literal mismatch between the algorithm used to fetch the preview grid and the algorithm saved to the ClickHouse segment definition.

### Proposed Solution: The Unified Compiler Pattern
**Do not patch the frontend.** Frontends constructing explicit database SQL dialects is brittle and inherently creates version mismatches anytime the backend logic is upgraded.

1. Create a dedicated endpoint `POST /api/segments/from-browse`.
2. Instead of building the SQL string via string concatenation on `Database.tsx`, the frontend will simply transmit the user's `BrowseParams` state (search variables, UI toggles, filters, completeness strings).
3. The backend `segments.ts` will feed the state precisely through the original `buildWhereConditions(params)` engine to statically compile the final `filterQuery`.
4. This ensures that the exact codebase fetching the Data Explorer grid is the exact codebase manufacturing the Segment Query, guaranteeing 100% mechanical synchronization forever.

---

## 2. Ingestion "Ghost" Queues, EPIPEs, and Data Drops

### Investigation findings
The ingestion pipeline has experienced systemic "phantom freezes" (e.g., 90 jobs claiming to be in progress but nothing actually ingesting) coupled with occasional unexplained dips in the `universal_person` total row count, followed by `EPIPE` / `socket hang up` crashes.

These are not separate bugs; they are a sequential domino effect created by how the auto-recovery module interacts with ClickHouse mutations:

1. **The Catalyst (Node OOM / Timeout):** During massive Parquet streams, aggressive block pulls without event-loop yielding suffocate the V8 garbage collector, causing PM2 to crash & restart.
2. **The Cleanup (Missing Rows):** On PM2 restart, `recoverStaleIngestionJobs` correctly diagnoses that jobs were interrupted. To prevent duplicate ghost rows when jobs are retried, it successfully fires a massive deletion mutation (`ALTER TABLE universal_person DELETE WHERE _ingestion_job_id = ?`). Attempting to delete millions of incomplete rows is what causes the dashboard's "Total Records" value to suddenly drop exactly by the equivalent partial payload count (e.g., 700M → 687M). The script is working as designed.
3. **The Deadlock (Ghost Queue & EPIPEs):** While the script is successfully deleting those 13M rows, ClickHouse physically restricts background `INSERT`s to maintain data integrity. However, the exact same recovery script places the jobs back onto the active pipeline immediately with a trivial 5-second `setTimeout`. Because the Node.js server starts screaming at ClickHouse to execute massive batch `INSERT`s into the very table ClickHouse is desperately wrestling to structurally mutate, massive database I/O contention occurs. The pipeline completely locks out (the 90 static "in progress" jobs), wait timeouts exceed limits, TCP connections sever upstream resulting in `EPIPE`, and the cycle of destruction starts anew.

### Proposed Solution: Systemic Backpressure and Mutation Locks
**Do not use arbitrary `setTimeout` arbitrary retry delays.**

1. **Mutation-Aware Worker Locks (ClickHouse Contention Shield):** Modify the `ingestion.ts` recovery logic. After issuing an `ALTER TABLE DELETE` command, the thread must physically loop `SELECT count() FROM system.mutations WHERE is_done = 0 AND table = 'universal_person'`. The Node pipeline must enter Deep Sleep (pausing the queue and blocking job slots) until ClickHouse officially returns an unlocked state. Zero contention.
2. **GC Yield Operations (OOM Prevention):** Add explicit blocking hooks `await new Promise(setImmediate)` inside the Parquet chunk processing loops. This forces the node architecture to cycle down and release pending memory pointers to the garbage collector sequentially during execution, making 5M row file parsing run indefinitely fast and stable without hitting terminal RAM crash floors.
3. **S3 Stream Resurrection Protocol:** Isolate the `GetObjectCommand` AWS S3 pipe into an independent error-trap scope. If Linode terminates the TCP connection due to transient throttling mid-ingestion, the system catches the pipe error locally and seamlessly spawns a resumed `Range` command without aborting the larger PM2 task context.
