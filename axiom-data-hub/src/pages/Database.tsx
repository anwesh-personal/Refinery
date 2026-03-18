import { Database, Table2, Rows3, HardDrive, Play, Copy, Download, RefreshCw, Loader2, AlertCircle, CheckCircle2, ChevronDown, ChevronUp } from 'lucide-react';
import { PageHeader, StatCard, SectionHeader, Button } from '../components/UI';
import { useState, useEffect, useCallback } from 'react';
import { ServerSelector } from '../components/ServerSelector';
import { apiCall } from '../lib/api';

interface DbStats {
  totalRows: string;
  totalBytes: string;
  tableCount: string;
  queriesToday: string;
}

interface TableInfo {
  table: string;
  rows: string;
  bytes_on_disk: string;
  last_modified: string;
}

interface QueryResult {
  rows: Record<string, unknown>[];
  elapsed: number;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatNumber(n: string | number): string {
  return Number(n).toLocaleString();
}

export default function DatabasePage() {
  const [query, setQuery] = useState('SELECT * FROM universal_person LIMIT 100');
  const [stats, setStats] = useState<DbStats | null>(null);
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [result, setResult] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [statsLoading, setStatsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showTables, setShowTables] = useState(false);
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const fetchStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const [s, t] = await Promise.all([
        apiCall<DbStats>('/api/database/stats'),
        apiCall<TableInfo[]>('/api/database/tables'),
      ]);
      setStats(s);
      setTables(t);
    } catch (e: any) {
      console.error('Stats fetch failed:', e.message);
    } finally {
      setStatsLoading(false);
    }
  }, []);

  useEffect(() => { fetchStats(); }, [fetchStats]);

  const executeQuery = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setError(null);
    setSuccess(null);
    setResult(null);
    setSortCol(null);
    try {
      const res = await apiCall<QueryResult>('/api/database/query', {
        method: 'POST',
        body: { sql: query },
      });
      setResult(res);
      setSuccess(`${res.rows.length} rows returned in ${res.elapsed}ms`);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      executeQuery();
    }
  };

  const copySQL = () => {
    navigator.clipboard.writeText(query);
    setSuccess('SQL copied to clipboard');
    setTimeout(() => setSuccess(null), 2000);
  };

  const downloadCSV = () => {
    if (!result?.rows.length) return;
    const cols = Object.keys(result.rows[0]);
    const csv = [
      cols.join(','),
      ...result.rows.map(r => cols.map(c => {
        const val = String(r[c] ?? '');
        return val.includes(',') || val.includes('"') || val.includes('\n')
          ? `"${val.replace(/"/g, '""')}"` : val;
      }).join(','))
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `query_result_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const insertTableQuery = (tableName: string) => {
    setQuery(`SELECT * FROM ${tableName} LIMIT 100`);
  };

  // Sorting
  const columns = result?.rows.length ? Object.keys(result.rows[0]) : [];
  const sortedRows = result?.rows ? [...result.rows].sort((a, b) => {
    if (!sortCol) return 0;
    const aVal = String(a[sortCol] ?? '');
    const bVal = String(b[sortCol] ?? '');
    const numA = Number(aVal), numB = Number(bVal);
    if (!isNaN(numA) && !isNaN(numB)) return sortDir === 'asc' ? numA - numB : numB - numA;
    return sortDir === 'asc' ? aVal.localeCompare(bVal) : bVal.localeCompare(aVal);
  }) : [];

  const toggleSort = (col: string) => {
    if (sortCol === col) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    } else {
      setSortCol(col);
      setSortDir('asc');
    }
  };

  return (
    <>
      <PageHeader
        title="ClickHouse"
        sub="Query, inspect, and manage your lead database directly."
        action={<ServerSelector type="clickhouse" />}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20, marginBottom: 36 }}>
        <StatCard
          label="Total Rows"
          value={statsLoading ? '...' : formatNumber(stats?.totalRows || '0')}
          sub="Leads in database"
          icon={<Rows3 size={18} />}
          color="var(--blue)" colorMuted="var(--blue-muted)" delay={0.06}
        />
        <StatCard
          label="Tables"
          value={statsLoading ? '...' : formatNumber(stats?.tableCount || '0')}
          sub="Active tables"
          icon={<Table2 size={18} />}
          color="var(--purple)" colorMuted="var(--purple-muted)" delay={0.12}
        />
        <StatCard
          label="DB Size"
          value={statsLoading ? '...' : formatBytes(Number(stats?.totalBytes || 0))}
          sub="on SSD"
          icon={<HardDrive size={18} />}
          color="var(--cyan)" colorMuted="var(--cyan-muted)" delay={0.18}
        />
        <StatCard
          label="Queries Today"
          value={statsLoading ? '...' : formatNumber(stats?.queriesToday || '0')}
          sub="Executed queries"
          icon={<Database size={18} />}
          color="var(--accent)" colorMuted="var(--accent-muted)" delay={0.24}
        />
      </div>

      {/* Tables Browser */}
      {tables.length > 0 && (
        <>
          <div
            className="animate-fadeIn stagger-3"
            style={{
              background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16,
              marginBottom: 24, overflow: 'hidden',
            }}
          >
            <div
              onClick={() => setShowTables(!showTables)}
              style={{
                padding: '16px 24px', cursor: 'pointer', display: 'flex', alignItems: 'center',
                justifyContent: 'space-between', userSelect: 'none',
              }}
            >
              <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>
                📋 Tables ({tables.length})
              </span>
              {showTables ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
            </div>
            {showTables && (
              <div style={{ padding: '0 24px 16px' }}>
                {tables.map(t => (
                  <div
                    key={t.table}
                    onClick={() => insertTableQuery(t.table)}
                    style={{
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      padding: '10px 14px', borderRadius: 10, cursor: 'pointer',
                      border: '1px solid var(--border)', marginBottom: 6,
                      transition: 'all 0.15s',
                    }}
                    onMouseOver={e => {
                      (e.currentTarget as HTMLElement).style.background = 'var(--bg-hover)';
                      (e.currentTarget as HTMLElement).style.borderColor = 'var(--accent)';
                    }}
                    onMouseOut={e => {
                      (e.currentTarget as HTMLElement).style.background = '';
                      (e.currentTarget as HTMLElement).style.borderColor = 'var(--border)';
                    }}
                  >
                    <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 600 }}>{t.table}</span>
                    <span style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
                      {formatNumber(t.rows)} rows · {formatBytes(Number(t.bytes_on_disk))}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}

      <SectionHeader title="SQL Query Editor" />
      <div
        className="animate-fadeIn stagger-4"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: 28, marginBottom: 36 }}
      >
        <textarea
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={6}
          placeholder="SELECT * FROM universal_person WHERE personal_state = 'CA' LIMIT 100"
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
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
          <Button icon={loading ? <Loader2 size={14} className="spin" /> : <Play size={14} />} onClick={executeQuery} disabled={loading}>
            {loading ? 'Running...' : 'Execute (⌘+Enter)'}
          </Button>
          <Button variant="ghost" icon={<Copy size={14} />} onClick={copySQL}>Copy SQL</Button>
          {result?.rows.length ? (
            <Button variant="ghost" icon={<Download size={14} />} onClick={downloadCSV}>
              Download CSV ({result.rows.length} rows)
            </Button>
          ) : null}
          <Button variant="ghost" icon={<RefreshCw size={14} />} onClick={fetchStats}>Refresh Stats</Button>
        </div>

        {/* Status messages */}
        {error && (
          <div style={{
            marginTop: 16, padding: '12px 18px', borderRadius: 10,
            background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)',
            display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: '#ef4444',
          }}>
            <AlertCircle size={16} /> {error}
          </div>
        )}
        {success && (
          <div style={{
            marginTop: 16, padding: '12px 18px', borderRadius: 10,
            background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)',
            display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: '#22c55e',
          }}>
            <CheckCircle2 size={16} /> {success}
          </div>
        )}
      </div>

      {/* Results Table */}
      <SectionHeader title={result ? `Query Results (${result.rows.length} rows · ${result.elapsed}ms)` : 'Query Results'} />
      <div style={{
        background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16,
        overflow: 'hidden',
      }}>
        {sortedRows.length > 0 ? (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  {columns.map(col => (
                    <th
                      key={col}
                      onClick={() => toggleSort(col)}
                      style={{
                        padding: '12px 16px', textAlign: 'left', fontWeight: 700,
                        fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em',
                        color: 'var(--text-tertiary)', borderBottom: '1px solid var(--border)',
                        cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
                        background: sortCol === col ? 'var(--bg-hover)' : 'transparent',
                      }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        {col}
                        {sortCol === col && (sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row, i) => (
                  <tr
                    key={i}
                    style={{ transition: 'background 0.1s' }}
                    onMouseOver={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                    onMouseOut={e => (e.currentTarget.style.background = '')}
                  >
                    {columns.map(col => (
                      <td
                        key={col}
                        style={{
                          padding: '10px 16px', borderBottom: '1px solid var(--border)',
                          maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap', color: 'var(--text-secondary)',
                        }}
                        title={String(row[col] ?? '')}
                      >
                        {row[col] === null || row[col] === undefined ? (
                          <span style={{ color: 'var(--text-tertiary)', fontStyle: 'italic' }}>NULL</span>
                        ) : (
                          String(row[col])
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{
            padding: 48, textAlign: 'center', color: 'var(--text-tertiary)',
          }}>
            <Database size={24} style={{ marginBottom: 12, opacity: 0.4 }} />
            <div style={{ fontWeight: 600 }}>No results</div>
            <div style={{ fontSize: 13, marginTop: 4 }}>Execute a query to see results here</div>
          </div>
        )}
      </div>
    </>
  );
}
