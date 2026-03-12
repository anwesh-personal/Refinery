import { Database, Table2, Rows3, HardDrive, Play, Copy } from 'lucide-react';
import { PageHeader, StatCard, SectionHeader, DataTable, Button } from '../components/UI';
import { useState } from 'react';

export default function DatabasePage() {
  const [query, setQuery] = useState('SELECT * FROM leads LIMIT 100;');

  return (
    <>
      <PageHeader title="ClickHouse" sub="Query, inspect, and manage your lead database directly." />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20, marginBottom: 36 }}>
        <StatCard label="Total Rows" value="0" sub="Leads in database" icon={<Rows3 size={18} />} color="var(--blue)" colorMuted="var(--blue-muted)" delay={0.06} />
        <StatCard label="Tables" value="0" sub="Active tables" icon={<Table2 size={18} />} color="var(--purple)" colorMuted="var(--purple-muted)" delay={0.12} />
        <StatCard label="DB Size" value="0 GB" sub="on disk" icon={<HardDrive size={18} />} color="var(--cyan)" colorMuted="var(--cyan-muted)" delay={0.18} />
        <StatCard label="Queries Today" value="0" sub="Executed queries" icon={<Database size={18} />} color="var(--accent)" colorMuted="var(--accent-muted)" delay={0.24} />
      </div>

      <SectionHeader title="SQL Query Editor" />
      <div
        className="animate-fadeIn stagger-4"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: 28, marginBottom: 36 }}
      >
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          rows={6}
          style={{
            width: '100%', padding: '14px 18px', borderRadius: 12,
            fontSize: 13, fontFamily: "'JetBrains Mono', 'Fira Code', monospace", fontWeight: 500,
            outline: 'none', resize: 'vertical',
            background: 'var(--bg-input)', border: '1px solid var(--border)',
            color: 'var(--text-primary)', transition: 'border-color 0.2s',
            marginBottom: 16,
          }}
          onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
          onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; }}
        />
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <Button icon={<Play size={14} />}>Execute Query</Button>
          <Button variant="ghost" icon={<Copy size={14} />}>Copy SQL</Button>
        </div>
      </div>

      <SectionHeader title="Query Results" />
      <DataTable
        columns={[
          { key: 'col1', label: 'Column 1' },
          { key: 'col2', label: 'Column 2' },
          { key: 'col3', label: 'Column 3' },
        ]}
        rows={[]}
        emptyIcon={<Database size={24} />}
        emptyTitle="No results"
        emptySub="Execute a query to see results here"
      />
    </>
  );
}
