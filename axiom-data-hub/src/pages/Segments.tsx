import { Filter, Plus, Layers, Users, Tag } from 'lucide-react';
import { PageHeader, StatCard, SectionHeader, DataTable, Button, Input } from '../components/UI';
import { ServerSelector } from '../components/ServerSelector';

export default function SegmentsPage() {
  return (
    <>
      <PageHeader 
        title="Segments" 
        sub="Create and manage lead segmentation rules for niche-based routing." 
        action={<ServerSelector type="clickhouse" />}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 20, marginBottom: 36 }}>
        <StatCard label="Total Segments" value="0" sub="Active niche segments" icon={<Filter size={18} />} color="var(--blue)" colorMuted="var(--blue-muted)" delay={0.06} />
        <StatCard label="Leads Segmented" value="0" sub="Assigned to niches" icon={<Users size={18} />} color="var(--green)" colorMuted="var(--green-muted)" delay={0.12} />
        <StatCard label="Unassigned" value="0" sub="Leads without a segment" icon={<Layers size={18} />} color="var(--yellow)" colorMuted="var(--yellow-muted)" delay={0.18} />
      </div>

      <SectionHeader title="New Segment" />
      <div
        className="animate-fadeIn stagger-3"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: 28, marginBottom: 36 }}
      >
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 20 }}>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', display: 'block', marginBottom: 8 }}>Segment Name</label>
            <Input placeholder="e.g. Real Estate — Texas" />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', display: 'block', marginBottom: 8 }}>Niche</label>
            <Input placeholder="e.g. Real Estate" />
          </div>
          <div>
            <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', display: 'block', marginBottom: 8 }}>Assigned Client</label>
            <Input placeholder="e.g. Client A" />
          </div>
        </div>
        <div style={{ marginBottom: 20 }}>
          <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', display: 'block', marginBottom: 8 }}>Filter Query (WHERE clause)</label>
          <textarea
            rows={3}
            placeholder="e.g. niche = 'real_estate' AND state = 'TX'"
            style={{
              width: '100%', padding: '12px 16px', borderRadius: 12,
              fontSize: 13, fontFamily: "'JetBrains Mono', monospace", fontWeight: 500,
              outline: 'none', resize: 'vertical',
              background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)',
            }}
          />
        </div>
        <Button icon={<Plus size={14} />}>Create Segment</Button>
      </div>

      <SectionHeader title="Saved Segments" />
      <DataTable
        columns={[
          { key: 'name', label: 'Segment Name' },
          { key: 'niche', label: 'Niche' },
          { key: 'client', label: 'Client' },
          { key: 'leads', label: 'Leads' },
          { key: 'status', label: 'Status' },
        ]}
        rows={[]}
        emptyIcon={<Tag size={24} />}
        emptyTitle="No segments created"
        emptySub="Create your first niche segment above"
      />
    </>
  );
}
