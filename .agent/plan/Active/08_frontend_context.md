# 08 — Frontend Context Integration

## Purpose
Make agents page-aware. When Tommy opens the agent on the Verification page, the agent instantly knows what job he's looking at without Tommy having to explain.

---

## How It Works

### 1. AgentCard receives `pageContext` prop

Each page already renders an `<AgentCard>`. We extend it:

```typescript
// Current (in each page):
<AgentCard agentSlug="bastion" contextLabel="Verification Engine" />

// New:
<AgentCard
  agentSlug="bastion"
  contextLabel="Verification Engine"
  pageContext={{
    page: 'verification',
    activeJobId: selectedJob?.id,
    jobStatus: selectedJob?.status,
    totalEmails: selectedJob?.total_emails,
    safeCount: selectedJob?.safe_count,
    riskyCount: selectedJob?.risky_count,
  }}
/>
```

### 2. AgentCard passes context to chat API

When the user sends their first message in a conversation, the frontend prepends the context:

```typescript
const firstMessage = pageContext
  ? `[CONTEXT: User is on the ${pageContext.page} page. ${formatContext(pageContext)}]\n\n${userMessage}`
  : userMessage;
```

### 3. Context formatting per page

```typescript
function formatContext(ctx: PageContext): string {
  switch (ctx.page) {
    case 'verification':
      return `Viewing verification job ${ctx.activeJobId} (${ctx.totalEmails?.toLocaleString()} emails, status: ${ctx.jobStatus}, safe: ${ctx.safeCount}, risky: ${ctx.riskyCount})`;

    case 'database':
      return `Viewing ClickHouse table "${ctx.tableName}", ${ctx.rowCount?.toLocaleString()} rows visible`;

    case 'segments':
      return `Viewing segments list. ${ctx.segmentCount} segments defined.`;

    case 'ingestion':
      return `Viewing S3 ingestion. ${ctx.activeJobCount} active jobs.`;

    case 'dashboard':
      return `Viewing main dashboard. Total leads: ${ctx.totalLeads?.toLocaleString()}.`;

    case 'targets':
      return `Viewing email target lists. ${ctx.listCount} lists created.`;

    default:
      return `Page: ${ctx.page}`;
  }
}
```

### 4. Cost: ~30 tokens per conversation. Zero extra API calls.

The data is already loaded on the page. We're just passing it as text context.

---

## Which Agent Appears on Which Page

| Page | Agent(s) | Context Data Passed |
|------|----------|-------------------|
| Dashboard | Overseer | totalLeads, verifiedCount, recentJobCount |
| S3 Ingestion | Overseer | activeJobs, configured sources |
| ClickHouse | Cortex | currentTable, visibleRowCount, activeQuery |
| Segments | Cortex | segmentCount, activeSegment name/filters |
| Verification | Bastion | activeJobId, status, email counts by class |
| Pipeline Studio | Bastion | activeJobId, progress, config |
| Email Targets | Overseer | listCount, totalExported |
| Mail Queue | Overseer | queueSize, pendingCount |
| MTA & Swarm | Overseer | satelliteCount, healthStatus |
| Data Enrichment | Cortex | sourceTable, enrichmentStatus |
| Lead Scoring | Cortex | segmentId, tierDistribution |
| ICP Analysis | Cortex | activeICPProfile |
| Segmentation | Cortex | filterConfig, matchCount |
| Bounce Analysis | Bastion | bounceRate, topDomains |
| Content Gen | Muse | generatedVariants, selectedTemplate |
| Campaign Opt | Muse | scheduleConfig, audienceSize |
| Architecture | Overseer | systemOverview |
| AI Settings | Overseer | providerStatus, tokenUsage |
| Server Config | Overseer | connectedServers, healthStatus |
| Team | Overseer | memberCount, roleDistribution |
| Logs | Overseer | recentErrors, logVolume |
| Database Janitor | Overseer | orphanedJobs, diskUsage |
| Settings | — | (no agent needed) |
| Tutorial | — | (no agent needed) |

---

## Implementation Checklist

For each page, the developer needs to:
1. Import `AgentCard` (already done on all pages)
2. Add `pageContext` prop with relevant state from the page's existing hooks
3. No new API calls — all context data comes from state already loaded

Total frontend changes: ~20 lines per page (just adding the pageContext object to existing AgentCard).
