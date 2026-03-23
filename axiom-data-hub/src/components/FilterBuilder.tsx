import { useState, useEffect, useCallback, useRef } from 'react';
import { Button } from './UI';
import { apiCall } from '../lib/api';
import { Plus, Trash2, Loader2, Layers } from 'lucide-react';

// ── Types ──
export interface FilterRule {
  id: string;
  column: string;
  operator: string;
  value: string;
}

export interface FilterGroup {
  connector: 'AND' | 'OR';
  rules: FilterRule[];
  groups?: FilterGroup[];
}

interface ColumnMeta {
  name: string;
  label: string;
  type: 'string' | 'number' | 'date';
  nullable: boolean;
}

interface ColumnGroup {
  key: string;
  label: string;
  columns: ColumnMeta[];
}

const OPERATORS: Record<string, { label: string; needsValue: boolean }[]> = {
  string: [
    { label: '=', needsValue: true },
    { label: '!=', needsValue: true },
    { label: 'LIKE', needsValue: true },
    { label: 'NOT LIKE', needsValue: true },
    { label: 'IN', needsValue: true },
    { label: 'IS NULL', needsValue: false },
    { label: 'IS NOT NULL', needsValue: false },
  ],
  number: [
    { label: '=', needsValue: true },
    { label: '!=', needsValue: true },
    { label: '>', needsValue: true },
    { label: '<', needsValue: true },
    { label: '>=', needsValue: true },
    { label: '<=', needsValue: true },
    { label: 'IS NULL', needsValue: false },
    { label: 'IS NOT NULL', needsValue: false },
  ],
  date: [
    { label: '=', needsValue: true },
    { label: '>', needsValue: true },
    { label: '<', needsValue: true },
    { label: 'IS NULL', needsValue: false },
    { label: 'IS NOT NULL', needsValue: false },
  ],
};

let _ruleId = 0;
function newRule(): FilterRule {
  return { id: `r${++_ruleId}`, column: '', operator: '=', value: '' };
}

// ── Convert filter group to SQL WHERE clause ──
export function filterGroupToSQL(group: FilterGroup): string {
  const parts: string[] = [];

  // Rules
  group.rules
    .filter(r => r.column)
    .forEach(r => {
      if (r.operator === 'IS NULL') { parts.push(`${r.column} IS NULL`); return; }
      if (r.operator === 'IS NOT NULL') { parts.push(`${r.column} IS NOT NULL`); return; }
      if (r.operator === 'IN') {
        const items = r.value.split(',').map(v => `'${v.trim().replace(/'/g, "''")}'`).join(', ');
        parts.push(`${r.column} IN (${items})`); return;
      }
      parts.push(`${r.column} ${r.operator} '${r.value.replace(/'/g, "''")}' `);
    });

  // Nested groups (recursive)
  (group.groups || []).forEach(sub => {
    const subSQL = filterGroupToSQL(sub);
    if (subSQL) parts.push(`(${subSQL})`);
  });

  return parts.join(` ${group.connector} `).trim();
}

// ── Parse SQL WHERE clause back into filter group ──
export function sqlToFilterGroup(sql: string): FilterGroup {
  if (!sql.trim()) return { connector: 'AND', rules: [newRule()] };
  const connector = sql.includes(' OR ') ? 'OR' : 'AND';
  const parts = sql.split(new RegExp(`\\s+${connector}\\s+`, 'i'));
  const rules: FilterRule[] = parts.map(part => {
    const trimmed = part.trim();
    // IS NULL / IS NOT NULL
    const nullMatch = trimmed.match(/^(\w+)\s+(IS\s+NOT\s+NULL|IS\s+NULL)$/i);
    if (nullMatch) return { id: `r${++_ruleId}`, column: nullMatch[1], operator: nullMatch[2].replace(/\s+/g, ' ').toUpperCase(), value: '' };
    // IN (...)
    const inMatch = trimmed.match(/^(\w+)\s+IN\s*\((.+)\)$/i);
    if (inMatch) {
      const vals = inMatch[2].split(',').map(v => v.trim().replace(/^'|'$/g, '')).join(', ');
      return { id: `r${++_ruleId}`, column: inMatch[1], operator: 'IN', value: vals };
    }
    // LIKE / NOT LIKE
    const likeMatch = trimmed.match(/^(\w+)\s+(NOT\s+LIKE|LIKE)\s+'(.+)'$/i);
    if (likeMatch) return { id: `r${++_ruleId}`, column: likeMatch[1], operator: likeMatch[2].toUpperCase(), value: likeMatch[3] };
    // Standard comparison
    const cmpMatch = trimmed.match(/^(\w+)\s*(=|!=|<>|>=?|<=?)\s*'(.+)'$/);
    if (cmpMatch) return { id: `r${++_ruleId}`, column: cmpMatch[1], operator: cmpMatch[2], value: cmpMatch[3] };
    // Fallback — unquoted
    const rawMatch = trimmed.match(/^(\w+)\s*(=|!=|<>|>=?|<=?)\s*(.+)$/);
    if (rawMatch) return { id: `r${++_ruleId}`, column: rawMatch[1], operator: rawMatch[2], value: rawMatch[3].trim() };
    return { id: `r${++_ruleId}`, column: '', operator: '=', value: trimmed };
  });
  return { connector: connector as 'AND' | 'OR', rules: rules.length > 0 ? rules : [newRule()] };
}

