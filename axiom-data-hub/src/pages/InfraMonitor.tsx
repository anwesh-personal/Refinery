import { useState, useEffect, useCallback, useRef } from 'react';
import { apiCall } from '../lib/api';
import {
  Cpu, HardDrive, Database, Activity, AlertTriangle, CheckCircle2,
  Server, RefreshCw, Layers, Zap, Wifi, Circle,
} from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────────
interface SystemInfo {
  hostname: string; platform: string; uptimeSec: number; ips: string[];
  cpuModel: string; cpuCores: number; cpuUsagePct: number;
  loadAvg: number[];
  ram: { totalMB: number; usedMB: number; freeMB: number; usePct: number };
  dockerContainers: number;
}
interface DiskInfo {
  device: string; mountpoint: string; totalGB: number; usedGB: number;
  availGB: number; usePct: number; type: 'SSD' | 'SATA/HDD' | 'Unknown';
}
interface PM2Proc {
  name: string; pid: number; status: string; cpu: number;
  memMB: number; uptime: string; restarts: number;
}
interface CHTable { table: string; parts: number; rows: number; bytes: number; }
interface CHStats {
  ok: boolean; error?: string; tables: CHTable[]; totalSize: string;
  totalRows: number; uptimeSec: number; version: string;
  activeMerges: number; partsMerging: number;
  memoryTrackingBytes: number; activeQueries: number;
}
interface S3Source {
  id: string; name: string; bucket: string; region: string;
  lastTestOk: boolean; lastTestedAt: string | null;
}
interface MetricsData {
  system: SystemInfo; disks: DiskInfo[]; pm2: PM2Proc[];
  clickhouse: CHStats; s3: S3Source[]; collectedAt: string;
}

// ─── Sparkline history: keep last 60 data points ───────────────
const HISTORY_LEN = 60;
type HistoryKey = 'cpu' | 'ram' | 'chMem' | 'chQueries';
type History = Record<HistoryKey, number[]>;

// ─── Helpers ─────────────────────────────────────────────────────
const fmtBytes = (b: number) => {
  if (!b) return '0 B';
  const k = 1024, s = ['B','KB','MB','GB','TB'];
  const i = Math.floor(Math.log(b) / Math.log(k));
  return (b / Math.pow(k, i)).toFixed(1) + ' ' + s[i];
};
const fmtUptime = (sec: number) => {
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  return d > 0 ? `${d}d ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m`;
};
const fmtNum = (n: number) => n.toLocaleString();
const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

const THRESHOLDS = {
  ramWarn: 80, ramCrit: 92, cpuWarn: 70, cpuCrit: 90,
  diskWarn: 75, diskCrit: 90, partsWarn: 200, partsCrit: 400,
};

// ─── Sparkline SVG ───────────────────────────────────────────────
function Sparkline({ data, color, height = 40, width = 120 }: {
  data: number[]; color: string; height?: number; width?: number;
}) {
  if (data.length < 2) return <div style={{ width, height }} />;
  const max = Math.max(...data, 1);
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - clamp((v / max) * height, 2, height - 2);
    return `${x},${y}`;
  }).join(' ');
  const areaBase = `${width},${height} 0,${height}`;
  return (
    <svg width={width} height={height} style={{ display: 'block', overflow: 'visible' }}>
      <defs>
        <linearGradient id={`sg-${color.replace(/[^a-z]/gi,'')}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <polygon
        points={`0,${height} ${pts} ${areaBase}`}
        fill={`url(#sg-${color.replace(/[^a-z]/gi,'')})`}
      />
      <polyline
        points={pts}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* Live dot */}
      {data.length > 0 && (() => {
        const last = data[data.length - 1];
        const lx = width;
        const ly = height - clamp((last / max) * height, 2, height - 2);
        return (
          <circle cx={lx} cy={ly} r="3" fill={color}>
            <animate attributeName="r" values="3;5;3" dur="2s" repeatCount="indefinite" />
            <animate attributeName="opacity" values="1;0.5;1" dur="2s" repeatCount="indefinite" />
          </circle>
        );
      })()}
    </svg>
  );
}

