# Plan 005 — In-Built Email Verification Engine

**Priority**: LOW (deferred to Plan 005 delivery)  
**Estimated effort**: Multi-session (8–12 hours total)  
**Status**: ✅ Done  
**Prerequisites**: ClickHouse running, SMTP configured, multi-server support (Plan 001)

## Goal
Build a native email verification engine that doesn't depend on Verify550. This engine performs SMTP-level checks (MX lookup, SMTP connect, RCPT TO) to validate email deliverability without actually sending emails.

## Why Build This?
- **Cost savings**: Verify550 charges per verification. At scale (millions of emails), this gets expensive.
- **Speed**: Local verification is faster than API calls to a third party.
- **Privacy**: No email data leaves your infrastructure.
- **Customization**: Custom rules, whitelists, domain-specific logic.

## Architecture

```
Verification Engine (Backend Service)
├── MX Resolver (DNS lookup for mail servers)
├── SMTP Connector (connect to MX, test RCPT TO)
├── Result Classifier (valid/invalid/risky/catch-all/disposable)
├── Disposable Domain DB (maintained list of temporary email providers)
├── Rate Limiter (per-domain throttling to avoid being blocked)
└── Result Writer (ClickHouse bulk insert)
```

## Verification Flow

```
Email Input → DNS MX Lookup → Connect to MX (port 25) → EHLO → MAIL FROM → RCPT TO
  ↓
  ├── 250 OK → valid
  ├── 550 → invalid (mailbox doesn't exist)
  ├── 450/451/452 → risky (temporary failure)
  ├── Catch-all detection (test random address at same domain)
  ├── Disposable domain check (against known list)
  └── Timeout/Error → unknown
```

## Implementation Steps (Phases)

### Phase 1: Core Engine (4 hours)
- [x] `refinery-backend/src/services/verificationEngine.ts` — core verification logic
- [x] MX resolver using Node.js `dns` module
- [x] SMTP connector using raw TCP (`net` module) — no full email library needed
- [x] Result classifier with all status types
- [x] Unit tests for each verification step
- [x] Integration with existing batch management (ClickHouse tables)

### Phase 2: Domain Intelligence (2 hours)
- [x] Disposable domain database (embed list or fetch from GitHub)
- [x] Catch-all detection algorithm
- [x] Domain reputation scoring (based on verification history)
- [x] Per-domain rate limiting (avoid IP blocks from major providers)

### Phase 3: UI Integration (2 hours)
- [x] Verification page toggle: "Verify550 API" vs "Built-in Engine"
- [x] Config section for built-in engine (concurrency, timeout, from-domain)
- [x] Progress display with real-time stats
- [x] Same batch management UI as Verify550 (shared backend interface)
- [x] Standalone Verification Studio (email list upload, granular checks, scoring, results)

### Phase 4: Production Hardening (2 hours)
- [x] IP rotation support (multiple outbound IPs) / Configuration placeholders
- [x] Backpressure handling (slow down when getting too many 4xx)
- [x] Retry logic with exponential backoff
- [x] DNSBL check placeholders and framework

## Security Considerations
- Must use a dedicated IP for verification (separate from sending IP)
- HELO/EHLO domain must have valid reverse DNS
- Must comply with anti-abuse policies (no harvesting)
- Rate limiting is critical — aggressive checking gets IP blocked

## Database Tables (ClickHouse)
Reuses existing:
- `verification_batches` — same table as Verify550 batches
- `verification_results` — same result format

New columns:
- `engine` column in batches: 'verify550' | 'builtin'

## Dependencies
- Node.js `dns` module (built-in)
- Node.js `net` module (built-in)
- No external npm packages needed for core engine
- Optional: disposable domain list from GitHub repo

## Risk Assessment
- **IP reputation risk**: If not rate-limited properly, SMTP checks can get the server's IP blocklisted by major email providers
- **Mitigation**: Use dedicated verification IP, respect rate limits, implement exponential backoff
- **Recommendation**: Start with Verify550 for now, build this when verification volume justifies the infrastructure cost
