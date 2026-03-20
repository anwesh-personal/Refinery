import { ScrollText, Trash2, RefreshCw, Search, AlertCircle, Loader2, FileText, HardDrive } from 'lucide-react';
import { PageHeader, Button } from '../components/UI';
import { useState, useEffect, useCallback } from 'react';
import { apiCall } from '../lib/api';

/* ── Types ── */
interface LogEntry {
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'debug';
  message: string;
  source: string;
}

interface LogFile {
  name: string;
  path: string;
  size: number;
  modified: string;
}

type LevelFilter = 'all' | 'info' | 'warn' | 'error' | 'debug';

const LEVEL_CONFIG: Record<string, { color: string; bg: string; label: string }> = {
  info: { color: 'var(--blue)', bg: 'var(--blue-muted)', label: 'INFO' },
  warn: { color: 'var(--yellow)', bg: 'var(--yellow-muted)', label: 'WARN' },
  error: { color: 'var(--red)', bg: 'var(--red-muted)', label: 'ERROR' },
  debug: { color: 'var(--text-tertiary)', bg: 'var(--bg-elevated)', label: 'DEBUG' },
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

export default function LogsPage() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [files, setFiles] = useState<LogFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [clearing, setClearing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [level, setLevel] = useState<LevelFilter>('all');
  const [search, setSearch] = useState('');
  const [lineCount, setLineCount] = useState(200);

  const fetchLogs = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const params = new URLSearchParams({ lines: String(lineCount) });
      if (level !== 'all') params.set('level', level);
      if (search.trim()) params.set('search', search.trim());

      const [logData, fileData] = await Promise.all([
        apiCall<LogEntry[]>(`/api/logs?${params.toString()}`),
        apiCall<LogFile[]>('/api/logs/files'),
      ]);
      setEntries(logData);
      setFiles(fileData);
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
    if (!silent) setLoading(false);
  }, [level, search, lineCount]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  // Auto-refresh every 5 seconds
  useEffect(() => {
    const interval = setInterval(() => fetchLogs(true), 5000);
    return () => clearInterval(interval);
  }, [fetchLogs]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchLogs(true);
    setTimeout(() => setRefreshing(false), 500);
  };

  const clearFile = async (fileName: string) => {
    if (!confirm(`Clear all contents of ${fileName}?`)) return;
    setClearing(fileName);
    try {
      await apiCall('/api/logs/clear', { method: 'POST', body: { fileName } });
      fetchLogs(true);
    } catch (e: any) {
      setError(e.message);
    }
    setClearing(null);
  };

  const levels: { key: LevelFilter; label: string }[] = [
    { key: 'all', label: 'All' },
    { key: 'info', label: 'Info' },
    { key: 'warn', label: 'Warning' },
    { key: 'error', label: 'Error' },
    { key: 'debug', label: 'Debug' },
  ];

  const errorCount = entries.filter(e => e.level === 'error').length;
  const warnCount = entries.filter(e => e.level === 'warn').length;

  return (
    <>
      <PageHeader
        title="Daemon Logs"
        sub="Real-time logs from the background pipeline daemon on your dedicated server."
        description="Tailing PM2 log files for real-time monitoring. Logs auto-refresh every 5 seconds. Use level filters and search to find specific events. Clear individual log files when they grow too large."
      />

      {/* Log files summary */}
      {files.length > 0 && (
        <div className="animate-fadeIn" style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 12, marginBottom: 24,
        }}>
          {files.map(f => (
            <div key={f.name} style={{
              background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12,
              padding: '14px 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <FileText size={14} style={{ color: 'var(--text-tertiary)' }} />
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>{f.name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                    {formatBytes(f.size)}
                  </div>
                </div>
              </div>
              <button
                onClick={() => clearFile(f.name)}
                disabled={clearing !== null}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--text-tertiary)', padding: 4, borderRadius: 6,
                  transition: 'color 0.2s',
                }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--red)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-tertiary)')}
                title={`Clear ${f.name}`}
              >
                {clearing === f.name ? <Loader2 size={14} className="spin" /> : <Trash2 size={14} />}
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Error alert */}
      {error && (
        <div style={{ marginBottom: 16, padding: '12px 18px', borderRadius: 10, background: 'var(--red-muted)', border: '1px solid var(--red)', display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--red)' }}>
          <AlertCircle size={16} /> {error}
        </div>
      )}

      {/* Filters */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 24, flexWrap: 'wrap' }}>
        {levels.map(l => (
          <button
            key={l.key}
            onClick={() => setLevel(l.key)}
            style={{
              padding: '8px 18px', borderRadius: 12,
              fontSize: 12, fontWeight: 600, cursor: 'pointer',
              background: level === l.key ? 'var(--accent-muted)' : 'var(--bg-card)',
              color: level === l.key ? 'var(--accent)' : 'var(--text-tertiary)',
              border: `1px solid ${level === l.key ? 'var(--accent)' : 'var(--border)'}`,
              transition: 'all 0.2s',
            }}
          >
            {l.label}
            {l.key === 'error' && errorCount > 0 && (
              <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: 'var(--red)' }}>({errorCount})</span>
            )}
            {l.key === 'warn' && warnCount > 0 && (
              <span style={{ marginLeft: 6, fontSize: 10, fontWeight: 700, color: 'var(--yellow)' }}>({warnCount})</span>
            )}
          </button>
        ))}

        {/* Search */}
        <div style={{ position: 'relative', marginLeft: 'auto' }}>
          <Search size={14} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
          <input
            type="text"
            placeholder="Search logs..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{
              padding: '8px 14px 8px 34px', borderRadius: 12, fontSize: 12, fontWeight: 500,
              background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)',
              outline: 'none', width: 200, transition: 'border-color 0.2s',
            }}
            onFocus={e => (e.currentTarget.style.borderColor = 'var(--accent)')}
            onBlur={e => (e.currentTarget.style.borderColor = 'var(--border)')}
          />
        </div>

        <Button variant="ghost" icon={<RefreshCw size={14} className={refreshing ? 'spin' : ''} />} onClick={handleRefresh}>
          Refresh
        </Button>
      </div>

      {/* Log viewer */}
      <div
        className="animate-fadeIn"
        style={{
          background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16,
          overflow: 'hidden',
        }}
      >
        {/* Header bar */}
        <div style={{
          padding: '12px 20px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          background: 'var(--bg-sidebar)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>
            <HardDrive size={14} />
            <span>{loading ? 'Loading...' : `${entries.length} entries`}</span>
            {entries.length > 0 && (
              <span style={{ color: 'var(--text-tertiary)', fontWeight: 500 }}>
                · last {lineCount} lines per file · auto-refresh 5s
              </span>
            )}
          </div>
          <select
            value={lineCount}
            onChange={e => setLineCount(Number(e.target.value))}
            style={{
              padding: '4px 8px', borderRadius: 6, fontSize: 11, fontWeight: 600,
              background: 'var(--bg-input)', border: '1px solid var(--border)',
              color: 'var(--text-secondary)', cursor: 'pointer', outline: 'none',
            }}
          >
            <option value={50}>50 lines</option>
            <option value={100}>100 lines</option>
            <option value={200}>200 lines</option>
            <option value={500}>500 lines</option>
          </select>
        </div>

        {/* Log entries */}
        <div
          style={{
            padding: '16px 20px',
            fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            fontSize: 12, minHeight: 300, maxHeight: 600,
            overflowY: 'auto', color: 'var(--text-secondary)',
          }}
        >
          {entries.length > 0 ? (
            entries.map((entry, i) => {
              const lc = LEVEL_CONFIG[entry.level] || LEVEL_CONFIG.info;
              return (
                <div
                  key={i}
                  style={{
                    padding: '4px 0', display: 'flex', gap: 10, alignItems: 'flex-start',
                    borderBottom: '1px solid var(--border)',
                    lineHeight: 1.6,
                  }}
                >
                  <span style={{ color: 'var(--text-tertiary)', whiteSpace: 'nowrap', flexShrink: 0, fontSize: 11 }}>
                    {entry.timestamp}
                  </span>
                  <span style={{
                    fontSize: 9, fontWeight: 800, padding: '2px 6px', borderRadius: 4,
                    color: lc.color, background: lc.bg, flexShrink: 0, letterSpacing: '0.05em',
                    lineHeight: '16px',
                  }}>
                    {lc.label}
                  </span>
                  <span style={{
                    fontSize: 10, color: 'var(--accent)', fontWeight: 600, flexShrink: 0,
                    padding: '1px 6px', borderRadius: 4, background: 'var(--accent-muted)',
                  }}>
                    {entry.source}
                  </span>
                  <span style={{ color: entry.level === 'error' ? 'var(--red)' : 'var(--text-secondary)', wordBreak: 'break-all' }}>
                    {entry.message}
                  </span>
                </div>
              );
            })
          ) : (
            <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-tertiary)' }}>
              <ScrollText size={24} style={{ marginBottom: 12, opacity: 0.4 }} />
              <div style={{ fontWeight: 600 }}>
                {loading ? 'Loading logs...' : 'No log entries'}
              </div>
              <div style={{ fontSize: 12, marginTop: 4 }}>
                {loading ? '' : 'Daemon logs will appear here when jobs are running'}
              </div>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