// ─── Radial Ring Gauge ───────────────────────────────────────────
function RingGauge({ pct, color, size = 80, strokeWidth = 7, label, sublabel }: {
  pct: number; color: string; size?: number; strokeWidth?: number;
  label: string; sublabel?: string;
}) {
  const r = (size - strokeWidth * 2) / 2;
  const circ = 2 * Math.PI * r;
  const dash = (clamp(pct, 0, 100) / 100) * circ;
  const cx = size / 2, cy = size / 2;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
      <svg width={size} height={size} style={{ transform: 'rotate(-90deg)' }}>
        <circle cx={cx} cy={cy} r={r} fill="none" stroke="var(--border)" strokeWidth={strokeWidth} />
        <circle
          cx={cx} cy={cy} r={r} fill="none"
          stroke={color} strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={`${dash} ${circ}`}
          style={{ transition: 'stroke-dasharray 0.8s cubic-bezier(0.4,0,0.2,1)' }}
        />
      </svg>
      <div style={{ marginTop: -size * 0.55, marginBottom: size * 0.25, textAlign: 'center', lineHeight: 1.2 }}>
        <div style={{ fontSize: size * 0.22, fontWeight: 800, fontFamily: 'monospace', color }}>{pct}%</div>
        {sublabel && <div style={{ fontSize: size * 0.12, color: 'var(--text-tertiary)', fontWeight: 500 }}>{sublabel}</div>}
      </div>
      <div style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)' }}>{label}</div>
    </div>
  );
}

