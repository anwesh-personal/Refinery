import { useState, useCallback, useMemo } from 'react';
import {
  ReactFlow, Background, Controls, MiniMap,
  Handle, Position, useNodesState, useEdgesState,
  type Node, type Edge, type NodeProps,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { X, ChevronRight } from 'lucide-react';

// ═══════════════════════════════════════════════════════════
// AI Nexus Architecture — Interactive Tutorial & System Map
// ═══════════════════════════════════════════════════════════

interface NodeData {
  label: string; subtitle: string; color: string; icon: string;
  details: string; pages?: string[]; dataAccess?: string[];
  capabilities?: string[]; layer: string;
  [key: string]: unknown;
}

// ── Agent Avatars ──
const AGENT_IMGS: Record<string, string> = {
  cortex: '/agents/cortex.png', bastion: '/agents/bastion.png',
  muse: '/agents/muse.png', overseer: '/agents/overseer.png',
  litmus: '/agents/litmus.png',
};

// ═══ Custom Node Components ═══

function HubNode({ data }: NodeProps<Node<NodeData>>) {
  return (
    <div style={{
      padding: '20px 28px', borderRadius: 20, minWidth: 220, textAlign: 'center',
      background: `linear-gradient(135deg, ${data.color} 0%, ${data.color}bb 100%)`,
      border: `3px solid ${data.color}`, boxShadow: `0 12px 40px ${data.color}40`,
      color: 'var(--accent-contrast, #fff)', cursor: 'pointer', position: 'relative',
    }}>
      <Handle type="target" position={Position.Top} style={{ background: data.color, border: '2px solid #fff', width: 12, height: 12 }} />
      <div style={{ fontSize: 32, marginBottom: 6, filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.3))' }}>{data.icon}</div>
      <div style={{ fontSize: 16, fontWeight: 900, letterSpacing: '0.05em' }}>{data.label}</div>
      <div style={{ fontSize: 10, opacity: 0.85, marginTop: 3, lineHeight: 1.4 }}>{data.subtitle}</div>
      <div style={{
        position: 'absolute', top: -8, right: -8, width: 20, height: 20, borderRadius: '50%',
        background: '#fff', border: `2px solid ${data.color}`, display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 10, fontWeight: 900, color: data.color,
      }}>?</div>
      <Handle type="source" position={Position.Bottom} style={{ background: data.color, border: '2px solid #fff', width: 12, height: 12 }} />
    </div>
  );
}

function PipelineNode({ data }: NodeProps<Node<NodeData>>) {
  return (
    <div style={{
      padding: '14px 20px', borderRadius: 14, minWidth: 160,
      background: 'var(--bg-card)', border: `2px solid ${data.color}40`,
      boxShadow: `0 4px 16px ${data.color}10`, cursor: 'pointer',
    }}>
      <Handle type="target" position={Position.Left} style={{ background: data.color, width: 8, height: 8 }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <div style={{
          width: 36, height: 36, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: `${data.color}15`, fontSize: 18,
        }}>{data.icon}</div>
        <div>
          <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-primary)' }}>{data.label}</div>
          <div style={{ fontSize: 8, color: 'var(--text-tertiary)', lineHeight: 1.3, maxWidth: 120 }}>{data.subtitle}</div>
        </div>
      </div>
      <Handle type="source" position={Position.Right} style={{ background: data.color, width: 8, height: 8 }} />
      <Handle type="source" position={Position.Bottom} id="bot" style={{ background: data.color, width: 8, height: 8 }} />
    </div>
  );
}

function AgentNodeComponent({ data }: NodeProps<Node<NodeData>>) {
  const img = AGENT_IMGS[data.label.toLowerCase()];
  return (
    <div style={{
      padding: '16px 20px', borderRadius: 16, minWidth: 170, maxWidth: 200,
      background: 'var(--bg-card)', border: `2px solid ${data.color}40`,
      boxShadow: `0 6px 24px ${data.color}12`, cursor: 'pointer',
    }}>
      <Handle type="target" position={Position.Top} style={{ background: data.color, border: `2px solid ${data.color}`, width: 10, height: 10 }} />
      <div style={{ textAlign: 'center' }}>
        {img && <img src={img} alt={data.label} style={{ width: 48, height: 48, borderRadius: 12, objectFit: 'cover', border: `2px solid ${data.color}30`, margin: '0 auto 8px', display: 'block' }} />}
        <div style={{ fontSize: 13, fontWeight: 900, color: data.color }}>{data.label}</div>
        <div style={{ fontSize: 9, color: 'var(--text-tertiary)', marginTop: 2, lineHeight: 1.3 }}>{data.subtitle}</div>
        {data.pages && (
          <div style={{ marginTop: 8, display: 'flex', gap: 3, flexWrap: 'wrap', justifyContent: 'center' }}>
            {data.pages.map((p: string) => (
              <span key={p} style={{
                fontSize: 7, padding: '2px 5px', borderRadius: 4,
                background: `${data.color}10`, color: data.color, fontWeight: 700,
              }}>📍 {p}</span>
            ))}
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: data.color, width: 8, height: 8 }} />
    </div>
  );
}

function DataNode({ data }: NodeProps<Node<NodeData>>) {
  return (
    <div style={{
      padding: '12px 16px', borderRadius: 10, minWidth: 140,
      background: 'var(--bg-app)', border: '1.5px dashed var(--border)',
      cursor: 'pointer',
    }}>
      <Handle type="target" position={Position.Top} style={{ background: 'var(--text-tertiary)', width: 7, height: 7 }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 16 }}>{data.icon}</span>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-secondary)' }}>{data.label}</div>
          <div style={{ fontSize: 7, color: 'var(--text-tertiary)', lineHeight: 1.2 }}>{data.subtitle}</div>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: 'var(--text-tertiary)', width: 7, height: 7 }} />
    </div>
  );
}

