// ═══════════════════════════════════════════════════════════════
// MOMENT OF TRUTH — Forensic Audit Data
// IIInfrastructure Canonical Workflow vs Axiom + Refinery Nexus
// Last audited: 2026-04-13
// ═══════════════════════════════════════════════════════════════

export type Status = 'done' | 'partial' | 'missing' | 'blocked' | 'external';

export interface Requirement {
  id: string;
  label: string;
  status: Status;
  evidence?: string;
  note?: string;
}

export interface Phase {
  id: string;
  number: number;
  title: string;
  owner: 'axiom' | 'refinery' | 'both';
  score: [number, number]; // [done, total]
  requirements: Requirement[];
}

export interface Blocker {
  id: string;
  title: string;
  severity: 'critical' | 'high' | 'medium';
  description: string;
  eta?: string;
  owner?: string;
}

export interface Milestone {
  id: string;
  label: string;
  done: boolean;
  date?: string;
}

export const BLOCKERS: Blocker[] = [
  {
    id: 'hetzner',
    title: 'Hetzner Dedicated Server',
    severity: 'critical',
    description: 'New dedicated server required for production deployment of Refinery Nexus + Workers. Current Linode cannot handle 3B+ row workloads at scale. Waiting on provisioning.',
    eta: '~48 hours',
    owner: 'Infrastructure',
  },
  {
    id: 'macbook',
    title: 'New MacBook Pro',
    severity: 'high',
    description: 'Development velocity severely throttled on current hardware. New MacBook Pro in transit — will unblock parallel development across Axiom + Refinery Nexus.',
    eta: '~48 hours',
    owner: 'Anwesh',
  },
  {
    id: 'signal-writeback',
    title: 'Signal Writeback: CH → Supabase',
    severity: 'critical',
    description: 'Engagement events (bounces, clicks, replies) stored in ClickHouse engagement_events never sync to Axiom signal_event table. Belief confidence formula has zero data. Learning loop is dead on arrival.',
    owner: 'Engineering',
  },
  {
    id: 'ai-persist',
    title: 'AI Scores Not Persisted',
    severity: 'high',
    description: 'Lead Scoring, ICP Analysis, Readiness — all exist as AI prompt responses but results vanish after API call. At 3B rows, re-running on demand is impossible. Need _lead_score, _buyer_stage, _readiness_score columns.',
    owner: 'Engineering',
  },
];

export const MILESTONES: Milestone[] = [
  { id: 'm1', label: 'MailWizz configured for Martin (Happy Ending)', done: true, date: '2026-04-06' },
  { id: 'm2', label: 'Refinery Nexus: 3B+ rows ingested', done: true, date: '2026-04-05' },
  { id: 'm3', label: 'KB Onboarding Questionnaire shipped', done: true, date: '2026-04-12' },
  { id: 'm4', label: 'KB Grader + Brain Hydrator agents', done: true, date: '2026-04-12' },
  { id: 'm5', label: 'Infra-Flow visualization live', done: true, date: '2026-04-13' },
  { id: 'm6', label: 'Canonical doc audit complete', done: true, date: '2026-04-13' },
  { id: 'm7', label: 'Hetzner server provisioned', done: false },
  { id: 'm8', label: 'Signal writeback bridge built', done: false },
  { id: 'm9', label: 'Phase gate system in UI', done: false },
  { id: 'm10', label: 'Partner #1 live', done: false },
];

export const REVENUE_OPPORTUNITIES = [
  {
    id: 'list-hygiene',
    title: 'List Hygiene Service',
    description: 'Verify550 + standalone 8-check pipeline. Offer as SaaS to clients. Already built.',
    status: 'ready' as const,
  },
  {
    id: 'data-enrichment',
    title: 'Data Enrichment',
    description: 'AI-powered enrichment with confidence scoring. Ready to productize.',
    status: 'ready' as const,
  },
  {
    id: 'icp-analysis',
    title: 'ICP Analysis Service',
    description: 'AI ICP refinement + match scoring against 3B+ contact database.',
    status: 'ready' as const,
  },
  {
    id: 'lead-scoring',
    title: 'Lead Scoring API',
    description: 'Quality scoring 0-100 with tier assignment. v1 API already built.',
    status: 'ready' as const,
  },
];