// ─── Animated Counter ────────────────────────────────────────────
function AnimCounter({ value, suffix = '' }: { value: number; suffix?: string }) {
  const [displayed, setDisplayed] = useState(value);
  const prev = useRef(value);
  useEffect(() => {
    if (value === prev.current) return;
    const start = prev.current, end = value;
    const diff = end - start;
    const dur = 600;
    const t0 = Date.now();
    const tick = () => {
      const elapsed = Date.now() - t0;
      if (elapsed >= dur) { setDisplayed(end); prev.current = end; return; }
      const eased = 1 - Math.pow(1 - elapsed / dur, 3);
      setDisplayed(Math.round(start + diff * eased));
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    prev.current = value;
  }, [value]);
  return <span>{fmtNum(displayed)}{suffix}</span>;
}

// ─── Section Header ──────────────────────────────────────────────
function SectionHead({ icon, title, badge }: { icon: React.ReactNode; title: string; badge?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, marginTop: 32 }}>
      <span style={{ color: 'var(--accent)', display: 'flex' }}>{icon}</span>
      <span style={{ fontSize: 13, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>{title}</span>
      {badge && (
        <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 20, background: 'var(--accent-muted)', color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{badge}</span>
      )}
    </div>
  );
}

// ─── Detective Image ────────────────────────────────────────────────
function DetectiveSleuth({ height = 120 }: { height?: number }) {
  return (
    <div style={{
      height,
      aspectRatio: '3/4',
      borderRadius: '24px',
      overflow: 'hidden',
      border: '1px solid var(--border)',
      boxShadow: '0 12px 32px rgba(0,0,0,0.4)',
      flexShrink: 0,
      background: 'var(--bg-card)',
      position: 'relative'
    }}>
      <img 
        src="/server-sleuth.webp" 
        alt="Server Sleuth" 
        style={{ width: '100%', height: '100%', objectFit: 'contain' }} 
        onError={(e) => {
          e.currentTarget.style.display = 'none';
        }}
      />
    </div>
  );
}

// ─── CSS keyframes injection ──────────────────────────────────────
const SLEUTH_CSS = `
@keyframes ping { 75%,100%{transform:scale(2);opacity:0;} }
@keyframes sleuth-float { 0%,100%{transform:translateY(0);} 50%{transform:translateY(-6px);} }
@keyframes fadeSlideIn { from{opacity:0;transform:translateY(8px);} to{opacity:1;transform:translateY(0);} }
`;

// ─── Main Component ───────────────────────────────────────────────
export default function InfraMonitor() {
  const [data, setData] = useState<MetricsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [history, setHistory] = useState<History>({ cpu: [], ram: [], chMem: [], chQueries: [] });
  const [alerts, setAlerts] = useState<{ level: 'warn' | 'error'; msg: string }[]>([]);
  const [tab, setTab] = useState<'overview' | 'processes' | 'database' | 'storage' | 's3'>('overview');

  const pushHistory = useCallback((key: HistoryKey, value: number) => {
    setHistory(prev => ({ ...prev, [key]: [...prev[key].slice(-(HISTORY_LEN - 1)), value] }));
  }, []);

  const fetchMetrics = useCallback(async () => {
    try {
      const d = await apiCall<MetricsData>('/api/server-metrics/metrics');
      setData(d); setError(null);
      pushHistory('cpu', d.system.cpuUsagePct);
      pushHistory('ram', d.system.ram.usePct);
      pushHistory('chMem', Math.round((d.clickhouse.memoryTrackingBytes || 0) / 1024 / 1024));
      pushHistory('chQueries', d.clickhouse.activeQueries || 0);
      const newAlerts: { level: 'warn' | 'error'; msg: string }[] = [];
      const { ram, cpuUsagePct } = d.system;
      if (ram.usePct >= THRESHOLDS.ramCrit) newAlerts.push({ level: 'error', msg: `RAM critically high — ${ram.usePct}%` });
      else if (ram.usePct >= THRESHOLDS.ramWarn) newAlerts.push({ level: 'warn', msg: `RAM elevated — ${ram.usePct}%` });
      if (cpuUsagePct >= THRESHOLDS.cpuCrit) newAlerts.push({ level: 'error', msg: `CPU critically high — ${cpuUsagePct}%` });
      else if (cpuUsagePct >= THRESHOLDS.cpuWarn) newAlerts.push({ level: 'warn', msg: `CPU elevated — ${cpuUsagePct}%` });
      for (const disk of d.disks) {
        if (disk.usePct >= THRESHOLDS.diskCrit) newAlerts.push({ level: 'error', msg: `${disk.mountpoint} disk critically full — ${disk.usePct}%` });
        else if (disk.usePct >= THRESHOLDS.diskWarn) newAlerts.push({ level: 'warn', msg: `${disk.mountpoint} filling up — ${disk.usePct}%` });
      }
      const tp = d.clickhouse.tables.reduce((s, t) => s + t.parts, 0);
      if (tp >= THRESHOLDS.partsCrit) newAlerts.push({ level: 'error', msg: `ClickHouse: ${tp} parts — heavy write pressure` });
      else if (tp >= THRESHOLDS.partsWarn) newAlerts.push({ level: 'warn', msg: `ClickHouse: ${tp} parts — watch closely` });
      if (!d.clickhouse.ok) newAlerts.push({ level: 'error', msg: `ClickHouse unreachable: ${d.clickhouse.error}` });
      setAlerts(newAlerts);
    } catch (e: any) { setError(e.message); }
    finally { setLoading(false); }
  }, [pushHistory]);

  useEffect(() => { fetchMetrics(); }, []);
  useEffect(() => {
    if (!autoRefresh) return;
    const t = setInterval(fetchMetrics, 10_000);
    return () => clearInterval(t);
  }, [autoRefresh, fetchMetrics]);

  if (loading && !data) {
    return (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 100, color: 'var(--text-tertiary)' }}>
        <style dangerouslySetInnerHTML={{ __html: SLEUTH_CSS }} />
        <DetectiveSleuth height={200} />
        <div style={{ marginTop: 24, fontSize: 13, fontWeight: 700, letterSpacing: '0.05em', textTransform: 'uppercase' }}>Server Sleuth is investigating...</div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: 'var(--red)' }}>
        <AlertTriangle size={32} style={{ margin: '0 auto 16px' }} />
        <div style={{ fontWeight: 600 }}>Failed to load server metrics</div>
        <div style={{ fontSize: 12, marginTop: 4, opacity: 0.8 }}>{error}</div>
      </div>
    );
  }

  if (!data) return null;
  const s = data.system;

  return (
    <div style={{ paddingBottom: 64, animation: 'fadeSlideIn 0.4s ease-out' }}>
      <style dangerouslySetInnerHTML={{ __html: SLEUTH_CSS }} />
      
      {/* ─── Hero / Header ─── */}
      <div style={{ 
        position: 'relative', overflow: 'hidden',
        background: 'var(--bg-card)',
        border: '1px solid var(--border)', borderRadius: 16, padding: '40px 48px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 32,
        boxShadow: '0 12px 40px rgba(0,0,0,0.15)'
      }}>
        {/* Background Image Layer */}
        <div style={{
          position: 'absolute', inset: 0, opacity: 0.5,
          backgroundImage: 'url(/server-sleuth.webp)',
          backgroundSize: 'cover',
          backgroundPosition: 'center 25%',
          backgroundRepeat: 'no-repeat',
          mixBlendMode: 'luminosity',
          maskImage: 'linear-gradient(to right, transparent, black 40%, black)',
          WebkitMaskImage: 'linear-gradient(to right, transparent, black 40%, black)'
        }} />
        
        {/* Left Side Content (Relative so it sits above the background) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 24, position: 'relative', zIndex: 10 }}>
          <div>
            <div style={{ fontSize: 32, fontWeight: 900, letterSpacing: '-0.02em', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 12, textShadow: '0 2px 10px rgba(0,0,0,0.8)' }}>
              Server Sleuth <span style={{ fontSize: 11, padding: '3px 10px', borderRadius: 12, background: 'var(--text-primary)', color: 'var(--bg-primary)', textTransform: 'uppercase', letterSpacing: '0.06em', textShadow: 'none' }}>Live</span>
            </div>
            <div style={{ fontSize: 15, color: '#fff', opacity: 0.9, marginTop: 8, display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, textShadow: '0 2px 8px rgba(0,0,0,0.8)' }}>
              <Server size={16} /> {s.hostname} · {s.platform}
            </div>
            <div style={{ fontSize: 14, color: '#fff', opacity: 0.8, marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, fontWeight: 500, textShadow: '0 2px 8px rgba(0,0,0,0.8)' }}>
              <Wifi size={14} /> {s.ips.join(', ')}
            </div>
          </div>
        </div>
        
        {/* Right Side Content */}
        <div style={{ textAlign: 'right', position: 'relative', zIndex: 10 }}>
          <div style={{ fontSize: 14, color: '#fff', opacity: 0.9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8, textShadow: '0 2px 8px rgba(0,0,0,0.8)' }}>
            Uptime
          </div>
          <div style={{ fontSize: 36, fontWeight: 900, fontFamily: 'monospace', color: '#fff', lineHeight: 1, textShadow: '0 2px 14px rgba(0,0,0,0.9)' }}>
            {fmtUptime(s.uptimeSec)}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, justifyContent: 'flex-end', marginTop: 16 }}>
            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#fff', cursor: 'pointer', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', textShadow: '0 2px 8px rgba(0,0,0,0.8)' }}>
              <input type="checkbox" checked={autoRefresh} onChange={e => setAutoRefresh(e.target.checked)} style={{ accentColor: 'var(--accent)', width: 16, height: 16 }} />
              Auto-poll
            </label>
            <button onClick={fetchMetrics} style={{ 
              background: 'var(--text-primary)', border: 'none', borderRadius: 8, padding: '8px 14px', 
              color: 'var(--bg-primary)', fontSize: 12, fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
              boxShadow: '0 4px 12px rgba(0,0,0,0.3)', transition: 'transform 0.1s'
            }} onMouseDown={e => e.currentTarget.style.transform = 'scale(0.95)'} onMouseUp={e => e.currentTarget.style.transform = 'scale(1)'} onMouseLeave={e => e.currentTarget.style.transform = 'scale(1)'}>
              <RefreshCw size={14} className={loading ? "animate-spin" : ""} /> Refresh
            </button>
          </div>
        </div>
      </div>

      {/* ─── Alerts ─── */}
      {alerts.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 24 }}>
          {alerts.map((alt, i) => (
            <div key={i} style={{ 
              padding: '12px 16px', borderRadius: 12, display: 'flex', alignItems: 'center', gap: 12,
              background: alt.level === 'error' ? 'var(--red-muted)' : 'rgba(255,180,0,0.1)',
              border: `1px solid ${alt.level === 'error' ? 'var(--red)' : '#f0a000'}`,
              color: alt.level === 'error' ? 'var(--red)' : '#f0a000',
              fontWeight: 600, fontSize: 13
            }}>
              <AlertTriangle size={16} />
              {alt.msg}
            </div>
          ))}
        </div>
      )}

      {/* ─── Tabs ─── */}
      <div style={{ display: 'flex', gap: 8, borderBottom: '1px solid var(--border)', paddingBottom: 16, marginBottom: 24, overflowX: 'auto' }}>
        {[
          { id: 'overview', icon: <Activity size={14}/>, label: 'Overview' },
          { id: 'database', icon: <Database size={14}/>, label: 'ClickHouse' },
          { id: 'storage', icon: <HardDrive size={14}/>, label: 'Storage' },
          { id: 'processes', icon: <Cpu size={14}/>, label: 'Processes' },
          { id: 's3', icon: <Layers size={14}/>, label: 'S3 Sources' },
        ].map(t => (
          <button key={t.id} onClick={() => setTab(t.id as any)} style={{
            display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderRadius: 8, 
            fontSize: 13, fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s',
            background: tab === t.id ? 'var(--accent)' : 'transparent',
            color: tab === t.id ? 'var(--accent-contrast)' : 'var(--text-secondary)',
            border: 'none',
            outline: 'none'
          }}>
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* ─── Tab Content ─── */}
      {tab === 'overview' && (
        <div style={{ animation: 'fadeSlideIn 0.3s ease-out' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 20 }}>
            
            {/* CPU Card */}
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: 24, display: 'flex', alignItems: 'center', gap: 24 }}>
              <RingGauge pct={s.cpuUsagePct} color={s.cpuUsagePct > THRESHOLDS.cpuCrit ? 'var(--red)' : s.cpuUsagePct > THRESHOLDS.cpuWarn ? 'var(--yellow)' : 'var(--accent)'} label="CPU Load" />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>{s.cpuModel.slice(0, 24)}...</div>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 12 }}>{s.cpuCores} Cores · Load Avg: {s.loadAvg.join(' / ')}</div>
                <Sparkline data={history.cpu} color={s.cpuUsagePct > THRESHOLDS.cpuCrit ? 'var(--red)' : s.cpuUsagePct > THRESHOLDS.cpuWarn ? 'var(--yellow)' : 'var(--accent)'} width={180} height={40} />
              </div>
            </div>

            {/* RAM Card */}
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: 24, display: 'flex', alignItems: 'center', gap: 24 }}>
              <RingGauge pct={s.ram.usePct} color={s.ram.usePct > THRESHOLDS.ramCrit ? 'var(--red)' : s.ram.usePct > THRESHOLDS.ramWarn ? 'var(--yellow)' : 'var(--accent)'} label="RAM Used" />
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>System Memory</div>
                <div style={{ fontSize: 12, color: 'var(--text-tertiary)', marginBottom: 12 }}>{fmtBytes(s.ram.usedMB * 1024 * 1024)} used of {fmtBytes(s.ram.totalMB * 1024 * 1024)}</div>
                <Sparkline data={history.ram} color={s.ram.usePct > THRESHOLDS.ramCrit ? 'var(--red)' : s.ram.usePct > THRESHOLDS.ramWarn ? 'var(--yellow)' : 'var(--accent)'} width={180} height={40} />
              </div>
            </div>

          </div>
        </div>
      )}

      {tab === 'database' && (
        <div style={{ animation: 'fadeSlideIn 0.3s ease-out' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 24 }}>
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: 20 }}>
              <div style={{ color: 'var(--text-tertiary)', marginBottom: 8 }}><Layers size={16} /></div>
              <div style={{ fontSize: 24, fontWeight: 800, fontFamily: 'monospace', color: 'var(--text-primary)' }}><AnimCounter value={data.clickhouse.totalRows} /></div>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', marginTop: 4 }}>Total Rows</div>
            </div>
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: 20 }}>
              <div style={{ color: 'var(--text-tertiary)', marginBottom: 8 }}><HardDrive size={16} /></div>
              <div style={{ fontSize: 24, fontWeight: 800, fontFamily: 'monospace', color: 'var(--text-primary)' }}>{data.clickhouse.totalSize}</div>
              <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', marginTop: 4 }}>Data Size</div>
            </div>
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: 20 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <div>
                  <div style={{ color: 'var(--text-tertiary)', marginBottom: 8 }}><Zap size={16} /></div>
                  <div style={{ fontSize: 24, fontWeight: 800, fontFamily: 'monospace', color: 'var(--text-primary)' }}><AnimCounter value={data.clickhouse.activeQueries} /></div>
                  <div style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', marginTop: 4 }}>Active Queries</div>
                </div>
                <div style={{ marginTop: 16 }}><Sparkline data={history.chQueries} color="var(--accent)" width={80} height={30} /></div>
              </div>
            </div>
          </div>

          <SectionHead icon={<Database size={16}/>} title="Top Tables by Parts" />
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ padding: '12px 20px', textAlign: 'left', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', borderBottom: '1px solid var(--border)' }}>Table</th>
                  <th style={{ padding: '12px 20px', textAlign: 'left', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', borderBottom: '1px solid var(--border)' }}>Parts</th>
                  <th style={{ padding: '12px 20px', textAlign: 'left', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', borderBottom: '1px solid var(--border)' }}>Rows</th>
                  <th style={{ padding: '12px 20px', textAlign: 'left', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', borderBottom: '1px solid var(--border)' }}>Size</th>
                </tr>
              </thead>
              <tbody>
                {data.clickhouse.tables.map(t => (
                  <tr key={t.table} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '12px 20px', fontWeight: 600 }}>{t.table}</td>
                    <td style={{ padding: '12px 20px', fontFamily: 'monospace', fontWeight: 700, color: t.parts > THRESHOLDS.partsCrit ? 'var(--red)' : t.parts > THRESHOLDS.partsWarn ? 'var(--yellow)' : 'var(--text-primary)' }}>{t.parts}</td>
                    <td style={{ padding: '12px 20px', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{fmtNum(t.rows)}</td>
                    <td style={{ padding: '12px 20px', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{fmtBytes(t.bytes)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'storage' && (
        <div style={{ animation: 'fadeSlideIn 0.3s ease-out' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
            {data.disks.map(d => (
              <div key={d.device} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: 24 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
                  <div>
                    <div style={{ fontSize: 16, fontWeight: 800, color: 'var(--text-primary)' }}>{d.mountpoint}</div>
                    <div style={{ fontSize: 11, fontFamily: 'monospace', color: 'var(--text-tertiary)', marginTop: 4 }}>{d.device}</div>
                  </div>
                  <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6, textTransform: 'uppercase', letterSpacing: '0.06em',
                    background: d.type === 'SSD' ? 'rgba(34,197,94,0.1)' : 'rgba(59,130,246,0.1)',
                    color: d.type === 'SSD' ? 'var(--green)' : 'var(--blue)'
                  }}>{d.type}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
                  <RingGauge pct={d.usePct} color={d.usePct > THRESHOLDS.diskCrit ? 'var(--red)' : d.usePct > THRESHOLDS.diskWarn ? 'var(--yellow)' : 'var(--accent)'} label="Used" size={70} strokeWidth={6} />
                  <div>
                    <div style={{ fontSize: 18, fontWeight: 800, fontFamily: 'monospace', color: 'var(--text-primary)' }}>{d.availGB} GB</div>
                    <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>Free Space</div>
                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8 }}>Total capacity: <b>{d.totalGB} GB</b></div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {tab === 'processes' && (
        <div style={{ animation: 'fadeSlideIn 0.3s ease-out' }}>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr>
                  <th style={{ padding: '12px 20px', textAlign: 'left', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', borderBottom: '1px solid var(--border)' }}>Process</th>
                  <th style={{ padding: '12px 20px', textAlign: 'left', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', borderBottom: '1px solid var(--border)' }}>Status</th>
                  <th style={{ padding: '12px 20px', textAlign: 'left', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', borderBottom: '1px solid var(--border)' }}>CPU</th>
                  <th style={{ padding: '12px 20px', textAlign: 'left', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', borderBottom: '1px solid var(--border)' }}>Memory</th>
                  <th style={{ padding: '12px 20px', textAlign: 'left', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', borderBottom: '1px solid var(--border)' }}>Uptime</th>
                  <th style={{ padding: '12px 20px', textAlign: 'left', fontWeight: 700, fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-tertiary)', borderBottom: '1px solid var(--border)' }}>Restarts</th>
                </tr>
              </thead>
              <tbody>
                {data.pm2.map(p => (
                  <tr key={p.name} style={{ borderBottom: '1px solid var(--border)' }}>
                    <td style={{ padding: '12px 20px', fontWeight: 800, color: 'var(--text-primary)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <Circle fill={p.status === 'online' ? 'var(--green)' : 'var(--red)'} size={8} stroke="none" />
                        {p.name}
                      </div>
                      <div style={{ fontSize: 10, fontFamily: 'monospace', color: 'var(--text-tertiary)', marginTop: 2, marginLeft: 16 }}>PID: {p.pid}</div>
                    </td>
                    <td style={{ padding: '12px 20px' }}>
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6, textTransform: 'uppercase', letterSpacing: '0.06em',
                        background: p.status === 'online' ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                        color: p.status === 'online' ? 'var(--green)' : 'var(--red)'
                      }}>{p.status}</span>
                    </td>
                    <td style={{ padding: '12px 20px', fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{p.cpu}%</td>
                    <td style={{ padding: '12px 20px', fontFamily: 'monospace', fontWeight: p.memMB > 2000 ? 700 : 400, color: p.memMB > 2000 ? 'var(--yellow)' : 'var(--text-secondary)' }}>
                      {p.memMB > 1024 ? `${(p.memMB/1024).toFixed(2)} GB` : `${p.memMB} MB`}
                    </td>
                    <td style={{ padding: '12px 20px', color: 'var(--text-tertiary)' }}>{p.uptime}</td>
                    <td style={{ padding: '12px 20px', fontFamily: 'monospace', color: p.restarts > 0 ? 'var(--yellow)' : 'var(--text-tertiary)' }}>{p.restarts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 's3' && (
        <div style={{ animation: 'fadeSlideIn 0.3s ease-out' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 20 }}>
            {data.s3.map(src => (
              <div key={src.id} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: 20 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
                  <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)' }}>{src.name}</div>
                  {src.lastTestOk ? <CheckCircle2 size={16} color="var(--green)" /> : <AlertTriangle size={16} color="var(--yellow)" />}
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, fontSize: 12, color: 'var(--text-secondary)' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-tertiary)' }}>Bucket</span><span style={{ fontFamily: 'monospace' }}>{src.bucket}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-tertiary)' }}>Region</span><span style={{ fontFamily: 'monospace' }}>{src.region}</span></div>
                  <div style={{ display: 'flex', justifyContent: 'space-between' }}><span style={{ color: 'var(--text-tertiary)' }}>Last Test</span><span>{src.lastTestedAt ? new Date(src.lastTestedAt).toLocaleDateString() : 'Never'}</span></div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  );
}