const nodeTypes = { hub: HubNode, pipeline: PipelineNode, agent: AgentNodeComponent, data: DataNode };

// ═══ Layout ═══

const initialNodes: Node<NodeData>[] = [
  // Row 0: Data Sources (Top)
  { id: 'ch', type: 'data', position: { x: 60, y: 0 }, data: { label: 'ClickHouse', subtitle: 'Universal Person DB', color: '#666', icon: '💾', layer: 'data', details: '**ClickHouse** is your core analytical database. It stores every lead you\'ve ever ingested — first name, last name, email, company, job title, phone, LinkedIn, and 50+ more columns.\n\nAll pipeline steps read from and write to this database.\n\n**Tables:** `universal_person` (main), plus segment materialized views.\n\n**Performance:** Sub-second queries across millions of rows.' } },
  { id: 'sb', type: 'data', position: { x: 350, y: 0 }, data: { label: 'Supabase', subtitle: 'Auth, Config, AI Memory', color: '#666', icon: '🗄️', layer: 'data', details: '**Supabase** handles everything non-analytical:\n\n- **User auth** — login, roles, permissions\n- **Server configs** — ClickHouse/S3 connections\n- **AI provider settings** — API keys, models\n- **Agent definitions** — prompts, KB, settings\n- **Conversation history** — chat memory\n- **Usage tracking** — token counts, costs\n\nAll frontend CRUD goes through Supabase.' } },
  { id: 's3', type: 'data', position: { x: 630, y: 0 }, data: { label: 'S3 / MinIO', subtitle: 'Raw data files', color: '#666', icon: '☁️', layer: 'data', details: '**S3-compatible storage** holds your raw data files:\n\n- CSV/TSV uploads from data providers\n- Parquet files for bulk ingestion\n- Export files (target lists)\n\nIngestion pulls files from S3 → transforms → loads into ClickHouse.' } },

  // Row 1: Pipeline Steps
  { id: 'ingest', type: 'pipeline', position: { x: 0, y: 150 }, data: { label: 'Ingestion', subtitle: 'Pull raw data from S3 into ClickHouse', color: 'var(--blue)', icon: '📥', layer: 'pipeline', details: '**Step 1: Ingestion**\n\nPulls raw data files from S3/MinIO, maps columns to the Universal Person schema, and bulk-inserts into ClickHouse.\n\n**What happens:** Source files (CSV/Parquet) → column mapping → dedup → INSERT INTO universal_person\n\n**Page:** `/ingestion`\n**Supports:** Multiple ingestion jobs, resume on failure, row-level dedup' } },
  { id: 'merge', type: 'pipeline', position: { x: 220, y: 150 }, data: { label: 'Merge', subtitle: 'Consolidate duplicate records', color: '#9c27b0', icon: '🔀', layer: 'pipeline', details: '**Step 2: Merge Playground**\n\nFinds duplicate leads (same email, same name+company, etc.) and consolidates them into a single golden record using configurable resolution rules.\n\n**What happens:** Identify merge keys → preview conflicts → resolve with anyIf/priority logic → materialize merged output\n\n**Page:** `/ingestion` (Merge tab)' } },
  { id: 'segment', type: 'pipeline', position: { x: 440, y: 150 }, data: { label: 'Segments', subtitle: 'Filter leads into targetable groups', color: '#fbbc05', icon: '📊', layer: 'pipeline', details: '**Step 3: Segmentation**\n\nCreates filtered subsets of your database based on criteria you define — industry, location, job title, company size, etc.\n\n**What happens:** Define filter conditions → generate segment → segment gets a materialized view in ClickHouse\n\n**Page:** `/segments`\n**Powers:** Target list creation, verification scoping' } },
  { id: 'verify', type: 'pipeline', position: { x: 660, y: 150 }, data: { label: 'Verification', subtitle: 'Validate emails via SMTP probing', color: '#ea4335', icon: '✅', layer: 'pipeline', details: '**Step 4: Verification**\n\nProbes each email address via SMTP to determine deliverability. Marks as valid/risky/invalid/unknown.\n\n**What happens:** Queue emails → DNS lookup → SMTP EHLO/MAIL FROM/RCPT TO → catch-all detection → risk scoring → write results back\n\n**Page:** `/verification`\n**Uses:** Verify550 API + built-in SMTP engine' } },
  { id: 'target', type: 'pipeline', position: { x: 220, y: 300 }, data: { label: 'Targets', subtitle: 'Build exportable mailing lists', color: '#ff9800', icon: '🎯', layer: 'pipeline', details: '**Step 5: Target Lists**\n\nTakes verified segments and generates clean mailing lists — only valid emails with populated contact data.\n\n**What happens:** Select segment → filter to verified-valid-only → export as clean list → download CSV or push to queue\n\n**Page:** `/targets`' } },
  { id: 'queue', type: 'pipeline', position: { x: 470, y: 300 }, data: { label: 'Queue', subtitle: 'Dispatch emails via MTA', color: '#e91e63', icon: '📤', layer: 'pipeline', details: '**Step 6: Send Queue**\n\nDispatches your target lists through configured MTA satellites (Postfix/PowerMTA).\n\n**What happens:** Target list → send queue → IP warmup scheduling → SMTP dispatch → delivery tracking\n\n**Page:** `/queue`' } },

  // Row 2: AI Nexus Hub (Center)
  { id: 'nexus', type: 'hub', position: { x: 310, y: 440 }, data: { label: 'AI NEXUS', subtitle: 'Configuration hub for all AI agents, tools, and providers', color: 'var(--purple)', icon: '🧠', layer: 'hub', details: '**AI Nexus** is the central configuration hub.\n\n**It does NOT process data itself.** Instead, it:\n\n1. **Configures AI Providers** — API keys, model selection, fallback routing\n2. **Manages Agents** — Core prompts, prompt stacks, knowledge bases, temperature\n3. **Tracks Usage** — Token counts, costs, latency per call\n4. **Hosts Tools** — Standalone AI features (ICP, Scoring, Enrichment, etc.)\n\n**The agents configured here are then surfaced contextually on the pages where they\'re useful.** You don\'t chat with agents in AI Nexus — you configure them here, use them where they work.\n\n**Page:** `/ai-nexus`' } },

  // Row 3: Agents (Bottom)
  { id: 'cortex', type: 'agent', position: { x: 0, y: 620 }, data: { label: 'Cortex', subtitle: 'Data Scientist — analyzes your data, finds patterns, builds ICPs', color: 'var(--blue)', icon: '📊', layer: 'agent', pages: ['Database', 'Merge', 'Segments'], dataAccess: ['ClickHouse schema', 'Table stats', 'Column metadata', 'Row samples'], capabilities: ['data_analysis', 'icp_building', 'pattern_detection', 'segmentation'], details: '**Cortex** is your data scientist.\n\n**Where you\'ll find it:** A collapsible card at the bottom of the **Database**, **Merge Playground**, and **Segments** pages.\n\n**What it sees:** Your ClickHouse table schema, column names, row counts, data distributions, and current filter state.\n\n**What to ask it:**\n- "Analyze the data quality of this table"\n- "Find patterns in my lead data"\n- "Suggest segments based on industry and seniority"\n- "Build an ICP from my best-performing leads"\n\n**How it connects:** When you click the Cortex card on the Database page, it automatically receives your table metadata, column list, and current view as context. No copy-pasting needed.' } },
  { id: 'bastion', type: 'agent', position: { x: 190, y: 620 }, data: { label: 'Bastion', subtitle: 'SMTP Specialist — guards your infrastructure', color: 'var(--red)', icon: '🛡️', layer: 'agent', pages: ['Config', 'MTA'], dataAccess: ['Server configs', 'DNS records', 'System settings'], capabilities: ['dns_analysis', 'smtp_troubleshooting', 'blacklist_checking'], details: '**Bastion** is your infrastructure guardian.\n\n**Where you\'ll find it:** A collapsible card at the bottom of the **Config** and **MTA Config** pages.\n\n**What it sees:** Your configured servers (ClickHouse, S3, MTA), their connection status, ping history, and system settings.\n\n**What to ask it:**\n- "Check the health of all my servers"\n- "Analyze my DNS configuration for deliverability"\n- "What\'s wrong with my MTA configuration?"\n- "IP warmup recommendations for a new satellite"\n\n**How it connects:** Server data from the Config page is automatically passed as context.' } },
  { id: 'muse', type: 'agent', position: { x: 380, y: 620 }, data: { label: 'Muse', subtitle: 'Email Marketer — writes copy, plans campaigns', color: '#e91e63', icon: '✉️', layer: 'agent', pages: ['Targets', 'Queue'], dataAccess: ['Target lists', 'Segment composition', 'Audience profiles'], capabilities: ['copywriting', 'campaign_strategy', 'send_optimization'], details: '**Muse** is your creative marketing strategist.\n\n**Where you\'ll find it:** A collapsible card on the **Targets** and **Queue** pages.\n\n**What it sees:** Your target lists (names, email counts, status), available segments with their niche tags and lead counts.\n\n**What to ask it:**\n- "Write a 5-email cold outreach sequence for this audience"\n- "Optimize send timing for 50K emails"\n- "Subject line ideas for SaaS CTOs"\n- "Campaign strategy for this niche"\n\n**How it connects:** Target list and segment data is passed as context. Muse knows your audience composition.' } },
  { id: 'overseer', type: 'agent', position: { x: 560, y: 620 }, data: { label: 'Overseer', subtitle: 'Supervisor — sees everything, makes strategic calls', color: 'var(--yellow)', icon: '👑', layer: 'agent', pages: ['Dashboard'], dataAccess: ['All stats', 'All trends', 'All activity', 'All agents'], capabilities: ['strategic_planning', 'cross_domain_analysis', 'executive_briefing'], details: '**Overseer** is your AI twin — the all-rounder supervisor.\n\n**Where you\'ll find it:** A collapsible card on the **Dashboard** page.\n\n**What it sees:** Everything: total records, storage usage, ingestion trends (7d), verification trends (7d), top segments, recent activity feed.\n\n**What to ask it:**\n- "Give me a daily briefing"\n- "What should I prioritize today?"\n- "ROI analysis of my verification pipeline"\n- "Strategic recommendations for scaling"\n\n**How it connects:** Dashboard stats are automatically injected. Overseer has the widest context of any agent.' } },
  { id: 'litmus', type: 'agent', position: { x: 750, y: 620 }, data: { label: 'Litmus', subtitle: 'Verification Engineer — the definitive test', color: 'var(--green)', icon: '🔬', layer: 'agent', pages: ['Verification'], dataAccess: ['Job results', 'SMTP responses', 'Bounce patterns', 'Domain analysis'], capabilities: ['result_analysis', 'catch_all_detection', 'risk_assessment', 'retry_strategy'], details: '**Litmus** is your verification engineer.\n\n**Where you\'ll find it:** A collapsible card on the **Verification** page — appears after a job finishes.\n\n**What it sees:** Complete job data: file name, total emails, processed count, suppression results breakdown (ok, ok_for_all, risky, unknown, etc.), upload/completion timestamps.\n\n**What to ask it:**\n- "Analyze these verification results"\n- "Which domains are catch-all?"\n- "Recommend which unknowns to retry"\n- "Risk assessment for this batch"\n\n**How it connects:** After a verification job completes, Litmus automatically receives the full job results as context. Just click and ask.' } },
];

