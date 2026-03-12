import {
  CloudDownload, Database, ShieldCheck, TrendingUp, Filter, Send, Activity, Zap, ServerCrash,
} from 'lucide-react';
import { GradientCard, StatCard, ActionCard, SectionHeader, EmptyState, PageHeader } from '../components/UI';

export default function DashboardPage() {
  return (
    <>
      <PageHeader title="Pipeline Overview" sub="Monitor your entire data pipeline from ingestion to delivery." />

      {/* Stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20, marginBottom: 36 }}>
        <GradientCard
          label="Total Clean Leads"
          value="0"
          sub="↗ +0 this month"
          progress={0}
          progressLabel="0 of 10M capacity"
          icon={<Zap size={28} />}
        />
        <StatCard
          label="Verify550 Yield"
          value="—"
          sub="No batches processed yet"
          icon={<ShieldCheck size={18} />}
          color="var(--green)"
          colorMuted="var(--green-muted)"
          delay={0.06}
        />
        <StatCard
          label="Active Segments"
          value="0"
          sub="Create your first niche segment"
          icon={<Filter size={18} />}
          color="var(--blue)"
          colorMuted="var(--blue-muted)"
          delay={0.12}
        />
      </div>

      {/* Quick actions */}
      <SectionHeader title="Quick Actions" />
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 12, marginBottom: 36 }}>
        <ActionCard title="Start S3 Ingestion" sub="Download latest 5x5 Co-Op data" icon={<CloudDownload size={18} />} color="var(--accent)" colorMuted="var(--accent-muted)" delay={0.06} />
        <ActionCard title="Query ClickHouse" sub="Run segment queries on lead data" icon={<Database size={18} />} color="var(--blue)" colorMuted="var(--blue-muted)" delay={0.12} />
        <ActionCard title="Send to Verify550" sub="Batch-verify extracted segments" icon={<ShieldCheck size={18} />} color="var(--green)" colorMuted="var(--green-muted)" delay={0.18} />
        <ActionCard title="Push to Mailer" sub="Export clean list to email server" icon={<Send size={18} />} color="var(--purple)" colorMuted="var(--purple-muted)" delay={0.24} />
        <ActionCard title="View Pipeline Stats" sub="Ingestion rates, verification yield" icon={<TrendingUp size={18} />} color="var(--cyan)" colorMuted="var(--cyan-muted)" delay={0.30} />
        <ActionCard title="Check Failures" sub="Review failed jobs and retries" icon={<ServerCrash size={18} />} color="var(--red)" colorMuted="var(--red-muted)" delay={0.36} />
      </div>

      {/* Activity log */}
      <SectionHeader title="Recent Pipeline Activity" action="View All" />
      <div
        className="animate-fadeIn stagger-5"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16 }}
      >
        <EmptyState
          icon={<Activity size={24} />}
          title="No pipeline activity yet"
          sub="Start an S3 ingestion to see jobs here"
        />
      </div>
    </>
  );
}
