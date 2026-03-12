import { ShieldCheck, CheckCircle, XCircle, Clock, Upload, RefreshCw } from 'lucide-react';
import { PageHeader, StatCard, SectionHeader, DataTable, Button, Input } from '../components/UI';

export default function VerificationPage() {
  return (
    <>
      <PageHeader title="Verification" sub="Clean and verify lead data through Verify550 before mailing." />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20, marginBottom: 36 }}>
        <StatCard label="Verified" value="0" sub="Clean leads ready" icon={<CheckCircle size={18} />} color="var(--green)" colorMuted="var(--green-muted)" delay={0.06} />
        <StatCard label="Bounced" value="0" sub="Invalid emails removed" icon={<XCircle size={18} />} color="var(--red)" colorMuted="var(--red-muted)" delay={0.12} />
        <StatCard label="Pending" value="0" sub="Awaiting verification" icon={<Clock size={18} />} color="var(--yellow)" colorMuted="var(--yellow-muted)" delay={0.18} />
        <StatCard label="Yield Rate" value="—" sub="No data yet" icon={<ShieldCheck size={18} />} color="var(--blue)" colorMuted="var(--blue-muted)" delay={0.24} />
      </div>

      <SectionHeader title="Verify550 API Configuration" />
      <div
        className="animate-fadeIn stagger-4"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: 28, marginBottom: 36 }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, marginBottom: 24 }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', display: 'block', marginBottom: 8 }}>API Endpoint</label>
            <Input placeholder="https://api.verify550.com/v1" />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', display: 'block', marginBottom: 8 }}>API Key</label>
            <Input placeholder="v550-key-..." type="password" />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', display: 'block', marginBottom: 8 }}>Batch Size</label>
            <Input placeholder="e.g. 5000" />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', display: 'block', marginBottom: 8 }}>Concurrency Limit</label>
            <Input placeholder="e.g. 3" />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Button icon={<Upload size={14} />}>Save Config</Button>
          <Button variant="secondary" icon={<RefreshCw size={14} />}>Test API</Button>
        </div>
      </div>

      <SectionHeader title="Verification Batches" action="Start New Batch" />
      <DataTable
        columns={[
          { key: 'id', label: 'Batch ID' },
          { key: 'segment', label: 'Segment' },
          { key: 'total', label: 'Total Leads' },
          { key: 'verified', label: 'Verified' },
          { key: 'bounced', label: 'Bounced' },
          { key: 'status', label: 'Status' },
        ]}
        rows={[]}
        emptyIcon={<ShieldCheck size={24} />}
        emptyTitle="No verification batches"
        emptySub="Configure the Verify550 API and start a batch"
      />
    </>
  );
}
