import { useState, useRef, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ReactFlow, Background, Controls,
  type Node, type Edge, Position, MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import {
  CloudDownload, Database, Filter, ShieldCheck, Sparkles,
  ChevronDown, CheckCircle2, AlertTriangle,
  Lightbulb, Code2, Settings, Users, Zap,
  RefreshCw, Copy, ExternalLink,
  Target, Shield, Eye,
  Layers, Cpu, FileText, Workflow,
} from 'lucide-react';

// ═══════════════════════════════════════════════════════════════
// TUTORIAL PAGE — Complete Interactive Reference
// ═══════════════════════════════════════════════════════════════

const spring = { type: 'spring' as const, stiffness: 300, damping: 24 };
const fadeUp = { initial: { opacity: 0, y: 24 }, animate: { opacity: 1, y: 0 }, transition: { duration: 0.5 } };

// ─── Data Flow Nodes for React Flow ───
const flowNodes: Node[] = [
  { id: 's3', position: { x: 0, y: 0 }, data: { label: '☁️ S3 Bucket' }, style: rfNodeStyle('var(--blue)'), sourcePosition: Position.Right, targetPosition: Position.Left },
  { id: 'ingest', position: { x: 240, y: 0 }, data: { label: '📥 Ingestion Engine' }, style: rfNodeStyle('var(--blue)'), sourcePosition: Position.Right, targetPosition: Position.Left },
  { id: 'ch', position: { x: 500, y: 0 }, data: { label: '⚡ ClickHouse' }, style: rfNodeStyle('var(--green)'), sourcePosition: Position.Right, targetPosition: Position.Left },
  { id: 'seg', position: { x: 280, y: 120 }, data: { label: '🎯 Segments' }, style: rfNodeStyle('var(--purple)'), sourcePosition: Position.Right, targetPosition: Position.Left },
  { id: 'verify', position: { x: 520, y: 120 }, data: { label: '🛡️ Verification' }, style: rfNodeStyle('var(--yellow)'), sourcePosition: Position.Right, targetPosition: Position.Left },
  { id: 'targets', position: { x: 400, y: 240 }, data: { label: '📋 Targets' }, style: rfNodeStyle('var(--cyan)'), sourcePosition: Position.Right, targetPosition: Position.Left },
  { id: 'api', position: { x: 700, y: 60 }, data: { label: '🔌 v1 API' }, style: rfNodeStyle('var(--accent)'), sourcePosition: Position.Right, targetPosition: Position.Left },
];

const flowEdges: Edge[] = [
  { id: 'e1', source: 's3', target: 'ingest', animated: true, style: { stroke: 'var(--blue)' }, markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--blue)' } },
  { id: 'e2', source: 'ingest', target: 'ch', animated: true, style: { stroke: 'var(--green)' }, markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--green)' } },
  { id: 'e3', source: 'ch', target: 'seg', style: { stroke: 'var(--purple)' }, markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--purple)' } },
  { id: 'e4', source: 'seg', target: 'verify', animated: true, style: { stroke: 'var(--yellow)' }, markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--yellow)' } },
  { id: 'e5', source: 'verify', target: 'targets', style: { stroke: 'var(--cyan)' }, markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--cyan)' } },
  { id: 'e6', source: 'ch', target: 'api', animated: true, style: { stroke: 'var(--accent)' }, markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--accent)' } },
];

function rfNodeStyle(color: string) {
  return {
    background: 'var(--bg-card)', border: `2px solid ${color}`,
    borderRadius: 12, padding: '10px 16px', fontSize: 13, fontWeight: 600,
    color: 'var(--text-primary)', boxShadow: `0 4px 20px ${color}22`,
  };
}

// ─── Section Definitions ───

interface TutorialSection {
  id: string;
  icon: ReactNode;
  color: string;
  title: string;
  subtitle: string;
  route?: string;
}

const SECTIONS: TutorialSection[] = [
  { id: 'overview', icon: <Workflow size={20} />, color: 'var(--accent)', title: 'Data Flow Overview', subtitle: 'The complete pipeline from raw CSV to verified prospect' },
  { id: 'ingestion', icon: <CloudDownload size={20} />, color: 'var(--blue)', title: 'S3 Ingestion', subtitle: 'Connect S3 buckets, auto-rules, format detection', route: '/ingestion' },
  { id: 'database', icon: <Database size={20} />, color: 'var(--green)', title: 'ClickHouse Database', subtitle: 'Browse, query, filter billions of rows', route: '/database' },
  { id: 'segments', icon: <Filter size={20} />, color: 'var(--purple)', title: 'Segmentation', subtitle: 'Build complex filters, preview audiences', route: '/segments' },
  { id: 'verification', icon: <ShieldCheck size={20} />, color: 'var(--yellow)', title: 'Verification Engine', subtitle: '9-check pipeline, SMTP probing, risk scoring', route: '/verification' },
  { id: 'pipeline', icon: <Cpu size={20} />, color: 'var(--cyan)', title: 'Pipeline Studio', subtitle: 'Standalone email list verifier with granular control', route: '/email-verifier' },
  { id: 'targets', icon: <Target size={20} />, color: 'var(--green)', title: 'Targets & Export', subtitle: 'Build target lists, export CSV/XLSX', route: '/targets' },
  { id: 'api', icon: <Code2 size={20} />, color: 'var(--accent)', title: 'v1 REST API', subtitle: 'Machine-to-machine API with key auth', route: undefined },
  { id: 'config', icon: <Settings size={20} />, color: 'var(--text-tertiary)', title: 'Configuration', subtitle: 'System config, servers, API keys, team', route: '/config' },
];

// ═══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════

export default function TutorialPage() {
  const navigate = useNavigate();
  const [openSection, setOpenSection] = useState<string | null>('overview');
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const heroRef = useRef<HTMLDivElement>(null);

  const toggleSection = (id: string) => setOpenSection(prev => prev === id ? null : id);

  return (
    <div style={{ paddingBottom: 120 }}>

      {/* ═══════════ HERO ═══════════ */}
      <motion.div
        ref={heroRef}
        onMouseMove={e => {
          if (!heroRef.current) return;
          const r = heroRef.current.getBoundingClientRect();
          setMousePos({ x: e.clientX - r.left, y: e.clientY - r.top });
        }}
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.6 }}
        style={{
          position: 'relative', padding: '72px 40px', textAlign: 'center',
          background: 'var(--bg-card)', borderRadius: 24,
          border: '1px solid var(--border)', overflow: 'hidden', marginBottom: 48,
        }}
      >
        <div style={{
          position: 'absolute', top: mousePos.y - 250, left: mousePos.x - 250,
          width: 500, height: 500, pointerEvents: 'none', opacity: 0.4,
          background: 'radial-gradient(circle, var(--accent-muted) 0%, transparent 70%)',
          transition: 'top 0.15s, left 0.15s',
        }} />

        <div style={{
          position: 'absolute', inset: 0, opacity: 0.08,
          backgroundImage: 'linear-gradient(var(--border) 1px, transparent 1px), linear-gradient(90deg, var(--border) 1px, transparent 1px)',
          backgroundSize: '32px 32px',
          maskImage: 'radial-gradient(ellipse at center, black 30%, transparent 75%)',
        }} />

        <div style={{ position: 'relative', zIndex: 2, maxWidth: 700, margin: '0 auto' }}>
          <motion.div
            initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '5px 14px', borderRadius: 999, marginBottom: 20,
              background: 'var(--accent-muted)', border: '1px solid var(--accent)',
              color: 'var(--accent)', fontSize: 12, fontWeight: 700,
              textTransform: 'uppercase', letterSpacing: '0.08em',
            }}
          >
            <Sparkles size={14} /> Complete Reference
          </motion.div>

          <motion.h1
            initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}
            style={{
              fontSize: 'clamp(32px, 5vw, 56px)', fontWeight: 900,
              lineHeight: 1.08, letterSpacing: '-0.04em',
              color: 'var(--text-primary)', marginBottom: 16,
            }}
          >
            Master <span style={{ color: 'var(--accent)' }}>Refinery Nexus</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}
            style={{ fontSize: 15, color: 'var(--text-secondary)', lineHeight: 1.7, maxWidth: 560, margin: '0 auto' }}
          >
            Every feature explained in detail — from connecting your first S3 bucket to building
            API integrations. Click any section below to deep-dive. Nothing is left out.
          </motion.p>
        </div>
      </motion.div>

      {/* ═══════════ TABLE OF CONTENTS ═══════════ */}
      <motion.div {...fadeUp} transition={{ delay: 0.5 }} style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 40 }}>
        {SECTIONS.map((s) => (
          <motion.button
            key={s.id}
            whileHover={{ scale: 1.04, y: -2 }}
            whileTap={{ scale: 0.97 }}
            onClick={() => { setOpenSection(s.id); document.getElementById(`sec-${s.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '8px 14px', borderRadius: 10, border: '1px solid var(--border)',
              background: openSection === s.id ? `${s.color}15` : 'var(--bg-card)',
              color: openSection === s.id ? s.color : 'var(--text-secondary)',
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
              transition: 'all 0.2s',
            }}
          >
            {s.icon} {s.title}
          </motion.button>
        ))}
      </motion.div>

      {/* ═══════════ SECTIONS ═══════════ */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {SECTIONS.map((sec, idx) => (
          <Section
            key={sec.id}
            section={sec}
            index={idx}
            isOpen={openSection === sec.id}
            onToggle={() => toggleSection(sec.id)}
            navigate={navigate}
          />
        ))}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SECTION WRAPPER — Collapsible with animations
// ═══════════════════════════════════════════════════════════════

function Section({ section: s, index, isOpen, onToggle, navigate }: {
  section: TutorialSection; index: number; isOpen: boolean;
  onToggle: () => void; navigate: (path: string) => void;
}) {
  return (
    <motion.div
      id={`sec-${s.id}`}
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-40px' }}
      transition={{ duration: 0.4, delay: 0.05 * index }}
    >
      {/* Header (always visible) */}
      <motion.div
        onClick={onToggle}
        whileHover={{ scale: 1.005, boxShadow: `0 0 0 1px ${s.color}40, 0 8px 30px ${s.color}10` }}
        style={{
          display: 'flex', alignItems: 'center', gap: 14,
          padding: '16px 20px', borderRadius: isOpen ? '16px 16px 0 0' : 16,
          background: 'var(--bg-card)', border: `1px solid ${isOpen ? s.color + '40' : 'var(--border)'}`,
          borderBottom: isOpen ? 'none' : undefined,
          cursor: 'pointer', transition: 'border-color 0.3s',
        }}
      >
        <div style={{
          width: 36, height: 36, borderRadius: 10,
          background: `${s.color}15`, color: s.color,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'box-shadow 0.3s',
          boxShadow: isOpen ? `0 0 16px ${s.color}30` : 'none',
        }}>
          {s.icon}
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{s.title}</div>
          <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginTop: 2 }}>{s.subtitle}</div>
        </div>
        {s.route && (
          <motion.button
            whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
            onClick={e => { e.stopPropagation(); navigate(s.route!); }}
            style={{
              padding: '6px 12px', borderRadius: 8, fontSize: 11, fontWeight: 600,
              background: `${s.color}15`, color: s.color, border: `1px solid ${s.color}30`,
              cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
            }}
          >
            Open <ExternalLink size={10} />
          </motion.button>
        )}
        <motion.div animate={{ rotate: isOpen ? 180 : 0 }} transition={spring}>
          <ChevronDown size={18} color="var(--text-tertiary)" />
        </motion.div>
      </motion.div>

      {/* Content (animated collapse) */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.35, ease: [0.25, 0.1, 0.25, 1] }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{
              padding: '24px 20px 28px', background: 'var(--bg-card)',
              border: `1px solid ${s.color}40`, borderTop: 'none',
              borderRadius: '0 0 16px 16px',
            }}>
              <SectionContent id={s.id} color={s.color} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════
// SECTION CONTENT — The actual tutorials
// ═══════════════════════════════════════════════════════════════

function SectionContent({ id, color }: { id: string; color: string }) {
  switch (id) {
    case 'overview': return <OverviewSection color={color} />;
    case 'ingestion': return <IngestionSection color={color} />;
    case 'database': return <DatabaseSection color={color} />;
    case 'segments': return <SegmentsSection color={color} />;
    case 'verification': return <VerificationSection color={color} />;
    case 'pipeline': return <PipelineSection color={color} />;
    case 'targets': return <TargetsSection color={color} />;
    case 'api': return <ApiSection color={color} />;
    case 'config': return <ConfigSection color={color} />;
    default: return null;
  }
}

// ─── 1. Overview ───

function OverviewSection({ color }: { color: string }) {
  return (
    <div>
      <P>Refinery Nexus is a data intelligence platform built on ClickHouse. It ingests raw contact data from S3, stores it in a blazingly fast analytical database, lets you segment and verify it, and exposes clean REST APIs for external systems to consume.</P>

      <H3 color={color}>The Data Pipeline</H3>
      <P>Every piece of data flows through this pipeline. Hover over nodes to see connections. Animated edges show real-time data flow direction.</P>

      <div style={{ height: 320, borderRadius: 12, overflow: 'hidden', border: '1px solid var(--border)', marginBottom: 24 }}>
        <ReactFlow
          nodes={flowNodes} edges={flowEdges}
          fitView fitViewOptions={{ padding: 0.3 }}
          nodesDraggable={false} nodesConnectable={false}
          panOnDrag={false} zoomOnScroll={false} zoomOnPinch={false}
          proOptions={{ hideAttribution: true }}
          style={{ background: 'var(--bg-app)' }}
        >
          <Background gap={24} size={1} color="var(--border)" />
          <Controls showInteractive={false} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8 }} />
        </ReactFlow>
      </div>

      <StepList color={color} steps={[
        { title: 'S3 → Ingestion', desc: 'Raw CSVs, GZips, Parquets are pulled from S3 buckets on a schedule or manually. Auto-rules detect new files and ingest them.' },
        { title: 'Ingestion → ClickHouse', desc: 'Data is parsed, normalized, and inserted into the universal_person table — 70+ columns per contact.' },
        { title: 'ClickHouse → Segments', desc: 'Build SQL-like filters to slice the database. "CEOs in California who work at SaaS companies with 50+ employees."' },
        { title: 'Segments → Verification', desc: 'Run the 9-check verification engine on your segment. Syntax, disposable, role, MX, SMTP probe, catch-all, and more.' },
        { title: 'Verification → Targets', desc: 'Verified contacts become export-ready target lists. Download as CSV or serve via v1 API.' },
        { title: 'ClickHouse → v1 API', desc: 'External systems (like MarketX) query contacts, segments, and verification status via authenticated REST endpoints.' },
      ]} />

      <Tip icon={<Lightbulb size={14} />} color="var(--yellow)">
        The entire pipeline can run autonomously. Set up auto-ingestion rules, and new data flows through the pipeline without any manual intervention.
      </Tip>
    </div>
  );
}

// ─── 2. S3 Ingestion ───

function IngestionSection({ color }: { color: string }) {
  return (
    <div>
      <P>The ingestion system connects to S3-compatible storage (AWS S3, MinIO, Linode Object Storage) and pulls data files into ClickHouse automatically.</P>

      <H3 color={color}>Supported Formats</H3>
      <FeatureGrid items={[
        { icon: <FileText size={16} />, title: 'CSV', desc: 'Comma-separated values. Auto-detects delimiter and encoding.' },
        { icon: <FileText size={16} />, title: 'TSV', desc: 'Tab-separated values. Common in data exports.' },
        { icon: <FileText size={16} />, title: 'GZip', desc: 'Compressed CSV/TSV. Decompresses on-the-fly during ingestion.' },
        { icon: <Layers size={16} />, title: 'Parquet', desc: 'Columnar format. Fastest ingestion — already column-oriented like ClickHouse.' },
      ]} color={color} />

      <H3 color={color}>How to Connect an S3 Source</H3>
      <StepList color={color} steps={[
        { title: 'Go to Ingestion → S3 Sources', desc: 'Click "Add Source" and enter your bucket details: bucket name, region, access key, secret key, and optional prefix.' },
        { title: 'Test the connection', desc: 'Hit "Test" to verify Refinery can reach your bucket. It will list available files as confirmation.' },
        { title: 'Browse files', desc: 'Once connected, you\'ll see all files in the bucket. Select one or more to ingest.' },
        { title: 'Start ingestion', desc: 'Click "Ingest" and watch real-time progress. Row counts update live as data streams into ClickHouse.' },
      ]} />

      <H3 color={color}>Auto-Ingestion Rules</H3>
      <P>Set up rules that automatically ingest new files matching a pattern. Runs on a cron schedule.</P>

      <CodeBlock title="Example: Auto-ingest all CSVs from /leads/ every hour">{`{
  "source_id": "src_abc123",
  "prefix_filter": "leads/",
  "file_pattern": "*.csv",
  "schedule": "0 * * * *",     // Every hour
  "auto_start": true,
  "skip_existing": true          // Don't re-ingest already processed files
}`}</CodeBlock>

      <Tip icon={<Lightbulb size={14} />} color="var(--yellow)">
        Pro tip: Use Parquet format for large files (1M+ rows). It's 5-10x faster to ingest than CSV because ClickHouse natively understands columnar data.
      </Tip>

      <Tip icon={<AlertTriangle size={14} />} color="var(--red)">
        Warning: Make sure your CSV columns match the universal_person schema. Unrecognized columns are silently dropped. Check the Database → Columns page for the full schema.
      </Tip>
    </div>
  );
}

// ─── 3. Database Explorer ───

function DatabaseSection({ color }: { color: string }) {
  return (
    <div>
      <P>The database explorer gives you direct access to ClickHouse. Browse the universal_person table with pagination, filtering, sorting, and column selection. Or run raw SQL for advanced queries.</P>

      <H3 color={color}>universal_person Table — Key Columns</H3>
      <P>This is the master table. Every contact lives here with 70+ columns. Here are the most important ones:</P>

      <div style={{ overflowX: 'auto', marginBottom: 20 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ background: 'var(--bg-hover)', textAlign: 'left' }}>
              <th style={thStyle}>Column</th><th style={thStyle}>Type</th><th style={thStyle}>Description</th>
            </tr>
          </thead>
          <tbody>
            {[
              ['up_id', 'String', 'Unique ID for each contact (nanoid)'],
              ['business_email', 'Nullable(String)', 'Primary business email address'],
              ['personal_emails', 'Nullable(String)', 'Comma-separated personal emails'],
              ['first_name / last_name', 'Nullable(String)', 'Contact name'],
              ['company_name', 'Nullable(String)', 'Company they work at'],
              ['company_domain', 'Nullable(String)', 'Company website domain'],
              ['job_title_normalized', 'Nullable(String)', 'Standardized job title'],
              ['seniority_level', 'Nullable(String)', 'VP, Director, C-Level, Manager, etc.'],
              ['primary_industry', 'Nullable(String)', 'Industry classification'],
              ['personal_state', 'Nullable(String)', 'US state (used for partitioning)'],
              ['_verification_status', 'Nullable(String)', 'safe, risky, rejected, or null'],
              ['_segment_ids', 'Array(String)', 'IDs of segments this contact belongs to'],
              ['_ingested_at', 'DateTime', 'When the record was ingested'],
            ].map(([col, type, desc], i) => (
              <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ ...tdStyle, fontFamily: 'monospace', color: color, fontWeight: 600 }}>{col}</td>
                <td style={{ ...tdStyle, fontFamily: 'monospace', color: 'var(--text-tertiary)', fontSize: 11 }}>{type}</td>
                <td style={tdStyle}>{desc}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <H3 color={color}>Browsing Data</H3>
      <P>The Browse tab shows paginated results. You can:</P>
      <BulletList color={color} items={[
        'Select which columns to display (don\'t need all 70+ at once)',
        'Filter by any column — state, industry, verification status, company domain',
        'Sort by any column ascending or descending',
        'Export the current view as CSV',
        'Click any row to see the full record',
      ]} />

      <H3 color={color}>Running SQL Queries</H3>
      <P>The Query tab lets you run raw ClickHouse SQL. This is powerful but be careful — ClickHouse can process billions of rows in seconds.</P>

      <CodeBlock title="Example: Count contacts by industry">{`SELECT primary_industry, count() as total
FROM universal_person
WHERE personal_state = 'California'
  AND _verification_status = 'safe'
GROUP BY primary_industry
ORDER BY total DESC
LIMIT 20`}</CodeBlock>

      <CodeBlock title="Example: Find all CEOs at SaaS companies">{`SELECT first_name, last_name, business_email, company_name
FROM universal_person
WHERE job_title_normalized ILIKE '%CEO%'
  AND primary_industry = 'SaaS'
  AND business_email IS NOT NULL
LIMIT 100`}</CodeBlock>

      <Tip icon={<Lightbulb size={14} />} color="var(--yellow)">
        ClickHouse is partitioned by personal_state and ordered by (personal_state, primary_industry, up_id). Queries that filter on state or industry will be significantly faster.
      </Tip>
    </div>
  );
}

// ─── 4. Segments ───

function SegmentsSection({ color }: { color: string }) {
  return (
    <div>
      <P>Segments let you slice the universal_person table into targeted groups. Think of them as saved queries that tag matching contacts.</P>

      <H3 color={color}>Creating a Segment</H3>
      <StepList color={color} steps={[
        { title: 'Name your segment', desc: 'Give it a descriptive name like "SaaS CEOs in Texas" and optionally assign a niche and client name.' },
        { title: 'Write the filter query', desc: 'This is a WHERE clause in ClickHouse SQL. Use any column from universal_person.' },
        { title: 'Preview', desc: 'Hit Preview to see how many contacts match and a sample of 10 results. Adjust until you\'re happy.' },
        { title: 'Save', desc: 'Save the segment. It\'s now a draft.' },
        { title: 'Execute', desc: 'Execute tags all matching contacts by appending the segment ID to their _segment_ids array. This is how contacts "belong" to segments.' },
      ]} />

      <H3 color={color}>Filter Query Examples</H3>

      <CodeBlock title="SaaS VPs and Directors in California">{`personal_state = 'California'
AND primary_industry = 'SaaS'
AND seniority_level IN ('VP', 'Director')
AND business_email IS NOT NULL`}</CodeBlock>

      <CodeBlock title="Large companies (500+ employees) in tech">{`company_employee_count > '500'
AND primary_industry IN ('SaaS', 'Software', 'Technology')
AND _verification_status != 'rejected'`}</CodeBlock>

      <CodeBlock title="Unverified contacts ingested this week">{`_verification_status IS NULL
AND _ingested_at > now() - INTERVAL 7 DAY`}</CodeBlock>

      <Tip icon={<AlertTriangle size={14} />} color="var(--red)">
        Filter queries are raw SQL WHERE clauses. SQL injection is possible if you allow user input. The UI should sanitize inputs before building the query.
      </Tip>

      <H3 color={color}>Segment Lifecycle</H3>
      <FeatureGrid items={[
        { icon: <FileText size={16} />, title: 'Draft', desc: 'Saved but not executed. Contacts are not yet tagged.' },
        { icon: <Zap size={16} />, title: 'Active', desc: 'Executed — matching contacts have this segment ID in their _segment_ids array.' },
        { icon: <RefreshCw size={16} />, title: 'Re-execute', desc: 'Run again after new data is ingested to tag newly matching contacts.' },
      ]} color={color} />
    </div>
  );
}

// ─── 5. Verification Engine ───

function VerificationSection({ color }: { color: string }) {
  return (
    <div>
      <P>The built-in verification engine runs 9 independent checks on each email without ever sending an actual email. It uses SMTP probing (RCPT TO) to verify mailbox existence.</P>

      <H3 color={color}>The 9 Checks</H3>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10, marginBottom: 24 }}>
        {[
          { num: 1, name: 'Syntax Validation', desc: 'RFC 5322 compliance, local part length, domain length, consecutive dots, valid TLD.', net: false, file: 'syntaxValidator.ts' },
          { num: 2, name: 'Typo Auto-Fix', desc: 'gmial.com → gmail.com, yaho.com → yahoo.com. 30+ known typo corrections.', net: false, file: 'syntaxValidator.ts' },
          { num: 3, name: 'Deduplication', desc: 'Removes duplicate emails from the list, preserving order. Case-insensitive.', net: false, file: 'syntaxValidator.ts' },
          { num: 4, name: 'Disposable Detection', desc: '190+ known temp email providers (mailinator, guerrillamail, yopmail, etc).', net: false, file: 'disposableDomains.ts' },
          { num: 5, name: 'Role-Based Detection', desc: '100+ role prefixes (info@, admin@, sales@, hr@). Shared mailboxes = lower engagement.', net: false, file: 'roleDetector.ts' },
          { num: 6, name: 'Free Provider Detection', desc: '90+ free providers classified: major (Gmail), regional (web.de), ISP (comcast), privacy (ProtonMail).', net: false, file: 'freeProviders.ts' },
          { num: 7, name: 'MX Lookup', desc: 'DNS query for mail exchange records. Falls back to A record per RFC 5321 §5.1. Cached 1 hour.', net: true, file: 'mxResolver.ts' },
          { num: 8, name: 'Catch-All Detection', desc: 'Probes a random address (xrfnry_timestamp_random@domain). If accepted → domain is catch-all.', net: true, file: 'verificationEngine.ts' },
          { num: 9, name: 'SMTP RCPT TO Probe', desc: 'Connect → EHLO → MAIL FROM → RCPT TO → QUIT. 250 = valid, 550 = invalid, 450 = greylisting.', net: true, file: 'smtpProbe.ts' },
        ].map(check => (
          <motion.div
            key={check.num}
            whileHover={{ scale: 1.02, borderColor: color }}
            style={{
              background: 'var(--bg-app)', border: '1px solid var(--border)',
              borderRadius: 12, padding: 14, transition: 'all 0.2s',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
              <span style={{
                width: 24, height: 24, borderRadius: 7, fontSize: 11, fontWeight: 800,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                background: `${color}15`, color,
              }}>{check.num}</span>
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{check.name}</span>
              {check.net && <span style={{ fontSize: 9, padding: '2px 6px', borderRadius: 4, background: 'var(--blue-muted)', color: 'var(--blue)', fontWeight: 600 }}>NETWORK</span>}
            </div>
            <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, marginBottom: 6 }}>{check.desc}</p>
            <span style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--text-tertiary)' }}>📁 engine/{check.file}</span>
          </motion.div>
        ))}
      </div>

      <H3 color={color}>SMTP Probe — How It Works</H3>
      <P>This is the most important check. It talks to the target mail server without sending any email:</P>

      <CodeBlock title="SMTP Handshake Protocol (smtpProbe.ts)">{`Connect to mx.company.com:25 (TCP socket)
← 220 mx.company.com ESMTP ready          // Server banner
→ EHLO mail.refinery.local                 // Announce ourselves
← 250 Hello                               // Server accepts
→ MAIL FROM:<verify@refinery.local>        // Envelope sender
← 250 OK                                  // Accepted
→ RCPT TO:<target@company.com>             // ← THE KEY STEP
← 250 OK          → status: 'valid'       // Mailbox EXISTS
← 550 User unknown → status: 'invalid'    // Mailbox DOESN'T exist
← 450 Try later   → status: 'risky'       // Greylisting
→ QUIT                                     // Disconnect — NO email sent`}</CodeBlock>

      <H3 color={color}>Risk Scoring System</H3>
      <P>Each check adds a weighted score. The total determines the classification:</P>

      <div style={{ overflowX: 'auto', marginBottom: 20 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead><tr style={{ background: 'var(--bg-hover)' }}><th style={thStyle}>Check Result</th><th style={thStyle}>Default Weight</th><th style={thStyle}>Effect</th></tr></thead>
          <tbody>
            {[
              ['syntax_invalid', '100', 'Instant reject — not a valid email format'],
              ['smtp_invalid (550)', '100', 'Instant reject — mailbox confirmed dead'],
              ['disposable', '90', 'Almost always reject — temp email'],
              ['no_mx', '85', 'No mail server for this domain'],
              ['smtp_risky (450)', '50', 'Greylisting or temporary failure'],
              ['catch_all', '30', 'Domain accepts everything — uncertain'],
              ['role_based', '20', 'Shared mailbox — lower engagement risk'],
              ['free_provider', '10', 'Personal email (Gmail, Yahoo)'],
              ['typo_detected', '5', 'Was auto-corrected — low risk after fix'],
            ].map(([check, weight, effect], i) => (
              <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ ...tdStyle, fontFamily: 'monospace', fontWeight: 600 }}>{check}</td>
                <td style={{ ...tdStyle, fontFamily: 'monospace', color, fontWeight: 700 }}>{weight}</td>
                <td style={tdStyle}>{effect}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <FeatureGrid items={[
        { icon: <CheckCircle2 size={16} />, title: 'Safe (< 15)', desc: 'Good to send. No significant issues detected.' },
        { icon: <Eye size={16} />, title: 'Uncertain (15-39)', desc: 'Proceed with caution. Minor flags like free provider + role.' },
        { icon: <AlertTriangle size={16} />, title: 'Risky (40-79)', desc: 'Significant issues. Greylisting, catch-all, or multiple flags.' },
        { icon: <Shield size={16} />, title: 'Reject (80+)', desc: 'Do not send. Invalid syntax, dead mailbox, or disposable.' },
      ]} color={color} />

      <Tip icon={<Lightbulb size={14} />} color="var(--yellow)">
        All weights and thresholds are configurable per run. You can make the engine stricter (lower thresholds) or more lenient depending on your use case.
      </Tip>
    </div>
  );
}

// ─── 6. Pipeline Studio ───

function PipelineSection({ color }: { color: string }) {
  return (
    <div>
      <P>Pipeline Studio is the standalone email verifier. Unlike batch verification (which works on ClickHouse segments), Pipeline Studio processes uploaded email lists with per-check control.</P>

      <H3 color={color}>How to Use</H3>
      <StepList color={color} steps={[
        { title: 'Upload a list', desc: 'Paste emails directly or upload a CSV/TXT file. Max limit depends on your server capacity.' },
        { title: 'Configure checks', desc: 'Toggle each of the 9 checks independently. Want only SMTP verification? Turn off syntax, disposable, role checks.' },
        { title: 'Adjust weights (optional)', desc: 'Customize risk scoring weights. Make disposable detection worth 100 (instant reject) or 50 (just risky).' },
        { title: 'Run the pipeline', desc: 'Watch real-time progress. Each email goes through enabled checks sequentially.' },
        { title: 'Review results', desc: 'See per-email breakdown: which checks passed/failed, individual risk scores, final classification.' },
        { title: 'Export', desc: 'Download results as CSV with all check details, or filter to only safe/risky/etc.' },
      ]} />

      <H3 color={color}>Pipeline Studio vs Batch Verification</H3>
      <div style={{ overflowX: 'auto', marginBottom: 20 }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead><tr style={{ background: 'var(--bg-hover)' }}><th style={thStyle}>Feature</th><th style={thStyle}>Pipeline Studio</th><th style={thStyle}>Batch Verification</th></tr></thead>
          <tbody>
            {[
              ['Input', 'Upload email list (CSV/paste)', 'ClickHouse segment'],
              ['Per-check control', '✅ Each check toggleable', '❌ All-or-nothing'],
              ['Custom weights', '✅ Fully configurable', '❌ Default only'],
              ['Results detail', 'Per-email, per-check breakdown', 'Aggregate counts only'],
              ['Best for', 'Quality analysis, custom workflows', 'Bulk segment cleaning'],
            ].map(([feat, ps, bv], i) => (
              <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ ...tdStyle, fontWeight: 600 }}>{feat}</td>
                <td style={tdStyle}>{ps}</td>
                <td style={tdStyle}>{bv}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── 7. Targets ───

function TargetsSection({ color }: { color: string }) {
  return (
    <div>
      <P>Targets are export-ready contact lists generated from verified segments. Once you've verified a segment, create a target list for download or API access.</P>

      <H3 color={color}>Creating a Target List</H3>
      <StepList color={color} steps={[
        { title: 'Pick a segment', desc: 'Select an executed segment that has been through verification.' },
        { title: 'Choose export format', desc: 'CSV (most common) or XLSX for Excel compatibility.' },
        { title: 'Generate', desc: 'Refinery pulls all matching contacts and packages them. Large lists may take a moment.' },
        { title: 'Download', desc: 'Click download to get the file. Or access via the v1 API.' },
      ]} />

      <Tip icon={<Lightbulb size={14} />} color="var(--yellow)">
        Target lists are snapshots. If you ingest new data and re-execute the segment, create a new target list to include the latest contacts.
      </Tip>
    </div>
  );
}

// ─── 8. v1 API ───

function ApiSection({ color }: { color: string }) {
  return (
    <div>
      <P>The v1 REST API provides machine-to-machine access to Refinery's data. External systems like MarketX authenticate with API keys and query contacts, segments, and verification data.</P>

      <H3 color={color}>Authentication</H3>
      <P>API keys use the format <code style={{ color }}>rnx_live_&lt;48 hex chars&gt;</code>. They're SHA-256 hashed in ClickHouse — the raw key is shown only once at creation.</P>

      <CodeBlock title="Creating an API key (via Supabase JWT auth)">{`POST /api/v1/keys
Authorization: Bearer <supabase_jwt>
Content-Type: application/json

{
  "name": "MarketX Production",
  "scopes": ["contacts:read", "segments:read", "verify:read"],
  "environment": "live",
  "rateLimitRpm": 120
}

// Response:
{
  "data": {
    "id": "abc123",
    "key": "rnx_live_a1b2c3d4e5f6...",   // ← SAVE THIS! Shown only once.
    "scopes": ["contacts:read", "segments:read", "verify:read"],
    "rateLimitRpm": 120
  },
  "_warning": "Store this key securely. It will not be shown again."
}`}</CodeBlock>

      <H3 color={color}>Using the API</H3>

      <CodeBlock title="Search contacts with ICP filters">{`POST /api/v1/contacts/search
Authorization: Bearer rnx_live_a1b2c3d4e5f6...

{
  "filters": {
    "primary_industry": "SaaS",
    "seniority_level": ["VP", "Director", "C-Level"],
    "company_employee_count": { "gt": "50" },
    "_verification_status": { "not": "bounced" }
  },
  "per_page": 200,
  "sort_by": "_ingested_at",
  "sort_dir": "DESC"
}`}</CodeBlock>

      <CodeBlock title="Bulk check email verification status">{`POST /api/v1/verify/bulk-status
Authorization: Bearer rnx_live_a1b2c3d4e5f6...

{ "emails": ["ceo@acme.com", "vp@startup.io", "fake@test.xyz"] }

// Response:
{
  "data": [
    { "email": "ceo@acme.com", "found": true, "verification_status": "safe" },
    { "email": "vp@startup.io", "found": true, "verification_status": "rejected" },
    { "email": "fake@test.xyz", "found": false, "verification_status": null }
  ],
  "meta": { "requested": 3, "found": 2 }
}`}</CodeBlock>

      <H3 color={color}>Available Scopes</H3>
      <BulletList color={color} items={[
        'contacts:read — List, search, get contacts',
        'contacts:write — Create, update contacts',
        'segments:read — List segments, get contacts in segment',
        'segments:write — Create, update, execute, delete segments',
        'verify:read — Check verification status, stats, batches',
        'verify:write — Trigger verification runs',
        'webhooks:write — Receive webhook events (Phase 2)',
        'stats:read — Query deliverability and engagement stats (Phase 4)',
      ]} />

      <H3 color={color}>Rate Limiting</H3>
      <P>Each API key has a configurable rate limit (default 60 requests/minute). Response headers include:</P>
      <CodeBlock title="Rate limit headers">{`X-RateLimit-Limit: 60
X-RateLimit-Remaining: 58
X-RateLimit-Reset: 1711234567`}</CodeBlock>

      <Tip icon={<AlertTriangle size={14} />} color="var(--red)">
        The raw API key is shown exactly ONCE at creation. If you lose it, revoke the old key and create a new one. There is no way to retrieve the raw key after creation.
      </Tip>
    </div>
  );
}

// ─── 9. Configuration ───

function ConfigSection({ color }: { color: string }) {
  return (
    <div>
      <P>Configuration covers server management, system settings, Verify550 API integration, and team/user management.</P>

      <H3 color={color}>Server Management</H3>
      <P>Refinery supports multiple ClickHouse and S3 servers. The primary server is auto-registered from environment variables. Additional servers can be added via the UI.</P>

      <H3 color={color}>Verify550 API Key Setup</H3>
      <P>If you want to use Verify550 as an alternative verification engine (in addition to the built-in engine), configure the API key with this priority:</P>
      <StepList color={color} steps={[
        { title: 'Per-user key', desc: 'Set in Personal Settings → Verify550 API Key. Each user can have their own credits.' },
        { title: 'Org-wide key', desc: 'Set in Config → Verification Config. Shared across the organization.' },
        { title: 'Environment variable', desc: 'VERIFY550_API_KEY in .env. Fallback for all users.' },
      ]} />

      <H3 color={color}>Team & Permissions</H3>
      <P>Refinery uses role-based access control (RBAC) with three base roles:</P>
      <FeatureGrid items={[
        { icon: <Shield size={16} />, title: 'Superadmin', desc: 'Full access to everything. Can manage users, servers, and all features.' },
        { icon: <Users size={16} />, title: 'Admin', desc: 'Can manage most features but cannot manage superadmin settings.' },
        { icon: <Eye size={16} />, title: 'Member', desc: 'Read-only access to data. Cannot modify segments or run verification.' },
      ]} color={color} />

      <Tip icon={<Lightbulb size={14} />} color="var(--yellow)">
        Custom roles can be created with fine-grained permissions. Each permission maps to a specific feature (canViewDatabase, canViewSegments, canRunVerification, etc.).
      </Tip>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// REUSABLE UI COMPONENTS
// ═══════════════════════════════════════════════════════════════

function H3({ color, children }: { color: string; children: ReactNode }) {
  return (
    <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginTop: 28, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
      <div style={{ width: 3, height: 16, borderRadius: 2, background: color }} />
      {children}
    </h3>
  );
}

function P({ children }: { children: ReactNode }) {
  return <p style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: 16, maxWidth: 720 }}>{children}</p>;
}

function Tip({ icon, color, children }: { icon: ReactNode; color: string; children: ReactNode }) {
  return (
    <motion.div
      whileHover={{ scale: 1.01 }}
      style={{
        display: 'flex', gap: 12, padding: 14, borderRadius: 10,
        background: `${color}08`, border: `1px solid ${color}25`,
        marginBottom: 16, alignItems: 'flex-start',
      }}
    >
      <div style={{ color, flexShrink: 0, marginTop: 2 }}>{icon}</div>
      <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, margin: 0 }}>{children}</p>
    </motion.div>
  );
}

function CodeBlock({ title, children }: { title?: string; children: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => { navigator.clipboard.writeText(children); setCopied(true); setTimeout(() => setCopied(false), 2000); };

  return (
    <div style={{ marginBottom: 16, borderRadius: 10, overflow: 'hidden', border: '1px solid var(--border)' }}>
      {title && (
        <div style={{
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          padding: '8px 14px', background: 'var(--bg-hover)',
          borderBottom: '1px solid var(--border)',
        }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)' }}>{title}</span>
          <motion.button
            whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}
            onClick={copy}
            style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 600, color: copied ? 'var(--green)' : 'var(--text-tertiary)', background: 'none', border: 'none', cursor: 'pointer' }}
          >
            {copied ? <CheckCircle2 size={12} /> : <Copy size={12} />}
            {copied ? 'Copied' : 'Copy'}
          </motion.button>
        </div>
      )}
      <pre style={{
        margin: 0, padding: 14, background: 'var(--bg-app)',
        fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
        fontSize: 12, lineHeight: 1.6, color: 'var(--text-secondary)',
        overflowX: 'auto', whiteSpace: 'pre',
      }}>{children}</pre>
    </div>
  );
}

function StepList({ color, steps }: { color: string; steps: { title: string; desc: string }[] }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 20 }}>
      {steps.map((step, i) => (
        <motion.div
          key={i}
          whileHover={{ x: 4, borderColor: `${color}50` }}
          style={{
            display: 'flex', gap: 12, padding: 12, borderRadius: 10,
            background: 'var(--bg-app)', border: '1px solid var(--border)',
            transition: 'border-color 0.2s', alignItems: 'flex-start',
          }}
        >
          <span style={{
            width: 24, height: 24, borderRadius: 7, fontSize: 11, fontWeight: 800,
            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            background: `${color}15`, color,
          }}>{i + 1}</span>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>{step.title}</div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{step.desc}</div>
          </div>
        </motion.div>
      ))}
    </div>
  );
}

function BulletList({ color, items }: { color: string; items: string[] }) {
  return (
    <ul style={{ listStyle: 'none', padding: 0, marginBottom: 20, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {items.map((item, i) => (
        <motion.li key={i} whileHover={{ x: 3 }} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          <CheckCircle2 size={14} color={color} style={{ flexShrink: 0, marginTop: 2 }} />
          {item}
        </motion.li>
      ))}
    </ul>
  );
}

function FeatureGrid({ items, color }: { items: { icon: ReactNode; title: string; desc: string }[]; color: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10, marginBottom: 20 }}>
      {items.map((item, i) => (
        <motion.div
          key={i}
          whileHover={{ scale: 1.03, borderColor: `${color}40`, boxShadow: `0 0 20px ${color}10` }}
          style={{
            padding: 14, borderRadius: 10, background: 'var(--bg-app)',
            border: '1px solid var(--border)', transition: 'all 0.2s',
          }}
        >
          <div style={{ color, marginBottom: 8 }}>{item.icon}</div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>{item.title}</div>
          <div style={{ fontSize: 11, color: 'var(--text-tertiary)', lineHeight: 1.5 }}>{item.desc}</div>
        </motion.div>
      ))}
    </div>
  );
}

// ─── Shared table styles ───
const thStyle: React.CSSProperties = { padding: '8px 12px', fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid var(--border)' };
const tdStyle: React.CSSProperties = { padding: '8px 12px', fontSize: 12, color: 'var(--text-secondary)' };