// ── Value Autocomplete ──
function ValueAutocomplete({ column, value, onChange }: { column: string; value: string; onChange: (v: string) => void }) {
  const [suggestions, setSuggestions] = useState<{ value: string; count: number }[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const fetchSuggestions = useCallback(async (q: string) => {
    if (!column) return;
    setLoading(true);
    try {
      const data = await apiCall<{ value: string; count: number }[]>(
        `/api/segment-columns/${column}/values?q=${encodeURIComponent(q)}`
      );
      setSuggestions(data);
    } catch { setSuggestions([]); }
    setLoading(false);
  }, [column]);

  useEffect(() => {
    if (!column) return;
    const t = setTimeout(() => fetchSuggestions(value), 300);
    return () => clearTimeout(t);
  }, [column, value, fetchSuggestions]);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} style={{ position: 'relative', flex: 1 }}>
      <input
        value={value}
        onChange={e => { onChange(e.target.value); setOpen(true); }}
        onFocus={() => setOpen(true)}
        placeholder="Type or pick a value..."
        style={{
          width: '100%', padding: '7px 10px', borderRadius: 7, fontSize: 12,
          background: 'var(--bg-input)', border: '1px solid var(--border)',
          color: 'var(--text-primary)', outline: 'none',
        }}
      />
      {open && suggestions.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100,
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          borderRadius: 8, marginTop: 4, maxHeight: 200, overflow: 'auto',
          boxShadow: '0 8px 24px rgba(0,0,0,0.3)',
        }}>
          {loading && <div style={{ padding: 8, fontSize: 11, color: 'var(--text-tertiary)', textAlign: 'center' }}>Loading...</div>}
          {suggestions.map(s => (
            <div key={s.value}
              onClick={() => { onChange(s.value); setOpen(false); }}
              style={{
                padding: '7px 12px', cursor: 'pointer', fontSize: 12,
                display: 'flex', justifyContent: 'space-between',
                color: 'var(--text-primary)', transition: 'background 0.1s',
              }}
              onMouseOver={e => (e.currentTarget.style.background = 'var(--bg-hover)')}
              onMouseOut={e => (e.currentTarget.style.background = '')}
            >
              <span>{s.value}</span>
              <span style={{ fontSize: 10, color: 'var(--text-tertiary)' }}>{s.count.toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main FilterBuilder ──
interface Props {
  value: FilterGroup;
  onChange: (group: FilterGroup) => void;
  disabled?: boolean;
}

export default function FilterBuilder({ value, onChange, disabled }: Props) {
  const [columnGroups, setColumnGroups] = useState<ColumnGroup[]>([]);
  const [loadingCols, setLoadingCols] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const groups = await apiCall<ColumnGroup[]>('/api/segment-columns');
        setColumnGroups(groups);
      } catch { /* ignore */ }
      setLoadingCols(false);
    })();
  }, []);

  const allColumns = columnGroups.flatMap(g => g.columns);
  const getColMeta = (name: string) => allColumns.find(c => c.name === name);

  const updateRule = (ruleId: string, patch: Partial<FilterRule>) => {
    onChange({
      ...value,
      rules: value.rules.map(r => r.id === ruleId ? { ...r, ...patch } : r),
    });
  };

  const addRule = () => {
    onChange({ ...value, rules: [...value.rules, newRule()] });
  };

  const removeRule = (ruleId: string) => {
    const updated = value.rules.filter(r => r.id !== ruleId);
    onChange({ ...value, rules: updated.length > 0 ? updated : [newRule()] });
  };

  const toggleConnector = () => {
    onChange({ ...value, connector: value.connector === 'AND' ? 'OR' : 'AND' });
  };

  const addGroup = () => {
    const groups = value.groups || [];
    onChange({ ...value, groups: [...groups, { connector: 'AND', rules: [newRule()] }] });
  };

  const updateGroup = (idx: number, updated: FilterGroup) => {
    const groups = [...(value.groups || [])];
    groups[idx] = updated;
    onChange({ ...value, groups });
  };

  const removeGroup = (idx: number) => {
    const groups = (value.groups || []).filter((_, i) => i !== idx);
    onChange({ ...value, groups });
  };

  const selectStyle: React.CSSProperties = {
    padding: '7px 10px', borderRadius: 7, fontSize: 12,
    background: 'var(--bg-input)', border: '1px solid var(--border)',
    color: 'var(--text-primary)', outline: 'none', cursor: 'pointer',
  };

  if (loadingCols) {
    return (
      <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-tertiary)' }}>
        <Loader2 size={16} className="spin" /> Loading columns...
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {value.rules.map((rule, i) => {
        const meta = getColMeta(rule.column);
        const colType = meta?.type || 'string';
        const ops = OPERATORS[colType] || OPERATORS.string;
        const needsValue = ops.find(o => o.label === rule.operator)?.needsValue !== false;

        return (
          <div key={rule.id}>
            {/* Connector pill between rules */}
            {i > 0 && (
              <div style={{ display: 'flex', justifyContent: 'center', margin: '4px 0' }}>
                <button onClick={toggleConnector} disabled={disabled}
                  style={{
                    padding: '2px 14px', borderRadius: 12, fontSize: 10, fontWeight: 800,
                    textTransform: 'uppercase', letterSpacing: '0.1em', cursor: 'pointer',
                    background: value.connector === 'AND' ? 'var(--accent-muted)' : 'var(--yellow-muted)',
                    color: value.connector === 'AND' ? 'var(--accent)' : 'var(--yellow)',
                    border: `1px solid ${value.connector === 'AND' ? 'var(--accent)' : 'var(--yellow)'}`,
                  }}>
                  {value.connector}
                </button>
              </div>
            )}

            {/* Rule row */}
            <div style={{
              display: 'flex', gap: 8, alignItems: 'center', padding: '6px 0',
              opacity: disabled ? 0.5 : 1,
            }}>
              {/* Column select — grouped */}
              <select
                value={rule.column}
                onChange={e => updateRule(rule.id, { column: e.target.value, value: '', operator: '=' })}
                disabled={disabled}
                style={{ ...selectStyle, minWidth: 180 }}
              >
                <option value="">Select column...</option>
                {columnGroups.map(g => (
                  <optgroup key={g.key} label={g.label}>
                    {g.columns.map(c => (
                      <option key={c.name} value={c.name}>{c.label}</option>
                    ))}
                  </optgroup>
                ))}
              </select>

              {/* Operator */}
              <select
                value={rule.operator}
                onChange={e => updateRule(rule.id, { operator: e.target.value })}
                disabled={disabled || !rule.column}
                style={{ ...selectStyle, minWidth: 100 }}
              >
                {ops.map(o => (
                  <option key={o.label} value={o.label}>{o.label}</option>
                ))}
              </select>

              {/* Value — with autocomplete */}
              {needsValue && (
                <ValueAutocomplete
                  column={rule.column}
                  value={rule.value}
                  onChange={v => updateRule(rule.id, { value: v })}
                />
              )}

              {/* Delete */}
              <button onClick={() => removeRule(rule.id)} disabled={disabled}
                style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                  color: 'var(--text-tertiary)', padding: 4, borderRadius: 4,
                  display: 'flex', alignItems: 'center',
                }}
                onMouseOver={e => (e.currentTarget.style.color = 'var(--red)')}
                onMouseOut={e => (e.currentTarget.style.color = 'var(--text-tertiary)')}>
                <Trash2 size={14} />
              </button>
            </div>
          </div>
        );
      })}

      {/* Nested sub-groups */}
      {(value.groups || []).map((sub, gi) => (
        <div key={`grp-${gi}`} style={{
          marginTop: 8, paddingLeft: 16, borderLeft: '3px solid var(--accent)',
          borderRadius: 4, position: 'relative',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
              Sub-group ({sub.connector})
            </span>
            <button onClick={() => removeGroup(gi)} disabled={disabled}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-tertiary)', padding: 2, display: 'flex' }}
              onMouseOver={e => (e.currentTarget.style.color = 'var(--red)')}
              onMouseOut={e => (e.currentTarget.style.color = 'var(--text-tertiary)')}>
              <Trash2 size={12} />
            </button>
          </div>
          <FilterBuilder value={sub} onChange={g => updateGroup(gi, g)} disabled={disabled} />
        </div>
      ))}

      {/* Add rule / group */}
      <div style={{ marginTop: 8, display: 'flex', gap: 8 }}>
        <Button variant="ghost" icon={<Plus size={13} />} onClick={addRule} disabled={disabled}>
          Add Condition
        </Button>
        <Button variant="ghost" icon={<Layers size={13} />} onClick={addGroup} disabled={disabled}>
          Add Group
        </Button>
      </div>
    </div>
  );
}
