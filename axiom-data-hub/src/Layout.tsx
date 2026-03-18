import { useState, useEffect, useRef, type ReactNode } from 'react';
import { useTheme, THEME_META, type ThemeName } from './ThemeContext';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth, ROLE_LABELS, ROLE_COLORS } from './auth/AuthContext';
import type { PermissionKey } from './auth/AuthContext';
import {
  LayoutDashboard, CloudDownload, Database, Filter, ShieldCheck,
  Send, ListOrdered, Server, ScrollText, Users, Settings2,
  Moon, Sun, LogOut, Menu, X, Zap, ChevronRight, Beaker, Palette, Check, PlayCircle, Trash2
} from 'lucide-react';

interface LayoutProps { children: ReactNode; }

const NAV = [
  {
    label: 'PIPELINE',
    items: [
      { name: 'Dashboard', icon: LayoutDashboard, path: '/', requires: 'canViewDashboard' as PermissionKey },
      { name: 'S3 Ingestion', icon: CloudDownload, path: '/ingestion', requires: 'canViewIngestion' as PermissionKey },
      { name: 'ClickHouse', icon: Database, path: '/database', requires: 'canViewDatabase' as PermissionKey },
    ],
  },
  {
    label: 'PROCESSING',
    items: [
      { name: 'Segments', icon: Filter, path: '/segments', requires: 'canViewSegments' as PermissionKey },
      { name: 'Verification Engine', icon: ShieldCheck, path: '/verification', requires: 'canViewVerification' as PermissionKey },
      { name: 'Pipeline Studio', icon: Beaker, path: '/email-verifier', requires: 'canViewVerification' as PermissionKey },
    ],
  },
  {
    label: 'DELIVERY',
    items: [
      { name: 'Email Targets', icon: Send, path: '/targets', requires: 'canViewTargets' as PermissionKey },
      { name: 'Mail Queue', icon: ListOrdered, path: '/queue', requires: 'canViewQueue' as PermissionKey },
    ],
  },
  {
    label: 'SYSTEM',
    items: [
      { name: 'Database Janitor', icon: Trash2, path: '/janitor', requires: 'canViewDashboard' as PermissionKey },
      { name: 'Interactive Tutorial', icon: PlayCircle, path: '/tutorial', requires: 'canViewDashboard' as PermissionKey },
      { name: 'Server Config', icon: Server, path: '/config', requires: 'canViewConfig' as PermissionKey },
      { name: 'Team', icon: Users, path: '/team', requires: 'canManageUsers' as PermissionKey },
      { name: 'Logs', icon: ScrollText, path: '/logs', requires: 'canViewLogs' as PermissionKey },
      { name: 'Settings', icon: Settings2, path: '/settings', requires: 'canViewDashboard' as PermissionKey },
    ],
  },
];

