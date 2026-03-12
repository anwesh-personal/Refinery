import { ScrollText, Trash2 } from 'lucide-react';
import { PageHeader, Button, EmptyState } from '../components/UI';

const LOG_LEVELS = [
  { label: 'All', active: true },
  { label: 'Info', active: false },
  { label: 'Warning', active: false },
  { label: 'Error', active: false },
];

export default function LogsPage() {
  return (
    <>
      <PageHeader title="Daemon Logs" sub="Real-time logs from the background pipeline daemon on your Linode server." />

      {/* Filters */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24, flexWrap: 'wrap' }}>
        {LOG_LEVELS.map((level) => (
          <button
            key={level.label}
            style={{
              padding: '8px 18px', borderRadius: 12,
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
              background: level.active ? 'var(--accent-muted)' : 'var(--bg-card)',
              color: level.active ? 'var(--accent)' : 'var(--text-tertiary)',
              border: `1px solid ${level.active ? 'var(--accent)' : 'var(--border)'}`,
              transition: 'all 0.2s',
            }}
          >
            {level.label}
          </button>
        ))}
        <div style={{ marginLeft: 'auto' }}>
          <Button variant="danger" icon={<Trash2 size={14} />}>Clear Logs</Button>
        </div>
      </div>

      {/* Log viewer */}
      <div
        className="animate-fadeIn"
        style={{
          background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: 28, fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            fontSize: 12, minHeight: 400, maxHeight: 600,
            overflowY: 'auto', color: 'var(--text-secondary)',
          }}
        >
          <EmptyState
            icon={<ScrollText size={24} />}
            title="No log entries"
            sub="Daemon logs will appear here in real-time when jobs are running"
          />
        </div>
      </div>
    </>
  );
}
