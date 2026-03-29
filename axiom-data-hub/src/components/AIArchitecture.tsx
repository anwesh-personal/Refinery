import { useState, useCallback, useMemo } from 'react';
import {
  ReactFlow, Background, Controls, MiniMap,
  Handle, Position, useNodesState, useEdgesState,
  type Node, type Edge, type NodeProps,
  MarkerType,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { X } from 'lucide-react';

// ═══════════════════════════════════════════════════════════
// AI Nexus Architecture — Interactive System Map
// ═══════════════════════════════════════════════════════════

interface NodeData {
  label: string; description: string; color: string; icon: string;
  details: string; capabilities?: string[];
  [key: string]: unknown;
}

// ── Custom Nodes ──

function CoreNode({ data }: NodeProps<Node<NodeData>>) {
  return (
    <div style={{
      padding: '16px 20px', borderRadius: 16, minWidth: 180,
      background: `linear-gradient(135deg, ${data.color} 0%, ${data.color}cc 100%)`,
      border: `2px solid ${data.color}`, boxShadow: `0 8px 30px ${data.color}30`,
      color: '#fff', textAlign: 'center', cursor: 'pointer',
    }}>
      <Handle type="target" position={Position.Top} style={{ background: data.color, border: '2px solid #fff', width: 10, height: 10 }} />
      <div style={{ fontSize: 24, marginBottom: 4 }}>{data.icon}</div>
      <div style={{ fontSize: 13, fontWeight: 800 }}>{data.label}</div>
      <div style={{ fontSize: 9, opacity: 0.85, marginTop: 2 }}>{data.description}</div>
      <Handle type="source" position={Position.Bottom} style={{ background: data.color, border: '2px solid #fff', width: 10, height: 10 }} />
    </div>
  );
}

function FeatureNode({ data }: NodeProps<Node<NodeData>>) {
  return (
    <div style={{
      padding: '12px 16px', borderRadius: 12, minWidth: 150,
      background: 'var(--bg-card)', border: `1.5px solid ${data.color}40`,
      boxShadow: `0 4px 16px ${data.color}10`, cursor: 'pointer',
      transition: 'all 0.2s',
    }}>
      <Handle type="target" position={Position.Top} style={{ background: data.color, width: 8, height: 8 }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <span style={{ fontSize: 18 }}>{data.icon}</span>
        <div>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-primary)' }}>{data.label}</div>
          <div style={{ fontSize: 8, color: 'var(--text-tertiary)' }}>{data.description}</div>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: data.color, width: 8, height: 8 }} />
    </div>
  );
}

function AgentNode({ data }: NodeProps<Node<NodeData>>) {
  return (
    <div style={{
      padding: '14px 18px', borderRadius: 14, minWidth: 160,
      background: 'var(--bg-card)', border: `2px solid ${data.color}50`,
      boxShadow: `0 6px 24px ${data.color}15`, cursor: 'pointer',
    }}>
      <Handle type="target" position={Position.Top} style={{ background: data.color, border: `2px solid ${data.color}`, width: 10, height: 10 }} />
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 28, marginBottom: 4 }}>{data.icon}</div>
        <div style={{ fontSize: 12, fontWeight: 800, color: data.color }}>{data.label}</div>
        <div style={{ fontSize: 8, color: 'var(--text-tertiary)', marginTop: 2 }}>{data.description}</div>
        {data.capabilities && (
          <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap', justifyContent: 'center', marginTop: 6 }}>
            {data.capabilities.map((c: string) => (
              <span key={c} style={{ fontSize: 6, padding: '1px 4px', borderRadius: 3, background: `${data.color}12`, color: data.color, fontWeight: 700, textTransform: 'uppercase' }}>{c.replace(/_/g, ' ')}</span>
            ))}
          </div>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: data.color, width: 8, height: 8 }} />
    </div>
  );
}