const initialEdges: Edge[] = [
  // Data → Pipeline
  { id: 'e-s3-ing', source: 's3', target: 'ingest', type: 'smoothstep', animated: true, style: { stroke: 'var(--blue)', strokeWidth: 2 }, markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--blue)' } },
  { id: 'e-ch-ing', source: 'ch', target: 'ingest', type: 'smoothstep', style: { stroke: 'var(--blue)' } },

  // Pipeline flow (L→R)
  { id: 'e-ing-merge', source: 'ingest', target: 'merge', animated: true, style: { stroke: '#9c27b0', strokeWidth: 2 }, markerEnd: { type: MarkerType.ArrowClosed, color: '#9c27b0' } },
  { id: 'e-merge-seg', source: 'merge', target: 'segment', animated: true, style: { stroke: '#fbbc05', strokeWidth: 2 }, markerEnd: { type: MarkerType.ArrowClosed, color: '#fbbc05' } },
  { id: 'e-seg-ver', source: 'segment', target: 'verify', animated: true, style: { stroke: '#ea4335', strokeWidth: 2 }, markerEnd: { type: MarkerType.ArrowClosed, color: '#ea4335' } },
  { id: 'e-seg-tgt', source: 'segment', target: 'target', sourceHandle: 'bot', type: 'smoothstep', style: { stroke: '#ff9800', strokeWidth: 2 }, markerEnd: { type: MarkerType.ArrowClosed, color: '#ff9800' } },
  { id: 'e-ver-tgt', source: 'verify', target: 'target', sourceHandle: 'bot', type: 'smoothstep', style: { stroke: '#ff980080' } },
  { id: 'e-tgt-q', source: 'target', target: 'queue', animated: true, style: { stroke: '#e91e63', strokeWidth: 2 }, markerEnd: { type: MarkerType.ArrowClosed, color: '#e91e63' } },

  // Nexus ↔ Agents
  { id: 'e-nx-cortex', source: 'nexus', target: 'cortex', type: 'smoothstep', style: { stroke: 'var(--purple)', strokeWidth: 1.5 }, label: 'configures', labelStyle: { fontSize: 7, fill: 'var(--text-tertiary)' } },
  { id: 'e-nx-bastion', source: 'nexus', target: 'bastion', type: 'smoothstep', style: { stroke: 'var(--purple)', strokeWidth: 1.5 } },
  { id: 'e-nx-muse', source: 'nexus', target: 'muse', type: 'smoothstep', style: { stroke: 'var(--purple)', strokeWidth: 1.5 } },
  { id: 'e-nx-overseer', source: 'nexus', target: 'overseer', type: 'smoothstep', style: { stroke: 'var(--purple)', strokeWidth: 1.5 } },
  { id: 'e-nx-litmus', source: 'nexus', target: 'litmus', type: 'smoothstep', style: { stroke: 'var(--purple)', strokeWidth: 1.5 } },

  // Pipeline → Nexus (AI enhancement)
  { id: 'e-ing-nx', source: 'ingest', target: 'nexus', sourceHandle: 'bot', type: 'smoothstep', style: { stroke: 'var(--blue)' } },
  { id: 'e-seg-nx', source: 'segment', target: 'nexus', sourceHandle: 'bot', type: 'smoothstep', style: { stroke: '#fbbc0520' } },
  { id: 'e-ver-nx', source: 'verify', target: 'nexus', sourceHandle: 'bot', type: 'smoothstep', style: { stroke: '#ea433520' } },

  // Data stores
  { id: 'e-sb-nx', source: 'sb', target: 'nexus', type: 'smoothstep', animated: true, style: { stroke: 'var(--purple)', strokeWidth: 1.5 }, markerEnd: { type: MarkerType.ArrowClosed, color: 'var(--purple)' } },
];

