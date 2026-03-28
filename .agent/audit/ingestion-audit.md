# Ingestion System — Full Forensic Audit

**Date:** 2026-03-28
**Scope:** Backend services, routes, DB schema, frontend page, automated rules

---

## Architecture Overview

```
S3 Source (co-op bucket)
  → Download stream
  → Upload to MinIO (archive)
  → Re-download from MinIO
  → Parse (CSV / GZ / Parquet)
  → Batch insert → ClickHouse (universal_person)
```

**Files Audited:**
- `services/ingestion.ts` (725 lines) — core pipeline
- `services/ingestion-rules.ts` (272 lines) — automated cron rules
- `services/s3sources.ts` (196 lines) — S3 source CRUD
- `routes/ingestion.ts` (217 lines) — API routes
- `db/init.ts` — schema definitions
- `config/env.ts` — environment config
- `pages/Ingestion.tsx` (1507 lines) — frontend

---

## CRITICAL ISSUES

### 1. `ingestion_jobs` schema missing `ingestion_rules` table

The `ingestion_rules` table is **not in `init.ts`**. It exists on the server only because it was created manually or via a prior deployment. If the DB is ever rebuilt from scratch, auto-ingest rules will crash.

**Impact:** Total failure of automated ingestion on fresh deployments.

### 2. `ingestion_jobs` missing `performed_by` in schema

The schema in `init.ts` (lines 87-101) does NOT include `performed_by` or `performed_by_name` columns. They're added via the `ATTRIBUTION_TABLES` loop (line 284-295) using `ADD COLUMN IF NOT EXISTS` — fine, but fragile. If `initDatabase()` fails partway, these columns won't exist and every job insert will silently drop the attribution.

### 3. S3 file listing limited to 1000 files (no pagination)

`listSourceFiles()` in `ingestion.ts` line 168-173 uses `ListObjectsV2Command` with `MaxKeys: 1000`. If a prefix has >1000 files, _the rest are invisible_. Same issue in `s3sources.ts` line 184-188 with `MaxKeys: 100` — even worse.

For the auto-ingest rules (`ingestion-rules.ts` line 143), this means rules will **never see** files beyond the first 1000. Files 1001+ are silently ignored forever.

**Impact:** Data loss — files beyond page 1 are never ingested.

### 4. CSV path has NO null-byte sanitization

The parquet path was just fixed (line 576-586), but the **CSV path** (lines 527-542) does NO sanitization at all. If a CSV file contains null bytes (which co-op data absolutely can), it will crash ClickHouse the same way.

### 5. `cancel-running` route has SQL injection via `user.name`

Route at line 185:
```ts
error_message = 'Cancelled by ${user.name}'
```
If `user.name` contains a single quote, the SQL breaks. Should use `esc()`.

---

## HIGH PRIORITY ISSUES

### 6. Double-download architecture wastes bandwidth and time

The pipeline downloads from S3 → uploads to MinIO → re-downloads from MinIO → parses. For a 2GB parquet file, this means **6GB of I/O** (download + upload + re-download) instead of **2GB** (download once, parse from disk, then upload the raw file async).

The archive upload should happen **in parallel** or **after** ingestion, not as a blocking prerequisite.

### 7. Concurrency queue leaks on unhandled rejection

`acquirePipelineSlot()` (line 36-44) stores a `resolve` callback in `waitQueue`. If the process gets a SIGTERM while workers are queued, those promises never resolve and never reject. The stale job recovery (`recoverStaleIngestionJobs`) handles the DB records but the in-memory queue is lost — fine on restart, but during a graceful shutdown the event loop hangs.

### 8. `flushBatch` does an ALTER TABLE UPDATE per batch

Line 493: Every 10,000 rows triggers:
```sql
ALTER TABLE ingestion_jobs UPDATE rows_ingested = X WHERE id = 'Y'
```
For a 1M-row file, that's 100 ALTER TABLE mutations queued on ClickHouse. ALTER TABLE UPDATE in ClickHouse creates **mutations** that serialize writes. This can cause mutation queue buildup and degraded performance.

**Fix:** Throttle progress updates (every 100k rows or every 30 seconds).

### 9. `env.ts` has silent empty-string fallbacks for critical credentials

Lines 25-28 and 32-35: `s3Source` and `objectStorage` credentials fall back to `''`. If these are missing, the pipeline starts but fails deep in the S3 call with a cryptic AWS SDK error instead of failing fast at startup.

### 10. `listSourceFiles` in `s3sources.ts` is completely separate from `ingestion.ts`