function InfraNode({ data }: NodeProps<Node<NodeData>>) {
  return (
    <div style={{
      padding: '10px 14px', borderRadius: 10, minWidth: 130,
      background: 'var(--bg-app)', border: '1px dashed var(--border)',
      cursor: 'pointer',
    }}>
      <Handle type="target" position={Position.Top} style={{ background: 'var(--text-tertiary)', width: 6, height: 6 }} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 14 }}>{data.icon}</span>
        <div>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)' }}>{data.label}</div>
          <div style={{ fontSize: 7, color: 'var(--text-tertiary)' }}>{data.description}</div>
        </div>
      </div>
      <Handle type="source" position={Position.Bottom} style={{ background: 'var(--text-tertiary)', width: 6, height: 6 }} />
    </div>
  );
}

const nodeTypes = { core: CoreNode, feature: FeatureNode, agent: AgentNode, infra: InfraNode };

// ═══ Node & Edge Definitions ═══

const initialNodes: Node<NodeData>[] = [
  // Center — AI Nexus Hub
  { id: 'nexus', type: 'core', position: { x: 400, y: 0 }, data: { label: 'AI NEXUS', description: 'Central AI Intelligence Hub', color: '#8b5cf6', icon: '🧠', details: 'AI Nexus is the central intelligence hub that orchestrates all AI-powered features in Refinery. It connects to your data (email lists, verification results, campaign stats) and routes AI requests through configured providers.\n\n**How it works:**\n1. You configure AI providers (OpenAI, Gemini, etc.) in Settings\n2. Each feature sends requests through the AI Client\n3. The AI Client handles routing, fallback, usage tracking\n4. Results come back and are displayed in the feature UI\n\n**What it touches:** Everything. It reads from your email data, verification results, and campaign history to power all 7 features and 5 agents.' } },

  // Layer 1 — AI Provider Infrastructure
  { id: 'providers', type: 'infra', position: { x: 200, y: -100 }, data: { label: 'AI Providers', description: 'OpenAI / Gemini / Anthropic / Custom', color: '#666', icon: '🔌', details: 'AI Providers are the LLM backends that power all AI features. You can configure multiple providers with different models.\n\n**Supported:** OpenAI (GPT-4, GPT-4o), Google Gemini (Flash, Pro), Anthropic (Claude), OpenRouter, any OpenAI-compatible API.\n\n**Fallback:** If primary provider fails, system automatically falls back to the next configured provider.\n\n**Cost tracking:** Every API call is logged with token count, latency, and estimated cost.' } },
  { id: 'usage', type: 'infra', position: { x: 600, y: -100 }, data: { label: 'Usage Tracking', description: 'Tokens / Cost / Latency / Errors', color: '#666', icon: '📊', details: 'Every AI call is automatically logged:\n- **Token count** (input + output)\n- **Latency** (response time in ms)\n- **Provider/Model used**\n- **Success/failure status**\n- **Estimated cost**\n\nThis data feeds into the Dashboard tab and helps you optimize provider selection and cost management.' } },

  // Layer 2 — The 7 AI Features
  { id: 'lead-scoring', type: 'feature', position: { x: 0, y: 150 }, data: { label: 'Lead Scoring', description: 'Score & classify leads', color: '#4285f4', icon: '✨', details: '**What:** Analyzes your email list data and assigns quality scores to each lead based on configurable criteria.\n\n**How it connects:** Reads from your uploaded/ingested data in Universal Person, asks AI to evaluate each lead against scoring criteria you define.\n\n**Real-world use:** "Score these 10,000 leads from 1-100 and classify as Hot/Warm/Cold based on domain authority, email provider, and verification status."' } },
  { id: 'icp-analysis', type: 'feature', position: { x: 170, y: 150 }, data: { label: 'ICP Analysis', description: 'Build ideal customer profiles', color: '#34a853', icon: '🎯', details: '**What:** Builds Ideal Customer Profiles by analyzing patterns in your existing data to identify who your best prospects are.\n\n**How it connects:** Analyzes your database entries — looking at domains, industries, company sizes, email patterns — to identify high-value segments.\n\n**Real-world use:** "Which types of companies in my list have the highest verification success rate and engagement potential?"' } },
  { id: 'segmentation', type: 'feature', position: { x: 340, y: 200 }, data: { label: 'Segmentation', description: 'Smart list grouping', color: '#fbbc05', icon: '📦', details: '**What:** Intelligently groups your leads into targeted segments based on shared characteristics.\n\n**How it connects:** Uses your Universal Person data + verification results to create meaningful groups.\n\n**Real-world use:** "Group my verified leads into segments: enterprise decision-makers, SMB founders, and marketing managers — with recommended messaging for each."' } },
  { id: 'bounce-analysis', type: 'feature', position: { x: 510, y: 200 }, data: { label: 'Bounce Analysis', description: 'Deliverability prediction', color: '#ea4335', icon: '⚡', details: '**What:** Predicts bounce risk before you send by analyzing historical patterns and domain health.\n\n**How it connects:** Uses verification job results, domain reputation data, and historical bounce patterns to assess risk.\n\n**Real-world use:** "Analyze my last 3 verification jobs — which domains have the highest bounce risk and why? How should I clean my list?"' } },
  { id: 'enrichment', type: 'feature', position: { x: 680, y: 150 }, data: { label: 'Data Enrichment', description: 'Infer company/role/industry', color: '#9c27b0', icon: '🔮', details: '**What:** Enriches your leads by inferring company name, role, industry, and other attributes from email addresses and domains.\n\n**How it connects:** Takes email addresses from your database and uses AI to infer contextual data.\n\n**Real-world use:** "For all emails @acme.com, infer the company details, industry, employee count, and likely decision-maker status."' } },
  { id: 'content', type: 'feature', position: { x: 810, y: 150 }, data: { label: 'Content Gen', description: 'Email copywriting', color: '#e91e63', icon: '✍️', details: '**What:** Generates email copy — subject lines, body text, follow-ups, cold outreach sequences.\n\n**How it connects:** Uses your ICP data and campaign goals to write targeted, personalized copy. Includes spam score analysis.\n\n**Real-world use:** "Write a 5-email cold outreach sequence targeting SaaS CTOs about our verification API. Include subject lines and follow-up timing."' } },
  { id: 'optimizer', type: 'feature', position: { x: 920, y: 200 }, data: { label: 'Campaign Optimizer', description: 'Send timing & strategy', color: '#ff9800', icon: '🚀', details: '**What:** Optimizes campaign strategy — send timing, volume distribution, A/B testing recommendations.\n\n**How it connects:** Analyzes your historical send data and engagement patterns to recommend optimal strategies.\n\n**Real-world use:** "Based on my audience profile, what are the best send times? How should I distribute 50K emails over 5 days without harming reputation?"' } },

  // Layer 3 — The 5 Agents
  { id: 'cortex', type: 'agent', position: { x: 0, y: 400 }, data: { label: 'Cortex', description: 'Data Scientist', color: '#4285f4', icon: '📊', details: '**Cortex** is your data scientist agent.\n\n**Personality:** Analytical, direct, pattern-obsessed. Speaks in data insights, never guesses — calculates.\n\n**What it can do:** Score leads, build ICPs, find patterns in verification data, design A/B tests, calculate statistical significance.\n\n**Tools:** Lead Scoring, ICP Analysis, Data Enrichment, Segmentation', capabilities: ['lead_scoring', 'icp_analysis', 'data_enrichment', 'list_segmentation'] } },
  { id: 'bastion', type: 'agent', position: { x: 200, y: 400 }, data: { label: 'Bastion', description: 'SMTP Specialist', color: '#ef4444', icon: '🛡️', details: '**Bastion** is your infrastructure guardian.\n\n**Personality:** Vigilant, precise, slightly paranoid about security. Direct and technical.\n\n**What it can do:** Diagnose SMTP issues, analyze DNS records (MX/SPF/DKIM/DMARC), troubleshoot bounces, recommend IP warmup strategies.\n\n**Tools:** Bounce Analysis', capabilities: ['bounce_analysis'] } },
  { id: 'muse', type: 'agent', position: { x: 400, y: 440 }, data: { label: 'Muse', description: 'Email Marketer', color: '#e91e63', icon: '✉️', details: '**Muse** is your creative marketing strategist.\n\n**Personality:** Creative, energetic, conversion-obsessed. Thinks in funnels and sequences.\n\n**What it can do:** Write email campaigns, design sequences, optimize subject lines, plan send cadences, analyze conversion potential.\n\n**Tools:** Content Gen, Campaign Optimizer, Segmentation, ICP Analysis', capabilities: ['content_generation', 'campaign_optimizer', 'list_segmentation', 'icp_analysis'] } },
  { id: 'overseer', type: 'agent', position: { x: 600, y: 400 }, data: { label: 'Overseer', description: 'Supervisor', color: '#ffd700', icon: '👑', details: '**Overseer** is your AI twin — the all-rounder supervisor.\n\n**Personality:** Strategic, decisive, sees the big picture. Makes executive decisions and delegates to specialist thinking.\n\n**What it can do:** Everything. Synthesizes across data, infrastructure, marketing, and verification. Provides executive-level strategy and ROI analysis.\n\n**Tools:** ALL 7 tools', capabilities: ['all_tools'] } },
  { id: 'litmus', type: 'agent', position: { x: 800, y: 400 }, data: { label: 'Litmus', description: 'Verification Engineer', color: '#10a37f', icon: '🔬', details: '**Litmus** is your verification engineer — the definitive test.\n\n**Personality:** Methodical, curious, obsessive about accuracy. Treats every email as a puzzle.\n\n**What it can do:** Explain verification results, diagnose catch-all domains, optimize risk thresholds, analyze SMTP responses, recommend retry strategies.\n\n**Tools:** Bounce Analysis, Lead Scoring, Data Enrichment', capabilities: ['bounce_analysis', 'lead_scoring', 'data_enrichment'] } },

  // Layer 4 — Data Sources
  { id: 'db', type: 'infra', position: { x: 200, y: 600 }, data: { label: 'Universal Person DB', description: 'ClickHouse — Your email data', color: '#666', icon: '💾', details: 'Your core database in ClickHouse containing all ingested email data. This is where lead scoring, enrichment, and segmentation draw their data from.\n\nEvery feature reads from this and writes results back.' } },
  { id: 'verification', type: 'infra', position: { x: 450, y: 600 }, data: { label: 'Verification Engine', description: 'SMTP probing & risk scoring', color: '#666', icon: '✅', details: 'The email verification pipeline that runs SMTP probes, catch-all detection, DNS checks, and risk scoring.\n\nBounce Analysis and Litmus agent read verification results to provide insights.' } },
  { id: 'supabase', type: 'infra', position: { x: 700, y: 600 }, data: { label: 'Supabase', description: 'Auth, Config, Agent Memory', color: '#666', icon: '🗄️', details: 'Supabase stores:\n- User auth & permissions\n- AI provider configs\n- Agent definitions & prompts\n- Conversation history & messages\n- Knowledge base entries\n- Usage tracking logs' } },
];