export default function Layout({ children }: LayoutProps) {
  const { theme, mode, setTheme, toggleMode } = useTheme();
  const { user, signOut } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [themePicker, setThemePicker] = useState(false);
  const themePickerRef = useRef<HTMLDivElement>(null);
  const roleStyle = user ? ROLE_COLORS[user.role] : ROLE_COLORS.member;

  // Close theme picker on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (themePickerRef.current && !themePickerRef.current.contains(e.target as Node)) {
        setThemePicker(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const currentTitle =
    NAV.flatMap((s) => s.items).find((i) => i.path === location.pathname)?.name ?? 'Dashboard';

  return (
    <div
      style={{
        display: 'flex',
        width: '100%',
        height: '100vh',
        background: 'var(--bg-app)',
        color: 'var(--text-primary)',
        overflow: 'hidden',
        transition: 'background 0.3s, color 0.3s',
      }}
    >
      {/* Overlay for mobile */}
      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position: 'fixed', inset: 0, zIndex: 30,
            background: 'rgba(0,0,0,0.5)',
            backdropFilter: 'blur(4px)',
          }}
        />
      )}

      {/* ─── SIDEBAR ─── */}
      <aside
        style={{
          position: 'fixed',
          zIndex: 40,
          top: 0, left: 0,
          height: '100%',
          width: 272,
          display: 'flex',
          flexDirection: 'column',
          background: 'var(--bg-sidebar)',
          borderRight: '1px solid var(--border)',
          transform: open ? 'translateX(0)' : 'translateX(-100%)',
          transition: 'transform 0.3s ease',
          overflowY: 'auto',
        }}
        className="sidebar-desktop"
      >
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '28px 24px 20px' }}>
          <div
            style={{
              width: 36, height: 36, borderRadius: 10,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'var(--accent-muted)',
            }}
          >
            <Zap size={18} style={{ color: 'var(--accent)' }} />
          </div>
          <span style={{ fontWeight: 800, fontSize: 18, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
            Refinery Nexus
          </span>
        </div>

        {/* Nav */}
        <nav style={{ flex: 1, padding: '8px 12px 24px', display: 'flex', flexDirection: 'column', gap: 28 }}>
          {NAV.map((section) => {
            const visibleItems = section.items.filter((item) => !user || user.permissions[item.requires]);
            if (visibleItems.length === 0) return null;
            return (
              <div key={section.label}>
                <p style={{
                  fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase',
                  color: 'var(--text-tertiary)', padding: '0 12px', marginBottom: 8,
                }}>
                  {section.label}
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {visibleItems.map((item) => {
                    const active = location.pathname === item.path;
                    return (
                      <button
                        key={item.path}
                        onClick={() => { navigate(item.path); setOpen(false); }}
                        style={{
                          display: 'flex', alignItems: 'center', gap: 12,
                          padding: '10px 12px', borderRadius: 12,
                          fontSize: 13, fontWeight: active ? 600 : 500,
                          border: 'none', cursor: 'pointer', width: '100%', textAlign: 'left',
                          background: active ? 'var(--accent-muted)' : 'transparent',
                          color: active ? 'var(--accent)' : 'var(--text-secondary)',
                          transition: 'all 0.15s ease',
                        }}
                        onMouseEnter={(e) => {
                          if (!active) {
                            e.currentTarget.style.background = 'var(--bg-card-hover)';
                            e.currentTarget.style.color = 'var(--text-primary)';
                          }
                        }}
                        onMouseLeave={(e) => {
                          if (!active) {
                            e.currentTarget.style.background = 'transparent';
                            e.currentTarget.style.color = 'var(--text-secondary)';
                          }
                        }}
                      >
                        <item.icon size={16} strokeWidth={active ? 2.5 : 1.8} />
                        <span style={{ flex: 1 }}>{item.name}</span>
                        {active && <ChevronRight size={14} />}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </nav>

        {/* Footer */}
        <div style={{
          padding: '16px 24px', borderTop: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--green)' }} />
          <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-tertiary)' }}>Daemon Online</span>
        </div>
      </aside>

      {/* ─── MAIN ─── */}
      <div
        className="main-content-desktop"
        style={{ flex: 1, display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}
      >
        {/* Top Bar */}
        <header
          style={{
            height: 64, flexShrink: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '0 24px',
            background: 'var(--bg-sidebar)',
            borderBottom: '1px solid var(--border)',
          }}
        >
          {/* Left */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              onClick={() => setOpen(!open)}
              className="hamburger-btn"
              style={{
                padding: 8, borderRadius: 8, border: 'none', cursor: 'pointer',
                background: 'var(--bg-card-hover)', color: 'var(--text-secondary)',
              }}
            >
              {open ? <X size={18} /> : <Menu size={18} />}
            </button>
            <h2 style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
              {currentTitle}
            </h2>
          </div>

          {/* Right */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {/* Status */}
            <div
              className="status-pill-desktop"
              style={{
                display: 'none', alignItems: 'center', gap: 6,
                padding: '6px 14px', borderRadius: 999,
                fontSize: 11, fontWeight: 700,
                background: 'var(--green-muted)', color: 'var(--green)',
              }}
            >
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--green)' }} />
              Systems OK
            </div>

            {/* Theme picker */}
            <div className="theme-picker" ref={themePickerRef}>
              <button
                onClick={() => setThemePicker(!themePicker)}
                title="Choose theme"
                style={{
                  padding: 10, borderRadius: 12, border: '1px solid var(--border)', cursor: 'pointer',
                  background: 'var(--bg-card)', color: 'var(--text-secondary)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  transition: 'all 0.2s',
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--border-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
              >
                <Palette size={16} />
              </button>
              {themePicker && (
                <div className="theme-picker-dropdown">
                  {(Object.keys(THEME_META) as ThemeName[]).map(t => (
                    <button
                      key={t}
                      className={`theme-picker-option ${theme === t ? 'active' : ''}`}
                      onClick={() => { setTheme(t); setThemePicker(false); }}
                    >
                      <span style={{ fontSize: 16 }}>{THEME_META[t].icon}</span>
                      <span style={{ flex: 1 }}>{THEME_META[t].label}</span>
                      {theme === t && <Check size={14} />}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Dark/Light toggle */}
            <button
              onClick={toggleMode}
              title={mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
              style={{
                padding: 10, borderRadius: 12, border: '1px solid var(--border)', cursor: 'pointer',
                background: 'var(--bg-card)', color: 'var(--text-secondary)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--border-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
            >
              {mode === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
            </button>

            {/* Role badge */}
            {user && (
              <span
                className="role-badge-desktop"
                style={{
                  display: 'none', padding: '4px 12px', borderRadius: 999,
                  fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
                  background: roleStyle.bg, color: roleStyle.color,
                }}
              >
                {ROLE_LABELS[user.role]}
              </span>
            )}

            {/* User — clickable, navigates to Settings */}
            <div
              onClick={() => navigate('/settings')}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '4px 16px 4px 4px', borderRadius: 999,
                background: 'var(--bg-card)', border: '1px solid var(--border)',
                cursor: 'pointer', transition: 'border-color 0.2s',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
              title="Account Settings"
            >
              <div style={{
                width: 30, height: 30, borderRadius: '50%',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 800,
                background: user?.avatarUrl ? `url(${user.avatarUrl}) center/cover` : 'var(--accent-muted)',
                color: user?.avatarUrl ? 'transparent' : 'var(--accent)',
              }}>
                {user?.avatarUrl ? '' : (user?.initials || '?')}
              </div>
              <span className="username-desktop" style={{ display: 'none', fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>
                {user?.fullName || 'Guest'}
              </span>
            </div>

            {/* Logout */}
            <button
              onClick={signOut}
              title="Sign out"
              style={{
                padding: 10, borderRadius: 12, border: '1px solid var(--border)', cursor: 'pointer',
                background: 'var(--bg-card)', color: 'var(--text-tertiary)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--red)'; e.currentTarget.style.borderColor = 'var(--red)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-tertiary)'; e.currentTarget.style.borderColor = 'var(--border)'; }}
            >
              <LogOut size={16} />
            </button>
          </div>
        </header>

        {/* Scrollable content */}
        <main style={{ flex: 1, overflowY: 'auto', padding: '32px 24px 48px', background: 'var(--bg-app)' }} className="main-scroll-desktop">
          <div style={{ maxWidth: 1200, margin: '0 auto', width: '100%' }}>
            {children}
          </div>
        </main>
      </div>

      {/* ─── RESPONSIVE STYLES ─── */}
      <style>{`
        @media (min-width: 1024px) {
          .sidebar-desktop {
            position: relative !important;
            transform: translateX(0) !important;
          }
          .hamburger-btn {
            display: none !important;
          }
          .status-pill-desktop {
            display: flex !important;
          }
          .username-desktop {
            display: block !important;
          }
          .role-badge-desktop {
            display: inline-flex !important;
          }
          .main-scroll-desktop {
            padding: 40px 48px 64px !important;
          }
        }
        @media (min-width: 1280px) {
          .main-scroll-desktop {
            padding: 48px 64px 80px !important;
          }
        }
      `}</style>
    </div>
  );
}
