import {
  Database, Table2, Rows3, HardDrive, Play, Copy, Download, RefreshCw,
  Loader2, AlertCircle, CheckCircle2, ChevronDown, ChevronUp,
  Search, Columns, ChevronLeft, ChevronRight, Layers, X, Filter, Plus, Trash2,
  Save, BookmarkCheck, BarChart2, Sidebar, Square, CheckSquare,
  Mail, Phone, Linkedin, Bookmark, Tag, ArrowRightLeft, ScanSearch, Replace
} from 'lucide-react';
import { PageHeader, StatCard, Button } from '../components/UI';
import { useState, useEffect, useCallback, useRef } from 'react';
import { ServerSelector } from '../components/ServerSelector';
import { apiCall } from '../lib/api';
import { useToast } from '../components/Toast';
import AgentCard from '../components/AgentCard';

// --- Interfaces ---
interface DbStats { totalRows: string; totalBytes: string; tableCount: string; segmentCount: string; }
interface TableInfo { table: string; rows: string; bytes_on_disk: string; last_modified: string; }
interface QueryResult { rows: Record<string, unknown>[]; elapsed: number; total?: number; page?: number; pageSize?: number; }
interface SavedQuery { name: string; sql: string; savedAt: number; }
interface ColumnStat { value: string; count: string; }

const PAGE_SIZES = [25, 50, 100, 200, 500, 1000, 5000];

const FILTER_OPERATORS = [
  { value: 'equals', label: 'Equals' },
  { value: 'not_equals', label: 'Not Equals' },
  { value: 'contains', label: 'Contains' },
  { value: 'not_contains', label: 'Does Not Contain' },
  { value: 'starts_with', label: 'Starts With' },
  { value: 'ends_with', label: 'Ends With' },
  { value: 'is_null', label: 'Is Empty' },
  { value: 'is_not_null', label: 'Is Not Empty' },
  { value: 'greater_than', label: 'Greater Than' },
  { value: 'less_than', label: 'Less Than' },
  { value: 'between', label: 'Between' },
];

// Completeness threshold constants — match backend values
const COMPLETENESS_HIGH = 0.8;
const COMPLETENESS_LOW = 0.4;

// Quick toggle definitions — column name is validated at runtime against schema
const QUICK_TOGGLE_CONFIG = [
  { key: 'hasEmail', label: 'Has Email', column: 'personal_emails', icon: 'mail' },
  { key: 'hasPhone', label: 'Has Phone', column: 'mobile_phone', icon: 'phone' },
  { key: 'hasLinkedin', label: 'Has LinkedIn', column: 'linkedin_url', icon: 'linkedin' },
] as const;

interface FilterPreset {
  name: string;
  filters: Record<string, string>;
  advancedFilters: AdvancedFilterUI[];
  completenessFilter: 'all' | 'high' | 'medium' | 'low';
  search: string;
  quickToggles: Record<string, boolean>;
  dataSourceFilter: string[];
  savedAt: number;
}

interface AdvancedFilterUI {
  id: number;
  column: string;
  operator: string;
  value: string;
}

