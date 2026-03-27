# Email Verification Pipeline — Complete Handover

> **Last Updated:** 2026-03-26T21:35:00+05:30
> **Conversation ID:** 7b9a1db4-3261-4be6-9b4a-9c0f9ff1910e
> **Production Server:** 107.172.56.66 (SSH: root / AuVkRFXqz5GY8qn5)
> **Deploy:** git push origin main → SSH deploy script (see /deploy workflow)

---

## 1. SYSTEM OVERVIEW

The Email Verification Pipeline is a standalone email list processor built into Refinery Nexus. Users upload CSV/text email lists, the backend runs multi-stage verification (syntax, dedup, typo fix, MX lookup, SMTP probe, catch-all detection, domain auth, DNSBL, domain age), and returns per-email results with risk scores and classifications (safe/uncertain/risky/reject).

### Architecture

```
Frontend (React/Vite)                    Backend (Express/Node)
axiom-data-hub/src/pages/               refinery-backend/src/
  EmailVerifier.tsx                        routes/verify.ts          ← API endpoints
                                           services/standaloneVerifier.ts ← Pipeline engine
                                           services/engine/
                                             smtpProbe.ts            ← Raw TCP SMTP
                                             rateLimiter.ts          ← Per-domain throttling
                                             syntaxValidator.ts      ← Syntax + typo fix
                                             disposableDomains.ts    ← Disposable check
                                             roleDetector.ts         ← Role-based detection
                                             freeProviders.ts        ← Free provider check
                                             mxResolver.ts           ← DNS MX lookup
                                             domainAuth.ts           ← SPF/DMARC
                                             dnsbl.ts                ← DNSBL blacklist check
                                             domainAge.ts            ← WHOIS age check
```

### Database

- **ClickHouse** (database: `refinery`)
  - `pipeline_jobs` — tracks job state, progress, results, source emails
  - `universal_person` — the main leads table (ingestion target)

### Key Tables Schema (pipeline_jobs)

```sql
CREATE TABLE pipeline_jobs (
  id                String,
  total_emails      UInt64,
  processed_count   UInt64,
  safe_count        UInt64,
  risky_count       UInt64,
  rejected_count    UInt64,
  uncertain_count   UInt64,
  duplicates_removed UInt64,
  typos_fixed       UInt64,
  status            String DEFAULT 'queued',    -- queued|processing|complete|failed|cancelled
  error_message     Nullable(String),
  results_json      Nullable(String),           -- Full results on completion
  config_json       Nullable(String),           -- Check config + SMTP config
  source_emails_json Nullable(String),          -- Source emails for retry (NEW)
  started_at        DateTime,
  completed_at      Nullable(DateTime),
  performed_by      Nullable(String),
  performed_by_name Nullable(String)
) ENGINE = MergeTree() ORDER BY (started_at, id)
```

---

## 2. CURRENT SYSTEM STATE (as of 2026-03-26)

### What's Deployed & Working
- ✅ Full pipeline engine with all checks
- ✅ CSV upload with dynamic column mapping
- ✅ Job persistence in ClickHouse (survives page refreshes)
- ✅ Background processing with polling reconnection
- ✅ Job cancellation via AbortController
- ✅ Orphan recovery on server restart (marks stuck `processing` → `failed`)
- ✅ 50MB body limit (supports 500k+ email lists)
- ✅ Animated pipeline progress UI (5-stage walkthrough, live stats, ETA)
- ✅ Granular ingestion modal (classification filters, risk threshold, overwrite modes, dry-run)
- ✅ Granular download CSV modal (classification filters, risk slider, quick presets)
- ✅ Retry button for failed/cancelled jobs (requires source_emails_json)
- ✅ Pipeline deadlock fixes (per-domain timeout, backoff cap, abort-aware rate limiter)