const initialEdges: Edge[] = [
  // Providers to Nexus
  { id: 'e-prov-nexus', source: 'providers', target: 'nexus', animated: true, style: { stroke: '#8b5cf6', strokeWidth: 2 }, markerEnd: { type: MarkerType.ArrowClosed, color: '#8b5cf6' } },
  { id: 'e-usage-nexus', source: 'usage', target: 'nexus', animated: true, style: { stroke: '#8b5cf6', strokeWidth: 2 }, markerEnd: { type: MarkerType.ArrowClosed, color: '#8b5cf6' } },

  // Nexus to features
  { id: 'e-n-ls', source: 'nexus', target: 'lead-scoring', style: { stroke: '#4285f4' }, markerEnd: { type: MarkerType.ArrowClosed, color: '#4285f4' } },
  { id: 'e-n-icp', source: 'nexus', target: 'icp-analysis', style: { stroke: '#34a853' }, markerEnd: { type: MarkerType.ArrowClosed, color: '#34a853' } },
  { id: 'e-n-seg', source: 'nexus', target: 'segmentation', style: { stroke: '#fbbc05' }, markerEnd: { type: MarkerType.ArrowClosed, color: '#fbbc05' } },
  { id: 'e-n-bounce', source: 'nexus', target: 'bounce-analysis', style: { stroke: '#ea4335' }, markerEnd: { type: MarkerType.ArrowClosed, color: '#ea4335' } },
  { id: 'e-n-enrich', source: 'nexus', target: 'enrichment', style: { stroke: '#9c27b0' }, markerEnd: { type: MarkerType.ArrowClosed, color: '#9c27b0' } },
  { id: 'e-n-content', source: 'nexus', target: 'content', style: { stroke: '#e91e63' }, markerEnd: { type: MarkerType.ArrowClosed, color: '#e91e63' } },
  { id: 'e-n-opt', source: 'nexus', target: 'optimizer', style: { stroke: '#ff9800' }, markerEnd: { type: MarkerType.ArrowClosed, color: '#ff9800' } },

  // Features to agents (who can use them)
  { id: 'e-ls-cortex', source: 'lead-scoring', target: 'cortex', style: { stroke: '#4285f440' }, type: 'smoothstep' },
  { id: 'e-icp-cortex', source: 'icp-analysis', target: 'cortex', style: { stroke: '#34a85340' }, type: 'smoothstep' },
  { id: 'e-bounce-bastion', source: 'bounce-analysis', target: 'bastion', style: { stroke: '#ef444440' }, type: 'smoothstep' },
  { id: 'e-content-muse', source: 'content', target: 'muse', style: { stroke: '#e91e6340' }, type: 'smoothstep' },
  { id: 'e-opt-muse', source: 'optimizer', target: 'muse', style: { stroke: '#ff980040' }, type: 'smoothstep' },
  { id: 'e-seg-overseer', source: 'segmentation', target: 'overseer', style: { stroke: '#ffd70040' }, type: 'smoothstep' },
  { id: 'e-bounce-litmus', source: 'bounce-analysis', target: 'litmus', style: { stroke: '#10a37f40' }, type: 'smoothstep' },

  // Agents to data
  { id: 'e-cortex-db', source: 'cortex', target: 'db', style: { stroke: '#4285f430' }, type: 'smoothstep' },
  { id: 'e-bastion-ver', source: 'bastion', target: 'verification', style: { stroke: '#ef444430' }, type: 'smoothstep' },
  { id: 'e-muse-db', source: 'muse', target: 'db', style: { stroke: '#e91e6330' }, type: 'smoothstep' },
  { id: 'e-overseer-supa', source: 'overseer', target: 'supabase', style: { stroke: '#ffd70030' }, type: 'smoothstep' },
  { id: 'e-litmus-ver', source: 'litmus', target: 'verification', style: { stroke: '#10a37f30' }, type: 'smoothstep' },
];

