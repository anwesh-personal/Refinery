import { useState, useEffect, useCallback, useRef } from 'react';
import { Loader2, CheckCircle2, AlertCircle, ChevronRight, ChevronLeft, Search, Download, GitMerge, FileText, X, ArrowUp, ArrowDown, GripVertical, AlertTriangle, Sparkles, Crown, Eye, BarChart3, Clock, Shield } from 'lucide-react';
import { apiCall } from '../lib/api';
import { Button } from '../components/UI';
import AgentCard from '../components/AgentCard';

// ═══════════════════════════════════════════════════════════════
// MERGE PLAYGROUND — Multi-file selective data consolidation
// ═══════════════════════════════════════════════════════════════

interface MergeSource {
  jobId: string;
  fileName: string;
  sourceKey: string;
  rowCount: number;
  completedAt: string;
  columns: string[];
  columnCount: number;
}

interface KeyCandidate {
  column: string;
  type: string;
  filesPresent: number;
  totalFiles: number;
  perFile: { jobId: string; fileName: string; uniqueValues: number; fillRate: number }[];
  overlapCount: number;
  overlapRate: number;
  recommendation: 'excellent' | 'good' | 'poor';
}

interface MergePreviewData {
  columns: string[];
  mergeKey: string;
  rows: Record<string, any>[];
  total: number;
  totalBefore: number;
  orphanRows: number;
  reduction: number;
  page: number;
  pageSize: number;
}

interface ConflictSample {
  keyValue: string;
  conflicts: {
    column: string;
    perFile: { jobId: string; value: string }[];
    resolvedValue: string;
    resolvedFromJobId: string;
  }[];
}

interface ConflictData {
  totalConflictKeys: number;
  totalConflictCells: number;
  samples: ConflictSample[];
}

interface MergeReport {
  success: boolean;
  mergeKey: string;
  totalBefore: number;
  totalAfter: number;
  rowsConsolidated: number;
  reductionPercent: number;
  filesCount: number;
  priorityApplied: boolean;
  performedBy: string;
  performedAt: string;
}

type MergeStep = 1 | 2 | 3 | 4;

const STEP_LABELS: Record<MergeStep, string> = {
  1: 'Select Files',
  2: 'Detect Keys',
  3: 'Configure & Prioritize',
  4: 'Preview & Execute',
};

const REC_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  excellent: { bg: 'var(--green-muted)', text: 'var(--green)', label: 'Excellent' },
  good: { bg: 'var(--yellow-muted)', text: 'var(--yellow)', label: 'Good' },
  poor: { bg: 'var(--red-muted)', text: 'var(--red)', label: 'Poor' },
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

