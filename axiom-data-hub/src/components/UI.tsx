import { type ReactNode } from 'react';
import { ChevronRight, ExternalLink } from 'lucide-react';

/* ═══════════════════════════════════════
   PAGE HEADER — Rich, animated, informative
   ═══════════════════════════════════════ */
export function PageHeader({ title, sub, description, learnMoreUrl, learnMoreLabel, action }: {
  title: string;
  sub: string;
  description?: string;
  learnMoreUrl?: string;
  learnMoreLabel?: string;
  action?: ReactNode;
}) {
  return (
    <div className="animate-fadeIn" style={{
      marginBottom: 32, display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start',
      position: 'relative',
    }}>
      {/* Accent bar */}
      <div style={{
        position: 'absolute', left: -24, top: 4, bottom: 4, width: 4, borderRadius: 4,
        background: 'var(--accent)', opacity: 0.6,
      }} />
      <div style={{ maxWidth: 680 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text-primary)', margin: 0 }}>
          {title}
        </h1>
        <p style={{ fontSize: 14, fontWeight: 500, marginTop: 6, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          {sub}
        </p>
        {description && (
          <p style={{
            fontSize: 12, fontWeight: 400, marginTop: 8, color: 'var(--text-tertiary)',
            lineHeight: 1.7, maxWidth: 580,
          }}>
            {description}
          </p>
        )}
        {learnMoreUrl && (
          <a
            href={learnMoreUrl}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              fontSize: 11, fontWeight: 600, color: 'var(--accent)',
              textDecoration: 'none', marginTop: 8,
              transition: 'opacity 0.2s',
            }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '0.7')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
          >
            {learnMoreLabel || 'Learn more'} <ExternalLink size={10} />
          </a>
        )}
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}

/* ═══════════════════════════════════════
   SECTION HEADER
   ═══════════════════════════════════════ */
export function SectionHeader({ title, action, onAction }: { title: string; action?: string; onAction?: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
      <h3 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{title}</h3>
      {action && (
        <button
          onClick={onAction}
          style={{
            fontSize: 12, fontWeight: 600, color: 'var(--accent)', background: 'none',
            border: 'none', cursor: 'pointer', transition: 'opacity 0.2s',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.7')}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
        >
          {action}
        </button>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════
   STAT CARD
   ═══════════════════════════════════════ */
interface StatCardProps {
  label: string;
  value: string | number;
  sub?: string;
  icon: ReactNode;
  color: string;
  colorMuted: string;
  delay?: number;
}

export function StatCard({ label, value, sub, icon, color, colorMuted, delay = 0 }: StatCardProps) {
  return (
    <div
      className="animate-fadeIn"
      style={{
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 16,
        padding: 24,
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between', gap: 20,
        boxShadow: 'var(--shadow-sm)',
        transition: 'all 0.25s ease',
        animationDelay: `${delay}s`,
        minHeight: 160,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.transform = 'translateY(-4px)';
        e.currentTarget.style.boxShadow = 'var(--shadow-md)';
        e.currentTarget.style.borderColor = 'var(--border-hover)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
        e.currentTarget.style.borderColor = 'var(--border)';
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>{label}</span>
        <div style={{
          width: 40, height: 40, borderRadius: 12,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          background: colorMuted, color,
          transition: 'transform 0.2s',
        }}>
          {icon}
        </div>
      </div>
      <div>
        <h3 style={{ fontSize: 32, fontWeight: 800, letterSpacing: '-0.02em', color: 'var(--text-primary)' }}>
          {value}
        </h3>
        {sub && <p style={{ fontSize: 12, fontWeight: 600, marginTop: 4, color }}>{sub}</p>}
      </div>
    </div>
  );
}

/* ... (GradientCard, ActionCard remain the same) ... */

/* ═══════════════════════════════════════
   EMPTY STATE — with breathing pulse
   ═══════════════════════════════════════ */
export function EmptyState({ icon, title, sub, action }: { icon: ReactNode; title: string; sub: string; action?: ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', padding: '48px 24px' }}>
      <div style={{
        width: 56, height: 56, borderRadius: 16,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--bg-card-hover)', color: 'var(--text-tertiary)',
        marginBottom: 16,
        animation: 'pulse 3s ease-in-out infinite',
      }}>
        {icon}
      </div>
      <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-secondary)' }}>{title}</p>
      <p style={{ fontSize: 12, fontWeight: 500, marginTop: 4, color: 'var(--text-tertiary)', maxWidth: 300 }}>{sub}</p>
      {action && <div style={{ marginTop: 16 }}>{action}</div>}
    </div>
  );
}
interface GradientCardProps {
  label: string;
  value: string | number;
  sub?: string;
  progress?: number;
  progressLabel?: string;
  icon: ReactNode;
}

export function GradientCard({ label, value, sub, progress = 0, progressLabel, icon }: GradientCardProps) {
  return (
    <div
      className="animate-fadeIn"
      style={{
        background: 'var(--gradient-card)',
        borderRadius: 16,
        padding: 28,
        display: 'flex', flexDirection: 'column', justifyContent: 'space-between',
        position: 'relative', overflow: 'hidden',
        minHeight: 200,
        boxShadow: 'var(--shadow-lg)',
        transition: 'transform 0.25s ease',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.transform = 'translateY(-4px)')}
      onMouseLeave={(e) => (e.currentTarget.style.transform = 'translateY(0)')}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', position: 'relative', zIndex: 1 }}>
        <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--gradient-card-sub)' }}>{label}</span>
        {sub && (
          <span style={{
            fontSize: 11, fontWeight: 700, padding: '4px 12px', borderRadius: 999,
            background: 'rgba(255,255,255,0.2)', backdropFilter: 'blur(8px)',
            color: 'var(--gradient-card-sub)',
          }}>
            {sub}
          </span>
        )}
      </div>
      <div style={{ position: 'relative', zIndex: 1, marginTop: 'auto' }}>
        <h3 style={{ fontSize: 52, fontWeight: 900, letterSpacing: '-0.03em', color: 'var(--gradient-card-text)' }}>
          {value}
        </h3>
        {progressLabel && (
          <div style={{ marginTop: 16 }}>
            <div style={{ height: 6, borderRadius: 999, background: 'rgba(0,0,0,0.1)', overflow: 'hidden' }}>
              <div style={{ height: '100%', borderRadius: 999, width: `${progress}%`, background: 'rgba(69,26,3,0.4)', transition: 'width 0.7s ease' }} />
            </div>
            <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--gradient-card-sub)', display: 'block', marginTop: 6 }}>
              {progressLabel}
            </span>
          </div>
        )}
      </div>
      {/* Watermark icon */}
      <div style={{
        position: 'absolute', right: -16, bottom: -16, opacity: 0.06, zIndex: 0,
        transform: 'scale(5)', transformOrigin: 'center',
        color: 'var(--gradient-card-text)',
      }}>
        {icon}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════
   ACTION CARD
   ═══════════════════════════════════════ */
interface ActionCardProps {
  title: string;
  sub: string;
  icon: ReactNode;
  color: string;
  colorMuted: string;
  onClick?: () => void;
  delay?: number;
}

export function ActionCard({ title, sub, icon, color, colorMuted, onClick, delay = 0 }: ActionCardProps) {
  return (
    <button
      onClick={onClick}
      className="animate-fadeIn"
      style={{
        display: 'flex', alignItems: 'center', gap: 16,
        padding: '16px 20px', borderRadius: 16, width: '100%', textAlign: 'left',
        background: 'var(--bg-card)', border: '1px solid var(--border)',
        boxShadow: 'var(--shadow-sm)', cursor: 'pointer',
        transition: 'all 0.2s ease', animationDelay: `${delay}s`,
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = color;
        e.currentTarget.style.transform = 'translateY(-2px)';
        e.currentTarget.style.boxShadow = 'var(--shadow-md)';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--border)';
        e.currentTarget.style.transform = 'translateY(0)';
        e.currentTarget.style.boxShadow = 'var(--shadow-sm)';
      }}
    >
      <div style={{
        width: 42, height: 42, borderRadius: 12, flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: colorMuted, color,
        transition: 'transform 0.2s',
      }}>
        {icon}
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{title}</p>
        <p style={{ fontSize: 11, fontWeight: 500, marginTop: 2, color: 'var(--text-tertiary)' }}>{sub}</p>
      </div>
      <ChevronRight size={16} style={{ flexShrink: 0, color: 'var(--text-tertiary)', transition: 'transform 0.2s' }} />
    </button>
  );
}




/* ═══════════════════════════════════════
   DATA TABLE
   ═══════════════════════════════════════ */
interface TableColumn { key: string; label: string; width?: string; }

interface DataTableProps {
  columns: TableColumn[];
  rows: Record<string, ReactNode>[];
  emptyIcon: ReactNode;
  emptyTitle: string;
  emptySub: string;
}

export function DataTable({ columns, rows, emptyIcon, emptyTitle, emptySub }: DataTableProps) {
  if (rows.length === 0) {
    return (
      <div
        className="animate-fadeIn"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}
      >
        <EmptyState icon={emptyIcon} title={emptyTitle} sub={emptySub} />
      </div>
    );
  }

  return (
    <div
      className="animate-fadeIn"
      style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}
    >
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {columns.map((col) => (
                <th
                  key={col.key}
                  style={{
                    fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
                    textAlign: 'left', padding: '14px 20px', color: 'var(--text-tertiary)', width: col.width,
                  }}
                >
                  {col.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr
                key={i}
                style={{ borderBottom: '1px solid var(--border)', transition: 'background 0.15s', cursor: 'pointer' }}
                onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-card-hover)')}
                onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
              >
                {columns.map((col) => (
                  <td key={col.key} style={{ fontSize: 13, fontWeight: 500, padding: '14px 20px', color: 'var(--text-primary)' }}>
                    {row[col.key]}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════
   BADGE
   ═══════════════════════════════════════ */
export function Badge({ label, color, colorMuted }: { label: string; color: string; colorMuted: string }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '4px 10px', borderRadius: 999,
      fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
      background: colorMuted, color,
    }}>
      {label}
    </span>
  );
}

/* ═══════════════════════════════════════
   CONFIG ROW
   ═══════════════════════════════════════ */
export function ConfigRow({ label, description, children }: { label: string; description: string; children: ReactNode }) {
  return (
    <div
      style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24,
        padding: '20px 24px',
        borderBottom: '1px solid var(--border)',
        transition: 'background 0.15s',
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--bg-card-hover)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      <div style={{ flex: 1, minWidth: 0 }}>
        <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>{label}</p>
        <p style={{ fontSize: 12, fontWeight: 500, marginTop: 2, color: 'var(--text-tertiary)' }}>{description}</p>
      </div>
      <div style={{ width: 280, flexShrink: 0 }}>{children}</div>
    </div>
  );
}

/* ═══════════════════════════════════════
   INPUT
   ═══════════════════════════════════════ */
export function Input({ placeholder, value, onChange, onKeyDown, type = 'text', style }: {
  placeholder?: string; value?: string; onChange?: (v: string) => void; onKeyDown?: (e: any) => void; type?: string; style?: React.CSSProperties;
}) {
  return (
    <input
      type={type}
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange?.(e.target.value)}
      onKeyDown={onKeyDown}
      style={{
        width: '100%', padding: '10px 16px', borderRadius: 12,
        fontSize: 13, fontWeight: 500, outline: 'none',
        background: 'var(--bg-input)', border: '1px solid var(--border)',
        color: 'var(--text-primary)',
        transition: 'border-color 0.2s, box-shadow 0.2s',
        ...style
      }}
      onFocus={(e) => {
        e.currentTarget.style.borderColor = 'var(--accent)';
        e.currentTarget.style.boxShadow = '0 0 0 3px var(--accent-muted)';
      }}
      onBlur={(e) => {
        e.currentTarget.style.borderColor = 'var(--border)';
        e.currentTarget.style.boxShadow = 'none';
      }}
    />
  );
}

/* ═══════════════════════════════════════
   BUTTON
   ═══════════════════════════════════════ */
export function Button({ children, variant = 'primary', onClick, icon, full = false, disabled = false, style, ...rest }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  children?: ReactNode; variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  icon?: ReactNode; full?: boolean; disabled?: boolean;
}) {
  const base: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
    padding: '10px 20px', borderRadius: 12, fontSize: 13, fontWeight: 600,
    cursor: disabled ? 'not-allowed' : 'pointer', transition: 'all 0.2s', border: 'none',
    width: full ? '100%' : undefined,
    opacity: disabled ? 0.5 : 1,
  };

  const variants: Record<string, React.CSSProperties> = {
    primary: { ...base, background: 'var(--accent)', color: 'var(--accent-contrast)' },
    secondary: { ...base, background: 'var(--bg-card-hover)', color: 'var(--text-primary)', border: '1px solid var(--border)' },
    danger: { ...base, background: 'var(--red-muted)', color: 'var(--red)' },
    ghost: { ...base, background: 'transparent', color: 'var(--text-secondary)', border: '1px solid var(--border)' },
  };

  return (
    <button
      {...rest}
      onClick={disabled ? undefined : onClick}
      disabled={disabled}
      style={{ ...variants[variant], ...style }}
      onMouseEnter={(e) => { if (!disabled) { e.currentTarget.style.transform = 'scale(1.03)'; e.currentTarget.style.opacity = '0.9'; }}}
      onMouseLeave={(e) => { if (!disabled) { e.currentTarget.style.transform = 'scale(1)'; e.currentTarget.style.opacity = '1'; }}}
      onMouseDown={(e) => { if (!disabled) e.currentTarget.style.transform = 'scale(0.97)'; }}
      onMouseUp={(e) => { if (!disabled) e.currentTarget.style.transform = 'scale(1.03)'; }}
    >
      {icon}
      {children}
    </button>
  );
}