### What's Broken / Needs Attention
- ⚠️ **v550 routes** — `/api/v550/credits`, `/api/v550/jobs/running`, `/api/v550/jobs/completed` all return 500. These are from a V550 external verification service integration that's incomplete/misconfigured. They spam the console on several pages.
- ⚠️ **AuthContext custom_roles** — The join query referencing `custom_roles` table fails (table doesn't exist). Falls back gracefully but logs warnings.
- ⚠️ **schedule_cron column** — The scheduler queries `schedule_cron` on `segments` table but the column doesn't exist. Logs errors every tick.
- ⚠️ **Old jobs can't retry** — Jobs created before 2026-03-26 don't have `source_emails_json` stored. Retry shows: "No source emails stored for this job". User must re-upload CSV.

### Recent Job History

| Job ID | Emails | Processed | Status | Notes |
|--------|--------|-----------|--------|-------|
| 6_hwZd_q6rN7HI0f | 136,731 | 126,862 | failed | Stuck at 93% for 14h due to deadlock. Marked failed on restart. No source_emails_json. |
| v3L1gW1flj8Pr1Oc | 136,731 | 110,715 | failed | Earlier attempt, same file |
| BttUNTlefHQgZCSk | 136,731 | 112,344 | failed | Earlier attempt, same file |
| gSQ-F0Ir6TQp0F42 | 40 | 40 | complete | Test run |
| dyE3uyw4u6-D3E8D | 40 | 40 | complete | Test run |

---

## 3. API ENDPOINTS (verify.ts)

All routes are under `/api/verify/` and require `requireSuperadmin` middleware.

### Pipeline Execution
- **POST `/api/verify/pipeline`** — Submit email list for verification
  - Body: `{ emails: string[], checks?: Partial<CheckConfig>, smtp?: Partial<SmtpConfig>, severityWeights?, thresholds? }`
  - Returns: `{ jobId, totalEmails }`
  - Now stores `source_emails_json` for retry capability

### Job Management
- **GET `/api/verify/jobs`** — List recent pipeline jobs (last 20)
- **GET `/api/verify/jobs/:id`** — Get job status + results (if complete)
- **POST `/api/verify/jobs/:id/cancel`** — Cancel running job via AbortController
- **POST `/api/verify/jobs/:id/retry`** — Retry failed/cancelled job using stored source emails & config

### Results
- **GET `/api/verify/jobs/:id/download`** — Download CSV
  - Query params: `?classifications=safe,uncertain&maxRiskScore=50`
  - Filters results server-side before generating CSV
  - Filename reflects applied filters
- **POST `/api/verify/jobs/:id/ingest`** — Push results to `universal_person` table
  - Body: `{ classifications: string[], maxRiskScore: number, mode: 'unverified_only'|'overwrite', dryRun: boolean }`
  - Dry run returns match counts without modifying DB
  - Maps classifications: safe→valid, uncertain→risky, risky→risky, reject→invalid

### Legacy
- **POST `/api/verify/push-to-db`** — Old push endpoint (still works, used by fresh pipeline results before job persistence)

---

## 4. THE DEADLOCK — ROOT CAUSE ANALYSIS

### What Happened
The 136k email job stuck at 93% (126,862/136,731 processed) for 14+ hours. Three bugs combined:

### Bug 1: Exponential Backoff → 5 Minute Blocks
**File:** `refinery-backend/src/services/engine/rateLimiter.ts`
```
Old: backoffSeconds = Math.min(5 * 2^(failureCount-1), 300) → Max 5 MINUTES
New: backoffSeconds = Math.min(5 * 2^(failureCount-1), 30)  → Max 30 seconds
```
Domains with repeated SMTP failures (4xx responses) triggered exponential backoff. After 7 failures, each subsequent probe attempt waited 5 minutes. With thousands of failing domains across 10 workers, the pipeline ground to a halt.

### Bug 2: Spin-Wait Without Timeout or Abort Check
**File:** `refinery-backend/src/services/engine/rateLimiter.ts`
```typescript
// OLD — could spin forever
while (globalActive >= GLOBAL_MAX_CONCURRENT) {
  await sleep(100); // No timeout, no abort check
}

// NEW — 60s hard timeout + abort signal
export async function acquireSlot(domain: string, signal?: AbortSignal): Promise<void> {
  const MAX_WAIT_MS = 60_000;
  const waitStart = Date.now();
  const checkAbort = () => {
    if (signal?.aborted) throw new Error('Pipeline cancelled');
    if (Date.now() - waitStart > MAX_WAIT_MS) throw new Error(`acquireSlot timeout for ${domain}`);
  };
  while (globalActive >= GLOBAL_MAX_CONCURRENT) {
    checkAbort();
    await sleep(100);
  }
  // ... same for backoff and per-domain waits
}
```

### Bug 3: No Per-Domain Timeout
**File:** `refinery-backend/src/services/standaloneVerifier.ts`
A single slow domain could block a worker indefinitely. Fixed with `Promise.race()`:
```typescript
const DOMAIN_TIMEOUT_MS = 120_000; // 2 minutes max per domain
await Promise.race([
  processDomainChecks(domain, indices, results, cfg, smtp, w, signal),
  new Promise<void>((_, reject) =>
    setTimeout(() => reject(new Error(`Domain timeout: ${domain}`)), DOMAIN_TIMEOUT_MS)
  ),
]);
// Timed-out domains get status: 'unknown', pipeline continues
```

### Bug 4: Double Release in Catch-All Detection
**File:** `refinery-backend/src/services/standaloneVerifier.ts`
```typescript
// OLD — releaseSlot called before return AND in finally block
if (isCatchAll) {
  releaseSlot(domain); // ← First release
  return;
}
// ...
finally {
  releaseSlot(domain); // ← Second release (corrupts globalActive counter)
}

// NEW — only finally block releases
if (isCatchAll) {
  return; // finally block handles release
}
```

---

## 5. FRONTEND — EmailVerifier.tsx

### Key State Variables
```typescript
// Job tracking
const [activeJobId, setActiveJobId] = useState<string | null>(null);
const [loading, setLoading] = useState(false);
const [progress, setProgress] = useState(0);
const [result, setResult] = useState<PipelineResult | null>(null);
const [recentJobs, setRecentJobs] = useState<any[]>([]);

// Live pipeline stats (populated during polling)
const [liveStats, setLiveStats] = useState<{
  processed, total, safe, uncertain, risky, rejected, deduped, typos, startedAt
}>();

// Ingestion modal
const [ingestJobId, setIngestJobId] = useState<string | null>(null);
const [ingestClassifications, setIngestClassifications] = useState({ safe: true, uncertain: true, risky: false, reject: false });
const [ingestMaxRisk, setIngestMaxRisk] = useState(100);
const [ingestMode, setIngestMode] = useState<'unverified_only' | 'overwrite'>('unverified_only');
const [ingestDryRunResult, setIngestDryRunResult] = useState<any>(null);

// Download modal
const [downloadJobId, setDownloadJobId] = useState<string | null>(null);
const [downloadClassifications, setDownloadClassifications] = useState({ safe: true, uncertain: true, risky: true, reject: true });
const [downloadMaxRisk, setDownloadMaxRisk] = useState(100);

// Results loaded from job (enables header action buttons)
const [loadedJobId, setLoadedJobId] = useState<string | null>(null);
```

### UI Sections (top to bottom)
1. **Input Section** — Text area or CSV upload with column mapping
2. **Run Pipeline Button** — Submits job, starts polling
3. **Animated Pipeline Progress** — 5-stage walkthrough (Syntax→Typo→MX→SMTP→Classify)
   - Gradient progress bar with pulsing dot
   - Live stat counters (Processed/Safe/Risky/Rejected)
   - Speed (emails/min), ETA, elapsed time
   - Cancel Job button
4. **Results Section** — Summary cards, breakdown bar, filterable results table
   - Header has "Ingest to DB" and "Download CSV" buttons (open modals when loadedJobId set)
5. **Recent Pipeline Jobs** — Last 20 jobs with status badges
   - Complete: View Results, Download CSV, Ingest to DB
   - Processing: Reconnect, Cancel
   - Failed/Cancelled: ⟳ Retry
6. **Ingestion Modal** — Classification checkboxes, risk slider, mode selector, dry-run preview, commit
7. **Download Modal** — Classification checkboxes, risk slider, quick presets (All/Safe Only/etc), custom download

---

## 6. DEPLOYMENT

### How to Deploy
```bash
# From local machine
cd "/Users/anweshrath/Documents/Cursor/Refinery Nexus"
git add -A && git commit -m "description" && git push origin main

# SSH to server
ssh root@107.172.56.66
# Password: AuVkRFXqz5GY8qn5

# On server
cd /root/refinery
git pull origin main

# Backend
cd refinery-backend && npm run build && pm2 restart refinery-api

# Frontend
cd ../axiom-data-hub && npm run build
rm -rf /home/anweshrath/htdocs/iiiemail.email/assets
cp -r dist/* /home/anweshrath/htdocs/iiiemail.email/

# Cache clear
varnishadm 'ban req.url ~ /'
systemctl restart varnish
```

### PM2 Processes
| Name | Purpose |
|------|---------|
| refinery-api | Main Express backend (port from config) |
| axiom-workers | Background workers (separate process) |

### Server Paths
- **Backend code:** `/root/refinery/refinery-backend/`
- **Frontend dist:** `/home/anweshrath/htdocs/iiiemail.email/`
- **PM2 logs:** `pm2 logs refinery-api --lines 50`
- **ClickHouse:** `clickhouse-client` → database `refinery`

---

## 7. PIPELINE CONFIGURATION & TUNING

### SMTP Defaults (in standaloneVerifier.ts)
```typescript
DEFAULT_SMTP_CONFIG = {
  concurrency: 10,           // Domain workers (10 parallel domains)
  timeout: 15_000,           // 15s per SMTP probe
  heloDomain: 'mail.refinery.local',
  fromEmail: 'verify@refinery.local',
  port: 25,
  minIntervalMs: 2_000,      // 2s between probes to same domain
  maxConcurrentPerDomain: 2, // Max 2 simultaneous probes per domain
};
```

### Rate Limiter Defensive Limits
```typescript
GLOBAL_MAX_CONCURRENT = 50;  // concurrency * 5
MAX_BACKOFF = 30s;           // Was 300s (5 min), now 30s
ACQUIRE_SLOT_TIMEOUT = 60s;  // Hard spin-wait cap
DOMAIN_TIMEOUT = 120s;       // Per-domain hard cap via Promise.race()
```

### Performance Tuning for Faster Runs
To speed up the 136k run, consider:
1. **Increase SMTP concurrency**: Change `smtp.concurrency` from 10 → 20-25 in the pipeline submit body or default config
2. **Reduce SMTP timeout**: 15s → 8s (faster fail-through on dead MX servers)
3. **Skip catch-all detection** for large runs (saves 30s greylisting retries per domain)

### Pipeline Max Emails
Controlled by config key `PIPELINE_MAX_EMAILS` in the `system_config` ClickHouse table. Default: 500,000. Express body limit: 50MB.

---

## 8. KNOWN ISSUES & GOTCHAS

### Critical
1. **Old jobs can't retry** — Only jobs created after 2026-03-26 have `source_emails_json`. Older jobs show "No source emails stored" on retry.

### Non-Critical (Pre-existing)
2. **v550 routes return 500** — External V550 verification integration is incomplete. The `/api/v550/credits`, `/api/v550/jobs/running`, `/api/v550/jobs/completed` endpoints crash because of missing config/tables. They're polled on several pages and spam the console.
3. **AuthContext custom_roles** — The auth context tries to JOIN on `custom_roles` table which doesn't exist. Falls back ok but logs warnings.
4. **Scheduler schedule_cron** — The scheduler queries a `schedule_cron` column on `segments` that doesn't exist. Logs errors every tick.
5. **Vite chunk size warning** — Frontend bundle is ~1.6MB. Not a blocker but could benefit from code splitting.

### Design Limitations
6. **Single-process rate limiter** — Rate limiting is in-memory (Map-based). Won't work with horizontal scaling. For multi-instance, swap the Map for Redis (API stays the same).
7. **Results stored as JSON string** — `results_json` stores full per-email results as a single JSON blob. For 136k emails, this is ~50MB+ in ClickHouse. Works but is not ideal for large-scale.
8. **No resume from partial results** — If a job fails at 93%, the 93% of results are lost. Would need streaming results to a separate table to support resume.

---

## 9. NEXT STEPS / PENDING WORK

### Immediate
1. **Re-run the 136k file** — Upload the CSV fresh. The deadlock fixes should make it complete in ~20-30 min.
2. **Test retry** — After the new run, cancel or fail it intentionally to verify retry works with stored source emails.

### Short-term
3. **Fix v550 500 errors** — Either implement the V550 integration properly or remove the polling from the frontend pages that use it.
4. **Fix schedule_cron column** — Add the column to the segments table or remove it from the scheduler query.
5. **Add custom_roles table** — Or modify the auth query to not reference it.

### Medium-term
6. **MinIO source email storage** — Instead of storing 136k emails as JSON in ClickHouse, write to MinIO as a file. Reduces DB bloat.
7. **Streaming results** — Write partial results as the pipeline progresses, enabling resume from failure point.
8. **SMTP concurrency auto-tuning** — Dynamically adjust concurrency based on domain response times.
9. **Result caching** — Don't re-verify emails that were verified recently (cache by email+timestamp).

---

## 10. FILE REFERENCE

### Backend (refinery-backend/src/)
| File | Purpose |
|------|---------|
| `routes/verify.ts` | All pipeline API endpoints |
| `services/standaloneVerifier.ts` | Pipeline engine (runPipeline, processDomainChecks) |
| `services/engine/rateLimiter.ts` | Per-domain rate limiting with abort support |
| `services/engine/smtpProbe.ts` | Raw TCP SMTP verification |
| `services/engine/syntaxValidator.ts` | Email syntax validation + typo fixing |
| `services/engine/disposableDomains.ts` | Disposable email domain detection |
| `services/engine/roleDetector.ts` | Role-based address detection (info@, admin@) |
| `services/engine/freeProviders.ts` | Free provider classification (Gmail, Yahoo) |
| `services/engine/mxResolver.ts` | DNS MX record resolution |
| `services/engine/domainAuth.ts` | SPF/DMARC verification |
| `services/engine/dnsbl.ts` | DNS blacklist checking |
| `services/engine/domainAge.ts` | WHOIS domain age lookup |
| `db/init.ts` | Database initialization + migrations |
| `index.ts` | Express setup, body limit (50MB), orphan recovery |

### Frontend (axiom-data-hub/src/)
| File | Purpose |
|------|---------|
| `pages/EmailVerifier.tsx` | The entire verification UI (1589 lines) |
| `index.css` | Global styles including pipeline animations |

### CSS Animations (index.css)
| Animation | Purpose |
|-----------|---------|
| `dataFlow` | Particle moving along pipeline connectors |
| `stageGlow` | Active stage node pulsing glow |
| `orbitalSpin` | Rotating element |
| `countUp` | Counter fade-in from below |
| `gradientShift` | Animated gradient bar at top of progress |
| `dotPulse` | Pulsing dot at progress bar leading edge |
| `progressGlow` | Brightness pulse on progress elements |

---

*End of handover. For questions, reference conversation ID 7b9a1db4-3261-4be6-9b4a-9c0f9ff1910e.*
