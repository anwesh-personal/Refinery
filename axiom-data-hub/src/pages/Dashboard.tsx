import {
  CloudDownload, Database, ShieldCheck, TrendingUp, Filter, Send, Activity, Zap,
  Loader2, CheckCircle2, AlertCircle, Clock,
} from 'lucide-react';
import { PageHeader, StatCard, GradientCard, ActionCard, SectionHeader, EmptyState } from '../components/UI';
import { ServerSelector } from '../components/ServerSelector';
import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiCall } from '../lib/api';

interface DbStats {
  totalRows: string;
  totalBytes: string;
  tableCount: string;
  queriesToday: string;
}

interface IngestionStats {
  total_jobs: string;
  total_rows: string;
  total_bytes: string;
  pending: string;
}

interface IngestionJob {
  id: string;
  file_name: string;
  status: string;
  rows_ingested: string;
  started_at: string;
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

const statusColors: Record<string, string> = {
  complete: '#22c55e',
  ingesting: '#3b82f6',
  downloading: '#f59e0b',
  uploading: '#8b5cf6',
  pending: '#6b7280',
  failed: '#ef4444',
};

export default function DashboardPage() {
  const navigate = useNavigate();
  const [dbStats, setDbStats] = useState<DbStats | null>(null);
  const [ingestionStats, setIngestionStats] = useState<IngestionStats | null>(null);
  const [recentJobs, setRecentJobs] = useState<IngestionJob[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [db, ing, jobs] = await Promise.all([
        apiCall<DbStats>('/api/database/stats').catch(() => null),
        apiCall<IngestionStats>('/api/ingestion/stats').catch(() => null),
        apiCall<IngestionJob[]>('/api/ingestion/jobs').catch(() => []),
      ]);
      setDbStats(db);
      setIngestionStats(ing);
      setRecentJobs(jobs.slice(0, 8));
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  const totalLeads = Number(dbStats?.totalRows || 0);
  const totalBytes = Number(dbStats?.totalBytes || 0);
  const pendingJobs = Number(ingestionStats?.pending || 0);

  return (
    <>
      <PageHeader
        title="Intelligence Hub"
        sub="Monitor your lead database, mailing queue, and recent verification batches."
        action={<ServerSelector type="clickhouse" />}
      />

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20, marginBottom: 36 }}>
        <GradientCard
          label="Total Clean Leads"
          value={loading ? '...' : formatNumber(totalLeads)}
          sub={`${formatBytes(totalBytes)} on SSD`}
          progress={Math.min(totalLeads / 10_000_000, 1)}
          progressLabel={`${formatNumber(totalLeads)} of 10M capacity`}
          icon={<Zap size={28} />}
        />
        <StatCard
          label="Pending Jobs"
          value={loading ? '...' : String(pendingJobs)}
          sub={pendingJobs > 0 ? 'Ingestion in progress' : 'No active jobs'}
          icon={<ShieldCheck size={18} />}
          color="var(--green)"
          colorMuted="var(--green-muted)"
          delay={0.06}
        />
        <StatCard
          label="Active Tables"
          value={loading ? '...' : formatNumber(dbStats?.tableCount || '0')}
          sub={`${formatNumber(dbStats?.queriesToday || '0')} queries today`}
          icon={<Filter size={18} />}
          color="var(--blue)"
          colorMuted="var(--blue-muted)"
          delay={0.12}
        />
      </div>

      {/* Quick actions */}
      <SectionHeader title="Quick Actions" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12, marginBottom: 36 }}>
        <ActionCard title="Start S3 Ingestion" sub="Download latest 5x5 Co-Op data" icon={<CloudDownload size={18} />} color="var(--accent)" colorMuted="var(--accent-muted)" delay={0.06} onClick={() => navigate('/ingestion')} />
        <ActionCard title="Query ClickHouse" sub="Run segment queries on lead data" icon={<Database size={18} />} color="var(--blue)" colorMuted="var(--blue-muted)" delay={0.12} onClick={() => navigate('/database')} />
        <ActionCard title="Create Segment" sub="Filter leads by industry, state, title" icon={<Filter size={18} />} color="var(--green)" colorMuted="var(--green-muted)" delay={0.18} onClick={() => navigate('/segments')} />
        <ActionCard title="Verify Emails" sub="Batch-verify extracted segments" icon={<ShieldCheck size={18} />} color="var(--purple)" colorMuted="var(--purple-muted)" delay={0.24} onClick={() => navigate('/verification')} />
        <ActionCard title="Export Targets" sub="Download clean lists as CSV" icon={<Send size={18} />} color="var(--cyan)" colorMuted="var(--cyan-muted)" delay={0.30} onClick={() => navigate('/targets')} />
        <ActionCard title="View Pipeline" sub="Ingestion rates, verification yield" icon={<TrendingUp size={18} />} color="var(--yellow)" colorMuted="var(--yellow-muted)" delay={0.36} onClick={() => navigate('/ingestion')} />
      </div>

      {/* Pipeline Activity */}
      <SectionHeader title="Recent Pipeline Activity" action="View All" onAction={() => navigate('/ingestion')} />
      <div
        className="animate-fadeIn stagger-5"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}
      >
        {recentJobs.length > 0 ? (
          <div style={{ padding: 8 }}>
            {recentJobs.map((job) => (
              <div
                key={job.id}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '12px 18px', borderRadius: 10, marginBottom: 4,
                  transition: 'background 0.15s',
                }}
                onMouseOver={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                onMouseOut={e => (e.currentTarget.style.background = '')}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                  {job.status === 'complete' ? <CheckCircle2 size={16} color="#22c55e" /> :
                   job.status === 'failed' ? <AlertCircle size={16} color="#ef4444" /> :
                   job.status === 'pending' ? <Clock size={16} color="#6b7280" /> :
                   <Loader2 size={16} color="#3b82f6" className="spin" />}
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{job.file_name}</div>
                    <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                      {formatNumber(job.rows_ingested)} rows · {timeAgo(job.started_at)}
                    </div>
                  </div>
                </div>
                <span style={{
                  fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                  padding: '4px 10px', borderRadius: 6,
                  color: statusColors[job.status] || '#6b7280',
                  background: (statusColors[job.status] || '#6b7280') + '18',
                }}>
                  {job.status}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<Activity size={24} />}
            title={loading ? 'Loading...' : 'No pipeline activity yet'}
            sub="Start an S3 ingestion to see jobs here"
          />
        )}
      </div>
    </>
  );
}