export default function MergePlayground() {
  // ── Step state ──
  const [step, setStep] = useState<MergeStep>(1);

  // ── Step 1: File Selection ──
  const [sources, setSources] = useState<MergeSource[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(false);
  const [selectedJobIds, setSelectedJobIds] = useState<Set<string>>(new Set());
  const [fileSearch, setFileSearch] = useState('');

  // ── Step 2: Key Detection ──
  const [keyCandidates, setKeyCandidates] = useState<KeyCandidate[]>([]);
  const [keysLoading, setKeysLoading] = useState(false);
  const [selectedKey, setSelectedKey] = useState('');

  // ── Step 3: Column Mapping + Priority ──
  const [excludedColumns, setExcludedColumns] = useState<Set<string>>(new Set());
  const [priorityOrder, setPriorityOrder] = useState<string[]>([]);

  // ── Step 4: Preview & Execute ──
  const [preview, setPreview] = useState<MergePreviewData | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewPage, setPreviewPage] = useState(1);
  const [previewSearch, setPreviewSearch] = useState('');
  const [previewSortBy, setPreviewSortBy] = useState('');
  const [previewSortDir, setPreviewSortDir] = useState<'asc' | 'desc'>('asc');
  const [executing, setExecuting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [previewPageSize, setPreviewPageSize] = useState(50);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // ── Conflict Analysis ──
  const [conflictData, setConflictData] = useState<ConflictData | null>(null);
  const [conflictLoading, setConflictLoading] = useState(false);
  const [showConflicts, setShowConflicts] = useState(false);

  // ── Merge Report ──
  const [mergeReport, setMergeReport] = useState<MergeReport | null>(null);
  const [showMergeReport, setShowMergeReport] = useState(false);

  // ── Animation / UX ──
  const [stepLoading, setStepLoading] = useState(false);

  // ── Load sources on mount ──
  useEffect(() => {
    loadSources();
  }, []);

  const loadSources = async () => {
    setSourcesLoading(true);
    try {
      const data = await apiCall<{ sources: MergeSource[] }>('/api/ingestion/merge/sources');
      setSources(data.sources || []);
    } catch (e: any) {
      setMessage({ text: e.message, type: 'error' });
    }
    setSourcesLoading(false);
  };

  const loadKeys = useCallback(async () => {
    if (selectedJobIds.size < 2) return;
    setKeysLoading(true);
    try {
      const ids = Array.from(selectedJobIds).join(',');
      const data = await apiCall<{ candidates: KeyCandidate[] }>(`/api/ingestion/merge/common-keys?jobIds=${ids}`);
      setKeyCandidates(data.candidates || []);
      // Auto-select best candidate
      if (data.candidates?.length > 0 && !selectedKey) {
        setSelectedKey(data.candidates[0].column);
      }
    } catch (e: any) {
      setMessage({ text: e.message, type: 'error' });
    }
    setKeysLoading(false);
  }, [selectedJobIds, selectedKey]);

  const loadPreview = useCallback(async (page = 1, search = '', sortBy = '', sortDir: 'asc' | 'desc' = 'asc') => {
    if (selectedJobIds.size < 2 || !selectedKey) return;
    setPreviewLoading(true);
    try {
      const ids = Array.from(selectedJobIds).join(',');
      const excludeCols = Array.from(excludedColumns).join(',');
      const params = new URLSearchParams({
        jobIds: ids, key: selectedKey, page: String(page), pageSize: String(previewPageSize),
        ...(search ? { search } : {}),
        ...(sortBy ? { sortBy, sortDir } : {}),
        ...(excludeCols ? { excludeCols } : {}),
        ...(priorityOrder.length > 0 ? { priority: priorityOrder.join(',') } : {}),
      });
      const data = await apiCall<MergePreviewData>(`/api/ingestion/merge/preview-selective?${params}`);
      setPreview(data);
    } catch (e: any) {
      setMessage({ text: e.message, type: 'error' });
    }
    setPreviewLoading(false);
  }, [selectedJobIds, selectedKey, excludedColumns, priorityOrder, previewPageSize]);

  const loadConflicts = useCallback(async () => {
    if (selectedJobIds.size < 2 || !selectedKey) return;
    setConflictLoading(true);
    try {
      const ids = Array.from(selectedJobIds).join(',');
      const priorityParam = priorityOrder.length > 0 ? `&priority=${priorityOrder.join(',')}` : '';
      const data = await apiCall<ConflictData>(`/api/ingestion/merge/conflict-sample?jobIds=${ids}&key=${selectedKey}${priorityParam}`);
      setConflictData(data);
    } catch { setConflictData(null); }
    setConflictLoading(false);
  }, [selectedJobIds, selectedKey, priorityOrder]);

  const executeMerge = async () => {
    if (!selectedKey || selectedJobIds.size < 2) return;
    const beforeMsg = preview
      ? `${preview.totalBefore.toLocaleString()} → ~${preview.total.toLocaleString()} rows (${preview.reduction}% reduction)`
      : 'Unknown row count';
    if (!confirm(`⚡ MATERIALIZE MERGE\n\nMerge key: ${selectedKey}\nFiles: ${selectedJobIds.size}\n${beforeMsg}\n\nThis CANNOT be undone. Proceed?`)) return;

    setExecuting(true);
    try {
      const result = await apiCall<MergeReport>('/api/ingestion/merge/execute-selective', {
        method: 'POST',
        body: {
          jobIds: Array.from(selectedJobIds),
          key: selectedKey,
          excludeColumns: Array.from(excludedColumns),
          priorityJobIds: priorityOrder.length > 0 ? priorityOrder : undefined,
        },
      });
      setMergeReport(result);
      setShowMergeReport(true);
      loadSources();
    } catch (e: any) {
      setMessage({ text: e.message, type: 'error' });
    }
    setExecuting(false);
  };

  const exportMerge = async () => {
    if (!selectedKey || selectedJobIds.size < 2) return;
    setExporting(true);
    try {
      const ids = Array.from(selectedJobIds).join(',');
      const priorityParam = priorityOrder.length > 0 ? `&priority=${priorityOrder.join(',')}` : '';
      const excludeParam = excludedColumns.size > 0 ? `&excludeCols=${Array.from(excludedColumns).join(',')}` : '';
      const blob = await apiCall<Blob>(`/api/ingestion/merge/export-selective?jobIds=${ids}&key=${selectedKey}${priorityParam}${excludeParam}`, { responseType: 'blob' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `merged-${selectedKey}-${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setMessage({ text: e.message, type: 'error' });
    }
    setExporting(false);
  };

  // ── Derived state ──
  const selectedSources = sources.filter(s => selectedJobIds.has(s.jobId));
  const totalSelectedRows = selectedSources.reduce((acc, s) => acc + s.rowCount, 0);
  const filteredSources = sources.filter(s =>
    !fileSearch || s.fileName.toLowerCase().includes(fileSearch.toLowerCase())
  );

  // Get all unique columns from selected sources for Step 3
  const allSelectedColumns = Array.from(new Set(selectedSources.flatMap(s => s.columns)));

  const toggleJob = (jobId: string) => {
    setSelectedJobIds(prev => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId);
      else next.add(jobId);
      return next;
    });
  };

  const toggleColumn = (col: string) => {
    if (col === selectedKey) return; // can't exclude merge key
    setExcludedColumns(prev => {
      const next = new Set(prev);
      if (next.has(col)) next.delete(col);
      else next.add(col);
      return next;
    });
  };

  const canAdvance = (s: MergeStep): boolean => {
    if (s === 1) return selectedJobIds.size >= 2;
    if (s === 2) return !!selectedKey;
    if (s === 3) return true;
    return false;
  };

  // Auto-dismiss messages after 6 seconds
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(() => setMessage(null), 6000);
    return () => clearTimeout(timer);
  }, [message]);

  const getFileName = (jobId: string): string => {
    return sources.find(s => s.jobId === jobId)?.fileName || jobId.slice(0, 8);
  };

  const goToStep = async (s: MergeStep) => {
    setStepLoading(true);
    try {
      if (s === 2 && selectedJobIds.size >= 2) {
        await loadKeys();
      }
      if (s === 3) {
        const currentIds = Array.from(selectedJobIds);
        const validPriority = priorityOrder.filter(id => currentIds.includes(id));
        const missing = currentIds.filter(id => !validPriority.includes(id));
        setPriorityOrder([...validPriority, ...missing]);
      }
      if (s === 4) {
        await Promise.all([
          loadPreview(1, '', '', 'asc'),
          loadConflicts(),
        ]);
        setPreviewPage(1);
        setPreviewSearch('');
        setPreviewSortBy('');
        setPreviewSortDir('asc');
      }
      setStep(s);
    } finally {
      setStepLoading(false);
    }
  };

  return (
    <>
    {/* CSS animations */}
    <style>{`
      @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
      @keyframes slideUp { from { opacity: 0; transform: translateY(24px) } to { opacity: 1; transform: translateY(0) } }
      @keyframes slideInRight { from { opacity: 0; transform: translateX(16px) } to { opacity: 1; transform: translateX(0) } }
    `}</style>
    <div style={{ padding: 0 }}>
      {/* ── Message Banner ── */}
      {message && (
        <div style={{
          padding: '10px 16px', borderRadius: 10, marginBottom: 20,
          display: 'flex', alignItems: 'center', gap: 10,
          background: message.type === 'success' ? 'var(--green-muted)' : 'var(--red-muted)',
          color: message.type === 'success' ? 'var(--green)' : 'var(--red)',
          fontSize: 13, fontWeight: 600,
        }}>
          {message.type === 'success' ? <CheckCircle2 size={16} /> : <AlertCircle size={16} />}
          {message.text}
          <button onClick={() => setMessage(null)} style={{ marginLeft: 'auto', background: 'none', border: 'none', color: 'inherit', cursor: 'pointer' }}>
            <X size={14} />
          </button>
        </div>
      )}

      {/* ── Step Indicator ── */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 0, marginBottom: 28,
        background: 'var(--bg-card)', borderRadius: 12, padding: '6px 6px',
        border: '1px solid var(--border)',
      }}>
        {([1, 2, 3, 4] as MergeStep[]).map((s, i) => (
          <div key={s} style={{ display: 'flex', alignItems: 'center', flex: 1 }}>
            <button
              onClick={() => s <= step && goToStep(s)}
              disabled={s > step}
              style={{
                flex: 1, padding: '10px 12px', borderRadius: 8, border: 'none',
                cursor: s <= step ? 'pointer' : 'default',
                background: s === step ? 'var(--accent)' : s < step ? 'var(--green-muted)' : 'transparent',
                color: s === step ? 'var(--accent-contrast)' : s < step ? 'var(--green)' : 'var(--text-tertiary)',
                fontSize: 12, fontWeight: s === step ? 700 : 600,
                transition: 'all 0.2s',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              }}
            >
              <span style={{
                width: 22, height: 22, borderRadius: '50%', display: 'flex',
                alignItems: 'center', justifyContent: 'center',
                background: s === step ? 'var(--accent-muted)' : s < step ? 'var(--green)' : 'var(--bg-hover)',
                color: s < step ? 'var(--accent-contrast)' : undefined,
                fontSize: 11, fontWeight: 700,
              }}>
                {s < step ? '✓' : s}
              </span>
              {STEP_LABELS[s]}
            </button>
            {i < 3 && <ChevronRight size={14} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />}
          </div>
        ))}
      </div>

      {/* ═══ STEP 1: SELECT FILES ═══ */}
      {step === 1 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
            <div>
              <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>Select Files to Merge</h3>
              <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-tertiary)' }}>
                Choose 2 or more ingested files. Rows from these files will be consolidated by a shared key.
              </p>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ position: 'relative' }}>
                <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
                <input
                  type="text" placeholder="Search files…" value={fileSearch} onChange={e => setFileSearch(e.target.value)}
                  style={{
                    padding: '7px 12px 7px 30px', borderRadius: 8, border: '1px solid var(--border)',
                    background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 12, width: 200,
                  }}
                />
              </div>
            </div>
          </div>

          {sourcesLoading ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-tertiary)' }}>
              <Loader2 size={24} className="spin" />
              <div style={{ marginTop: 8, fontSize: 13 }}>Loading ingestion jobs…</div>
            </div>
          ) : filteredSources.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-tertiary)', fontSize: 13 }}>
              No completed ingestion jobs found. Ingest data first.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
              {filteredSources.map(src => {
                const selected = selectedJobIds.has(src.jobId);
                return (
                  <div
                    key={src.jobId}
                    onClick={() => toggleJob(src.jobId)}
                    style={{
                      background: selected ? 'var(--bg-hover)' : 'var(--bg-card)',
                      border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
                      borderRadius: 12, padding: 16, cursor: 'pointer',
                      transition: 'all 0.2s', position: 'relative',
                      boxShadow: selected ? '0 0 0 1px var(--accent)' : 'none',
                    }}
                    onMouseEnter={e => { if (!selected) e.currentTarget.style.borderColor = 'var(--accent)'; }}
                    onMouseLeave={e => { if (!selected) e.currentTarget.style.borderColor = 'var(--border)'; }}
                  >
                    {/* Checkbox */}
                    <div style={{
                      position: 'absolute', top: 12, right: 12,
                      width: 20, height: 20, borderRadius: 6,
                      border: `2px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
                      background: selected ? 'var(--accent)' : 'transparent',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      transition: 'all 0.15s',
                    }}>
                      {selected && <span style={{ color: 'var(--accent-contrast)', fontSize: 12, fontWeight: 700 }}>✓</span>}
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
                      <FileText size={16} color={selected ? 'var(--accent)' : 'var(--text-tertiary)'} />
                      <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {src.fileName}
                      </span>
                    </div>

                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: 'var(--bg-hover)', color: 'var(--text-secondary)' }}>
                        {src.rowCount.toLocaleString()} rows
                      </span>
                      <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: 'var(--bg-hover)', color: 'var(--text-secondary)' }}>
                        {src.columnCount} cols
                      </span>
                      <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 4, background: 'var(--bg-hover)', color: 'var(--text-tertiary)' }}>
                        {timeAgo(src.completedAt)}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Bottom bar */}
          <div style={{
            marginTop: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 16px', borderRadius: 10, background: 'var(--bg-card)', border: '1px solid var(--border)',
          }}>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              <strong style={{ color: 'var(--accent)' }}>{selectedJobIds.size}</strong> file{selectedJobIds.size !== 1 ? 's' : ''} selected
              {selectedJobIds.size >= 2 && <span> • {totalSelectedRows.toLocaleString()} total rows</span>}
            </div>
            <Button
              disabled={!canAdvance(1) || stepLoading}
              onClick={() => goToStep(2)}
              style={{ padding: '8px 20px', fontSize: 12, fontWeight: 700, opacity: canAdvance(1) ? 1 : 0.4 }}
              icon={stepLoading ? <Loader2 size={14} className="spin" /> : <ChevronRight size={14} />}
            >
              {stepLoading ? 'Analyzing…' : 'Next: Detect Keys'}
            </Button>
          </div>
        </div>
      )}

      {/* ═══ STEP 2: DETECT KEYS ═══ */}
      {step === 2 && (
        <div>
          <div style={{ marginBottom: 16 }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>Detect Common Merge Key</h3>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-tertiary)' }}>
              Select the column that links rows across your {selectedJobIds.size} files. Higher overlap rate = better merge.
            </p>
          </div>

          {keysLoading ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-tertiary)' }}>
              <Loader2 size={24} className="spin" />
              <div style={{ marginTop: 8, fontSize: 13 }}>Analyzing columns across {selectedJobIds.size} files…</div>
            </div>
          ) : keyCandidates.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-tertiary)', fontSize: 13 }}>
              No common columns found across selected files. Select different files.
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {keyCandidates.map(candidate => {
                const isSelected = selectedKey === candidate.column;
                const rec = REC_COLORS[candidate.recommendation] || REC_COLORS.poor;
                return (
                  <div
                    key={candidate.column}
                    onClick={() => setSelectedKey(candidate.column)}
                    style={{
                      background: isSelected ? 'var(--bg-hover)' : 'var(--bg-card)',
                      border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
                      borderRadius: 12, padding: 16, cursor: 'pointer', transition: 'all 0.2s',
                      boxShadow: isSelected ? '0 0 0 1px var(--accent)' : 'none',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        {/* Radio */}
                        <div style={{
                          width: 18, height: 18, borderRadius: '50%',
                          border: `2px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                          {isSelected && <div style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--accent)' }} />}
                        </div>
                        <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{candidate.column}</span>
                        <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>({candidate.type})</span>
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{
                          padding: '3px 10px', borderRadius: 6, fontSize: 10, fontWeight: 700,
                          background: rec.bg, color: rec.text, textTransform: 'uppercase', letterSpacing: '0.05em',
                        }}>
                          {rec.label}
                        </span>
                        <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>
                          {candidate.filesPresent}/{candidate.totalFiles} files
                        </span>
                      </div>
                    </div>

                    {/* Overlap bar */}
                    <div style={{ marginBottom: 10 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4 }}>
                        <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>Overlap rate</span>
                        <span style={{ fontSize: 11, fontWeight: 700, color: rec.text }}>{candidate.overlapRate}%</span>
                      </div>
                      <div style={{ height: 6, borderRadius: 3, background: 'var(--bg-hover)', overflow: 'hidden' }}>
                        <div style={{
                          height: '100%', borderRadius: 3, background: rec.text,
                          width: `${Math.min(candidate.overlapRate, 100)}%`, transition: 'width 0.5s ease',
                        }} />
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-tertiary)', marginTop: 3 }}>
                        {candidate.overlapCount.toLocaleString()} shared values across files
                      </div>
                    </div>

                    {/* Per-file stats */}
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                      {candidate.perFile.map(pf => (
                        <div key={pf.jobId} style={{
                          padding: '4px 10px', borderRadius: 6, background: 'var(--bg-hover)', fontSize: 11,
                        }}>
                          <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>{pf.fileName.slice(0, 25)}</span>
                          <span style={{ color: 'var(--text-tertiary)', marginLeft: 6 }}>
                            {pf.uniqueValues.toLocaleString()} unique • {pf.fillRate}% filled
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Bottom bar */}
          <div style={{
            marginTop: 20, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 16px', borderRadius: 10, background: 'var(--bg-card)', border: '1px solid var(--border)',
          }}>
            <Button variant="secondary" onClick={() => setStep(1)} style={{ padding: '8px 16px', fontSize: 12 }} icon={<ChevronLeft size={14} />}>
              Back
            </Button>
            <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
              {selectedKey ? <>Merge key: <strong style={{ color: 'var(--accent)' }}>{selectedKey}</strong></> : 'Select a merge key'}
            </div>
            <Button
              disabled={!canAdvance(2) || stepLoading}
              onClick={() => goToStep(3)}
              style={{ padding: '8px 20px', fontSize: 12, fontWeight: 700, opacity: canAdvance(2) ? 1 : 0.4 }}
              icon={stepLoading ? <Loader2 size={14} className="spin" /> : <ChevronRight size={14} />}
            >
              {stepLoading ? 'Loading…' : 'Next: Configure & Prioritize'}
            </Button>
          </div>
        </div>
      )}

      {/* ═══ STEP 3: COLUMN MAPPING ═══ */}
      {step === 3 && (
        <div>
          <div style={{ marginBottom: 16 }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>Column Mapping</h3>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-tertiary)' }}>
              Choose which columns to include in the merged output. The merge key (<strong>{selectedKey}</strong>) is always included.
            </p>
          </div>

          {selectedSources.map(src => {
            const srcCols = src.columns.filter(c => c !== selectedKey);
            // Note: srcCols are non-key columns from this file
            return (
              <div key={src.jobId} style={{
                background: 'var(--bg-card)', border: '1px solid var(--border)',
                borderRadius: 12, padding: 16, marginBottom: 12,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <FileText size={14} color="var(--accent)" />
                    <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{src.fileName}</span>
                    <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{src.columns.length} columns</span>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      onClick={() => setExcludedColumns(prev => { const next = new Set(prev); srcCols.forEach(c => next.delete(c)); return next; })}
                      style={{ padding: '3px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-secondary)', fontSize: 10, fontWeight: 600, cursor: 'pointer' }}
                    >Select All</button>
                    <button
                      onClick={() => setExcludedColumns(prev => { const next = new Set(prev); srcCols.forEach(c => next.add(c)); return next; })}
                      style={{ padding: '3px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-secondary)', fontSize: 10, fontWeight: 600, cursor: 'pointer' }}
                    >Deselect All</button>
                  </div>
                </div>

                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {/* Merge key — always included */}
                  <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 4,
                    padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                    background: 'var(--accent)', color: 'var(--accent-contrast)', cursor: 'default',
                  }}>
                    🔑 {selectedKey}
                  </span>
                  {srcCols.map(col => {
                    const included = !excludedColumns.has(col);
                    return (
                      <button
                        key={col}
                        onClick={() => toggleColumn(col)}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 500,
                          background: included ? 'var(--bg-hover)' : 'transparent',
                          color: included ? 'var(--text-secondary)' : 'var(--text-tertiary)',
                          border: `1px solid ${included ? 'var(--border)' : 'var(--border)'}`,
                          cursor: 'pointer', transition: 'all 0.15s',
                          textDecoration: included ? 'none' : 'line-through',
                          opacity: included ? 1 : 0.5,
                        }}
                      >
                        {col}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
          {/* ── File Priority Order ── */}
          <div style={{
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 12, padding: 16, marginBottom: 12,
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <div>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>
                  Conflict Resolution Priority
                </div>
                <div style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
                  When two files have different values for the same column and key, the file higher in this list wins.
                </div>
              </div>
              <div style={{
                padding: '3px 10px', borderRadius: 6, fontSize: 10, fontWeight: 700,
                background: 'var(--blue-muted)', color: 'var(--blue)', textTransform: 'uppercase', letterSpacing: '0.05em',
              }}>
                #{1} = Highest
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {priorityOrder.map((jobId, idx) => {
                const src = sources.find(s => s.jobId === jobId);
                if (!src) return null;
                return (
                  <div
                    key={jobId}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 10,
                      padding: '10px 14px', borderRadius: 10,
                      background: idx === 0 ? 'var(--accent-muted)' : 'var(--bg-hover)',
                      border: `1px solid ${idx === 0 ? 'var(--accent)' : 'var(--border)'}`,
                      transition: 'all 0.2s',
                    }}
                  >
                    <GripVertical size={14} style={{ color: 'var(--text-tertiary)', flexShrink: 0 }} />

                    {/* Priority badge */}
                    <div style={{
                      width: 24, height: 24, borderRadius: '50%', flexShrink: 0,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 11, fontWeight: 800,
                      background: idx === 0 ? 'var(--accent)' : 'var(--bg-elevated)',
                      color: idx === 0 ? 'var(--accent-contrast)' : 'var(--text-tertiary)',
                    }}>
                      {idx + 1}
                    </div>

                    {/* File info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{
                        fontSize: 13, fontWeight: 600,
                        color: idx === 0 ? 'var(--accent)' : 'var(--text-primary)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                      }}>
                        {src.fileName}
                      </div>
                      <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>
                        {src.rowCount.toLocaleString()} rows • {src.columns.length} cols
                      </div>
                    </div>

                    {/* Reorder buttons */}
                    <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                      <button
                        disabled={idx === 0}
                        onClick={() => {
                          const next = [...priorityOrder];
                          [next[idx - 1], next[idx]] = [next[idx], next[idx - 1]];
                          setPriorityOrder(next);
                        }}
                        style={{
                          width: 28, height: 28, borderRadius: 6, border: '1px solid var(--border)',
                          background: 'var(--bg-input)', color: 'var(--text-secondary)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          cursor: idx === 0 ? 'not-allowed' : 'pointer',
                          opacity: idx === 0 ? 0.3 : 1, transition: 'opacity 0.15s',
                        }}
                        title="Move up (higher priority)"
                      >
                        <ArrowUp size={14} />
                      </button>
                      <button
                        disabled={idx === priorityOrder.length - 1}
                        onClick={() => {
                          const next = [...priorityOrder];
                          [next[idx], next[idx + 1]] = [next[idx + 1], next[idx]];
                          setPriorityOrder(next);
                        }}
                        style={{
                          width: 28, height: 28, borderRadius: 6, border: '1px solid var(--border)',
                          background: 'var(--bg-input)', color: 'var(--text-secondary)',
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          cursor: idx === priorityOrder.length - 1 ? 'not-allowed' : 'pointer',
                          opacity: idx === priorityOrder.length - 1 ? 0.3 : 1, transition: 'opacity 0.15s',
                        }}
                        title="Move down (lower priority)"
                      >
                        <ArrowDown size={14} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Summary */}
          <div style={{
            padding: '10px 16px', borderRadius: 8, background: 'var(--bg-hover)',
            fontSize: 12, color: 'var(--text-secondary)', marginBottom: 12,
          }}>
            <strong>{allSelectedColumns.length - excludedColumns.size}</strong> columns included
            {excludedColumns.size > 0 && <> • <span style={{ color: 'var(--yellow)' }}>{excludedColumns.size} excluded</span></>}
          </div>

          {/* Bottom bar */}
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 16px', borderRadius: 10, background: 'var(--bg-card)', border: '1px solid var(--border)',
          }}>
            <Button variant="secondary" onClick={() => setStep(2)} style={{ padding: '8px 16px', fontSize: 12 }} icon={<ChevronLeft size={14} />}>
              Back
            </Button>
            <Button
              onClick={() => goToStep(4)}
              disabled={stepLoading}
              style={{ padding: '8px 20px', fontSize: 12, fontWeight: 700 }}
              icon={stepLoading ? <Loader2 size={14} className="spin" /> : <ChevronRight size={14} />}
            >
              {stepLoading ? 'Building Preview…' : 'Next: Preview & Execute'}
            </Button>
          </div>
        </div>
      )}

      {/* ═══ STEP 4: PREVIEW & EXECUTE ═══ */}
      {step === 4 && (
        <div>
          <div style={{ marginBottom: 16 }}>
            <h3 style={{ margin: 0, fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>Preview & Execute</h3>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-tertiary)' }}>
              Review the merged result below. Export as CSV or materialize to make it permanent.
            </p>
          </div>

          {/* Stats */}
          {preview && (
            <div style={{
              display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
              gap: 10, marginBottom: 16,
            }}>
              {[
                { label: 'Before', value: preview.totalBefore.toLocaleString(), sub: 'rows', color: 'var(--text-secondary)' },
                { label: 'After Merge', value: preview.total.toLocaleString(), sub: 'rows', color: 'var(--accent)' },
                { label: 'Reduction', value: `${preview.reduction}%`, sub: 'consolidated', color: 'var(--green)' },
                { label: 'Orphan Rows', value: preview.orphanRows.toLocaleString(), sub: 'no key match', color: preview.orphanRows > 0 ? 'var(--yellow)' : 'var(--text-tertiary)' },
              ].map(stat => (
                <div key={stat.label} style={{
                  padding: '12px 16px', borderRadius: 10, background: 'var(--bg-card)', border: '1px solid var(--border)',
                }}>
                  <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 4 }}>{stat.label}</div>
                  <div style={{ fontSize: 20, fontWeight: 800, color: stat.color }}>{stat.value}</div>
                  <div style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{stat.sub}</div>
                </div>
              ))}
            </div>
          )}

          {/* ── Conflict Preview ── */}
          {conflictData && (conflictData.totalConflictCells > 0 || conflictLoading) && (
            <div style={{
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              borderRadius: 12, padding: 16, marginBottom: 16,
            }}>
              <button
                onClick={() => setShowConflicts(!showConflicts)}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%',
                  background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--text-primary)',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <AlertTriangle size={16} color="var(--yellow)" />
                  <span style={{ fontSize: 14, fontWeight: 700 }}>Conflict Resolution Preview</span>
                  <span style={{
                    padding: '2px 8px', borderRadius: 6, fontSize: 10, fontWeight: 700,
                    background: 'var(--yellow-muted)', color: 'var(--yellow)',
                  }}>
                    {conflictData.totalConflictCells} conflicts across {conflictData.totalConflictKeys} keys
                  </span>
                </div>
                <Eye size={14} color="var(--text-tertiary)" style={{ transform: showConflicts ? 'none' : 'rotate(180deg)', transition: 'transform 0.2s' }} />
              </button>

              {showConflicts && conflictData.samples.length > 0 && (
                <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  {conflictData.samples.slice(0, 5).map((sample, si) => (
                    <div key={si} style={{
                      padding: 12, borderRadius: 10,
                      background: 'var(--bg-hover)', border: '1px solid var(--border)',
                    }}>
                      <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', marginBottom: 8 }}>
                        🔑 {sample.keyValue}
                      </div>
                      {sample.conflicts.map((c, ci) => (
                        <div key={ci} style={{ marginBottom: ci < sample.conflicts.length - 1 ? 8 : 0 }}>
                          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>
                            {c.column}
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
                            {c.perFile.map((pf, pi) => {
                              const isWinner = pf.jobId === c.resolvedFromJobId;
                              return (
                                <div key={pi} style={{
                                  display: 'flex', alignItems: 'center', gap: 8,
                                  padding: '4px 10px', borderRadius: 6, fontSize: 11,
                                  background: isWinner ? 'var(--green-muted)' : 'var(--red-muted)',
                                  border: `1px solid ${isWinner ? 'var(--green)' : 'var(--red)'}`,
                                  color: isWinner ? 'var(--green)' : 'var(--red)',
                                }}>
                                  {isWinner ? <Crown size={12} /> : <X size={12} />}
                                  <span style={{ fontWeight: 600, minWidth: 80, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {getFileName(pf.jobId)}
                                  </span>
                                  <span style={{ color: 'var(--text-primary)', fontWeight: isWinner ? 700 : 400 }}>
                                    "{pf.value}"
                                  </span>
                                  {isWinner && <span style={{ fontSize: 9, fontWeight: 800, marginLeft: 'auto' }}>WINNER</span>}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                  {conflictData.samples.length > 5 && (
                    <div style={{ fontSize: 11, color: 'var(--text-tertiary)', textAlign: 'center', padding: 4 }}>
                      + {conflictData.samples.length - 5} more conflict groups
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {conflictData && conflictData.totalConflictCells === 0 && (
            <div style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '10px 16px', borderRadius: 10, marginBottom: 16,
              background: 'var(--green-muted)', color: 'var(--green)', fontSize: 12, fontWeight: 600,
            }}>
              <Shield size={14} /> No column conflicts detected — all files agree on shared values.
            </div>
          )}

          {/* Search + Actions */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
              <div style={{ position: 'relative' }}>
                <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-tertiary)' }} />
                <input
                  type="text" placeholder="Search merged data…" value={previewSearch}
                  onChange={e => {
                    setPreviewSearch(e.target.value);
                    clearTimeout(searchTimerRef.current);
                    const val = e.target.value;
                    searchTimerRef.current = setTimeout(() => {
                      loadPreview(1, val, previewSortBy, previewSortDir);
                      setPreviewPage(1);
                    }, 400);
                  }}
                  style={{
                    padding: '7px 12px 7px 30px', borderRadius: 8, border: '1px solid var(--border)',
                    background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 12, width: 250,
                  }}
                />
              </div>
              <select
                value={previewPageSize}
                onChange={e => {
                  const newSize = Number(e.target.value);
                  setPreviewPageSize(newSize);
                  setPreviewPage(1);
                  // Use setTimeout to let state update before calling loadPreview
                  setTimeout(() => loadPreview(1, previewSearch, previewSortBy, previewSortDir), 0);
                }}
                style={{
                  padding: '6px 10px', borderRadius: 8, border: '1px solid var(--border)',
                  background: 'var(--bg-input)', color: 'var(--text-secondary)', fontSize: 11, cursor: 'pointer',
                }}
                title="Rows per page — your server (32GB RAM, Xeon E3-1240) handles all sizes easily"
              >
                {[
                  { n: 25, label: '25 rows' },
                  { n: 50, label: '50 rows ★' },
                  { n: 100, label: '100 rows' },
                  { n: 200, label: '200 rows' },
                  { n: 500, label: '500 rows' },
                  { n: 1000, label: '1,000 rows' },
                ].map(opt => (
                  <option key={opt.n} value={opt.n}>{opt.label}</option>
                ))}
              </select>
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button
                variant="secondary"
                onClick={exportMerge}
                disabled={exporting || !preview}
                icon={exporting ? <Loader2 size={12} className="spin" /> : <Download size={12} />}
                style={{ padding: '6px 14px', fontSize: 11 }}
              >
                Export CSV
              </Button>
              <Button
                onClick={executeMerge}
                disabled={executing || !preview}
                icon={executing ? <Loader2 size={12} className="spin" /> : <GitMerge size={12} />}
                style={{
                  padding: '6px 14px', fontSize: 11, fontWeight: 700,
                  background: 'var(--green)', border: 'none',
                }}
              >
                {executing ? 'Merging…' : '⚡ Materialize'}
              </Button>
            </div>
          </div>

          {/* Preview Table */}
          {previewLoading && (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-tertiary)' }}>
              <Loader2 size={24} className="spin" />
              <div style={{ marginTop: 8, fontSize: 13 }}>Loading preview…</div>
            </div>
          )}

          {preview && !previewLoading && preview.rows.length > 0 && (
            <div style={{ overflowX: 'auto', borderRadius: 10, border: '1px solid var(--border)' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr>
                    {preview.columns.map(col => (
                      <th
                        key={col}
                        onClick={() => {
                          if (previewSortBy === col) {
                            const newDir = previewSortDir === 'asc' ? 'desc' : 'asc';
                            setPreviewSortDir(newDir);
                            loadPreview(previewPage, previewSearch, col, newDir);
                          } else {
                            setPreviewSortBy(col);
                            setPreviewSortDir('asc');
                            loadPreview(previewPage, previewSearch, col, 'asc');
                          }
                        }}
                        style={{
                          padding: '8px 10px', textAlign: 'left', cursor: 'pointer',
                          background: 'var(--bg-hover)', borderBottom: '1px solid var(--border)',
                          color: col === preview.mergeKey ? 'var(--accent)' : 'var(--text-tertiary)',
                          fontWeight: col === preview.mergeKey ? 700 : 600, fontSize: 10,
                          whiteSpace: 'nowrap', position: 'sticky', top: 0,
                          textTransform: 'uppercase', letterSpacing: '0.04em',
                        }}
                      >
                        {col} {previewSortBy === col ? (previewSortDir === 'asc' ? '↑' : '↓') : ''}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.rows.map((row: any, ri: number) => (
                    <tr key={ri} style={{ background: ri % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-app)' }}>
                      {preview.columns.map(col => (
                        <td key={col} style={{
                          padding: '6px 10px', borderBottom: '1px solid var(--border)',
                          maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          fontWeight: col === preview.mergeKey ? 600 : 400,
                          color: row[col] ? 'var(--text-primary)' : 'var(--text-tertiary)',
                        }}>
                          {row[col] ?? ''}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {preview && !previewLoading && preview.rows.length === 0 && (
            <div style={{ textAlign: 'center', padding: 40, color: 'var(--text-tertiary)', fontSize: 13 }}>
              No rows match your search.
            </div>
          )}

          {/* Pagination */}
          {preview && preview.total > preview.pageSize && (
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 16,
              padding: '12px 0', marginTop: 8, fontSize: 12, color: 'var(--text-secondary)',
            }}>
              <span>
                {((preview.page - 1) * preview.pageSize) + 1}–{Math.min(preview.page * preview.pageSize, preview.total)} of {preview.total.toLocaleString()}
              </span>
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  disabled={previewPage <= 1}
                  onClick={() => { const p = previewPage - 1; setPreviewPage(p); loadPreview(p, previewSearch, previewSortBy, previewSortDir); }}
                  style={{
                    padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)',
                    background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 11,
                    cursor: previewPage <= 1 ? 'not-allowed' : 'pointer',
                    opacity: previewPage <= 1 ? 0.4 : 1,
                  }}
                >← Prev</button>
                <button
                  disabled={previewPage >= Math.ceil(preview.total / preview.pageSize)}
                  onClick={() => { const p = previewPage + 1; setPreviewPage(p); loadPreview(p, previewSearch, previewSortBy, previewSortDir); }}
                  style={{
                    padding: '4px 10px', borderRadius: 6, border: '1px solid var(--border)',
                    background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 11,
                    cursor: previewPage >= Math.ceil(preview.total / preview.pageSize) ? 'not-allowed' : 'pointer',
                    opacity: previewPage >= Math.ceil(preview.total / preview.pageSize) ? 0.4 : 1,
                  }}
                >Next →</button>
              </div>
            </div>
          )}

          {/* Bottom bar */}
          <div style={{
            marginTop: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '12px 16px', borderRadius: 10, background: 'var(--bg-card)', border: '1px solid var(--border)',
          }}>
            <Button variant="secondary" onClick={() => setStep(3)} style={{ padding: '8px 16px', fontSize: 12 }} icon={<ChevronLeft size={14} />}>
              Back
            </Button>
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>
              Merge key: <strong style={{ color: 'var(--accent)' }}>{selectedKey}</strong> • {selectedJobIds.size} files
            </div>
          </div>
        </div>
      )}
    </div>

    {/* ── Merge Report Overlay ── */}
    {showMergeReport && mergeReport && (
      <MergeReportOverlay
        report={mergeReport}
        conflictData={conflictData}
        priorityOrder={priorityOrder}
        getFileName={getFileName}
        onClose={() => {
          setShowMergeReport(false);
          setStep(1);
          setSelectedJobIds(new Set());
          setPreview(null);
          setConflictData(null);
          setMessage({ text: `Merge complete: ${mergeReport.totalBefore.toLocaleString()} → ${mergeReport.totalAfter.toLocaleString()} rows (${mergeReport.rowsConsolidated.toLocaleString()} consolidated)`, type: 'success' });
        }}
      />
    )}

      {/* AI Agent */}
      <div style={{ marginTop: 36 }}>
        <AgentCard slug="data_scientist" contextLabel="Merge Strategy — Dedup & Consolidation" />
      </div>
    </>
  );
}

// ── Post-Merge Report Overlay ──
function MergeReportOverlay({ report, conflictData, priorityOrder, getFileName, onClose }: {
  report: MergeReport;
  conflictData: ConflictData | null;
  priorityOrder: string[];
  getFileName: (jobId: string) => string;
  onClose: () => void;
}) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      animation: 'fadeIn 0.3s ease-out',
    }}>
      <div style={{
        width: '100%', maxWidth: 560, maxHeight: '85vh', overflowY: 'auto',
        background: 'var(--bg-card)', border: '1px solid var(--border)',
        borderRadius: 20, boxShadow: 'var(--shadow-lg)',
        animation: 'slideUp 0.4s ease-out',
      }}>
        {/* Header */}
        <div style={{
          padding: '24px 24px 16px',
          borderBottom: '1px solid var(--border)',
          textAlign: 'center',
        }}>
          <Sparkles size={32} color="var(--accent)" style={{ marginBottom: 8 }} />
          <h2 style={{ margin: 0, fontSize: 22, fontWeight: 800, color: 'var(--text-primary)' }}>Merge Complete</h2>
          <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-tertiary)' }}>
            by {report.performedBy} • {new Date(report.performedAt).toLocaleString()}
          </p>
        </div>

        {/* Stats */}
        <div style={{ padding: '16px 24px', display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
          {[
            { label: 'Before', value: report.totalBefore.toLocaleString(), color: 'var(--text-secondary)', icon: <BarChart3 size={14} /> },
            { label: 'After', value: report.totalAfter.toLocaleString(), color: 'var(--accent)', icon: <GitMerge size={14} /> },
            { label: 'Saved', value: `${report.reductionPercent}%`, color: 'var(--green)', icon: <CheckCircle2 size={14} /> },
          ].map(s => (
            <div key={s.label} style={{
              textAlign: 'center', padding: '14px 8px', borderRadius: 12,
              background: 'var(--bg-hover)', border: '1px solid var(--border)',
            }}>
              <div style={{ color: 'var(--text-tertiary)', marginBottom: 6 }}>{s.icon}</div>
              <div style={{ fontSize: 22, fontWeight: 800, color: s.color }}>{s.value}</div>
              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>{s.label}</div>
            </div>
          ))}
        </div>

        {/* Details */}
        <div style={{ padding: '0 24px 16px' }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Details</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
              <GitMerge size={12} color="var(--accent)" /> Merge key: <strong style={{ color: 'var(--accent)' }}>{report.mergeKey}</strong>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
              <FileText size={12} color="var(--blue)" /> {report.filesCount} files merged
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
              <Clock size={12} color="var(--purple)" /> {report.rowsConsolidated.toLocaleString()} rows consolidated
            </div>
            {report.priorityApplied && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
                <Crown size={12} color="var(--yellow)" /> Priority-based conflict resolution applied
              </div>
            )}
            {conflictData && conflictData.totalConflictCells > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
                <AlertTriangle size={12} color="var(--yellow)" /> {conflictData.totalConflictCells} column conflicts resolved across {conflictData.totalConflictKeys} keys
              </div>
            )}
          </div>
        </div>

        {/* Priority order used */}
        {priorityOrder.length > 0 && (
          <div style={{ padding: '0 24px 16px' }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>Priority Order</div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {priorityOrder.map((jid, i) => (
                <span key={jid} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 600,
                  background: i === 0 ? 'var(--accent-muted)' : 'var(--bg-hover)',
                  color: i === 0 ? 'var(--accent)' : 'var(--text-secondary)',
                  border: `1px solid ${i === 0 ? 'var(--accent)' : 'var(--border)'}`,
                }}>
                  #{i + 1} {getFileName(jid)}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div style={{
          padding: '16px 24px', borderTop: '1px solid var(--border)',
          display: 'flex', justifyContent: 'center',
        }}>
          <Button
            onClick={onClose}
            style={{ padding: '10px 32px', fontSize: 13, fontWeight: 700 }}
            icon={<CheckCircle2 size={14} />}
          >
            Done
          </Button>
        </div>
      </div>
    </div>
  );
}