// ═══ LAYERS LEGEND ═══
const LAYERS = [
  { key: 'data', label: 'Data Stores', color: '#666', emoji: '💾' },
  { key: 'pipeline', label: 'Pipeline Steps', color: 'var(--blue)', emoji: '⚙️' },
  { key: 'hub', label: 'AI Nexus (Config)', color: 'var(--purple)', emoji: '🧠' },
  { key: 'agent', label: 'AI Agents (Contextual)', color: 'var(--green)', emoji: '🤖' },
];

// ═══ AGENT PROFILES (Tutorial Cards) ═══
interface AgentProfile {
  slug: string; name: string; role: string; color: string;
  pages: string[]; description: string; dataAccess: string[];
  exampleQuestions: string[]; capabilities: string[];
}

const AGENT_PROFILES: AgentProfile[] = [
  {
    slug: 'cortex', name: 'Cortex', role: 'Data Scientist', color: 'var(--blue)',
    pages: ['Database', 'Segments'],
    description: 'Cortex is your data scientist. It analyzes your ClickHouse database — schema, column distributions, row counts, and filter state. It lives as a collapsible card at the bottom of the Database page. When you click it, your current table metadata and column list are automatically passed as context.',
    dataAccess: ['ClickHouse schema', 'Table stats', 'Column metadata', 'Active filters', 'Visible columns'],
    exampleQuestions: ['Analyze the data quality of this table', 'Find patterns in my lead data', 'Suggest segments based on industry and seniority', 'Build an ICP from top-performing leads'],
    capabilities: ['data_analysis', 'icp_building', 'pattern_detection', 'schema_analysis'],
  },
  {
    slug: 'bastion', name: 'Bastion', role: 'SMTP & Infrastructure Specialist', color: 'var(--red)',
    pages: ['Config', 'MTA & Swarm'],
    description: 'Bastion guards your infrastructure. It sees your configured servers (ClickHouse, S3, MTA satellites), their connection status, ping history, and system settings. It lives on the Server Config page and helps troubleshoot connectivity, DNS, and deliverability issues.',
    dataAccess: ['Server configs', 'Connection status', 'Ping history', 'System settings', 'DNS records'],
    exampleQuestions: ['Check the health of all my servers', 'Analyze DNS for deliverability issues', 'IP warmup plan for new satellites', 'Troubleshoot MTA configuration'],
    capabilities: ['dns_analysis', 'smtp_troubleshooting', 'blacklist_checking', 'warmup_planning'],
  },
  {
    slug: 'muse', name: 'Muse', role: 'Email Marketing Strategist', color: '#e91e63',
    pages: ['Targets', 'Queue'],
    description: 'Muse is your creative marketing strategist. It sees your target lists (names, email counts, status) and available segments with niche tags and lead counts. It lives on the Targets page and helps craft campaigns, write copy, and optimize send strategies.',
    dataAccess: ['Target lists', 'Segment composition', 'Audience profiles', 'Email counts', 'Niche tags'],
    exampleQuestions: ['Write a 5-email cold outreach sequence', 'Subject line ideas for SaaS CTOs', 'Campaign strategy for this niche', 'Optimize send timing for 50K emails'],
    capabilities: ['copywriting', 'campaign_strategy', 'send_optimization', 'audience_analysis'],
  },
  {
    slug: 'overseer', name: 'Overseer', role: 'AI Supervisor — Executive Briefings', color: 'var(--yellow)',
    pages: ['Dashboard'],
    description: 'Overseer is the all-seeing supervisor. It has the widest context: total records, storage usage, 7-day ingestion trends, verification trends, top segments, and the recent activity feed. It lives on the Dashboard and provides executive-level briefings and strategic recommendations.',
    dataAccess: ['All statistics', 'Ingestion trends (7d)', 'Verification trends (7d)', 'Top segments', 'Activity feed'],
    exampleQuestions: ['Give me a daily briefing', 'What should I prioritize today?', 'ROI analysis of the verification pipeline', 'Strategic recommendations for scaling'],
    capabilities: ['strategic_planning', 'cross_domain_analysis', 'executive_briefing', 'trend_analysis'],
  },
  {
    slug: 'litmus', name: 'Litmus', role: 'Verification Engineer', color: 'var(--green)',
    pages: ['Verification'],
    description: 'Litmus is the verification expert. It appears as a card on the Verification page after a job finishes. It automatically receives the complete job data: file name, total/processed counts, suppression results breakdown, and timestamps. Ask it to analyze results, assess risk, or recommend retries.',
    dataAccess: ['Job results', 'Suppression breakdown', 'Domain analysis', 'Bounce patterns', 'Timestamps'],
    exampleQuestions: ['Analyze these verification results', 'Which domains are catch-all?', 'Recommend which unknowns to retry', 'Risk assessment for this batch'],
    capabilities: ['result_analysis', 'catch_all_detection', 'risk_assessment', 'retry_strategy'],
  },
];
// ═══ Component ═══

