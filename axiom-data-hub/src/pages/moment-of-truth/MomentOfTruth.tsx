import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { PHASES } from './phases-0-3';
import { PHASES_4_9 } from './phases-4-9';
import { BLOCKERS, MILESTONES, REVENUE_OPPORTUNITIES } from './data';
import type { Phase, Requirement, Status } from './data';
import './moment-of-truth.css';

const ALL_PHASES: Phase[] = [...PHASES, ...PHASES_4_9];

const totals = ALL_PHASES.reduce(
  (acc, p) => ({ done: acc.done + p.score[0], total: acc.total + p.score[1] }),
  { done: 0, total: 0 }
);
const overallPct = Math.round((totals.done / totals.total) * 100);

const STATUS_ICON: Record<Status, string> = {
  done: '✅',
  partial: '🟡',
  missing: '🔴',
  blocked: '⛔',
  external: '🔗',
};

const STATUS_LABEL: Record<Status, string> = {
  done: 'Complete',
  partial: 'Partial',
  missing: 'Missing',
  blocked: 'Blocked',
  external: 'External',
};

function PhaseCard({ phase, isOpen, onClick }: { phase: Phase; isOpen: boolean; onClick: () => void }) {
  const pct = Math.round((phase.score[0] / phase.score[1]) * 100);
  const color = pct === 100 ? '#00ff88' : pct >= 75 ? '#ffd700' : pct >= 50 ? '#ff8c00' : '#ff3b3b';
  const ownerBadge = phase.owner === 'axiom' ? '⚡ Axiom' : phase.owner === 'refinery' ? '🔬 Refinery' : '🔗 Both';

  return (
    <motion.div
      className="mot-phase-card"
      layout
      onClick={onClick}
      whileHover={{ scale: 1.01 }}
      style={{ borderLeft: `4px solid ${color}` }}
    >
      <div className="mot-phase-header">
        <div className="mot-phase-title-row">
          <span className="mot-phase-number">P{phase.number}</span>
          <h3 className="mot-phase-title">{phase.title}</h3>
          <span className="mot-owner-badge">{ownerBadge}</span>
        </div>
        <div className="mot-phase-score-row">
          <div className="mot-progress-bar">
            <motion.div
              className="mot-progress-fill"
              style={{ backgroundColor: color }}
              initial={{ width: 0 }}
              animate={{ width: `${pct}%` }}
              transition={{ duration: 1, ease: 'easeOut' }}
            />
          </div>
          <span className="mot-score" style={{ color }}>{phase.score[0]}/{phase.score[1]} ({pct}%)</span>
        </div>
      </div>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            className="mot-requirements"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3 }}
          >
            {phase.requirements.map((req: Requirement) => (
              <div key={req.id} className={`mot-req mot-req-${req.status}`}>
                <span className="mot-req-icon">{STATUS_ICON[req.status]}</span>
                <div className="mot-req-content">
                  <span className="mot-req-label">{req.label}</span>
                  {req.evidence && <span className="mot-req-evidence">{req.evidence}</span>}
                  {req.note && <span className="mot-req-note">{req.note}</span>}
                </div>
                <span className="mot-req-status-badge">{STATUS_LABEL[req.status]}</span>
              </div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function BlockerCard({ blocker }: { blocker: typeof BLOCKERS[0] }) {
  const color = blocker.severity === 'critical' ? '#ff3b3b' : blocker.severity === 'high' ? '#ff8c00' : '#ffd700';
  return (
    <motion.div
      className="mot-blocker-card"
      style={{ borderLeft: `4px solid ${color}` }}
      initial={{ opacity: 0, x: -20 }}
      animate={{ opacity: 1, x: 0 }}
    >
      <div className="mot-blocker-header">
        <span className="mot-blocker-severity" style={{ color }}>{blocker.severity.toUpperCase()}</span>
        <h4>{blocker.title}</h4>
        {blocker.eta && <span className="mot-blocker-eta">ETA: {blocker.eta}</span>}
      </div>
      <p className="mot-blocker-desc">{blocker.description}</p>
      {blocker.owner && <span className="mot-blocker-owner">Owner: {blocker.owner}</span>}
    </motion.div>
  );
}

export default function MomentOfTruthPage() {
  const [openPhase, setOpenPhase] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'phases' | 'blockers' | 'milestones' | 'revenue'>('phases');

  const togglePhase = (id: string) => setOpenPhase(prev => prev === id ? null : id);

  const doneCount = ALL_PHASES.flatMap(p => p.requirements).filter(r => r.status === 'done').length;
  const partialCount = ALL_PHASES.flatMap(p => p.requirements).filter(r => r.status === 'partial').length;
  const missingCount = ALL_PHASES.flatMap(p => p.requirements).filter(r => r.status === 'missing').length;

  return (
    <div className="mot-container">
      {/* Hero Section */}
      <motion.div
        className="mot-hero"
        initial={{ opacity: 0, y: -30 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6 }}
      >
        <h1 className="mot-title">Moment of Truth</h1>
        <p className="mot-subtitle">IIInfrastructure Canonical Workflow — Forensic Audit</p>
        <p className="mot-date">Last audited: April 13, 2026</p>

        {/* Overall Score Ring */}
        <div className="mot-score-ring-container">
          <svg className="mot-score-ring" viewBox="0 0 120 120">
            <circle cx="60" cy="60" r="52" fill="none" stroke="rgba(255,255,255,0.1)" strokeWidth="8" />
            <motion.circle
              cx="60" cy="60" r="52" fill="none"
              stroke={overallPct >= 80 ? '#00ff88' : '#ffd700'}
              strokeWidth="8"
              strokeLinecap="round"
              strokeDasharray={`${2 * Math.PI * 52}`}
              initial={{ strokeDashoffset: 2 * Math.PI * 52 }}
              animate={{ strokeDashoffset: 2 * Math.PI * 52 * (1 - overallPct / 100) }}
              transition={{ duration: 1.5, ease: 'easeOut' }}
              style={{ transform: 'rotate(-90deg)', transformOrigin: '50% 50%' }}
            />
            <text x="60" y="55" textAnchor="middle" fill="white" fontSize="24" fontWeight="700">{overallPct}%</text>
            <text x="60" y="72" textAnchor="middle" fill="rgba(255,255,255,0.6)" fontSize="10">{totals.done}/{totals.total}</text>
          </svg>
        </div>

        {/* Quick Stats */}
        <div className="mot-stats-row">
          <div className="mot-stat"><span className="mot-stat-num" style={{ color: '#00ff88' }}>{doneCount}</span><span className="mot-stat-label">Complete</span></div>
          <div className="mot-stat"><span className="mot-stat-num" style={{ color: '#ffd700' }}>{partialCount}</span><span className="mot-stat-label">Partial</span></div>
          <div className="mot-stat"><span className="mot-stat-num" style={{ color: '#ff3b3b' }}>{missingCount}</span><span className="mot-stat-label">Missing</span></div>
          <div className="mot-stat"><span className="mot-stat-num" style={{ color: '#00bfff' }}>3B+</span><span className="mot-stat-label">CH Rows</span></div>
        </div>
      </motion.div>

      {/* Tab Navigation */}
      <div className="mot-tabs">
        {(['phases', 'blockers', 'milestones', 'revenue'] as const).map(tab => (
          <button
            key={tab}
            className={`mot-tab ${activeTab === tab ? 'mot-tab-active' : ''}`}
            onClick={() => setActiveTab(tab)}
          >
            {tab === 'phases' ? '📋 Phases' : tab === 'blockers' ? '⛔ Blockers' : tab === 'milestones' ? '🏁 Milestones' : '💰 Revenue'}
          </button>
        ))}
      </div>

      {/* Tab Content */}
      <AnimatePresence mode="wait">
        {activeTab === 'phases' && (
          <motion.div key="phases" className="mot-tab-content" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            {ALL_PHASES.map(phase => (
              <PhaseCard key={phase.id} phase={phase} isOpen={openPhase === phase.id} onClick={() => togglePhase(phase.id)} />
            ))}
          </motion.div>
        )}

        {activeTab === 'blockers' && (
          <motion.div key="blockers" className="mot-tab-content" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <div className="mot-blockers-header">
              <h2>🚨 What's Blocking Go-Live</h2>
              <p>These must be resolved before committing to Partner #1</p>
            </div>
            {BLOCKERS.map(b => <BlockerCard key={b.id} blocker={b} />)}
          </motion.div>
        )}

        {activeTab === 'milestones' && (
          <motion.div key="milestones" className="mot-tab-content" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <h2 className="mot-section-title">🏁 Milestone Tracker</h2>
            <div className="mot-milestones">
              {MILESTONES.map((m, i) => (
                <motion.div
                  key={m.id}
                  className={`mot-milestone ${m.done ? 'mot-milestone-done' : 'mot-milestone-pending'}`}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: i * 0.05 }}
                >
                  <span className="mot-ms-icon">{m.done ? '✅' : '⏳'}</span>
                  <span className="mot-ms-label">{m.label}</span>
                  {m.date && <span className="mot-ms-date">{m.date}</span>}
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}

        {activeTab === 'revenue' && (
          <motion.div key="revenue" className="mot-tab-content" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
            <h2 className="mot-section-title">💰 Revenue Opportunities (Refinery Nexus)</h2>
            <p className="mot-section-desc">Standalone features that save money AND generate revenue by offering services to clients</p>
            <div className="mot-revenue-grid">
              {REVENUE_OPPORTUNITIES.map(r => (
                <motion.div key={r.id} className="mot-revenue-card" whileHover={{ scale: 1.02 }}>
                  <div className="mot-rev-badge">READY TO SHIP</div>
                  <h3>{r.title}</h3>
                  <p>{r.description}</p>
                </motion.div>
              ))}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