There are TWO independent `listSourceFiles` functions:
- `ingestion.ts:149` — returns `{ folders, files, prefix }` with `Delimiter: '/'` and `MaxKeys: 1000`
- `s3sources.ts:177` — returns flat file list with `MaxKeys: 100`, no delimiter, no folders

The auto-ingest rules call `ingestion.listSourceFiles()` which uses the delimiter — meaning it only sees files at the **current prefix level**, not recursively. If files are nested in subdirectories, rules will never find them.

---

## MODERATE ISSUES

### 11. No deduplication in manual ingestion

`startIngestionJob()` has zero duplicate checking. You can click "Ingest" on the same file 50 times and get 50 duplicate copies in `universal_person`. Only the auto-ingest rules have `skip_duplicates`. Manual ingestion should at minimum warn.

### 12. `inFlightFiles` 10-second TTL is arbitrary

`ingestion-rules.ts` line 211:
```ts
setTimeout(() => inFlightFiles.delete(file.key), 10000);
```
If ClickHouse takes >10s to register the job, another rule can re-claim the file. This TTL should be tied to actual DB confirmation, not a magic number.

### 13. Parquet temp files can accumulate on crash

Line 547-548 creates temp directories. The `finally` block cleans up, but if the process is hard-killed (OOM, SIGKILL), temp files remain. There's no startup cleanup of orphaned `refinery-pq-*` directories in `/tmp`.

### 14. `getJobs()` has a hardcoded LIMIT 50

Line 271: `SELECT * FROM ingestion_jobs ORDER BY started_at DESC LIMIT ${limit}`. Default is 50. With 257 failed jobs, users only see the last 50 in the UI. No pagination support.

### 15. `esc()` function is duplicated 3 times

The exact same `esc()` function exists in:
- `ingestion.ts:21-23`
- `s3sources.ts:36-38`  
- `ingestion-rules.ts:7-9`

Should be a shared utility.

---

## MINOR / CODE QUALITY

### 16. Dynamic imports in routes

`routes/ingestion.ts` lines 164-167: `await import('../db/clickhouse.js')` inside request handlers. This is already imported at the top of `ingestion.ts`. These should use the top-level import.

### 17. `clear-jobs` has unused `db` variable

Line 149: `const db = 'refinery';` — never used.

### 18. `archiveJob` date formatting is manual

Line 668-669: Manual ISO string slicing for date formatting. Should use a consistent utility.

### 19. Frontend file browser doesn't show snappy.parquet format badge

`getFileFormat()` in the frontend only checks `.parquet` and `.pqt` — files named `.snappy.parquet` are matched correctly but `.snappy` alone wouldn't be.

---

## SUMMARY TABLE

| # | Severity | Issue | File |
|---|----------|-------|------|
| 1 | 🔴 CRITICAL | `ingestion_rules` table missing from schema | `db/init.ts` |
| 2 | 🔴 CRITICAL | Attribution columns depend on partial init | `db/init.ts` |
| 3 | 🔴 CRITICAL | S3 listing has no pagination (>1000 files invisible) | `ingestion.ts`, `s3sources.ts` |
| 4 | 🔴 CRITICAL | CSV path has no null-byte sanitization | `ingestion.ts` |
| 5 | 🔴 CRITICAL | SQL injection in cancel-running route | `routes/ingestion.ts` |
| 6 | 🟠 HIGH | Double-download wastes 3x bandwidth | `ingestion.ts` |
| 7 | 🟠 HIGH | Concurrency queue can hang on shutdown | `ingestion.ts` |
| 8 | 🟠 HIGH | ALTER TABLE mutation spam per batch | `ingestion.ts` |
| 9 | 🟠 HIGH | Silent empty-string fallbacks for creds | `config/env.ts` |
| 10 | 🟠 HIGH | Auto-ingest rules can't find nested files | `ingestion-rules.ts` |
| 11 | 🟡 MED | No dedup in manual ingestion | `ingestion.ts` |
| 12 | 🟡 MED | inFlightFiles TTL is arbitrary | `ingestion-rules.ts` |
| 13 | 🟡 MED | Orphaned parquet temp files | `ingestion.ts` |
| 14 | 🟡 MED | Jobs list hard-capped at 50 | `ingestion.ts` |
| 15 | 🟡 MED | esc() duplicated 3 times | multiple |
| 16 | ⚪ LOW | Dynamic imports in route handlers | `routes/ingestion.ts` |
| 17 | ⚪ LOW | Unused variable | `routes/ingestion.ts` |
| 18 | ⚪ LOW | Manual date formatting | `ingestion.ts` |
| 19 | ⚪ LOW | Frontend format badge edge case | `Ingestion.tsx` |
