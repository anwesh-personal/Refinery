import { useState, useEffect, createContext, useContext, type ReactNode } from 'react';
import { apiCall } from '../lib/api';
import { Server, ChevronDown, Check, Wifi, WifiOff } from 'lucide-react';

// ═══════════════════════════════════════════════════════════════
// Server Context — Global server selection state
// ═══════════════════════════════════════════════════════════════

interface ServerInfo {
  id: string;
  name: string;
  type: 'clickhouse' | 's3' | 'minio';
  host: string;
  is_default: boolean;
  last_ping_ok: boolean | null;
}

interface ServerContextType {
  servers: ServerInfo[];
  selectedServerId: string | null;
  selectServer: (id: string) => void;
  loading: boolean;
  refresh: () => Promise<void>;
}

const ServerContext = createContext<ServerContextType | undefined>(undefined);

export function ServerProvider({ children }: { children: ReactNode }) {
  const [servers, setServers] = useState<ServerInfo[]>([]);
  const [selectedServerId, setSelectedServerId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchServers = async () => {
    try {
      const data = await apiCall<{ servers: ServerInfo[] }>('/api/servers');
      const list = data.servers || [];
      setServers(list);

      // Auto-select: restore from localStorage, then fall back to default, then first
      const stored = localStorage.getItem('selected_server_id');
      const valid = list.find((s) => s.id === stored);
      if (valid) {
        setSelectedServerId(valid.id);
      } else {
        const defaultServer = list.find((s) => s.is_default && s.type === 'clickhouse');
        if (defaultServer) setSelectedServerId(defaultServer.id);
      }
    } catch {
      // Silently fail — servers table might not exist yet
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchServers(); }, []);

  const selectServer = (id: string) => {
    setSelectedServerId(id);
    localStorage.setItem('selected_server_id', id);
  };

  return (
    <ServerContext.Provider value={{ servers, selectedServerId, selectServer, loading, refresh: fetchServers }}>
      {children}
    </ServerContext.Provider>
  );
}

export function useServers() {
  const ctx = useContext(ServerContext);
  if (!ctx) throw new Error('useServers must be used within ServerProvider');
  return ctx;
}

// ═══════════════════════════════════════════════════════════════
// Server Selector Widget — Dropdown for page headers
// ═══════════════════════════════════════════════════════════════

export function ServerSelector({ type = 'clickhouse' }: { type?: 'clickhouse' | 's3' | 'minio' }) {
  const { servers, selectedServerId, selectServer } = useServers();
  const [open, setOpen] = useState(false);

  const filtered = servers.filter(s => s.type === type);
  const selected = filtered.find(s => s.id === selectedServerId) || filtered.find(s => s.is_default) || filtered[0];

  if (filtered.length <= 1) {
    if (selected) {
      return (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '4px 10px', borderRadius: 6,
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          fontSize: 12, color: 'var(--text-secondary)',
        }}>
          <StatusDot ok={selected.last_ping_ok} />
          <Server size={12} />
          <span>{selected.name}</span>
        </div>
      );
    }
    return null;
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '6px 12px', borderRadius: 8,
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          fontSize: 12, fontWeight: 600, color: 'var(--text-primary)',
          cursor: 'pointer', transition: 'all 0.15s',
        }}
      >
        <StatusDot ok={selected?.last_ping_ok ?? null} />
        <Server size={13} />
        <span>{selected?.name || 'Select Server'}</span>
        <ChevronDown size={12} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.2s' }} />
      </button>

      {open && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 999 }}
            onClick={() => setOpen(false)}
          />
          <div
            style={{
              position: 'absolute', top: '100%', left: 0, marginTop: 4,
              minWidth: 220, zIndex: 1000,
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              borderRadius: 10, padding: 4,
              boxShadow: 'var(--shadow-lg)',
            }}
            className="animate-fadeIn"
          >
            {filtered.map(s => (
              <button
                key={s.id}
                onClick={() => { selectServer(s.id); setOpen(false); }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                  padding: '8px 12px', borderRadius: 6, border: 'none',
                  background: s.id === selectedServerId ? 'var(--accent-muted)' : 'transparent',
                  color: 'var(--text-primary)', fontSize: 12, fontWeight: 500,
                  cursor: 'pointer', transition: 'all 0.1s',
                  textAlign: 'left',
                }}
              >
                <StatusDot ok={s.last_ping_ok} />
                <span style={{ flex: 1 }}>{s.name}</span>
                {s.is_default && (
                  <span style={{
                    fontSize: 10, padding: '1px 6px', borderRadius: 4,
                    background: 'var(--blue-muted)', color: 'var(--blue)',
                    fontWeight: 700,
                  }}>DEFAULT</span>
                )}
                {s.id === selectedServerId && <Check size={14} style={{ color: 'var(--accent)' }} />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function StatusDot({ ok }: { ok: boolean | null }) {
  if (ok === null) return <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--text-tertiary)', display: 'inline-block' }} />;
  return ok
    ? <Wifi size={10} style={{ color: 'var(--green)' }} />
    : <WifiOff size={10} style={{ color: 'var(--red)' }} />;
}