export default function AIArchitecture() {
  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);
  const [selectedNode, setSelectedNode] = useState<NodeData | null>(null);
  const [activeGuide, setActiveGuide] = useState(0);

  const onNodeClick = useCallback((_: any, node: Node) => {
    setSelectedNode(node.data as NodeData);
  }, []);

  const nt = useMemo(() => nodeTypes, []);

  const GUIDES = [
    { title: 'The Pipeline', desc: 'Your data flows left-to-right: Ingestion → Merge → Segments → Verification → Targets → Queue. Each step transforms your raw data into sendable, verified email lists.' },
    { title: 'AI Nexus = Config Only', desc: 'AI Nexus is where you configure agents (prompts, KB, settings) and providers (API keys, models). You don\'t use agents here — you set them up here.' },
    { title: 'Agents Live on Pages', desc: 'Each agent appears as a card on the page where it\'s useful. Litmus shows up on Verification after a job completes. Cortex lives on Database. Overseer is on Dashboard.' },
    { title: 'Context Injection', desc: 'When you open an agent card, it automatically gets the page\'s data as context. On Verification, Litmus sees your job results. On Database, Cortex sees your schema. No copy-pasting.' },
    { title: 'Everything is Configurable', desc: 'Go to AI Nexus → Agents → click any agent. You can edit their Core Prompt, add custom instructions (Prompt Stack), add training data (Knowledge Base), and tune temperature.' },
  ];

  return (
    <div style={{ position: 'relative' }}>
      {/* Header */}
      <div style={{ marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h2 style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 6px' }}>System Architecture</h2>
          <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: 0, maxWidth: 500 }}>
            Interactive map of Refinery Nexus. Click any node to learn what it does, where it lives, and what data it accesses. Drag to rearrange. Scroll to zoom.
          </p>
        </div>
        {/* Layer Legend */}
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          {LAYERS.map(l => (
            <div key={l.key} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 600, color: l.color, background: `${l.color}10`, padding: '4px 10px', borderRadius: 6 }}>
              <span>{l.emoji}</span> {l.label}
            </div>
          ))}
        </div>
      </div>

      {/* Quick Guide Carousel */}
      <div style={{
        marginBottom: 16, padding: '12px 18px', borderRadius: 12,
        background: 'var(--bg-card)', border: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 14,
      }}>
        <div style={{
          width: 28, height: 28, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: 'var(--accent)', color: 'var(--accent-contrast, #fff)', fontSize: 13, fontWeight: 900, flexShrink: 0,
        }}>{activeGuide + 1}</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 800, color: 'var(--text-primary)' }}>{GUIDES[activeGuide].title}</div>
          <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5, marginTop: 2 }}>{GUIDES[activeGuide].desc}</div>
        </div>
        <div style={{ display: 'flex', gap: 4 }}>
          {GUIDES.map((_, i) => (
            <button key={i} onClick={() => setActiveGuide(i)} style={{
              width: 8, height: 8, borderRadius: '50%', border: 'none', cursor: 'pointer', padding: 0,
              background: i === activeGuide ? 'var(--accent)' : 'var(--border)',
            }} />
          ))}
          <button onClick={() => setActiveGuide((activeGuide + 1) % GUIDES.length)} style={{
            marginLeft: 6, padding: '2px 8px', borderRadius: 6, border: '1px solid var(--border)',
            background: 'transparent', color: 'var(--text-tertiary)', cursor: 'pointer', fontSize: 10, fontWeight: 600,
          }}><ChevronRight size={12} /></button>
        </div>
      </div>

      {/* Flow Canvas */}
      <div style={{ height: 'calc(100vh - 320px)', borderRadius: 16, overflow: 'hidden', border: '1px solid var(--border)', background: 'var(--bg-app)' }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          nodeTypes={nt}
          fitView
          fitViewOptions={{ padding: 0.12 }}
          minZoom={0.3}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="var(--border)" gap={20} size={1} />
          <Controls style={{ bottom: 16, left: 16 }} />
          <MiniMap
            nodeColor={(n) => (n.data as NodeData)?.color || '#666'}
            maskColor="rgba(0,0,0,0.25)"
            style={{ borderRadius: 8, border: '1px solid var(--border)' }}
          />
        </ReactFlow>
      </div>

      {/* Detail Panel (Slide-in) */}
      {selectedNode && (
        <div style={{
          position: 'absolute', top: 100, right: 16, width: 380, maxHeight: 'calc(100vh - 380px)',
          background: 'var(--bg-card)', borderRadius: 16, border: `2px solid ${selectedNode.color}25`,
          boxShadow: `0 16px 48px ${selectedNode.color}12`, overflow: 'hidden',
          backdropFilter: 'blur(12px)', zIndex: 10,
          animation: 'slideInPanel 0.2s ease-out',
        }}>
          {/* Panel Header */}
          <div style={{
            background: `linear-gradient(135deg, ${selectedNode.color} 0%, ${selectedNode.color}cc 100%)`,
            padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              {AGENT_IMGS[selectedNode.label.toLowerCase()] ? (
                <img src={AGENT_IMGS[selectedNode.label.toLowerCase()]} alt="" style={{ width: 36, height: 36, borderRadius: 10, objectFit: 'cover', border: '2px solid rgba(255,255,255,0.3)' }} />
              ) : (
                <span style={{ fontSize: 24 }}>{selectedNode.icon}</span>
              )}
              <div>
                <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--accent-contrast, #fff)' }}>{selectedNode.label}</div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)' }}>{selectedNode.subtitle}</div>
              </div>
            </div>
            <button onClick={() => setSelectedNode(null)} style={{
              background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 6, padding: 4, cursor: 'pointer', color: 'var(--accent-contrast, #fff)',
            }}><X size={14} /></button>
          </div>

          {/* Panel Body */}
          <div style={{ padding: '16px 20px', overflowY: 'auto', maxHeight: 360 }}>
            {/* Render markdown-lite details */}
            {selectedNode.details.split('\n\n').map((block, i) => (
              <div key={i} style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: 10 }}>
                {block.split('\n').map((line, j) => {
                  if (line.startsWith('**') && line.endsWith('**')) return <div key={j} style={{ fontWeight: 800, color: 'var(--text-primary)', marginTop: 6, fontSize: 13 }}>{line.replace(/\*\*/g, '')}</div>;
                  if (line.startsWith('- ')) return <div key={j} style={{ paddingLeft: 14, position: 'relative' }}><span style={{ position: 'absolute', left: 0, color: selectedNode.color, fontWeight: 900 }}>•</span>{line.slice(2)}</div>;
                  if (line.includes('**')) {
                    const parts = line.split('**');
                    return <div key={j}>{parts.map((part, k) => k % 2 === 1 ? <strong key={k} style={{ color: 'var(--text-primary)' }}>{part}</strong> : <span key={k}>{part}</span>)}</div>;
                  }
                  return <div key={j}>{line}</div>;
                })}
              </div>
            ))}

            {/* Pages badges */}
            {selectedNode.pages && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 6 }}>Found on pages</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {selectedNode.pages.map(p => <span key={p} style={{ padding: '4px 10px', borderRadius: 6, fontSize: 10, fontWeight: 700, background: `${selectedNode.color}10`, color: selectedNode.color }}>📍 {p}</span>)}
                </div>
              </div>
            )}

            {/* Data access */}
            {selectedNode.dataAccess && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 6 }}>Data it accesses</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {selectedNode.dataAccess.map(d => <span key={d} style={{ padding: '3px 8px', borderRadius: 4, fontSize: 9, fontWeight: 600, background: 'var(--bg-app)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>{d}</span>)}
                </div>
              </div>
            )}

            {/* Capabilities */}
            {selectedNode.capabilities && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', marginBottom: 6 }}>Capabilities</div>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {selectedNode.capabilities.map(c => <span key={c} style={{ padding: '3px 8px', borderRadius: 4, fontSize: 9, fontWeight: 700, textTransform: 'uppercase', background: `${selectedNode.color}10`, color: selectedNode.color }}>{c.replace(/_/g, ' ')}</span>)}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ═══════════════════════════════════════════════════════════════ */}
      {/* AGENT TUTORIAL — Detailed Breakdown Below the Flow Map       */}
      {/* ═══════════════════════════════════════════════════════════════ */}

      <div style={{ marginTop: 36 }}>
        <h2 style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 4px' }}>Meet Your AI Agents</h2>
        <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: '0 0 20px', maxWidth: 600 }}>
          Each agent is a specialist AI assistant embedded where it's most useful. Configure them in AI Nexus → Agents. Use them on their pages.
        </p>

        {/* How It Works — 3 Column */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16, marginBottom: 28 }}>
          {[
            { step: '1', title: 'Configure in AI Nexus', desc: 'Go to Agents tab. Click any agent. Edit their Core Prompt, add Prompt Stack instructions, upload Knowledge Base entries, tune temperature.', color: 'var(--purple)' },
            { step: '2', title: 'Agents Appear on Pages', desc: 'Each agent surfaces as a card on the page where they help. Litmus on Verification, Cortex on Database, etc. They receive the page\'s live data automatically.', color: 'var(--blue)' },
            { step: '3', title: 'Ask & Get Insights', desc: 'Click the agent card, ask your question. The agent sees your current data context — no copy-pasting. Responses are powered by your configured AI provider.', color: 'var(--green)' },
          ].map(s => (
            <div key={s.step} style={{
              padding: '20px 22px', borderRadius: 14,
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              position: 'relative', overflow: 'hidden',
            }}>
              <div style={{
                position: 'absolute', top: -6, right: -6, width: 48, height: 48, borderRadius: '50%',
                background: `${s.color}08`, display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 28, fontWeight: 900, color: `${s.color}25`,
              }}>{s.step}</div>
              <div style={{ fontSize: 22, fontWeight: 900, color: s.color, marginBottom: 8 }}>{s.step}</div>
              <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 6 }}>{s.title}</div>
              <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.6 }}>{s.desc}</div>
            </div>
          ))}
        </div>

        {/* Agent Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 20, marginBottom: 36 }}>
          {AGENT_PROFILES.map(agent => (
            <div key={agent.slug} style={{
              borderRadius: 18, overflow: 'hidden', background: 'var(--bg-card)',
              border: `1px solid ${agent.color}20`, transition: 'transform 0.15s, box-shadow 0.15s',
            }}
              onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-4px)'; e.currentTarget.style.boxShadow = `0 16px 40px ${agent.color}15`; }}
              onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = 'none'; }}
            >
              {/* Agent Header */}
              <div style={{
                background: `linear-gradient(135deg, ${agent.color} 0%, ${agent.color}cc 100%)`,
                padding: '20px 22px', display: 'flex', alignItems: 'center', gap: 14,
              }}>
                <img src={AGENT_IMGS[agent.slug]} alt={agent.name} style={{
                  width: 64, height: 64, borderRadius: 16, objectFit: 'cover',
                  border: '3px solid rgba(255,255,255,0.25)', boxShadow: '0 4px 16px rgba(0,0,0,0.3)',
                }} />
                <div>
                  <div style={{ fontSize: 18, fontWeight: 900, color: 'var(--accent-contrast, #fff)' }}>{agent.name}</div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.8)', fontWeight: 500 }}>{agent.role}</div>
                  <div style={{ display: 'flex', gap: 4, marginTop: 6, flexWrap: 'wrap' }}>
                    {agent.pages.map(p => (
                      <span key={p} style={{
                        fontSize: 8, padding: '2px 7px', borderRadius: 4, fontWeight: 700,
                        background: 'rgba(255,255,255,0.15)', color: 'var(--accent-contrast, #fff)',
                      }}>📍 {p}</span>
                    ))}
                  </div>
                </div>
              </div>

              {/* Agent Body */}
              <div style={{ padding: '18px 22px' }}>
                <p style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7, margin: '0 0 14px' }}>
                  {agent.description}
                </p>

                {/* What it sees */}
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                    🔍 What it sees (auto-injected)
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {agent.dataAccess.map(d => (
                      <span key={d} style={{
                        padding: '3px 8px', borderRadius: 5, fontSize: 9, fontWeight: 600,
                        background: 'var(--bg-app)', border: '1px solid var(--border)', color: 'var(--text-secondary)',
                      }}>{d}</span>
                    ))}
                  </div>
                </div>

                {/* Example Questions */}
                <div style={{ marginBottom: 14 }}>
                  <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                    💬 Example questions
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {agent.exampleQuestions.map((q, i) => (
                      <div key={i} style={{
                        padding: '6px 10px', borderRadius: 8, fontSize: 11, color: 'var(--text-primary)',
                        background: `${agent.color}06`, border: `1px solid ${agent.color}12`,
                        fontStyle: 'italic',
                      }}>"{q}"</div>
                    ))}
                  </div>
                </div>

                {/* Capabilities */}
                <div>
                  <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                    ⚡ Capabilities
                  </div>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {agent.capabilities.map(c => (
                      <span key={c} style={{
                        padding: '3px 8px', borderRadius: 4, fontSize: 8, fontWeight: 700,
                        textTransform: 'uppercase', background: `${agent.color}10`, color: agent.color,
                        border: `1px solid ${agent.color}25`,
                      }}>{c.replace(/_/g, ' ')}</span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Configuration Reminder */}
        <div style={{
          padding: '20px 24px', borderRadius: 16,
          background: `linear-gradient(135deg, color-mix(in srgb, var(--purple) 6%, transparent) 0%, color-mix(in srgb, var(--blue) 6%, transparent) 100%)`,
          border: '1px solid var(--purple)', display: 'flex', alignItems: 'center', gap: 16,
        }}>
          <div style={{ fontSize: 32, flexShrink: 0 }}>⚙️</div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 4 }}>
              All agents are fully customizable
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
              Go to <strong style={{ color: 'var(--accent)' }}>AI Nexus → Agents</strong> → click any agent to open the configuration modal. Edit the <strong>Core Prompt</strong> (personality, expertise, demeanour), add <strong>Prompt Stack</strong> instructions (project-specific rules), upload <strong>Knowledge Base</strong> entries (training data, examples, references), and tune <strong>Temperature</strong> and <strong>Max Tokens</strong>. Changes take effect immediately for all conversations.
            </div>
          </div>
        </div>
      </div>

      <style>{`
        @keyframes slideInPanel {
          from { opacity: 0; transform: translateX(20px); }
          to { opacity: 1; transform: translateX(0); }
        }
      `}</style>
    </div>
  );
}
