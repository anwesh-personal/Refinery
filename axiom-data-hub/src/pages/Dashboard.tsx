import {
  CloudDownload, Database, ShieldCheck, Filter, Send, Activity, Zap,
  Loader2, CheckCircle2, AlertCircle, Mail, MousePointerClick, Ban, Eye
} from 'lucide-react';
import { PageHeader, StatCard, GradientCard, ActionCard, SectionHeader, EmptyState } from '../components/UI';
import { ServerSelector } from '../components/ServerSelector';
import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import { apiCall } from '../lib/api';
import { TeamNetworkGraph } from '../components/TeamNetworkGraph';
import AgentCard from '../components/AgentCard';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell } from 'recharts';

interface DbStats {
  totalRows: string;
  totalBytes: string;
  tableCount: string;
  segmentCount: string;
}

interface IngestionStats {
  total_jobs: string;
  total_rows: string;
  total_bytes: string;
  pending: string;
}

interface IngestionTrend {
  day: string;
  jobs: string;
  rows: string;
}

interface VerificationTrend {
  day: string;
  batches: string;
  valid: string;
  invalid: string;
  unknown: string;
}

interface SegmentBreakdown {
  name: string;
  lead_count: string;
}

interface RecentActivity {
  type: 'ingestion' | 'verification' | 'segment' | 'target';
  title: string;
  detail: string;
  status: string;
  timestamp: string;
  performedBy: string | null;
}