// Column grouping for the picker
const COLUMN_GROUPS: Record<string, string[]> = {
  'Person': ['up_id', 'first_name', 'middle_name', 'last_name', 'full_name', 'gender', 'birth_year', 'birth_date', 'linkedin_url'],
  'Contact': ['business_email', 'personal_emails', 'mobile_phone', 'direct_phone', 'personal_phone_1', 'personal_phone_2', 'personal_phone_3'],
  'Company': ['company_name', 'company_domain', 'company_phone', 'company_linkedin_url', 'company_revenue', 'company_employee_count', 'primary_industry', 'company_description', 'company_sic', 'company_naics'],
  'Location': ['personal_address', 'personal_city', 'personal_state', 'personal_zip', 'personal_country', 'company_address', 'company_city', 'company_state', 'company_zip', 'company_country'],
  'Job': ['job_title', 'seniority_level', 'department', 'job_title_last_updated'],
  'Metadata': ['_ingestion_job_id', '_ingested_at', '_segment_ids', '_verification_status', '_verified_at', '_v550_category', '_bounced', 'topic_type', 'source_table', 'topic_id'],
};

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
  const { success: toastSuccess, error: toastError } = useToast();

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
  const [savedQueries, setSavedQueries] = useState<SavedQuery[]>(() => {
    try { return JSON.parse(localStorage.getItem('refinery_saved_queries') || '[]'); } catch { return []; }
  });
  const [showSavedQueries, setShowSavedQueries] = useState(false);

  // --- Browse (Data Explorer State) ---
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [showColPicker, setShowColPicker] = useState(false);
  const [pageSize, setPageSize] = useState(50);
  const [dataSourceFilter, setDataSourceFilter] = useState<string[]>([]);
  const [completenessFilter, setCompletenessFilter] = useState<'all' | 'high' | 'medium' | 'low'>('all');
  const colPickerRef = useRef<HTMLDivElement>(null);
  const colPickerBtnRef = useRef<HTMLButtonElement>(null);

  // Data source options for filter
  const [dataSourceOptions, setDataSourceOptions] = useState<{ id: string; label: string }[]>([]);

  // Row detail drawer
  const [selectedRow, setSelectedRow] = useState<Record<string, unknown> | null>(null);


  // Dynamic columns from backend
  const [allColumns, setAllColumns] = useState<string[]>([]);

  const [visibleCols, setVisibleCols] = useState<Record<string, boolean>>({});
  const [columnsLoaded, setColumnsLoaded] = useState(false);

  // Advanced Filters
  const [advancedFilters, setAdvancedFilters] = useState<AdvancedFilterUI[]>([]);
  const [showAdvFilters, setShowAdvFilters] = useState(false);
  let filterIdCounter = useRef(0);

  // Bulk selection
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkDeleting, setBulkDeleting] = useState(false);

  // Column stats popup
  const [columnStats, setColumnStats] = useState<ColumnStat[]>([]);
  const [statsColumn, setStatsColumn] = useState<string | null>(null);
  const [loadingStats, setLoadingStats] = useState(false);

  // Quick boolean toggles
  const [quickToggles, setQuickToggles] = useState<Record<string, boolean>>({});

  // Faceted drill-down state
  const [facets, setFacets] = useState<Record<string, { value: string; count: number }[]>>({});
  const [facetsLoading, setFacetsLoading] = useState(false);

  // Filter presets
  const [filterPresets, setFilterPresets] = useState<FilterPreset[]>(() => {
    try { return JSON.parse(localStorage.getItem('refinery_filter_presets') || '[]'); } catch { return []; }
  });
  const [showPresets, setShowPresets] = useState(false);
  const presetsRef = useRef<HTMLDivElement>(null);
  const presetsBtnRef = useRef<HTMLButtonElement>(null);

  const [showFindReplace, setShowFindReplace] = useState(false);
  const [frColumn, setFrColumn] = useState('');
  const [frFind, setFrFind] = useState('');
  const [frReplace, setFrReplace] = useState('');
  const [frProcessing, setFrProcessing] = useState(false);
  const [frMatchMode, setFrMatchMode] = useState<'exact' | 'contains'>('exact');
  const [frPreviewCount, setFrPreviewCount] = useState<number | null>(null);

  // Duplicate detection 
  const [showDuplicates, setShowDuplicates] = useState(false);
  const [dupColumn, setDupColumn] = useState('business_email');
  const [dupResults, setDupResults] = useState<{ value: string; cnt: string }[]>([]);
  const [dupLoading, setDupLoading] = useState(false);

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
      const cols = await apiCall<string[]>('/api/database/columns').catch(() => []);
      setAllColumns(cols);

      // Default visible: first 8 non-internal columns
      // Default visible: curated priority list with emails at the top
      const PRIORITY_COLS = [
        'first_name', 'last_name', 'business_email', 'personal_emails',
        'company_name', 'job_title_normalized', 'primary_industry',
        'personal_state', 'seniority_level', 'mobile_phone',
        'company_domain', 'linkedin_url',
      ];
      const colSet = new Set(cols);
      const defaultVisible: Record<string, boolean> = {};
      PRIORITY_COLS.filter(c => colSet.has(c)).forEach(c => { defaultVisible[c] = true; });
      setVisibleCols(defaultVisible);
      setColumnsLoaded(true);
    } catch { /* ignore */ }
  }, []);


  useEffect(() => {
    fetchStats();
    fetchColumns();
    // Fetch data source options (ingestion job IDs)
    apiCall<{ id: string; label: string }[]>('/api/ingestion/sources').then(sources => {
      if (sources) setDataSourceOptions(sources.map((s: any) => ({ id: s.id, label: s.label || s.id })));
    }).catch(() => { });
  }, [fetchStats, fetchColumns]);

  // Click outside handler for column picker
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (colPickerRef.current && !colPickerRef.current.contains(event.target as Node) &&
        colPickerBtnRef.current && !colPickerBtnRef.current.contains(event.target as Node)) {
        setShowColPicker(false);
      }
      // Click outside presets dropdown
      if (presetsRef.current && !presetsRef.current.contains(event.target as Node) &&
        presetsBtnRef.current && !presetsBtnRef.current.contains(event.target as Node)) {
        setShowPresets(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Track what search value was last sent to the server
  const searchRef = useRef(search);
  const isTypingRef = useRef(false);

  // Load browse data
  const runBrowse = useCallback(async (currentSearch: string = searchRef.current) => {
    if (activeTab !== 'browse' || !columnsLoaded) return;
    setLoading(true); setError(null);
    try {
      const activeFilters = Object.fromEntries(Object.entries(filters).filter(([_, v]) => v !== ''));
      const activeCols = Object.entries(visibleCols).filter(([_, v]) => v).map(([k]) => k);

      // Build advanced filter payload
      const afPayload = advancedFilters
        .filter(f => f.column && f.operator)
        .map(f => ({ column: f.column, operator: f.operator, value: f.value }));

      // Add quick boolean toggles
      // hasEmail is handled separately via the hasEmail flag (checks both business_email + personal_emails)
      if (quickToggles.hasPhone) afPayload.push({ column: 'mobile_phone', operator: 'is_not_null', value: '' });
      if (quickToggles.hasLinkedin) afPayload.push({ column: 'linkedin_url', operator: 'is_not_null', value: '' });

      const res = await apiCall<QueryResult>('/api/database/browse', {
        method: 'POST',
        body: {
          search: currentSearch,
          filters: activeFilters,
          dataSourceIds: dataSourceFilter.length > 0 ? dataSourceFilter : undefined,
          advancedFilters: afPayload.length > 0 ? afPayload : undefined,
          hasEmail: quickToggles.hasEmail || undefined,
          page,
          pageSize,
          sortBy: sortCol || activeCols[0] || 'up_id',
          sortDir,
          columns: activeCols.length > 0 ? activeCols : undefined,
          completenessFilter: completenessFilter !== 'all' ? completenessFilter : undefined,
        }
      });
      setResult(res);
      searchRef.current = currentSearch; // update ref AFTER successful fetch

      // ─── Facet drill-down: fetch top values for key columns (non-blocking) ───
      // Only fetch when results are filtered (not on 121M unfiltered view)
      const hasActiveFilters = currentSearch.trim() || Object.keys(activeFilters).length > 0 ||
        afPayload.length > 0 || quickToggles.hasEmail || quickToggles.hasPhone || quickToggles.hasLinkedin ||
        dataSourceFilter.length > 0 || (completenessFilter !== 'all');

      if (hasActiveFilters && (res.total ?? 0) < 10_000_000) {
        setFacetsLoading(true);
        apiCall<{ facets: Record<string, { value: string; count: number }[]> }>('/api/database/facets', {
          method: 'POST',
          body: {
            search: currentSearch,
            filters: activeFilters,
            dataSourceIds: dataSourceFilter.length > 0 ? dataSourceFilter : undefined,
            advancedFilters: afPayload.length > 0 ? afPayload : undefined,
            hasEmail: quickToggles.hasEmail || undefined,
          }
        }).then(facetRes => {
          if (facetRes?.facets) setFacets(facetRes.facets);
        }).catch(() => {}).finally(() => setFacetsLoading(false));
      } else {
        setFacets({});
      }
    } catch (e: any) {
      setError(`Browse error: ${e.message}`);
    } finally {
      setLoading(false);
    }
  }, [filters, page, pageSize, sortCol, sortDir, visibleCols, activeTab, columnsLoaded, dataSourceFilter, quickToggles, completenessFilter, advancedFilters]);

  // Single effect for Browse tab — debounces search, runs immediately for other filter changes
  useEffect(() => {
    if (activeTab !== 'browse') return;

    const isSearchChange = search !== searchRef.current;

    // Always debounce — prevents stale ref races when multiple deps change at once
    // 600ms for typing (search bar + filter values), 300ms for dropdown/toggle changes
    const delay = isSearchChange ? 600 : 300;
    isTypingRef.current = isSearchChange;

    const timer = setTimeout(() => {
      isTypingRef.current = false;
      runBrowse(search);
    }, delay);

    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, filters, page, sortCol, sortDir, visibleCols, activeTab, advancedFilters, quickToggles, completenessFilter, dataSourceFilter]);


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

  const saveCurrentQuery = () => {
    if (!query.trim()) return;
    const name = prompt('Enter a name for this saved query:');
    if (!name) return;

    // Store in localStorage
    const newSaved = [...savedQueries, { name, sql: query.trim(), savedAt: Date.now() }];
    setSavedQueries(newSaved);
    try { localStorage.setItem('refinery_saved_queries', JSON.stringify(newSaved)); } catch { /* ignore */ }
    toastSuccess(`Query "${name}" saved`);
  };

  const removeSavedQuery = (index: number) => {
    if (!confirm('Delete this saved query?')) return;
    const newSaved = savedQueries.filter((_, i) => i !== index);
    setSavedQueries(newSaved);
    try { localStorage.setItem('refinery_saved_queries', JSON.stringify(newSaved)); } catch { /* ignore */ }
  };

  const handleBulkDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!confirm(`Are you absolutely sure you want to permanently delete ${selectedIds.size} rows? This cannot be undone.`)) return;

    setBulkDeleting(true);
    try {
      const res = await apiCall<{ deleted: number }>('/api/database/bulk-delete', {
        method: 'POST',
        body: { upIds: Array.from(selectedIds) }
      });
      toastSuccess(`Successfully deleted ${res.deleted} rows`);
      setSelectedIds(new Set()); // clear selection
      runBrowse(); // refresh data
    } catch (e: any) {
      toastError(e.message || 'Failed to delete rows');
    } finally {
      setBulkDeleting(false);
    }
  };

  const showColumnStats = async (col: string) => {
    setStatsColumn(col);
    setColumnStats([]);
    setLoadingStats(true);
    try {
      const res = await apiCall<ColumnStat[]>(`/api/database/column-stats/${col}?limit=20`);
      setColumnStats(res || []);
    } catch (e: any) {
      toastError(`Failed to load stats for ${col}`);
      setStatsColumn(null);
    } finally {
      setLoadingStats(false);
    }
  };

  // --- UI Helpers ---
  const downloadCSV = (rows: Record<string, unknown>[], fileNameSuffix: string = 'page') => {
    if (!rows.length) return;
    const cols = Object.keys(rows[0]);
    const csv = [
      cols.join(','),
      ...rows.map(r => cols.map(c => {
        const val = String(r[c] ?? '');
        return val.includes(',') || val.includes('"') || val.includes('\n')
          ? `"${val.replace(/"/g, '""')}"` : val;
      }).join(','))
    ].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `export_${fileNameSuffix}_${Date.now()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  // Sorting
  const resultCols = result?.rows.length ? Object.keys(result.rows[0]) : [];

  // For SQL mode, we sort locally. For Browse mode, backend sorts, but we can do local sort for currently displayed page too
  // NOTE: Completeness is now filtered server-side only — no double filtering
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
        sub="Browse, search, filter, and export your entire lead database with millisecond ClickHouse performance."
        description="Use the search bar for full-text lookups, or open Advanced Filters to build precise queries with 8 operators (equals, contains, starts with, etc.). Toggle columns via the column picker, adjust page size up to 5,000 rows, and export filtered results as CSV — either the current page or the full matching dataset."
        action={<ServerSelector type="clickhouse" />}
      />

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 20, marginBottom: 36 }}>
        <StatCard label="Total Rows" value={statsLoading ? '...' : formatNumber(stats?.totalRows || '0')} sub="Leads in database" icon={<Rows3 size={18} />} color="var(--blue)" colorMuted="var(--blue-muted)" delay={0.06} />
        <StatCard label="Tables" value={statsLoading ? '...' : formatNumber(stats?.tableCount || '0')} sub="Active tables" icon={<Table2 size={18} />} color="var(--purple)" colorMuted="var(--purple-muted)" delay={0.12} />
        <StatCard label="DB Size" value={statsLoading ? '...' : formatBytes(Number(stats?.totalBytes || 0))} sub="on SSD" icon={<HardDrive size={18} />} color="var(--cyan)" colorMuted="var(--cyan-muted)" delay={0.18} />
        <StatCard label="Segments" value={statsLoading ? '...' : formatNumber(stats?.segmentCount || '0')} sub="Created segments" icon={<Database size={18} />} color="var(--accent)" colorMuted="var(--accent-muted)" delay={0.24} />
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
                <Search size={16} style={{ position: 'absolute', left: 14, top: 12, color: search ? 'var(--accent)' : 'var(--text-tertiary)', transition: 'color 0.2s' }} />
                <input
                  type="text"
                  placeholder="Search anything — domains, emails, names, phone numbers, companies, cities..."
                  value={search}
                  onChange={e => { setSearch(e.target.value); setPage(1); }}
                  style={{
                    width: '100%', padding: '10px 16px 10px 38px', borderRadius: 12,
                    fontSize: 13, fontWeight: 500, outline: 'none',
                    background: 'var(--bg-input)', border: `1px solid ${search ? 'var(--accent)' : 'var(--border)'}`,
                    color: 'var(--text-primary)', transition: 'border-color 0.2s',
                    ...(search ? { boxShadow: '0 0 0 2px color-mix(in srgb, var(--accent) 15%, transparent)' } : {}),
                  }}
                  onFocus={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; }}
                  onBlur={(e) => { if (!search) e.currentTarget.style.borderColor = 'var(--border)'; }}
                />
                {/* Smart intent badge — shows what type of search is detected */}
                {search.trim() && (() => {
                  const s = search.trim();
                  const isDomain = /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(s);
                  const isEmail = s.includes('@');
                  const isPhone = /^[\d()+\-\s.]{7,}$/.test(s);
                  const isLinkedIn = s.toLowerCase().includes('linkedin.com');
                  const badge = isDomain ? { icon: '🌐', label: 'Domain', color: '#3b82f6' }
                    : isEmail ? { icon: '📧', label: 'Email', color: '#8b5cf6' }
                    : isPhone ? { icon: '📱', label: 'Phone', color: '#10b981' }
                    : isLinkedIn ? { icon: '💼', label: 'LinkedIn', color: '#0077b5' }
                    : { icon: '🔍', label: 'All fields', color: 'var(--text-tertiary)' };
                  return (
                    <span style={{
                      position: 'absolute', right: 12, top: 8,
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      padding: '3px 10px', borderRadius: 20,
                      fontSize: 10, fontWeight: 700, letterSpacing: '0.04em',
                      background: `color-mix(in srgb, ${badge.color} 12%, transparent)`,
                      color: badge.color, border: `1px solid color-mix(in srgb, ${badge.color} 25%, transparent)`,
                      animation: 'fadeIn 0.15s ease-out',
                      pointerEvents: 'none', userSelect: 'none',
                    }}>
                      {badge.icon} {badge.label}
                    </span>
                  );
                })()}
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
                    position: 'absolute', top: 44, right: 0, width: 260, zIndex: 100,
                    background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12,
                    boxShadow: 'var(--shadow-lg)', padding: 12, maxHeight: 400, overflowY: 'auto'
                  }}>
                    {/* Quick actions */}
                    <div style={{ display: 'flex', gap: 6, marginBottom: 10, paddingBottom: 8, borderBottom: '1px solid var(--border)' }}>
                      <button onClick={() => {
                        const all: Record<string, boolean> = {};
                        allColumns.forEach(c => all[c] = true);
                        setVisibleCols(all);
                      }} style={{ flex: 1, padding: '5px 0', borderRadius: 6, fontSize: 10, fontWeight: 700, cursor: 'pointer', background: 'var(--accent-muted)', color: 'var(--accent)', border: '1px solid var(--accent)' }}>
                        Show All
                      </button>
                      <button onClick={() => {
                        const defaults: Record<string, boolean> = {};
                        const PRIORITY = ['first_name','last_name','business_email','personal_emails','company_name','job_title_normalized','primary_industry','personal_state','seniority_level','mobile_phone','company_domain','linkedin_url'];
                        PRIORITY.filter(c => allColumns.includes(c)).forEach(c => defaults[c] = true);
                        setVisibleCols(defaults);
                      }} style={{ flex: 1, padding: '5px 0', borderRadius: 6, fontSize: 10, fontWeight: 700, cursor: 'pointer', background: 'var(--bg-hover)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
                        Default
                      </button>
                    </div>
                    {Object.entries(COLUMN_GROUPS).map(([group, groupCols]) => {
                      const available = groupCols.filter(c => allColumns.includes(c));
                      if (available.length === 0) return null;
                      return (
                        <div key={group} style={{ marginBottom: 8 }}>
                          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-tertiary)', padding: '4px 8px', letterSpacing: '0.08em' }}>{group}</div>
                          {available.map(col => (
                            <label key={col} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', cursor: 'pointer', borderRadius: 6, fontSize: 12 }}
                              onMouseOver={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                              onMouseOut={e => e.currentTarget.style.background = 'transparent'}>
                              <input type="checkbox" checked={!!visibleCols[col]} onChange={() => toggleCol(col)} style={{ accentColor: 'var(--accent)' }} />
                              <span style={{ userSelect: 'none' }}>{col.replace(/_/g, ' ')}</span>
                            </label>
                          ))}
                        </div>
                      );
                    })}
                    {/* Other columns not in any group */}
                    {(() => {
                      const grouped = new Set(Object.values(COLUMN_GROUPS).flat());
                      const other = allColumns.filter(c => !grouped.has(c));
                      if (other.length === 0) return null;
                      return (
                        <div style={{ marginBottom: 8 }}>
                          <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-tertiary)', padding: '4px 8px', letterSpacing: '0.08em' }}>Other</div>
                          {other.map(col => (
                            <label key={col} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 8px', cursor: 'pointer', borderRadius: 6, fontSize: 12 }}
                              onMouseOver={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                              onMouseOut={e => e.currentTarget.style.background = 'transparent'}>
                              <input type="checkbox" checked={!!visibleCols[col]} onChange={() => toggleCol(col)} style={{ accentColor: 'var(--accent)' }} />
                              <span style={{ userSelect: 'none' }}>{col.replace(/_/g, ' ')}</span>
                            </label>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>

              <Button variant="secondary" icon={<RefreshCw size={14} />} onClick={() => runBrowse()}>Refresh</Button>
            </div>

            {/* Quick Toggles + Completeness moved here for cleaner layout */}

            {/* Advanced Filter Builder */}
            <div style={{ marginTop: 16 }}>
              <button
                onClick={() => setShowAdvFilters(!showAdvFilters)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6,
                  background: 'transparent', border: 'none', color: advancedFilters.length > 0 ? 'var(--accent)' : 'var(--text-tertiary)',
                  fontSize: 12, fontWeight: 700, cursor: 'pointer', padding: '4px 0',
                }}
              >
                <Filter size={14} />
                Advanced Filters {advancedFilters.length > 0 && `(${advancedFilters.length} active)`}
              </button>
              {showAdvFilters && (
                <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {advancedFilters.map((af, idx) => (
                    <div key={af.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <select
                        value={af.column}
                        onChange={e => {
                          const updated = [...advancedFilters];
                          updated[idx] = { ...af, column: e.target.value };
                          setAdvancedFilters(updated);
                        }}
                        style={{
                          padding: '8px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                          background: 'var(--bg-input)', border: '1px solid var(--border)',
                          color: af.column ? 'var(--text-primary)' : 'var(--text-tertiary)',
                          minWidth: 180, cursor: 'pointer',
                        }}
                      >
                        <option value="">Select Column...</option>
                        {allColumns.map(c => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
                      </select>
                      <select
                        value={af.operator}
                        onChange={e => {
                          const updated = [...advancedFilters];
                          updated[idx] = { ...af, operator: e.target.value };
                          setAdvancedFilters(updated);
                        }}
                        style={{
                          padding: '8px 12px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                          background: 'var(--bg-input)', border: '1px solid var(--border)',
                          color: 'var(--text-primary)', minWidth: 150, cursor: 'pointer',
                        }}
                      >
                        {FILTER_OPERATORS.map(op => <option key={op.value} value={op.value}>{op.label}</option>)}
                      </select>
                      {!['is_null', 'is_not_null'].includes(af.operator) && (
                        <input
                          type={af.operator === 'between' ? 'text' : (['_ingested_at', '_verified_at', 'birth_date', 'job_title_last_updated'].includes(af.column) && ['greater_than', 'less_than'].includes(af.operator)) ? 'date' : 'text'}
                          placeholder={af.operator === 'between' ? 'min, max (e.g. 100,500)' : 'Value...'}
                          value={af.value}
                          onChange={e => {
                            const updated = [...advancedFilters];
                            updated[idx] = { ...af, value: e.target.value };
                            setAdvancedFilters(updated);
                          }}
                          onKeyDown={e => { if (e.key === 'Enter') setPage(1); }}
                          style={{
                            padding: '8px 12px', borderRadius: 8, fontSize: 12,
                            background: 'var(--bg-input)', border: '1px solid var(--border)',
                            color: 'var(--text-primary)', flex: 1, minWidth: 120, outline: 'none',
                          }}
                        />
                      )}
                      <button
                        onClick={() => setAdvancedFilters(advancedFilters.filter((_, i) => i !== idx))}
                        style={{
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          width: 32, height: 32, borderRadius: 8, cursor: 'pointer',
                          background: 'transparent', border: '1px solid var(--border)',
                          color: 'var(--red)',
                        }}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
                    <button
                      onClick={() => {
                        filterIdCounter.current += 1;
                        setAdvancedFilters([...advancedFilters, { id: filterIdCounter.current, column: '', operator: 'equals', value: '' }]);
                      }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 6,
                        padding: '8px 14px', borderRadius: 8, fontSize: 12, fontWeight: 600,
                        background: 'var(--bg-hover)', border: '1px dashed var(--border)',
                        color: 'var(--text-secondary)', cursor: 'pointer',
                      }}
                    >
                      <Plus size={14} /> Add Filter
                    </button>
                    {advancedFilters.some(f => f.column && f.operator) && (
                      <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontStyle: 'italic', display: 'flex', alignItems: 'center', gap: 4 }}>
                        ⚡ Filters apply live as you type
                      </span>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* ═══ ACTION TOOLBAR ═══ */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap', alignItems: 'center' }}>
            {QUICK_TOGGLE_CONFIG.filter(t => allColumns.includes(t.column)).map(t => (
              <button key={t.key} onClick={() => { setQuickToggles(prev => ({ ...prev, [t.key]: !prev[t.key] })); setPage(1); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 8,
                  fontSize: 11, fontWeight: 700, cursor: 'pointer', transition: 'all 0.15s',
                  background: quickToggles[t.key] ? 'var(--accent)' : 'var(--bg-card-hover)',
                  color: quickToggles[t.key] ? 'var(--accent-contrast)' : 'var(--text-secondary)',
                  border: `1px solid ${quickToggles[t.key] ? 'var(--accent)' : 'var(--border)'}`,
                }}>
                {t.icon === 'mail' ? <Mail size={12} /> : t.icon === 'phone' ? <Phone size={12} /> : <Linkedin size={12} />} {t.label}
              </button>
            ))}
            <div style={{ width: 1, height: 20, background: 'var(--border)', margin: '0 4px' }} />
            <div style={{ position: 'relative' }}>
              <button ref={presetsBtnRef} onClick={() => setShowPresets(!showPresets)}
                style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: 'var(--bg-card-hover)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
                <Bookmark size={12} /> Presets {filterPresets.length > 0 && `(${filterPresets.length})`}
              </button>
              {showPresets && (
                <div ref={presetsRef} style={{ position: 'absolute', top: 36, left: 0, width: 280, zIndex: 100, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, boxShadow: 'var(--shadow-lg)', padding: 8 }}>
                  <button onClick={() => {
                    const name = prompt('Name this filter preset:');
                    if (!name) return;
                    const preset: FilterPreset = { name, filters: { ...filters }, advancedFilters: [...advancedFilters], completenessFilter, search, quickToggles: { ...quickToggles }, dataSourceFilter, savedAt: Date.now() };
                    const updated = [...filterPresets, preset];
                    setFilterPresets(updated);
                    localStorage.setItem('refinery_filter_presets', JSON.stringify(updated));
                    toastSuccess(`Preset "${name}" saved`); setShowPresets(false);
                  }}
                    style={{ width: '100%', padding: '8px 12px', fontSize: 11, fontWeight: 700, borderRadius: 8, cursor: 'pointer', background: 'var(--bg-hover)', border: '1px dashed var(--border)', color: 'var(--accent)', marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Plus size={12} /> Save Current Filters
                  </button>
                  {filterPresets.map((p, idx) => (
                    <div key={idx} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '6px 10px', borderRadius: 6, cursor: 'pointer', fontSize: 12, color: 'var(--text-primary)' }}
                      onMouseOver={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                      onMouseOut={e => (e.currentTarget.style.background = 'transparent')}>
                      <span onClick={() => { setFilters(p.filters); setAdvancedFilters(p.advancedFilters); setCompletenessFilter(p.completenessFilter); setSearch(p.search); setQuickToggles(p.quickToggles || {}); setDataSourceFilter(Array.isArray(p.dataSourceFilter) ? p.dataSourceFilter : p.dataSourceFilter ? [p.dataSourceFilter] : []); setPage(1); setShowPresets(false); toastSuccess(`Loaded "${p.name}"`); }} style={{ flex: 1, fontWeight: 600 }}>
                        {p.name}
                        <span style={{ fontSize: 9, color: 'var(--text-tertiary)', marginLeft: 6 }}>{new Date(p.savedAt).toLocaleDateString()}</span>
                      </span>
                      <X size={12} style={{ color: 'var(--text-tertiary)', cursor: 'pointer' }} onClick={() => { const u = filterPresets.filter((_, i) => i !== idx); setFilterPresets(u); localStorage.setItem('refinery_filter_presets', JSON.stringify(u)); }} />
                    </div>
                  ))}
                  {filterPresets.length === 0 && <div style={{ padding: 12, fontSize: 11, color: 'var(--text-tertiary)', textAlign: 'center' }}>No saved presets</div>}
                </div>
              )}
            </div>
            <button onClick={async () => {
              // Collect ALL active filters — leave nothing behind
              const af = Object.entries(filters).filter(([_, v]) => v !== '');
              const afAdv = advancedFilters.filter(f => f.column && f.operator);
              const activeToggles = Object.entries(quickToggles).filter(([_, v]) => v);
              const hasCompleteness = completenessFilter !== 'all';
              const hasDataSource = dataSourceFilter.length > 0;
              const hasSearch = !!search.trim();

              // Check if ANY filter is active
              if (af.length === 0 && afAdv.length === 0 && activeToggles.length === 0 && !hasCompleteness && !hasDataSource && !hasSearch) {
                toastError('Apply some filters first to create a segment');
                return;
              }

              // Build the SQL filter parts
              const parts: string[] = [];

              // 1. Dropdown filters
              for (const [col, val] of af) {
                parts.push(`\`${col}\` = '${val.replace(/'/g, "\\'")}'`);
              }

              // 2. Advanced filters
              for (const f of afAdv) {
                const c = `\`${f.column}\``;
                const escaped = (f.value || '').replace(/'/g, "\\'");
                switch (f.operator) {
                  case 'equals': parts.push(`${c} = '${escaped}'`); break;
                  case 'not_equals': parts.push(`${c} != '${escaped}'`); break;
                  case 'contains': parts.push(`${c} LIKE '%${escaped}%'`); break;
                  case 'not_contains': parts.push(`${c} NOT LIKE '%${escaped}%'`); break;
                  case 'starts_with': parts.push(`${c} LIKE '${escaped}%'`); break;
                  case 'ends_with': parts.push(`${c} LIKE '%${escaped}'`); break;
                  case 'is_not_null': parts.push(`${c} IS NOT NULL AND toString(${c}) != ''`); break;
                  case 'is_null': parts.push(`(${c} IS NULL OR toString(${c}) = '')`); break;
                  case 'greater_than': parts.push(`${c} > '${escaped}'`); break;
                  case 'less_than': parts.push(`${c} < '${escaped}'`); break;
                  case 'between': {
                    const [a, b] = (escaped).split(',').map(s => s.trim());
                    if (a && b) parts.push(`${c} >= '${a}' AND ${c} <= '${b}'`);
                    break;
                  }
                }
              }

              // 3. Quick toggles → IS NOT NULL conditions
              for (const [key] of activeToggles) {
                const toggle = QUICK_TOGGLE_CONFIG.find(t => t.key === key);
                if (toggle) {
                  if (key === 'hasEmail') {
                    // Email checks both business_email AND personal_emails
                    parts.push(`((\`business_email\` IS NOT NULL AND toString(\`business_email\`) != '') OR (\`personal_emails\` IS NOT NULL AND toString(\`personal_emails\`) != ''))`);
                  } else {
                    parts.push(`\`${toggle.column}\` IS NOT NULL AND toString(\`${toggle.column}\`) != ''`);
                  }
                }
              }

              // 4. Search → LIKE across searchable columns
              if (hasSearch) {
                const escaped = search.trim().replace(/'/g, "\\'");
                const searchCols = ['first_name', 'last_name', 'business_email', 'personal_emails', 'company_name', 'job_title_normalized', 'mobile_phone', 'company_domain'];
                const searchClause = searchCols.map(c => `lower(coalesce(toString(\`${c}\`), '')) LIKE lower('%${escaped}%')`).join(' OR ');
                parts.push(`(${searchClause})`);
              }

              // 5. Data source filter
              if (hasDataSource) {
                const escaped = dataSourceFilter.map(id => `'${id.replace(/'/g, "\\'")}'`).join(', ');
                parts.push(`\`_ingestion_job_id\` IN (${escaped})`);
              }

              // 6. Completeness filter (computed column ratio)
              if (hasCompleteness) {
                const cols = allColumns.filter(c => !['_ingestion_job_id', '_ingested_at', '_segment_ids', '_verification_status', '_verified_at', '_v550_category', '_bounced', 'topic_type', 'source_table', 'topic_id'].includes(c));
                const filledExpr = cols.map(c => `if(\`${c}\` IS NOT NULL AND toString(\`${c}\`) != '', 1, 0)`).join(' + ');
                const total = cols.length;
                if (completenessFilter === 'high') {
                  parts.push(`(${filledExpr}) / ${total} > 0.8`);
                } else if (completenessFilter === 'medium') {
                  parts.push(`(${filledExpr}) / ${total} > 0.4 AND (${filledExpr}) / ${total} <= 0.8`);
                } else if (completenessFilter === 'low') {
                  parts.push(`(${filledExpr}) / ${total} <= 0.4`);
                }
              }

              const filterQuery = parts.join(' AND ');

              // Build a human-readable summary
              const summary: string[] = [];
              if (af.length > 0) summary.push(`${af.length} dropdown filter(s)`);
              if (afAdv.length > 0) summary.push(`${afAdv.length} advanced filter(s)`);
              if (activeToggles.length > 0) summary.push(activeToggles.map(([k]) => k === 'hasEmail' ? 'Has Email' : k === 'hasPhone' ? 'Has Phone' : 'Has LinkedIn').join(', '));
              if (hasCompleteness) summary.push(`Completeness: ${completenessFilter}`);
              if (hasDataSource) summary.push('Data source filtered');
              if (hasSearch) summary.push(`Search: "${search}"`);

              const currentCount = result?.total ? formatNumber(result.total) : '?';

              const name = prompt(
                `Create Segment\n\n` +
                `Filters: ${summary.join(' + ')}\n` +
                `Matching: ~${currentCount} leads\n\n` +
                `Enter segment name:`
              );
              if (!name) return;

              try {
                await apiCall('/api/segments', { method: 'POST', body: { name, filterQuery } });
                toastSuccess(`Segment "${name}" created with ${summary.join(' + ')}!`);
              } catch (e: any) { toastError(e.message); }
            }}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: 'var(--bg-card-hover)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
              <Tag size={12} /> Create Segment
            </button>
            <button onClick={() => setShowDuplicates(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: 'var(--bg-card-hover)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
              <ScanSearch size={12} /> Duplicates
            </button>
            <button onClick={() => setShowFindReplace(true)}
              style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '6px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: 'var(--bg-card-hover)', color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
              <ArrowRightLeft size={12} /> Find &amp; Replace
            </button>
          </div>

          {/* ═══ ACTIVE FILTER CHIPS ═══ */}
          {(() => {
            const chips: { label: string; onRemove: () => void }[] = [];
            Object.entries(filters).forEach(([k, v]) => { if (v) chips.push({ label: `${k.replace(/_/g, ' ')}: ${v}`, onRemove: () => setFilters(prev => ({ ...prev, [k]: '' })) }); });
            advancedFilters.forEach((af, idx) => { if (af.column) chips.push({ label: `${af.column.replace(/_/g, ' ')} ${af.operator.replace(/_/g, ' ')} ${af.value || ''}`.trim(), onRemove: () => setAdvancedFilters(advancedFilters.filter((_, i) => i !== idx)) }); });
            if (search) chips.push({ label: `Search: "${search}"`, onRemove: () => setSearch('') });
            if (completenessFilter !== 'all') chips.push({ label: `Completeness: ${completenessFilter}`, onRemove: () => setCompletenessFilter('all') });
            Object.entries(quickToggles).forEach(([k, v]) => { if (v) chips.push({ label: k === 'hasEmail' ? 'Has Email' : k === 'hasPhone' ? 'Has Phone' : 'Has LinkedIn', onRemove: () => setQuickToggles(prev => ({ ...prev, [k]: false })) }); });
            if (dataSourceFilter.length > 0) chips.push({ label: `Source: ${dataSourceFilter.length === 1 ? (dataSourceOptions.find(s => s.id === dataSourceFilter[0])?.label || dataSourceFilter[0]) : `${dataSourceFilter.length} files`}`, onRemove: () => setDataSourceFilter([]) });
            if (chips.length === 0) return null;
            return (
              <div style={{ display: 'flex', gap: 6, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
                <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-tertiary)', letterSpacing: '0.05em' }}>Active:</span>
                {chips.map((c, i) => (
                  <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: 'var(--accent-muted)', color: 'var(--accent)', border: '1px solid var(--accent)' }}>
                    {c.label}
                    <X size={10} style={{ cursor: 'pointer', opacity: 0.7 }} onClick={() => { c.onRemove(); setPage(1); }} />
                  </span>
                ))}
                <button onClick={() => { setFilters({}); setAdvancedFilters([]); setSearch(''); setCompletenessFilter('all'); setQuickToggles({}); setDataSourceFilter([]); setPage(1); }}
                  style={{ fontSize: 10, fontWeight: 700, color: 'var(--red)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 6px' }}>Clear All</button>
              </div>
            );
          })()}

          {/* ═══ DRILL-DOWN FACETS ═══ */}
          {Object.keys(facets).length > 0 && (
            <div style={{
              marginBottom: 16, padding: '12px 16px', borderRadius: 12,
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              position: 'relative',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                <span style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-tertiary)', letterSpacing: '0.05em' }}>
                  🔍 Drill Deeper
                </span>
                {facetsLoading && <span style={{ fontSize: 10, color: 'var(--text-tertiary)', fontStyle: 'italic' }}>updating...</span>}
                <span style={{ fontSize: 10, color: 'var(--text-tertiary)', marginLeft: 'auto' }}>
                  Click a value to filter
                </span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {Object.entries(facets).map(([col, values]) => (
                  <div key={col} style={{ display: 'flex', gap: 6, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    <span style={{
                      fontSize: 10, fontWeight: 700, color: 'var(--text-secondary)',
                      minWidth: 90, paddingTop: 4, textTransform: 'capitalize',
                    }}>
                      {col.replace(/_/g, ' ').replace(/^personal /, '').replace(/^job title /, '')}
                    </span>
                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', flex: 1 }}>
                      {values.slice(0, 8).map(v => {
                        // Check if this value is already an active filter
                        const isActive = advancedFilters.some(af => af.column === col && af.value === v.value && af.operator === 'equals');
                        return (
                          <button
                            key={v.value}
                            disabled={isActive}
                            onClick={() => {
                              if (isActive) return;
                              filterIdCounter.current += 1;
                              setAdvancedFilters(prev => [...prev, {
                                id: filterIdCounter.current, column: col, operator: 'equals', value: v.value,
                              }]);
                              setPage(1);
                            }}
                            style={{
                              display: 'inline-flex', alignItems: 'center', gap: 4,
                              padding: '3px 8px', borderRadius: 6, fontSize: 11, fontWeight: 500,
                              cursor: isActive ? 'default' : 'pointer',
                              background: isActive ? 'var(--accent)' : 'var(--bg-hover)',
                              color: isActive ? 'var(--accent-contrast)' : 'var(--text-primary)',
                              border: `1px solid ${isActive ? 'var(--accent)' : 'var(--border)'}`,
                              opacity: isActive ? 0.6 : 1,
                              transition: 'all 0.15s',
                            }}
                            onMouseOver={e => { if (!isActive) { e.currentTarget.style.background = 'var(--accent-muted)'; e.currentTarget.style.borderColor = 'var(--accent)'; } }}
                            onMouseOut={e => { if (!isActive) { e.currentTarget.style.background = 'var(--bg-hover)'; e.currentTarget.style.borderColor = 'var(--border)'; } }}
                          >
                            {v.value}
                            <span style={{ fontSize: 9, opacity: 0.6 }}>({v.count.toLocaleString()})</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
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
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', gap: 12 }}>
                <Button icon={loading ? <Loader2 size={14} className="spin" /> : <Play size={14} />} onClick={executeSQL} disabled={loading}>{loading ? 'Running...' : 'Execute SQL (⌘+Enter)'}</Button>
                <Button variant="ghost" icon={<Copy size={14} />} onClick={() => { navigator.clipboard.writeText(query); setSuccess('Copied!'); setTimeout(() => setSuccess(null), 2000); }}>Copy SQL</Button>
                <Button variant="secondary" icon={<Save size={14} />} onClick={saveCurrentQuery}>Save Query</Button>
              </div>
              <Button variant="ghost" icon={<BookmarkCheck size={14} />} onClick={() => setShowSavedQueries(!showSavedQueries)}>
                Saved Queries ({savedQueries.length})
              </Button>
            </div>
            {showSavedQueries && savedQueries.length > 0 && (
              <div className="animate-slideDown" style={{ marginTop: 16, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                <h4 style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Saved Queries</h4>
                <div style={{ display: 'grid', gap: 8 }}>
                  {savedQueries.map((sq, i) => (
                    <div key={i} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', background: 'var(--bg-app)', border: '1px solid var(--border)', borderRadius: 8 }}>
                      <div style={{ cursor: 'pointer', flex: 1 }} onClick={() => setQuery(sq.sql)}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>{sq.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-tertiary)', fontFamily: "'JetBrains Mono', monospace", whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 400 }}>{sq.sql}</div>
                      </div>
                      <button onClick={() => removeSavedQuery(i)} style={{ color: 'var(--red)', background: 'none', border: 'none', cursor: 'pointer', padding: 4 }}>
                        <Trash2 size={14} />
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* --- NOTIFICATIONS --- */}
      {error && (
        <div style={{ marginBottom: 24, padding: '12px 18px', borderRadius: 10, background: 'var(--red-muted)', border: '1px solid var(--red)', display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--red)' }}>
          <AlertCircle size={16} /> {error}
        </div>
      )}
      {success && activeTab === 'sql' && (
        <div style={{ marginBottom: 24, padding: '12px 18px', borderRadius: 10, background: 'var(--green-muted)', border: '1px solid var(--green)', display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--green)' }}>
          <CheckCircle2 size={16} /> {success}
        </div>
      )}

      {/* --- RESULTS STATS BAR --- */}
      <div style={{
        display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16,
        padding: '12px 20px', borderRadius: 12,
        background: 'linear-gradient(135deg, color-mix(in srgb, var(--accent) 6%, var(--bg-card)), var(--bg-card))',
        border: '1px solid var(--border)',
        backdropFilter: 'blur(8px)',
      }}>
        <div style={{ display: 'flex', gap: 24, alignItems: 'center' }}>
          {/* Result count */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 8, height: 8, borderRadius: '50%', background: result ? 'var(--green)' : 'var(--text-tertiary)', boxShadow: result ? '0 0 6px var(--green)' : 'none' }} />
            <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
              {activeTab === 'browse' ? (
                loading && !result ? 'Searching...' :
                  result ? formatNumber(result.total || 0) : '—'
              ) : (result ? result.rows.length : '—')}
            </span>
            <span style={{ fontSize: 12, color: 'var(--text-tertiary)', fontWeight: 500 }}>
              {activeTab === 'browse' ? 'leads' : 'rows'}
            </span>
          </div>

          {/* Query speed */}
          {result?.elapsed && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 20, background: Number(result.elapsed) < 3000 ? 'color-mix(in srgb, var(--green) 15%, transparent)' : Number(result.elapsed) < 10000 ? 'color-mix(in srgb, var(--yellow) 15%, transparent)' : 'color-mix(in srgb, var(--red) 15%, transparent)', color: Number(result.elapsed) < 3000 ? 'var(--green)' : Number(result.elapsed) < 10000 ? 'var(--yellow, #f59e0b)' : 'var(--red)' }}>
                ⚡ {Number(result.elapsed) < 1000 ? `${result.elapsed}ms` : `${(Number(result.elapsed) / 1000).toFixed(1)}s`}
              </span>
            </div>
          )}

          {/* Active columns */}
          <span style={{ fontSize: 11, color: 'var(--text-tertiary)', fontWeight: 500 }}>
            {Object.values(visibleCols).filter(Boolean).length} columns
          </span>
        </div>

        <h3 style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)', margin: 0 }}>
          {activeTab === 'browse' ? 'Data Explorer' : 'SQL Editor'}
        </h3>
      </div>

      {/* --- PAGINATION & EXPORT BAR --- */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', alignItems: 'center', marginBottom: 16 }}>
        {/* Pagination & Export for Browse OR just Export for SQL */}
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          {activeTab === 'browse' && result && (result.total || 0) > 0 && (() => {
            const totalPages = Math.max(1, Math.ceil((result.total || 0) / pageSize));
            return (
              <>
                {/* Rows per page */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <Layers size={12} color="var(--text-tertiary)" />
                  <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }} style={{
                    background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 6,
                    color: 'var(--text-primary)', fontSize: 11, fontWeight: 600, padding: '4px 8px', cursor: 'pointer',
                  }}>
                    {PAGE_SIZES.map(s => <option key={s} value={s}>{s} rows</option>)}
                  </select>
                </div>

                {/* Data source filter — multi-select */}
                <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 4 }}>
                  <button
                    onClick={() => {
                      const el = document.getElementById('source-picker');
                      if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
                    }}
                    style={{
                      background: dataSourceFilter.length > 0 ? 'var(--accent)' : 'var(--bg-input)',
                      border: '1px solid var(--border)', borderRadius: 6,
                      color: dataSourceFilter.length > 0 ? 'var(--accent-contrast)' : 'var(--text-primary)',
                      fontSize: 11, fontWeight: 600, padding: '4px 8px', cursor: 'pointer',
                    }}
                  >
                    {dataSourceFilter.length === 0 ? 'All Sources' : dataSourceFilter.length === 1 ? (dataSourceOptions.find(s => s.id === dataSourceFilter[0])?.label || '1 file').split(' (')[0] : `${dataSourceFilter.length} files`}
                  </button>
                  <div id="source-picker" style={{
                    display: 'none', position: 'absolute', top: 32, right: 0, zIndex: 200,
                    background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10,
                    boxShadow: 'var(--shadow-lg)', padding: 8, minWidth: 280, maxHeight: 300, overflowY: 'auto',
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6, padding: '2px 4px' }}>
                      <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-tertiary)' }}>Data Sources</span>
                      {dataSourceFilter.length > 0 && (
                        <button onClick={() => { setDataSourceFilter([]); setPage(1); }} style={{ fontSize: 10, fontWeight: 700, color: 'var(--red)', background: 'none', border: 'none', cursor: 'pointer' }}>Clear</button>
                      )}
                    </div>
                    {dataSourceOptions.map(ds => (
                      <label key={ds.id} style={{
                        display: 'flex', alignItems: 'center', gap: 6, padding: '5px 6px',
                        borderRadius: 6, cursor: 'pointer', fontSize: 11, fontWeight: 500,
                        color: 'var(--text-primary)',
                      }}
                        onMouseOver={e => e.currentTarget.style.background = 'var(--bg-hover)'}
                        onMouseOut={e => e.currentTarget.style.background = 'transparent'}
                      >
                        <input
                          type="checkbox"
                          checked={dataSourceFilter.includes(ds.id)}
                          onChange={() => {
                            setDataSourceFilter(prev =>
                              prev.includes(ds.id) ? prev.filter(id => id !== ds.id) : [...prev, ds.id]
                            );
                            setPage(1);
                          }}
                          style={{ accentColor: 'var(--accent)' }}
                        />
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{ds.label}</span>
                      </label>
                    ))}
                  </div>
                </div>

                {/* Page nav */}
                <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <Button variant="ghost" disabled={page === 1} onClick={() => setPage(p => Math.max(1, p - 1))} style={{ padding: '6px 10px' }}><ChevronLeft size={16} /></Button>
                  <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4 }}>
                    Page
                    <input
                      type="number"
                      value={page}
                      min={1}
                      max={totalPages}
                      onChange={e => {
                        const v = parseInt(e.target.value, 10);
                        if (!isNaN(v) && v >= 1 && v <= totalPages) setPage(v);
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
                    of {totalPages.toLocaleString()}
                  </span>
                  <Button variant="ghost" disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} style={{ padding: '6px 10px' }}><ChevronRight size={16} /></Button>
                </div>
              </>
            );
          })()}
          {result?.rows.length ? (
            <>
              <Button variant="ghost" icon={<Download size={14} />} onClick={() => downloadCSV(sortedRows, `page${page}`)}>Export View ({sortedRows.length})</Button>
              {selectedIds.size > 0 && (
                <Button variant="ghost" icon={<Download size={14} />} onClick={() => {
                  const selectedRows = sortedRows.filter(r => selectedIds.has(String(r.up_id || r.id)));
                  downloadCSV(selectedRows, 'selected');
                }}>Export Selected ({selectedIds.size})</Button>
              )}
              <Button variant="secondary" icon={<Download size={14} />} onClick={async () => {
                try {
                  const activeFilters = Object.fromEntries(Object.entries(filters).filter(([_, v]) => v !== ''));
                  const activeCols = Object.entries(visibleCols).filter(([_, v]) => v).map(([k]) => k);
                  const afPayload = advancedFilters.filter(f => f.column && f.operator).map(f => ({ column: f.column, operator: f.operator, value: f.value }));
                  const resp = await fetch((import.meta as any).env?.VITE_API_URL ? `${(import.meta as any).env.VITE_API_URL}/api/database/export` : '/api/database/export', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      search,
                      filters: activeFilters,
                      dataSourceIds: dataSourceFilter.length > 0 ? dataSourceFilter : undefined,
                      advancedFilters: afPayload.length > 0 ? afPayload : undefined,
                      sortBy: sortCol, sortDir,
                      columns: activeCols.length > 0 ? activeCols : undefined,
                      completenessFilter: completenessFilter !== 'all' ? completenessFilter : undefined,
                    }),
                  });
                  const blob = await resp.blob();
                  const url = URL.createObjectURL(blob);
                  const link = document.createElement('a');
                  link.href = url;
                  link.download = `refinery-export-all-${Date.now()}.csv`;
                  document.body.appendChild(link);
                  link.click();
                  document.body.removeChild(link);
                  URL.revokeObjectURL(url);
                } catch (e: any) {
                  setError(`Export failed: ${e.message}`);
                }
              }}>Export All{completenessFilter !== 'all' ? ` (${completenessFilter})` : ''} ({formatNumber(result.total || 0)})</Button>
              {selectedIds.size > 0 && (
                <Button variant="primary" icon={<Trash2 size={14} />} onClick={handleBulkDelete} disabled={bulkDeleting} style={{ background: 'var(--red)', borderColor: 'var(--red)' }}>
                  {bulkDeleting ? 'Deleting...' : `Delete Selected (${selectedIds.size})`}
                </Button>
              )}
            </>
          ) : null}
        </div>
      </div>

      {activeTab === 'browse' && (result?.rows?.length ?? 0) > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 12, padding: '8px 14px', background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 11, color: 'var(--text-tertiary)' }}>
          <span style={{ fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Data Completeness</span>
          {(['all', 'high', 'medium', 'low'] as const).map(level => {
            const colors: Record<string, string> = { all: 'var(--text-secondary)', high: 'var(--green)', medium: 'var(--yellow)', low: 'var(--red)' };
            const labels: Record<string, string> = { all: 'All', high: '>80%', medium: '40–80%', low: '<40%' };
            const isActive = completenessFilter === level;
            return (
              <button key={level} onClick={() => setCompletenessFilter(level)} style={{
                display: 'flex', alignItems: 'center', gap: 5, background: isActive ? 'var(--bg-hover)' : 'transparent',
                border: isActive ? `1px solid ${colors[level]}` : '1px solid transparent', borderRadius: 6,
                padding: '3px 8px', cursor: 'pointer', color: isActive ? colors[level] : 'var(--text-tertiary)',
                fontWeight: isActive ? 700 : 400, fontSize: 11, transition: 'all 0.15s'
              }}>
                {level !== 'all' && <span style={{ width: 7, height: 7, borderRadius: '50%', background: colors[level] }} />}
                {labels[level]}
              </button>
            );
          })}
        </div>
      )}

      <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden', minHeight: 400 }}>
        {loading && !result ? (
          <SkeletonTable />
        ) : sortedRows.length > 0 ? (
          <div style={{ overflowX: 'auto', maxHeight: '70vh' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead style={{ position: 'sticky', top: 0, background: 'var(--bg-card)', zIndex: 10, borderBottom: '1px solid var(--border)' }}>
                <tr>
                  {activeTab === 'browse' && (
                    <th style={{ padding: '12px 16px', borderBottom: '1px solid var(--border)', width: 40 }}>
                      <div style={{ cursor: 'pointer', color: 'var(--text-tertiary)' }} onClick={() => {
                        if (selectedIds.size > 0) {
                          setSelectedIds(new Set());
                        } else {
                          setSelectedIds(new Set(sortedRows.map(r => String(r.up_id || r.id)).filter(Boolean)));
                        }
                      }}>
                        {selectedIds.size > 0 && selectedIds.size === sortedRows.length ? (
                          <CheckSquare size={16} color="var(--accent)" />
                        ) : selectedIds.size > 0 ? (
                          <div style={{ width: 16, height: 16, borderRadius: 3, border: '2px solid var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <div style={{ width: 8, height: 2, background: 'var(--accent)', borderRadius: 1 }} />
                          </div>
                        ) : (
                          <Square size={16} />
                        )}
                      </div>
                    </th>
                  )}
                  {resultCols.map(col => {
                    const COLUMN_ICONS: Record<string, string> = { business_email: '📧', personal_emails: '📧', company_domain: '🌐', mobile_phone: '📱', personal_phone: '📱', direct_number: '📱', company_phone: '📱', linkedin_url: '💼', company_linkedin_url: '💼', first_name: '👤', last_name: '👤', full_name: '👤', company_name: '🏢', job_title: '💼', job_title_normalized: '💼', personal_city: '📍', personal_state: '📍', country: '🌎' };
                    const icon = COLUMN_ICONS[col] || '';
                    return (
                    <th key={col}
                      style={{
                        padding: '12px 16px', textAlign: 'left', fontWeight: 700,
                        fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em',
                        color: 'var(--text-tertiary)', borderBottom: '1px solid var(--border)',
                        whiteSpace: 'nowrap', background: sortCol === col ? 'var(--bg-hover)' : 'transparent',
                        position: 'relative',
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', flex: 1 }} onClick={() => toggleSort(col)}>
                          {icon && <span style={{ fontSize: 12 }}>{icon}</span>}
                          {col.replace(/_/g, ' ')}
                          {sortCol === col && (sortDir === 'asc' ? <ChevronUp size={12} /> : <ChevronDown size={12} />)}
                        </span>
                        {activeTab === 'browse' && (
                          <BarChart2 size={12} style={{ cursor: 'pointer', opacity: 0.5 }} onClick={() => showColumnStats(col)} />
                        )}
                      </div>
                    </th>
                    );
                  })}
                </tr>
              </thead>
              <tbody>
                {sortedRows.map((row, i) => {
                  const rowId = String(row.up_id || row.id);
                  const isSelected = selectedIds.has(rowId);

                  // Completeness score using named constants
                  const values = Object.values(row).filter(v => v !== null && v !== '');
                  const score = values.length / resultCols.length;
                  const completenessColor = score > COMPLETENESS_HIGH ? 'var(--green)' : score > COMPLETENESS_LOW ? 'var(--yellow)' : 'var(--red)';

                  return (
                    <tr key={i} style={{ transition: 'background 0.1s', cursor: 'pointer', background: isSelected ? 'var(--bg-hover)' : 'transparent' }}
                      onMouseOver={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
                      onMouseOut={e => (e.currentTarget.style.background = isSelected ? 'var(--bg-hover)' : 'transparent')}>

                      {activeTab === 'browse' && (
                        <td style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', verticalAlign: 'middle' }}
                          onClick={(e) => { e.stopPropagation(); const newIds = new Set(selectedIds); if (isSelected) newIds.delete(rowId); else newIds.add(rowId); setSelectedIds(newIds); }}>
                          <div style={{ color: isSelected ? 'var(--accent)' : 'var(--border)' }}>
                            {isSelected ? <CheckSquare size={16} /> : <Square size={16} />}
                          </div>
                        </td>
                      )}

                      {activeTab === 'browse' && (
                        <td style={{ padding: '10px 8px 10px 16px', borderBottom: '1px solid var(--border)', fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', fontFamily: "'JetBrains Mono', monospace", width: 40, textAlign: 'right' }}>
                          {(page - 1) * pageSize + i + 1}
                        </td>
                      )}

                      {resultCols.map((col, cIdx) => {
                        const val = row[col];
                        const valStr = val === null || val === undefined ? '' : String(val);
                        // Color coding for data types
                        const EMAIL_COLS = ['business_email', 'personal_emails', 'additional_personal_emails', 'programmatic_business_emails'];
                        const PHONE_COLS = ['mobile_phone', 'personal_phone', 'direct_number', 'company_phone'];
                        const DOMAIN_COLS = ['company_domain', 'related_domains'];
                        const LINKEDIN_COLS = ['linkedin_url', 'company_linkedin_url'];
                        const isClickable = valStr && (EMAIL_COLS.includes(col) || PHONE_COLS.includes(col) || DOMAIN_COLS.includes(col) || LINKEDIN_COLS.includes(col));
                        const cellColor = !valStr ? 'var(--text-tertiary)' : EMAIL_COLS.includes(col) ? '#818cf8' : PHONE_COLS.includes(col) ? '#34d399' : DOMAIN_COLS.includes(col) ? '#60a5fa' : LINKEDIN_COLS.includes(col) ? '#0077b5' : 'var(--text-secondary)';
                        return (
                          <td key={col}
                            onClick={() => {
                              if (isClickable) {
                                navigator.clipboard.writeText(valStr);
                                toastSuccess(`Copied: ${valStr}`);
                              } else {
                                setSelectedRow(row);
                              }
                            }}
                            onDoubleClick={(e) => {
                              e.stopPropagation();
                              if (!valStr) return;
                              filterIdCounter.current += 1;
                              setAdvancedFilters(prev => [...prev, { id: filterIdCounter.current, column: col, operator: 'equals', value: valStr }]);
                              setPage(1);
                              toastSuccess(`Filtered: ${col.replace(/_/g, ' ')} = "${valStr}"`);
                            }}
                            style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: cellColor, position: 'relative', cursor: isClickable ? 'copy' : 'pointer' }} title={isClickable ? `Click to copy: ${valStr}\nDouble-click to filter` : `${valStr || '—'}\n\nDouble-click to filter by this value`}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                              {cIdx === 0 && <span style={{ width: 6, height: 6, borderRadius: '50%', background: completenessColor, flexShrink: 0 }} title={`Data Completeness`} />}
                              <span>{!valStr ? <span style={{ color: 'var(--text-tertiary)', fontStyle: 'italic' }}>—</span> : valStr}</span>
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
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

      {/* Column Stats Popover */}
      {statsColumn && (
        <div onClick={() => setStatsColumn(null)} style={{ position: 'fixed', inset: 0, zIndex: 150, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <div className="animate-scaleIn" onClick={e => e.stopPropagation()} style={{ background: 'var(--bg-card)', width: 400, borderRadius: 16, border: '1px solid var(--border)', overflow: 'hidden', boxShadow: 'var(--shadow-xl)' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h4 style={{ margin: 0, fontSize: 13, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-primary)' }}>Top {statsColumn.replace(/_/g, ' ')}</h4>
              <X size={16} style={{ cursor: 'pointer', color: 'var(--text-tertiary)' }} onClick={() => setStatsColumn(null)} />
            </div>
            <div style={{ padding: 20, maxHeight: 400, overflowY: 'auto' }}>
              {loadingStats ? <div style={{ textAlign: 'center', padding: 20 }}><Loader2 size={24} className="spin" style={{ color: 'var(--accent)' }} /></div> : (
                columnStats.length === 0 ? <div style={{ color: 'var(--text-tertiary)', textAlign: 'center', padding: 20 }}>No common values found</div> :
                  columnStats.map((s, idx) => {
                    const maxCount = parseInt(columnStats[0].count);
                    const pct = (parseInt(s.count) / maxCount) * 100;
                    return (
                      <div key={idx} style={{ marginBottom: 12 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, marginBottom: 4 }}>
                          <span style={{ color: 'var(--text-primary)', fontWeight: 600, maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={s.value}>{s.value}</span>
                          <span style={{ color: 'var(--text-secondary)' }}>{formatNumber(s.count)}</span>
                        </div>
                        <div style={{ width: '100%', height: 6, background: 'var(--bg-app)', borderRadius: 3, overflow: 'hidden' }}>
                          <div style={{ width: `${pct}%`, height: '100%', background: 'var(--accent)', borderRadius: 3 }} />
                        </div>
                      </div>
                    );
                  })
              )}
            </div>
          </div>
        </div>
      )}

      {/* Row Detail Drawer (Slide from Right) */}
      {selectedRow && (
        <>
          <div onClick={() => setSelectedRow(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)', backdropFilter: 'blur(2px)', zIndex: 200, animation: 'fadeIn 0.2s' }} />
          <div className="animate-slideIn" style={{
            position: 'fixed', top: 0, right: 0, bottom: 0, width: '100%', maxWidth: 500,
            background: 'var(--bg-app)', borderLeft: '1px solid var(--border)', boxShadow: '-10px 0 25px rgba(0,0,0,0.2)',
            zIndex: 210, display: 'flex', flexDirection: 'column',
          }}>
            <div style={{
              display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              padding: '24px', borderBottom: '1px solid var(--border)', background: 'var(--bg-card)'
            }}>
              <div>
                <h3 style={{ margin: 0, fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Sidebar size={18} style={{ color: 'var(--accent)' }} /> Profile Viewer
                </h3>
                <div style={{ fontSize: 13, color: 'var(--text-tertiary)', marginTop: 4 }}>
                  ID: {String(selectedRow.up_id || selectedRow.id || 'Unknown')}
                </div>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  onClick={() => {
                    navigator.clipboard.writeText(JSON.stringify(selectedRow, null, 2));
                    toastSuccess('JSON copied to clipboard');
                  }}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: 36, height: 36, borderRadius: 10, cursor: 'pointer',
                    background: 'var(--bg-hover)', border: '1px solid var(--border)', color: 'var(--text-secondary)',
                  }} title="Copy JSON"
                >
                  <Copy size={16} />
                </button>
                <button
                  onClick={() => setSelectedRow(null)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    width: 36, height: 36, borderRadius: 10, cursor: 'pointer',
                    background: 'var(--bg-hover)', border: 'none', color: 'var(--text-tertiary)',
                  }} title="Close"
                >
                  <X size={18} />
                </button>
              </div>
            </div>

            <div style={{ overflowY: 'auto', padding: '24px', flex: 1 }}>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                {Object.entries(selectedRow).map(([key, value]) => {
                  const isEmpty = value === null || value === undefined || value === '';
                  return (
                    <div key={key} style={{
                      background: 'var(--bg-card)', padding: '12px 16px', borderRadius: 12,
                      border: '1px solid var(--border)', borderLeft: isEmpty ? '3px solid var(--border)' : '3px solid var(--accent)'
                    }}>
                      <div style={{
                        fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
                        letterSpacing: '0.05em', color: 'var(--text-tertiary)', marginBottom: 6
                      }}>
                        {String(key).replace(/_/g, ' ')}
                      </div>
                      <div style={{
                        fontSize: 14, color: isEmpty ? 'var(--text-tertiary)' : 'var(--text-primary)',
                        fontStyle: isEmpty ? 'italic' : 'normal', wordBreak: 'break-all', fontWeight: 500,
                      }}>
                        {isEmpty ? 'Not provided' : String(value)}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </>
      )}
      {/* ═══ FIND & REPLACE MODAL ═══ */}
      {showFindReplace && (
        <>
          <div onClick={() => setShowFindReplace(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200 }} />
          <div className="animate-scaleIn" style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 210, width: 440, background: 'var(--bg-card)', borderRadius: 16, border: '1px solid var(--border)', boxShadow: 'var(--shadow-xl)', overflow: 'hidden' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}><Replace size={16} color="var(--accent)" /> Find &amp; Replace</h4>
              <X size={16} style={{ cursor: 'pointer', color: 'var(--text-tertiary)' }} onClick={() => { setShowFindReplace(false); setFrPreviewCount(null); }} />
            </div>
            <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
              <select value={frColumn} onChange={e => { setFrColumn(e.target.value); setFrPreviewCount(null); }}
                style={{ padding: '10px 12px', borderRadius: 10, fontSize: 13, background: 'var(--bg-input)', border: '1px solid var(--border)', color: frColumn ? 'var(--text-primary)' : 'var(--text-tertiary)', cursor: 'pointer' }}>
                <option value="">Select Column...</option>
                {allColumns.map(c => <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>)}
              </select>
              <div style={{ display: 'flex', gap: 8 }}>
                {(['exact', 'contains'] as const).map(m => (
                  <button key={m} onClick={() => { setFrMatchMode(m); setFrPreviewCount(null); }}
                    style={{ flex: 1, padding: '6px 12px', borderRadius: 8, fontSize: 11, fontWeight: 700, cursor: 'pointer', background: frMatchMode === m ? 'var(--accent)' : 'var(--bg-hover)', color: frMatchMode === m ? 'var(--accent-contrast)' : 'var(--text-secondary)', border: `1px solid ${frMatchMode === m ? 'var(--accent)' : 'var(--border)'}` }}>
                    {m === 'exact' ? 'Exact Match' : 'Contains'}
                  </button>
                ))}
              </div>
              <input type="text" placeholder={frMatchMode === 'exact' ? 'Find exact value...' : 'Find text containing...'} value={frFind} onChange={e => { setFrFind(e.target.value); setFrPreviewCount(null); }}
                style={{ padding: '10px 12px', borderRadius: 10, fontSize: 13, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', outline: 'none' }} />
              <input type="text" placeholder="Replace with..." value={frReplace} onChange={e => setFrReplace(e.target.value)}
                style={{ padding: '10px 12px', borderRadius: 10, fontSize: 13, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', outline: 'none' }} />
              {frPreviewCount !== null && (
                <div style={{ padding: '8px 12px', borderRadius: 8, background: frPreviewCount > 0 ? 'var(--yellow-muted)' : 'var(--green-muted)', fontSize: 12, fontWeight: 600, color: frPreviewCount > 0 ? 'var(--yellow)' : 'var(--green)' }}>
                  {frPreviewCount > 0 ? `⚠️ ${frPreviewCount.toLocaleString()} rows will be affected` : '✅ No matching rows found'}
                </div>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <button disabled={!frColumn || !frFind} onClick={async () => {
                  try {
                    const res = await apiCall<{ updated: number }>('/api/database/find-replace-preview', { method: 'POST', body: { column: frColumn, findValue: frFind, matchMode: frMatchMode } });
                    setFrPreviewCount(res.updated);
                  } catch { setFrPreviewCount(0); }
                }}
                  style={{ flex: 1, padding: '10px 16px', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer', background: 'var(--bg-hover)', color: 'var(--text-primary)', border: '1px solid var(--border)' }}>
                  Preview Count
                </button>
                <button disabled={!frColumn || !frFind || frProcessing} onClick={async () => {
                  const count = frPreviewCount ?? '(unknown)';
                  if (!confirm(`Replace ${count} occurrences of "${frFind}" with "${frReplace}" in ${frColumn}?`)) return;
                  setFrProcessing(true);
                  try {
                    const res = await apiCall<{ updated: number }>('/api/database/find-replace', { method: 'POST', body: { column: frColumn, findValue: frFind, replaceValue: frReplace, matchMode: frMatchMode } });
                    toastSuccess(`Updated ${res.updated.toLocaleString()} rows`);
                    setShowFindReplace(false); setFrFind(''); setFrReplace(''); setFrPreviewCount(null); runBrowse();
                  } catch (e: any) { toastError(e.message); }
                  setFrProcessing(false);
                }}
                  style={{ flex: 1, padding: '10px 16px', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer', background: (!frColumn || !frFind || frProcessing) ? 'var(--bg-hover)' : 'var(--red)', color: (!frColumn || !frFind || frProcessing) ? 'var(--text-tertiary)' : 'var(--accent-contrast)', border: 'none', transition: 'all 0.15s' }}>
                  {frProcessing ? 'Processing...' : 'Replace All'}
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ═══ DUPLICATE DETECTION MODAL ═══ */}
      {showDuplicates && (
        <>
          <div onClick={() => setShowDuplicates(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', zIndex: 200 }} />
          <div className="animate-scaleIn" style={{ position: 'fixed', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', zIndex: 210, width: 500, maxHeight: '70vh', background: 'var(--bg-card)', borderRadius: 16, border: '1px solid var(--border)', boxShadow: 'var(--shadow-xl)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h4 style={{ margin: 0, fontSize: 14, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}><ScanSearch size={16} color="var(--accent)" /> Duplicate Detection</h4>
              <X size={16} style={{ cursor: 'pointer', color: 'var(--text-tertiary)' }} onClick={() => setShowDuplicates(false)} />
            </div>
            <div style={{ padding: '16px 20px', display: 'flex', gap: 8, alignItems: 'center' }}>
              <select value={dupColumn} onChange={e => setDupColumn(e.target.value)}
                style={{ flex: 1, padding: '10px 12px', borderRadius: 10, fontSize: 13, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', cursor: 'pointer' }}>
                {['business_email', 'personal_emails', 'mobile_phone', 'linkedin_url', 'first_name', 'last_name', 'company_name', ...allColumns.filter(c => !['business_email', 'personal_emails', 'mobile_phone', 'linkedin_url', 'first_name', 'last_name', 'company_name'].includes(c))].map(c => (
                  <option key={c} value={c}>{c.replace(/_/g, ' ')}</option>
                ))}
              </select>
              <button onClick={async () => {
                setDupLoading(true); setDupResults([]);
                try {
                  const res = await apiCall<{ value: string; cnt: string }[]>('/api/database/duplicates', { method: 'POST', body: { column: dupColumn } });
                  setDupResults(res || []);
                } catch (e: any) { toastError(e.message); }
                setDupLoading(false);
              }}
                style={{ padding: '10px 16px', borderRadius: 10, fontSize: 13, fontWeight: 700, cursor: 'pointer', background: 'var(--accent)', color: 'var(--accent-contrast)', border: 'none', whiteSpace: 'nowrap' }}>
                {dupLoading ? <Loader2 size={14} className="spin" /> : 'Scan'}
              </button>
            </div>
            <div style={{ overflowY: 'auto', flex: 1, padding: '0 20px 16px' }}>
              {dupLoading && <div style={{ textAlign: 'center', padding: 20 }}><Loader2 size={24} className="spin" style={{ color: 'var(--accent)' }} /></div>}
              {!dupLoading && dupResults.length === 0 && <div style={{ textAlign: 'center', padding: 20, color: 'var(--text-tertiary)', fontSize: 13 }}>No duplicates found (or click Scan)</div>}
              {dupResults.map((d, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
                  <span style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={d.value}>
                    {d.value}
                  </span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--red)', background: 'rgba(239,68,68,0.1)', padding: '2px 8px', borderRadius: 10 }}>{Number(d.cnt).toLocaleString()}×</span>
                    <button onClick={() => {
                      filterIdCounter.current += 1;
                      setAdvancedFilters(prev => [...prev, { id: filterIdCounter.current, column: dupColumn, operator: 'equals', value: d.value }]);
                      setPage(1); setShowDuplicates(false);
                      toastSuccess(`Filtered to "${d.value}" duplicates`);
                    }}
                      style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6, cursor: 'pointer', background: 'transparent', border: '1px solid var(--accent)', color: 'var(--accent)' }}>
                      Filter
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
      {/* Cortex AI Agent — Data Analysis */}
      <div style={{ marginTop: 24, marginBottom: 24 }}>
        <AgentCard
          slug="data_scientist"
          contextLabel="Data Analysis — Universal Person Database"
          context={{
            totalRows: stats?.totalRows,
            totalBytes: stats?.totalBytes,
            tableCount: stats?.tableCount,
            segmentCount: stats?.segmentCount,
            tables: tables.map(t => ({ name: t.table, rows: t.rows, size: t.bytes_on_disk })),
            columns: allColumns,
            currentFilters: Object.entries(filters).filter(([_, v]) => v).length,
            visibleColumns: Object.entries(visibleCols).filter(([_, v]) => v).map(([k]) => k),
          }}
        />
      </div>
    </>
  );
}