// ═══ Architecture Component ═══

export default function AIArchitecture() {
  const [nodes, , onNodesChange] = useNodesState(initialNodes);
  const [edges, , onEdgesChange] = useEdgesState(initialEdges);
  const [selectedNode, setSelectedNode] = useState<NodeData | null>(null);

  const onNodeClick = useCallback((_: any, node: Node) => {
    setSelectedNode(node.data as NodeData);
  }, []);

  const nt = useMemo(() => nodeTypes, []);

  return (
    <div style={{ position: 'relative' }}>
      {/* Header */}
      <div style={{ marginBottom: 16 }}>
        <h2 style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)', margin: '0 0 6px' }}>AI Nexus Architecture</h2>
        <p style={{ fontSize: 12, color: 'var(--text-tertiary)', margin: 0 }}>Interactive system map. Click any node to learn how it works and connects. Drag to rearrange. Scroll to zoom.</p>
      </div>

      {/* Flow Canvas */}
      <div style={{ height: 'calc(100vh - 240px)', borderRadius: 16, overflow: 'hidden', border: '1px solid var(--border)', background: 'var(--bg-app)' }}>
        <ReactFlow
          nodes={nodes}
          edges={edges}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          nodeTypes={nt}
          fitView
          fitViewOptions={{ padding: 0.15 }}
          minZoom={0.3}
          maxZoom={2}
          proOptions={{ hideAttribution: true }}
        >
          <Background color="var(--border)" gap={20} size={1} />
          <Controls style={{ bottom: 16, left: 16 }} />
          <MiniMap
            nodeColor={(n) => (n.data as NodeData)?.color || '#666'}
            maskColor="rgba(0,0,0,0.3)"
            style={{ borderRadius: 8, border: '1px solid var(--border)' }}
          />
        </ReactFlow>
      </div>

      {/* Detail Panel */}
      {selectedNode && (
        <div style={{
          position: 'absolute', top: 60, right: 16, width: 360, maxHeight: 'calc(100vh - 300px)',
          background: 'var(--bg-card)', borderRadius: 16, border: `2px solid ${selectedNode.color}30`,
          boxShadow: `0 16px 40px ${selectedNode.color}15`, overflow: 'hidden',
          backdropFilter: 'blur(12px)', zIndex: 10,
        }}>
          <div style={{ background: `linear-gradient(135deg, ${selectedNode.color} 0%, ${selectedNode.color}cc 100%)`, padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <span style={{ fontSize: 24 }}>{selectedNode.icon}</span>
              <div>
                <div style={{ fontSize: 15, fontWeight: 800, color: '#fff' }}>{selectedNode.label}</div>
                <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.7)' }}>{selectedNode.description}</div>
              </div>
            </div>
            <button onClick={() => setSelectedNode(null)} style={{ background: 'rgba(255,255,255,0.15)', border: 'none', borderRadius: 6, padding: 4, cursor: 'pointer', color: '#fff' }}><X size={14} /></button>
          </div>
          <div style={{ padding: '16px 20px', overflowY: 'auto', maxHeight: 400 }}>
            {selectedNode.details.split('\n\n').map((p, i) => (
              <div key={i} style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.7, marginBottom: 10 }}>
                {p.split('\n').map((line, j) => {
                  if (line.startsWith('**') && line.endsWith('**')) return <div key={j} style={{ fontWeight: 700, color: 'var(--text-primary)', marginTop: 4 }}>{line.replace(/\*\*/g, '')}</div>;
                  if (line.startsWith('- ')) return <div key={j} style={{ paddingLeft: 12, position: 'relative' }}><span style={{ position: 'absolute', left: 0, color: selectedNode.color }}>•</span>{line.slice(2)}</div>;
                  if (line.startsWith('**')) {
                    const parts = line.split('**');
                    return <div key={j}>{parts.map((part, k) => k % 2 === 1 ? <strong key={k} style={{ color: 'var(--text-primary)' }}>{part}</strong> : part)}</div>;
                  }
                  return <div key={j}>{line}</div>;
                })}
              </div>
            ))}
            {selectedNode.capabilities && (
              <div style={{ marginTop: 8, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                {selectedNode.capabilities.map(c => <span key={c} style={{ padding: '3px 8px', borderRadius: 4, fontSize: 9, fontWeight: 700, textTransform: 'uppercase', background: `${selectedNode.color}12`, color: selectedNode.color }}>{c.replace(/_/g, ' ')}</span>)}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
