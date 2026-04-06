import { useState, useEffect, useCallback } from 'react';
import { Send, Loader2, CheckCircle2, AlertCircle, Users } from 'lucide-react';
import { SectionHeader, Button } from './UI';
import { apiCall } from '../lib/api';

interface Segment {
  id: string;
  name: string;
  lead_count: string | number;
  status: string;
  niche: string | null;
}

interface MTAProvider {
  id: string;
  name: string;
  provider_type: string;
  is_active: boolean;
  is_default: boolean;
  last_test_ok: boolean | null;
}

interface PushResult {
  providerId: string;
  providerName: string;
  success: boolean;
  synced: number;
  listId?: string;
  error?: string;
}

interface MultiPushResponse {
  segmentId: string;
  segmentName: string;
  totalLeads: number;
  results: PushResult[];
}

export default function MultiPushPanel({ segments }: { segments: Segment[] }) {
  const [providers, setProviders] = useState<MTAProvider[]>([]);
  const [loadingProviders, setLoadingProviders] = useState(false);
  const [selectedSegment, setSelectedSegment] = useState('');
  const [selectedProviders, setSelectedProviders] = useState<Set<string>>(new Set());
  const [pushing, setPushing] = useState(false);
  const [result, setResult] = useState<MultiPushResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const activeSegments = segments.filter(s => s.status === 'active' && Number(s.lead_count) > 0);

  const fetchProviders = useCallback(async () => {
    setLoadingProviders(true);
    try {
      const data = await apiCall<MTAProvider[]>('/api/mta-providers');
      setProviders(data.filter(p => p.is_active));
    } catch { /* ignore */ }
    setLoadingProviders(false);
  }, []);

  useEffect(() => { fetchProviders(); }, [fetchProviders]);

  const toggleProvider = (id: string) => {
    setSelectedProviders(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedProviders.size === providers.length) {
      setSelectedProviders(new Set());
    } else {
      setSelectedProviders(new Set(providers.map(p => p.id)));
    }
  };

  const pushToProviders = async () => {
    if (!selectedSegment) { setError('Select a segment'); return; }
    if (selectedProviders.size === 0) { setError('Select at least one user/provider'); return; }
    setPushing(true);
    setError(null);
    setResult(null);
    try {
      const res = await apiCall<MultiPushResponse>(`/api/segments/${selectedSegment}/push-multi`, {
        method: 'POST',
        body: { providerIds: Array.from(selectedProviders) },
      });
      setResult(res);
    } catch (e: any) {
      setError(e.message);
    }
    setPushing(false);
  };

  const selectedSeg = activeSegments.find(s => s.id === selectedSegment);

  const labelStyle = {
    fontSize: 11, fontWeight: 700 as const,
    textTransform: 'uppercase' as const, letterSpacing: '0.08em',
    color: 'var(--text-tertiary)', display: 'block', marginBottom: 8,
  };

  const checkboxStyle = (checked: boolean) => ({
    width: 18, height: 18, borderRadius: 5,
    border: `2px solid ${checked ? 'var(--accent)' : 'var(--border)'}`,
    background: checked ? 'var(--accent)' : 'transparent',
    display: 'flex', alignItems: 'center' as const, justifyContent: 'center' as const,
    cursor: 'pointer', transition: 'all 0.15s', flexShrink: 0,
  });

  return (
    <>
      <SectionHeader title="Push to Users' MailWizz" />
      <div
        className="animate-fadeIn"
        style={{
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 16, padding: 28, marginBottom: 36,
        }}
      >
        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 20 }}>
          Select a verified segment and pick which users' MailWizz instances to push the leads to.
          Each provider will get its own subscriber list.
        </div>

        {/* Error / Success */}
        {error && (
          <div style={{
            marginBottom: 16, padding: '12px 18px', borderRadius: 10,
            background: 'var(--red-muted)', border: '1px solid var(--red)',
            display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--red)',
          }}>
            <AlertCircle size={16} /> {error}
          </div>
        )}

        {/* Segment Selector */}
        <div style={{ marginBottom: 20 }}>
          <label style={labelStyle}>Source Segment *</label>
          <select
            value={selectedSegment}
            onChange={e => setSelectedSegment(e.target.value)}
            style={{
              width: '100%', maxWidth: 500, padding: '10px 14px', borderRadius: 12,
              fontSize: 13, fontWeight: 500,
              background: 'var(--bg-input, var(--bg-elevated))',
              border: '1px solid var(--border)', color: 'var(--text-primary)',
              outline: 'none', cursor: 'pointer',
              appearance: 'none' as const,
              backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' fill='%239ca3af' viewBox='0 0 16 16'%3E%3Cpath d='M8 11L3 6h10z'/%3E%3C/svg%3E")`,
              backgroundRepeat: 'no-repeat', backgroundPosition: 'right 12px center',
            }}
          >
            <option value="">Select a segment...</option>
            {activeSegments.map(seg => (
              <option key={seg.id} value={seg.id}>
                {seg.name} ({Number(seg.lead_count).toLocaleString()} leads)
                {seg.niche ? ` — ${seg.niche}` : ''}
              </option>
            ))}
          </select>
          {selectedSeg && (
            <div style={{
              marginTop: 8, fontSize: 12, color: 'var(--accent)', fontWeight: 600,
            }}>
              {Number(selectedSeg.lead_count).toLocaleString()} leads will be pushed
            </div>
          )}
        </div>

        {/* Provider Multi-Select */}
        <div style={{ marginBottom: 20 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
            <label style={{ ...labelStyle, marginBottom: 0 }}>Target Users / MTA Providers *</label>
            <button
              onClick={selectAll}
              style={{
                background: 'none', border: 'none', color: 'var(--accent)',
                fontSize: 11, fontWeight: 700, cursor: 'pointer', textDecoration: 'underline',
              }}
            >
              {selectedProviders.size === providers.length ? 'Deselect All' : 'Select All'}
            </button>
          </div>

          {loadingProviders ? (
            <div style={{ padding: 20, textAlign: 'center', color: 'var(--text-tertiary)' }}>
              <Loader2 size={16} className="spin" />
            </div>
          ) : providers.length === 0 ? (
            <div style={{
              padding: 20, textAlign: 'center', color: 'var(--text-tertiary)',
              background: 'var(--bg-elevated)', borderRadius: 10,
              border: '1px dashed var(--border)', fontSize: 13,
            }}>
              No MTA providers configured. Add MailWizz instances in Email → MTA Providers.
            </div>
          ) : (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              gap: 8,
            }}>
              {providers.map(p => {
                const checked = selectedProviders.has(p.id);
                return (
                  <div
                    key={p.id}
                    onClick={() => toggleProvider(p.id)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 12,
                      padding: '10px 14px', borderRadius: 10, cursor: 'pointer',
                      background: checked ? 'var(--accent-muted)' : 'var(--bg-elevated)',
                      border: `1px solid ${checked ? 'var(--accent)' : 'var(--border)'}`,
                      transition: 'all 0.15s',
                    }}
                  >
                    <div style={checkboxStyle(checked)}>
                      {checked && (
                        <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
                          <path d="M2 5L4 7L8 3" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      )}
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>
                        {p.name}
                      </div>
                      <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
                        {p.provider_type} {p.is_default ? '(default)' : ''}
                        {p.last_test_ok === true && ' ✓'}
                        {p.last_test_ok === false && ' ✗'}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          {selectedProviders.size > 0 && (
            <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
              <Users size={12} style={{ display: 'inline', verticalAlign: -2, marginRight: 4 }} />
              {selectedProviders.size} provider{selectedProviders.size > 1 ? 's' : ''} selected
            </div>
          )}
        </div>

        {/* Push Button */}
        <Button
          icon={pushing ? <Loader2 size={14} className="spin" /> : <Send size={14} />}
          onClick={pushToProviders}
          disabled={pushing || !selectedSegment || selectedProviders.size === 0}
        >
          {pushing ? 'Pushing...' : `Push to ${selectedProviders.size || 0} Provider${selectedProviders.size !== 1 ? 's' : ''}`}
        </Button>

        {/* Results */}
        {result && (
          <div style={{
            marginTop: 20, padding: 20, borderRadius: 12,
            border: '1px solid var(--border)', background: 'var(--bg-hover)',
          }}>
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 4 }}>
              Push Results — "{result.segmentName}"
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 16 }}>
              {result.totalLeads.toLocaleString()} leads pushed to {result.results.length} provider(s)
            </div>
            <div style={{ display: 'flex', flexDirection: 'column' as const, gap: 8 }}>
              {result.results.map(r => (
                <div
                  key={r.providerId}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '10px 14px', borderRadius: 8,
                    background: r.success ? 'var(--green-muted)' : 'var(--red-muted)',
                    border: `1px solid ${r.success ? 'var(--green)' : 'var(--red)'}`,
                  }}
                >
                  {r.success
                    ? <CheckCircle2 size={16} color="var(--green)" />
                    : <AlertCircle size={16} color="var(--red)" />
                  }
                  <div style={{ flex: 1 }}>
                    <span style={{ fontWeight: 600, fontSize: 13 }}>{r.providerName}</span>
                    {r.success
                      ? <span style={{ fontSize: 12, color: 'var(--green)', marginLeft: 8 }}>
                          {r.synced.toLocaleString()} synced
                        </span>
                      : <span style={{ fontSize: 12, color: 'var(--red)', marginLeft: 8 }}>
                          {r.error}
                        </span>
                    }
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  );
}
