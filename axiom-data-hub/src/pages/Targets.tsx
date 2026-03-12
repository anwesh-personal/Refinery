import { Send, Users, Plus, FileDown } from 'lucide-react';
import { PageHeader, StatCard, SectionHeader, DataTable, Button, Input } from '../components/UI';

export default function TargetsPage() {
  return (
    <>
      <PageHeader title="Email Targets" sub="Manage client target lists and export verified leads for mailing." />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 20, marginBottom: 36 }}>
        <StatCard label="Target Lists" value="0" sub="Client-specific lists" icon={<Send size={18} />} color="var(--accent)" colorMuted="var(--accent-muted)" delay={0.06} />
        <StatCard label="Total Targets" value="0" sub="Email addresses" icon={<Users size={18} />} color="var(--green)" colorMuted="var(--green-muted)" delay={0.12} />
        <StatCard label="Exported" value="0" sub="Downloaded as CSV/XLSX" icon={<FileDown size={18} />} color="var(--purple)" colorMuted="var(--purple-muted)" delay={0.18} />
      </div>

      <SectionHeader title="New Target List" />
      <div
        className="animate-fadeIn stagger-3"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: 28, marginBottom: 36 }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: 16, marginBottom: 24 }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', display: 'block', marginBottom: 8 }}>List Name</label>
            <Input placeholder="e.g. Client A — March 2026" />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', display: 'block', marginBottom: 8 }}>Source Segment</label>
            <Input placeholder="Select a verified segment..." />
          </div>
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Button icon={<Plus size={14} />}>Create List</Button>
          <Button variant="ghost" icon={<FileDown size={14} />}>Export Sample</Button>
        </div>
      </div>

      <SectionHeader title="Saved Target Lists" />
      <DataTable
        columns={[
          { key: 'name', label: 'List Name' },
          { key: 'segment', label: 'Source Segment' },
          { key: 'count', label: 'Emails' },
          { key: 'exported', label: 'Exported' },
          { key: 'created', label: 'Created' },
        ]}
        rows={[]}
        emptyIcon={<Send size={24} />}
        emptyTitle="No target lists"
        emptySub="Create a target list from verified segments"
      />
    </>
  );
}
