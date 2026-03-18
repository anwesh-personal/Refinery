import {
  Database, Table2, Rows3, HardDrive, Play, Copy, Download, RefreshCw,
  Loader2, AlertCircle, CheckCircle2, ChevronDown, ChevronUp,
  Search, Columns, ChevronLeft, ChevronRight
} from 'lucide-react';
import { PageHeader, StatCard, Button } from '../components/UI';
import { useState, useEffect, useCallback, useRef } from 'react';
import { ServerSelector } from '../components/ServerSelector';
import { apiCall } from '../lib/api';

// --- Interfaces ---
interface DbStats { totalRows: string; totalBytes: string; tableCount: string; queriesToday: string; }
interface TableInfo { table: string; rows: string; bytes_on_disk: string; last_modified: string; }
interface QueryResult { rows: Record<string, unknown>[]; elapsed: number; total?: number; page?: number; pageSize?: number; }

// --- Helpers ---
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatNumber(n: string | number): string { return Number(n).toLocaleString(); }

// --- Main Component ---
export default function DatabasePage() {
  // Tabs: 'browse' or 'sql'
  const [activeTab, setActiveTab] = useState<'browse' | 'sql'>('browse');

  // Stats
  const [stats, setStats] = useState<DbStats | null>(null);
  const [tables, setTables] = useState<TableInfo[]>([]);
  const [statsLoading, setStatsLoading] = useState(true);

  // Common Result State
  const [result, setResult] = useState<QueryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  // --- SQL Editor State ---
  const [query, setQuery] = useState('SELECT * FROM universal_person LIMIT 100');
  const [showTables, setShowTables] = useState(false);

  // --- Browse (Data Explorer State) ---
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [showColPicker, setShowColPicker] = useState(false);
  const colPickerRef = useRef<HTMLDivElement>(null);
  const colPickerBtnRef = useRef<HTMLButtonElement>(null);
  
  // Available filters populated from backend limit 200
  const [filterOptions, setFilterOptions] = useState<Record<string, string[]>>({});
  
  // Dynamic columns from backend
  const [allColumns, setAllColumns] = useState<string[]>([]);
  const [availableFilters, setAvailableFilters] = useState<string[]>([]);
  const [visibleCols, setVisibleCols] = useState<Record<string, boolean>>({});
  const [columnsLoaded, setColumnsLoaded] = useState(false);

  // --- Data Fetching ---
  const fetchStats = useCallback(async () => {
    setStatsLoading(true);
    try {
      const [s, t] = await Promise.all([
        apiCall<DbStats>('/api/database/stats').catch(() => null),
        apiCall<TableInfo[]>('/api/database/tables').catch(() => []),
      ]);
      if (s) setStats(s);
      if (t) setTables(t);
    } catch { /* ignore */ }
    setStatsLoading(false);
  }, []);

  // Fetch columns and filters dynamically from backend
  const fetchColumns = useCallback(async () => {
    try {
      const [cols, filterCols] = await Promise.all([
        apiCall<string[]>('/api/database/columns').catch(() => []),
        apiCall<string[]>('/api/database/filterable-columns').catch(() => []),
      ]);
      setAllColumns(cols);
      setAvailableFilters(filterCols.slice(0, 8)); // Show up to 8 filter dropdowns
      // Default visible: first 8 non-internal columns
      const internalCols = new Set(['_ingestion_job_id', '_ingested_at', '_segment_ids', '_verification_status', '_verified_at']);
      const defaultVisible: Record<string, boolean> = {};
      cols.filter(c => !internalCols.has(c)).slice(0, 8).forEach(c => { defaultVisible[c] = true; });
      setVisibleCols(defaultVisible);
      setColumnsLoaded(true);
    } catch { /* ignore */ }
  }, []);

  const fetchFilterOptions = useCallback(async () => {
    if (availableFilters.length === 0) return;
    try {
      const opts: Record<string, string[]> = {};
      await Promise.all(availableFilters.map(async (f) => {
        opts[f] = await apiCall<string[]>(`/api/database/filter-options/${f}`).catch(() => []);
      }));
      setFilterOptions(opts);
    } catch { /* ignore */ }
  }, [availableFilters]);

  useEffect(() => { 
    fetchStats();
    fetchColumns();
  }, [fetchStats, fetchColumns]);

  useEffect(() => {
    fetchFilterOptions();
  }, [fetchFilterOptions]);

  // Click outside handler for column picker
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (colPickerRef.current && !colPickerRef.current.contains(event.target as Node) &&
          colPickerBtnRef.current && !colPickerBtnRef.current.contains(event.target as Node)) {
        setShowColPicker(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Use a ref for search to avoid double-fire when filtering
  const searchRef = useRef(search);
  useEffect(() => {
    searchRef.current = search;
  }, [search]);

  // Load browse data
  const runBrowse = useCallback(async (currentSearch: string = searchRef.current) => {
    if (activeTab !== 'browse' || !columnsLoaded) return;
    setLoading(true); setError(null);
    try {
      const activeFilters = Object.fromEntries(Object.entries(filters).filter(([_, v]) => v !== ''));
      const activeCols = Object.entries(visibleCols).filter(([_, v]) => v).map(([k]) => k);
      
      const res = await apiCall<QueryResult>('/api/database/browse', {
        method: 'POST',
        body: {
          search: currentSearch,
          filters: activeFilters,
          page,
          pageSize: 50,
          sortBy: sortCol || activeCols[0] || 'up_id',
          sortDir,
          columns: activeCols.length > 0 ? activeCols : undefined
        }
      });
      setResult(res);
    } catch (e: any) {
      setError(`Browse error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [filters, page, sortCol, sortDir, visibleCols, activeTab, columnsLoaded]);

  // Single effect for Browse tab (handles both search debounce and other filters)
  useEffect(() => {
    if (activeTab !== 'browse') return;
    
    const isSearchChange = search !== searchRef.current;
    
    // If it's a search change, debounce. Otherwise, run immediately.
    let timer: ReturnType<typeof setTimeout>;
    if (isSearchChange) {
       timer = setTimeout(() => runBrowse(search), 400);
    } else {
       if (!loading) runBrowse(searchRef.current);
    }

    return () => {
      if (timer) clearTimeout(timer);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, filters, page, sortCol, sortDir, visibleCols, activeTab]);


  const executeSQL = async () => {
    if (!query.trim()) return;
    setLoading(true); setError(null); setSuccess(null); setResult(null); setSortCol(null);
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
      executeSQL();
    }
  };

  // --- UI Helpers ---
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
    a.download = `export_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Sorting
  const resultCols = result?.rows.length ? Object.keys(result.rows[0]) : [];
  
  // For SQL mode, we sort locally. For Browse mode, backend sorts, but we can do local sort for currently displayed page too
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

  const toggleCol = (col: string) => {
    setVisibleCols(prev => ({ ...prev, [col]: !prev[col] }));
  };

  // Skeleton Loader for table rows
  const SkeletonTable = () => (
    <div style={{ padding: 20 }}>
      {Array.from({ length: 15 }).map((_, i) => (
         <div key={i} style={{ 
           height: 32, 
           background: 'var(--bg-card-hover)', 
           borderRadius: 4, 
           marginBottom: 8,
           opacity: 1 - (i * 0.05), // Fades out
           animation: 'pulse 1.5s infinite ease-in-out'
         }} />
      ))}
      <style>{`
        @keyframes pulse {
          0% { background-color: var(--bg-card-hover); }
          50% { background-color: var(--border); }
          100% { background-color: var(--bg-card-hover); }
        }
      `}</style>
    </div>
  );

  return (
    <>
      <PageHeader
        title="Universal Data Explorer"
        sub="Browse, filter, and inspect your lead database."
        action={<ServerSelector type="clickhouse" />}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20, marginBottom: 36 }}>
        <StatCard label="Total Rows" value={statsLoading ? '...' : formatNumber(stats?.totalRows || '0')} sub="Leads in database" icon={<Rows3 size={18} />} color="var(--blue)" colorMuted="var(--blue-muted)" delay={0.06} />
        <StatCard label="Tables" value={statsLoading ? '...' : formatNumber(stats?.tableCount || '0')} sub="Active tables" icon={<Table2 size={18} />} color="var(--purple)" colorMuted="var(--purple-muted)" delay={0.12} />
        <StatCard label="DB Size" value={statsLoading ? '...' : formatBytes(Number(stats?.totalBytes || 0))} sub="on SSD" icon={<HardDrive size={18} />} color="var(--cyan)" colorMuted="var(--cyan-muted)" delay={0.18} />
        <StatCard label="Queries Today" value={statsLoading ? '...' : formatNumber(stats?.queriesToday || '0')} sub="Executed queries" icon={<Database size={18} />} color="var(--accent)" colorMuted="var(--accent-muted)" delay={0.24} />
      </div>

      {/* TABS */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 24, borderBottom: '1px solid var(--border)', paddingBottom: 16 }}>
        <Button 
          variant={activeTab === 'browse' ? 'primary' : 'ghost'} 
          icon={<Search size={14} />} 
          onClick={() => { setActiveTab('browse'); setResult(null); setSortCol('last_name'); }}
        >
          Data Explorer
        </Button>
        <Button 
          variant={activeTab === 'sql' ? 'primary' : 'ghost'} 
          icon={<Database size={14} />} 
          onClick={() => { setActiveTab('sql'); setResult(null); setSortCol(null); }}
        >
          Advanced SQL Editor
        </Button>
      </div>

      {/* --- TAB: BROWSE --- */}
      {activeTab === 'browse' && (
        <div className="animate-fadeIn">
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: 20, marginBottom: 24 }}>
            {/* Search & Toolbar */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 20, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, position: 'relative', minWidth: 250 }}>
                <Search size={16} style={{ position: 'absolute', left: 14, top: 12, color: 'var(--text-tertiary)' }} />
                <input
                  type="text"
                  placeholder="Search names, emails, companies..."
                  value={search}
                  onChange={e => { setSearch(e.target.value); setPage(1); }}
                  style={{
                    width: '100%', padding: '10px 16px 10px 38px', borderRadius: 12,
                    fontSize: 13, fontWeight: 500, outline: 'none',
                    background: 'var(--bg-input)', border: '1px solid var(--border)',
                    color: 'var(--text-primary)', transition: 'border-color 0.2s',
                  }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
                  onBlur={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; }}
                />
              </div>
              
              <div style={{ position: 'relative' }}>
                {/* 
                  Use generic button element here and capture ref, 
                  so we can cleanly attach ref without breaking UI.Button constraints
                */}
                <button 
                  ref={colPickerBtnRef}
                  onClick={() => setShowColPicker(!showColPicker)}
                  style={{
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                    padding: '10px 20px', borderRadius: 12, fontSize: 13, fontWeight: 600,
                    cursor: 'pointer', transition: 'all 0.2s',
                    background: 'var(--bg-card-hover)', color: 'var(--text-primary)', border: '1px solid var(--border)'
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.transform = 'scale(1.03)'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.transform = 'scale(1)'; }}
                >
                  <Columns size={14} /> Columns
                </button>
                {showColPicker && (
                  <div ref={colPickerRef} style={{
                    position: 'absolute', top: 44, right: 0, width: 220, zIndex: 100,
                    background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12,
                    boxShadow: 'var(--shadow-lg)', padding: 12, maxHeight: 300, overflowY: 'auto'
                  }}>
                    <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 8, paddingLeft: 8 }}>Visible Columns</div>
                    {allColumns.map((col: string) => (
                      <label key={col} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 8px', cursor: 'pointer', borderRadius: 6 }}
                        onMouseOver={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                        onMouseOut={e => e.currentTarget.style.background = 'transparent'}
                      >
                        <input type="checkbox" checked={!!visibleCols[col]} onChange={() => toggleCol(col)} />
                        <span style={{ fontSize: 13, userSelect: 'none' }}>{col.replace(/_/g, ' ')}</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
              
              <Button variant="secondary" icon={<RefreshCw size={14} />} onClick={() => runBrowse()}>Refresh</Button>
            </div>

            {/* Filters */}
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              {availableFilters.map(f => (
                <div key={f} style={{ minWidth: 160, flex: 1, position: 'relative' }}>
                  <select
                    value={filters[f] || ''}
                    onChange={e => {
                      setFilters(prev => ({ ...prev, [f]: e.target.value }));
                      setPage(1);
                    }}
                    style={{
                      width: '100%', padding: '9px 32px 9px 12px', borderRadius: 10,
                      fontSize: 13, fontWeight: 500, outline: 'none', cursor: 'pointer',
                      background: 'var(--bg-input)', border: '1px solid var(--border)',
                      color: filters[f] ? 'var(--text-primary)' : 'var(--text-tertiary)',
                      // Allow native appearance so arrow shows
                    }}
                  >
                    <option value="">{f.split('_').join(' ').toUpperCase()} (All)</option>
                    {(filterOptions[f] || []).map(opt => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                </div>
              ))}
              {(Object.keys(filters).some(k => filters[k] !== '') || search) && (
                <Button variant="ghost" onClick={() => { setFilters({}); setSearch(''); setPage(1); }}>
                  Clear Filters
                </Button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* --- TAB: SQL --- */}
      {activeTab === 'sql' && (
        <div className="animate-fadeIn">
          {tables.length > 0 && (
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, marginBottom: 24, overflow: 'hidden' }}>
              <div onClick={() => setShowTables(!showTables)} style={{ padding: '16px 24px', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'space-between', userSelect: 'none' }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>📋 Database Tables ({tables.length})</span>
                {showTables ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              </div>
              {showTables && (
                <div style={{ padding: '0 24px 16px', display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 8 }}>
                  {tables.map(t => (
                    <div key={t.table} onClick={() => setQuery(`SELECT * FROM ${t.table} LIMIT 100`)}
                      style={{ padding: '8px 12px', borderRadius: 8, cursor: 'pointer', border: '1px solid var(--border)' }}
                      onMouseOver={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                      onMouseOut={e => e.currentTarget.style.background = ''}
                    >
                      <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 13, fontWeight: 600 }}>{t.table}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>{formatNumber(t.rows)} rows</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: 28, marginBottom: 24 }}>
            <textarea
              value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={handleKeyDown} rows={6}
              style={{
                width: '100%', padding: '14px 18px', borderRadius: 12, fontSize: 13, fontFamily: "'JetBrains Mono', monospace", color: 'var(--text-primary)',
                background: 'var(--bg-input)', border: '1px solid var(--border)', outline: 'none', resize: 'vertical', marginBottom: 16
              }}
              onFocus={e => e.currentTarget.style.borderColor = 'var(--accent)'}
              onBlur={e => e.currentTarget.style.borderColor = 'var(--border)'}
            />
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <Button icon={loading ? <Loader2 size={14} className="spin" /> : <Play size={14} />} onClick={executeSQL} disabled={loading}>{loading ? 'Running...' : 'Execute SQL (⌘+Enter)'}</Button>
              <Button variant="ghost" icon={<Copy size={14} />} onClick={() => { navigator.clipboard.writeText(query); setSuccess('Copied!'); setTimeout(()=>setSuccess(null),2000); }}>Copy SQL</Button>
            </div>
          </div>
        </div>
      )}

      {/* --- NOTIFICATIONS --- */}
      {error && (
        <div style={{ marginBottom: 24, padding: '12px 18px', borderRadius: 10, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: '#ef4444' }}>
          <AlertCircle size={16} /> {error}
        </div>
      )}
      {success && activeTab === 'sql' && (
        <div style={{ marginBottom: 24, padding: '12px 18px', borderRadius: 10, background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: '#22c55e' }}>
          <CheckCircle2 size={16} /> {success}
        </div>
      )}

      {/* --- RESULTS GRID --- */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
          {activeTab === 'browse' ? (
            loading && !result ? (<span><Loader2 size={14} className="spin" style={{ display: 'inline', marginRight: 8 }}/> Loading data...</span>) : 
            result ? `Showing ${formatNumber(result.total || 0)} results (${result.elapsed}ms)` : 'Data Results'
          ) : (
            `Query Results ${result ? `(${result.rows.length} rows, ${result.elapsed}ms)` : ''}`
          )}
        </h3>
        
        {/* Pagination & Export for Browse OR just Export for SQL */}
        <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
          {activeTab === 'browse' && result && (result.total || 0) > 0 && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
              <Button variant="ghost" disabled={page === 1} onClick={() => setPage(p => Math.max(1, p - 1))} style={{ padding: '6px 10px' }}><ChevronLeft size={16}/></Button>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4 }}>
                Page
                <input
                  type="number"
                  value={page}
                  min={1}
                  max={Math.max(1, Math.ceil((result.total || 0) / 50))}
                  onChange={e => {
                    const v = parseInt(e.target.value, 10);
                    if (!isNaN(v) && v >= 1 && v <= Math.ceil((result.total || 0) / 50)) setPage(v);
                  }}
                  style={{
                    width: 52, textAlign: 'center', padding: '4px 6px', borderRadius: 6,
                    border: '1px solid var(--border)', background: 'var(--bg-input)',
                    color: 'var(--text-primary)', fontSize: 12, fontWeight: 600,
                    outline: 'none'
                  }}
                  onFocus={e => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
                  onBlur={e => { e.currentTarget.style.borderColor = 'var(--border)'; }}
                />
                of {Math.max(1, Math.ceil((result.total || 0) / 50)).toLocaleString()}
              </span>
              <Button variant="ghost" disabled={page >= Math.ceil((result.total || 0) / 50)} onClick={() => setPage(p => p + 1)} style={{ padding: '6px 10px' }}><ChevronRight size={16}/></Button>
            </div>
          )}
          {result?.rows.length ? (
            <Button variant="ghost" icon={<Download size={14} />} onClick={downloadCSV}>Export CSV</Button>
          ) : null}
        </div>
      </div>

      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden', minHeight: 400 }}>
        {loading && !result ? (
          <SkeletonTable />
        ) : sortedRows.length > 0 ? (
          <div style={{ overflowX: 'auto', maxHeight: '70vh' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-card)', zIndex: 10, borderBottom: '1px solid var(--border)' }}>
                <tr>
                  {resultCols.map(col => (
                    <th key={col} onClick={() => toggleSort(col)}
                      style={{
                        padding: '12px 16px', textAlign: 'left', fontWeight: 700,
                        fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em',
                        color: 'var(--text-tertiary)', borderBottom: '1px solid var(--border)',
                        cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap',
                        background: sortCol === col ? 'var(--bg-hover)' : 'transparent',
                      }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                        {col.replace(/_/g, ' ')}
                        {sortCol === col && (sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
                      </span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row, i) => (
                  <tr key={i} style={{ transition: 'background 0.1s' }}
                    onMouseOver={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                    onMouseOut={e => (e.currentTarget.style.background = '')}>
                    {resultCols.map(col => {
                      const val = row[col];
                      return (
                        <td key={col} style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-secondary)' }} title={String(val ?? '')}>
                          {val === null || val === undefined ? <span style={{ color: 'var(--text-tertiary)', fontStyle: 'italic' }}>—</span> : String(val)}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ padding: 80, textAlign: 'center', color: 'var(--text-tertiary)' }}>
            <Database size={32} style={{ marginBottom: 16, opacity: 0.3 }} />
            <div style={{ fontWeight: 600, fontSize: 15 }}>No results found</div>
            <div style={{ fontSize: 13, marginTop: 6 }}>{activeTab === 'browse' ? 'Try adjusting your filters or search' : 'Execute a query to see results here'}</div>
          </div>
        )}
      </div>
    </>
  );
}