function formatNumber(n: string | number): string {
  const num = Number(n);
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(1) + 'M';
  if (num >= 1_000) return (num / 1_000).toFixed(1) + 'K';
  return num.toLocaleString();
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

function formatDateShort(dateStr: string): string {
  const [, m, d] = dateStr.split('-');
  return `${m}/${d}`;
}

const statusStyles: Record<string, { color: string; bg: string }> = {
  complete: { color: 'var(--green)', bg: 'var(--green-muted)' },
  ready: { color: 'var(--green)', bg: 'var(--green-muted)' },
  ingesting: { color: 'var(--blue)', bg: 'var(--blue-muted)' },
  generating: { color: 'var(--blue)', bg: 'var(--blue-muted)' },
  downloading: { color: 'var(--yellow)', bg: 'var(--yellow-muted)' },
  uploading: { color: 'var(--purple)', bg: 'var(--purple-muted)' },
  pushed: { color: 'var(--purple)', bg: 'var(--purple-muted)' },
  pending: { color: 'var(--text-tertiary)', bg: 'var(--bg-elevated)' },
  failed: { color: 'var(--red)', bg: 'var(--red-muted)' },
};

const activityIcons: Record<string, any> = {
  ingestion: CloudDownload,
  verification: ShieldCheck,
  segment: Filter,
  target: Send,
};

const COLORS = ['#3b82f6', '#8b5cf6', '#f59e0b', '#10b981', '#ef4444', '#ec4899', '#0ea5e9', '#6366f1'];

export default function DashboardPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [dbStats, setDbStats] = useState<DbStats | null>(null);
  const [ingestionStats, setIngestionStats] = useState<IngestionStats | null>(null);
  const [activities, setActivities] = useState<RecentActivity[]>([]);

  const [ingestionTrends, setIngestionTrends] = useState<IngestionTrend[]>([]);
  const [verificationTrends, setVerificationTrends] = useState<VerificationTrend[]>([]);
  const [segmentBreakdown, setSegmentBreakdown] = useState<SegmentBreakdown[]>([]);

  const [loading, setLoading] = useState(true);
  const [engagement, setEngagement] = useState<any>(null);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [db, ing, acts, ingTrends, verTrends, segBreak] = await Promise.all([
        apiCall<DbStats>('/api/database/stats').catch(() => null),
        apiCall<IngestionStats>('/api/ingestion/stats').catch(() => null),
        apiCall<RecentActivity[]>('/api/dashboard/activity').catch(() => []),
        apiCall<IngestionTrend[]>('/api/dashboard/ingestion-trends').catch(() => []),
        apiCall<VerificationTrend[]>('/api/dashboard/verification-trends').catch(() => []),
        apiCall<SegmentBreakdown[]>('/api/dashboard/segment-breakdown').catch(() => []),
      ]);
      setDbStats(db);
      setIngestionStats(ing);
      setActivities(acts);
      setIngestionTrends(ingTrends);
      setVerificationTrends(verTrends);
      setSegmentBreakdown(segBreak);
      // Fetch engagement metrics (non-blocking)
      apiCall('/api/dashboard/engagement').then(setEngagement).catch(() => {});
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const totalLeads = Number(dbStats?.totalRows || 0);
  const totalBytes = Number(dbStats?.totalBytes || 0);
  const pendingJobs = Number(ingestionStats?.pending || 0);

  const mappedIngestionTrends = ingestionTrends.map(item => ({
    ...item,
    formattedDay: formatDateShort(item.day),
    volume: Number(item.rows)
  }));

  const mappedVerificationTrends = verificationTrends.map(item => ({
    ...item,
    formattedDay: formatDateShort(item.day),
    Valid: Number(item.valid),
    Invalid: Number(item.invalid)
  }));

  const mappedSegments = segmentBreakdown.map((s, i) => ({
    name: s.name,
    value: Number(s.lead_count),
    color: COLORS[i % COLORS.length]
  }));

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', padding: '10px 14px', borderRadius: 8, fontSize: 12, boxShadow: '0 4px 12px rgba(0,0,0,0.1)', zIndex: 100 }}>
          <div style={{ fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>{label}</div>
          {payload.map((entry: any, index: number) => (
            <div key={index} style={{ color: entry.color, display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: entry.color }}></span>
              <span>{entry.name}: <strong>{formatNumber(entry.value)}</strong></span>
            </div>
          ))}
        </div>
      );
    }
    return null;
  };

  return (
    <>
      <PageHeader
        title="Intelligence Hub"
        sub="Your real-time command center for data operations, ingestion health, and verification yield."
        description="This dashboard aggregates live stats from your ClickHouse database, ingestion pipeline, and verification engine. Watch total lead counts, active jobs, and storage usage update in real-time. Use the quick actions below to jump into any workflow — from ingesting new S3 data to verifying segments."
        action={<ServerSelector type="clickhouse" />}
      />

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20, marginBottom: 36 }}>
        <GradientCard
          label="Total Records"
          value={loading ? '...' : formatNumber(totalLeads)}
          sub={`${formatBytes(totalBytes)} stored on disk`}
          icon={<Zap size={28} />}
        />
        <StatCard
          label="Pending Jobs"
          value={loading ? '...' : String(pendingJobs)}
          sub={pendingJobs > 0 ? 'Ingestion in progress' : 'No active jobs'}
          icon={<CloudDownload size={18} />}
          color="var(--blue)"
          colorMuted="var(--blue-muted)"
          delay={0.06}
        />
        <StatCard
          label="Active Tables"
          value={loading ? '...' : formatNumber(dbStats?.tableCount || '0')}
          sub={`${formatNumber(dbStats?.segmentCount || '0')} segments created`}
          icon={<Database size={18} />}
          color="var(--green)"
          colorMuted="var(--green-muted)"
          delay={0.12}
        />
      </div>

      {/* Engagement / Delivery Health */}
      {engagement && (
        <>
          <SectionHeader title="Delivery Health (7d)" />
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 16, marginBottom: 36 }}>
            <StatCard label="Opens" value={formatNumber(engagement.engagement?.unique_opens || '0')} sub="Unique opens" icon={<Eye size={18} />} color="var(--green)" colorMuted="var(--green-muted)" delay={0.06} />
            <StatCard label="Clicks" value={formatNumber(engagement.engagement?.unique_clicks || '0')} sub="Unique clicks" icon={<MousePointerClick size={18} />} color="var(--accent)" colorMuted="var(--accent-muted)" delay={0.12} />
            <StatCard label="Bounces" value={formatNumber(engagement.engagement?.bounces || '0')} sub={`${engagement.engagement?.hard_bounces || 0} hard`} icon={<AlertCircle size={18} />} color="var(--red)" colorMuted="var(--red-muted)" delay={0.18} />
            <StatCard label="Complaints" value={formatNumber(engagement.engagement?.complaints || '0')} sub="Spam reports" icon={<Ban size={18} />} color="var(--yellow)" colorMuted="var(--yellow-muted)" delay={0.24} />
            <StatCard label="Suppressed" value={formatNumber(String(Number(engagement.suppressed?.bounced || 0) + Number(engagement.suppressed?.unsubscribed || 0)))} sub={`${engagement.suppressed?.bounced || 0} bounced · ${engagement.suppressed?.unsubscribed || 0} unsub`} icon={<Mail size={18} />} color="var(--text-tertiary)" colorMuted="var(--bg-elevated)" delay={0.30} />
          </div>
        </>
      )}

      {/* Charts Row */}
      <div className="animate-fadeIn stagger-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 20, marginBottom: 36 }}>

        {/* Ingestion Area Chart */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: 20, gridColumn: 'span 2' }}>
          <h3 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', marginBottom: 20 }}>Ingestion Volume (30 Days)</h3>
          {mappedIngestionTrends.length > 0 ? (
            <div style={{ height: 220, width: '100%' }}>
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={mappedIngestionTrends} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorVolume" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                      <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" opacity={0.5} />
                  <XAxis dataKey="formattedDay" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} dy={10} />
                  <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} tickFormatter={(val) => formatNumber(val)} />
                  <Tooltip content={<CustomTooltip />} />
                  <Area type="monotone" dataKey="volume" name="Ingested Rows" stroke="#3b82f6" strokeWidth={3} fillOpacity={1} fill="url(#colorVolume)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)' }}>
              {loading ? <Loader2 className="spin" size={24} /> : 'No recent ingestion data'}
            </div>
          )}
        </div>

        {/* Top Segments Donut Chart */}
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: 20, display: 'flex', flexDirection: 'column' }}>
          <h3 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', marginBottom: 0 }}>Top Segments</h3>
          {mappedSegments.length > 0 ? (
            <div style={{ flex: 1, position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie
                    data={mappedSegments}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={80}
                    paddingAngle={2}
                    dataKey="value"
                    stroke="var(--bg-card)"
                    strokeWidth={2}
                  >
                    {mappedSegments.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <Tooltip content={<CustomTooltip />} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', textAlign: 'center' }}>
                <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)' }}>{mappedSegments.length}</div>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 600 }}>Active</div>
              </div>
            </div>
          ) : (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)' }}>
              {loading ? <Loader2 className="spin" size={24} /> : 'No active segments'}
            </div>
          )}
        </div>
      </div>

      {/* Verification Trends Bar Chart */}
      <div className="animate-fadeIn stagger-3" style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: 20, marginBottom: 36 }}>
        <h3 style={{ fontSize: 13, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', marginBottom: 20 }}>Verification Yield (30 Days)</h3>
        {mappedVerificationTrends.length > 0 ? (
          <div style={{ height: 260, width: '100%' }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={mappedVerificationTrends} margin={{ top: 5, right: 0, left: -20, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--border)" opacity={0.5} />
                <XAxis dataKey="formattedDay" axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} dy={10} />
                <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 11, fill: 'var(--text-tertiary)' }} tickFormatter={(val) => formatNumber(val)} />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'var(--bg-hover)' }} />
                <Bar dataKey="Valid" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={40} />
                <Bar dataKey="Invalid" fill="#ef4444" radius={[4, 4, 0, 0]} maxBarSize={40} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div style={{ height: 260, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-tertiary)' }}>
            {loading ? <Loader2 className="spin" size={24} /> : 'No recent verification batches'}
          </div>
        )}
      </div>

      {/* Superadmin Team Constellation */}
      {user?.role === 'superadmin' && (
        <div className="animate-fadeIn stagger-3" style={{ marginBottom: 36 }}>
          <TeamNetworkGraph />
        </div>
      )}

      {/* Overseer AI Agent — Executive Briefing */}
      <div className="animate-fadeIn stagger-3" style={{ marginBottom: 36 }}>
        <AgentCard
          slug="supervisor"
          contextLabel="Executive Briefing — Refinery Status"
          context={{
            totalRecords: totalLeads,
            totalStorage: formatBytes(totalBytes),
            activeTablesCount: dbStats?.tableCount,
            segmentCount: dbStats?.segmentCount,
            pendingIngestionJobs: pendingJobs,
            ingestionTrend: ingestionTrends.slice(-7).map(t => ({ day: t.day, rows: Number(t.rows) })),
            verificationTrend: verificationTrends.slice(-7).map(t => ({ day: t.day, valid: Number(t.valid), invalid: Number(t.invalid) })),
            topSegments: segmentBreakdown.slice(0, 5).map(s => ({ name: s.name, leads: Number(s.lead_count) })),
            recentActivity: activities.slice(0, 5).map(a => ({ type: a.type, title: a.title, status: a.status })),
          }}
        />
      </div>

      {/* Two Column Layout (Actions / Activity) */}
      <div className="animate-fadeIn stagger-4" style={{ display: 'grid', gridTemplateColumns: 'minmax(300px, 1fr) minmax(350px, 1fr)', gap: 36, marginBottom: 36 }}>

        {/* Quick Actions (Left) */}
        <div>
          <SectionHeader title="Quick Actions" />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <ActionCard title="Start S3 Ingestion" sub="Download latest data" icon={<CloudDownload size={18} />} color="var(--blue)" colorMuted="var(--blue-muted)" delay={0.06} onClick={() => navigate('/ingestion')} />
            <ActionCard title="Create Segment" sub="Filter leads by conditions" icon={<Filter size={18} />} color="var(--purple)" colorMuted="var(--purple-muted)" delay={0.12} onClick={() => navigate('/segments')} />
            <ActionCard title="Verify Emails" sub="Catch bounces & traps" icon={<ShieldCheck size={18} />} color="var(--green)" colorMuted="var(--green-muted)" delay={0.18} onClick={() => navigate('/verification')} />
            <ActionCard title="Export Targets" sub="Dispatch to queue" icon={<Send size={18} />} color="var(--accent)" colorMuted="var(--accent-muted)" delay={0.24} onClick={() => navigate('/targets')} />
          </div>
        </div>

        {/* Activity Feed (Right) */}
        <div>
          <SectionHeader title="Recent Activity" action="View All" onAction={() => navigate('/ingestion')} />
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden', minHeight: 400 }}>
            {activities.length > 0 ? (
              <div style={{ padding: 8 }}>
                {activities.map((act, idx) => {
                  const Icon = activityIcons[act.type] || Activity;
                  return (
                    <div
                      key={idx}
                      style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '12px 18px', borderRadius: 10, marginBottom: 4,
                        transition: 'background 0.15s',
                      }}
                      onMouseOver={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                      onMouseOut={e => (e.currentTarget.style.background = '')}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <div style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-secondary)' }}>
                          <Icon size={16} />
                        </div>
                        <div>
                          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                            {act.title}
                            {act.status === 'failed' && <AlertCircle size={12} color="var(--red)" />}
                            {act.status === 'complete' || act.status === 'ready' ? <CheckCircle2 size={12} color="var(--green)" /> : null}
                          </div>
                          <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                            {act.detail}{act.performedBy ? ` · by ${act.performedBy}` : ''} · {timeAgo(act.timestamp)}
                          </div>
                        </div>
                      </div>
                      <span style={{
                        fontSize: 10, fontWeight: 700, textTransform: 'uppercase',
                        padding: '4px 8px', borderRadius: 6,
                        color: (statusStyles[act.status] || statusStyles.pending).color,
                        background: (statusStyles[act.status] || statusStyles.pending).bg,
                      }}>
                        {act.status}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : (
              <EmptyState
                icon={<Activity size={24} />}
                title={loading ? 'Loading...' : 'No recent activity'}
                sub="Your ecosystem activity feed will appear here"
              />
            )}
          </div>
        </div>

      </div>
    </>
  );
}
