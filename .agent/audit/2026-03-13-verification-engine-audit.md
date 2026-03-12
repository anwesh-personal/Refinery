# Forensic Audit — Plan 005 Verification Engine
**Date**: 2026-03-13  
**Scope**: All files created or modified for the built-in verification engine.

## Files Audited
1. `services/engine/mxResolver.ts` — ✅ Clean
2. `services/engine/smtpProbe.ts` — ✅ Clean
3. `services/engine/rateLimiter.ts` — ⚠️ 1 issue (spin-wait starvation risk)
4. `services/engine/disposableDomains.ts` — ✅ Clean
5. `services/verificationEngine.ts` — 🔴 2 issues (race condition, memory leak)
6. `services/verification.ts` — 🔴 3 issues (stale comment, `as any` casts, error log label wrong)
7. `routes/verification.ts` — ⚠️ 1 issue (stale comment)
8. `pages/Verification.tsx` — ⚠️ 1 issue (page header subtitle stale)

---

## CRITICAL FINDINGS

### F1: Race condition in worker pool (verificationEngine.ts:106-107)
**Severity**: 🔴 CRITICAL  
**File**: `verificationEngine.ts` line 106-107  
**Problem**: `domainIndex++` is NOT atomic in JavaScript's async context. Multiple workers `await`-ing will return, read `domainIndex`, and then all increment. While JS is single-threaded so the `++` itself can't interleave, the `if (currentIndex >= domainEntries.length) break;` guard on line 108 makes line 106-107 redundant and confusing — it's a double-check that adds complexity for zero safety.  
**Fix**: Remove the redundant guard. The while condition on line 106 is sufficient because JS is single-threaded and `domainIndex++` is synchronous.

### F2: Catch-all cache never evicted (verificationEngine.ts:61)
**Severity**: ⚠️ MEDIUM  
**File**: `verificationEngine.ts` line 61  
**Problem**: `catchAllCache` is a module-level `Map` that grows indefinitely. After processing millions of domains, this will leak memory. The MX cache has `MX_CACHE_MAX_SIZE` with eviction, but catchAllCache has nothing.  
**Fix**: Apply the same eviction strategy or tie it to MX cache TTL.

### F3: `as any` type casts in verification.ts (lines 186-187)
**Severity**: 🔴 BAD PRACTICE  
**File**: `verification.ts` lines 186-187  
**Problem**: `v550Config as any` and `builtinConfig as any` are lazy type-lie casts. When engine is `'verify550'`, `builtinConfig` is `undefined`, and it's passed as `EngineConfig` to `runVerificationPipeline`. Same for the reverse. The function signature says both params are required objects but one will always be `undefined`.  
**Fix**: Either make both params optional in the function signature (`| undefined`), or restructure to use a discriminated union.

### F4: Stale error log label (verification.ts:190)
**Severity**: ⚠️ MEDIUM  
**File**: `verification.ts` line 190  
**Problem**: `console.error('[Verify550] Batch ${batchId} failed:', err.message)` — still says `[Verify550]` even if the engine is `builtin`. Should use `[Engine - ${engine}]` like the other log lines.  
**Fix**: Use template string with engine variable.

### F5: Duplicate section comment (verification.ts:123 + 140)
**Severity**: ⚠️ LOW  
**File**: `verification.ts` lines 123 and 140  
**Problem**: Two identical `// ─── Start a Verification Batch ───` comments from sloppy insertion. Line 123 is orphaned.  
**Fix**: Remove the duplicate on line 123.

### F6: Stale route comment (routes/verification.ts:51 + 94-95)
**Severity**: ⚠️ LOW  
**File**: `routes/verification.ts` lines 51 and 94-95  
**Problem**: Line 51 comment says `Body: { segmentId: string }` but now also accepts `engine`. Line 94-95 comment still says "Save Verify550 configuration" but now also handles builtin engine config.  
**Fix**: Update comments.

### F7: Page header subtitle stale (Verification.tsx:184)
**Severity**: ⚠️ LOW  
**File**: `Verification.tsx` line 184  
**Problem**: `sub="Clean and verify lead data through Verify550 before mailing."` — now inaccurate since we have the native engine too.  
**Fix**: Update subtitle.

---

## CLEAN FINDINGS (No issues)

- **mxResolver.ts**: RFC 5321 fallback correct, LRU eviction correct, TTL caching correct.
- **smtpProbe.ts**: State machine correct, multi-line response parser correct, socket cleanup on all paths, timeout handling correct.
- **rateLimiter.ts**: Exponential backoff math correct, slot acquisition/release balanced, global counter clamped.
- **disposableDomains.ts**: Immutable Set, lowercase normalization, extensible via addDomains.
