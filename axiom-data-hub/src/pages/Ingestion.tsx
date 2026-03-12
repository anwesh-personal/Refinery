import { CloudDownload, FolderSync, HardDrive, Clock, Plus, RefreshCw } from 'lucide-react';
import { PageHeader, StatCard, SectionHeader, DataTable, Button, Input } from '../components/UI';
import { ServerSelector } from '../components/ServerSelector';

export default function IngestionPage() {
  return (
    <>
      <PageHeader 
        title="S3 Ingestion" 
        sub="Manage data downloads from the 5x5 Co-Op S3 buckets to your ClickHouse server." 
        action={<ServerSelector type="clickhouse" />}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20, marginBottom: 36 }}>
        <StatCard label="Pending Files" value="0" sub="Awaiting download" icon={<Clock size={18} />} color="var(--yellow)" colorMuted="var(--yellow-muted)" delay={0.06} />
        <StatCard label="Downloaded" value="0" sub="Total files ingested" icon={<CloudDownload size={18} />} color="var(--green)" colorMuted="var(--green-muted)" delay={0.12} />
        <StatCard label="Storage Used" value="0 GB" sub="of 1 TB on Linode" icon={<HardDrive size={18} />} color="var(--blue)" colorMuted="var(--blue-muted)" delay={0.18} />
        <StatCard label="Last Sync" value="Never" sub="No sync yet" icon={<FolderSync size={18} />} color="var(--purple)" colorMuted="var(--purple-muted)" delay={0.24} />
      </div>

      <SectionHeader title="S3 Source Configuration" />
      <div
        className="animate-fadeIn stagger-4"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: 28, marginBottom: 36 }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, marginBottom: 24 }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', display: 'block', marginBottom: 8 }}>Bucket Name</label>
            <Input placeholder="e.g. 5x5-coop-leads-2026" />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', display: 'block', marginBottom: 8 }}>AWS Region</label>
            <Input placeholder="e.g. us-east-1" />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', display: 'block', marginBottom: 8 }}>Access Key ID</label>
            <Input placeholder="AKIA..." type="password" />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', display: 'block', marginBottom: 8 }}>Secret Access Key</label>
            <Input placeholder="••••••••" type="password" />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Button icon={<Plus size={14} />}>Save Source</Button>
          <Button variant="secondary" icon={<RefreshCw size={14} />}>Test Connection</Button>
        </div>
      </div>

      <SectionHeader title="Ingestion Jobs" action="Start New Job" />
      <DataTable
        columns={[
          { key: 'id', label: 'Job ID', width: '15%' },
          { key: 'source', label: 'Source Bucket' },
          { key: 'files', label: 'Files' },
          { key: 'size', label: 'Total Size' },
          { key: 'status', label: 'Status' },
          { key: 'started', label: 'Started' },
        ]}
        rows={[]}
        emptyIcon={<CloudDownload size={24} />}
        emptyTitle="No ingestion jobs yet"
        emptySub="Configure an S3 source and start your first download"
      />
    </>
  );
}
