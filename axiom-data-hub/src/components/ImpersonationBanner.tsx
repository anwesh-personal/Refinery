import { useState, useEffect } from 'react';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../lib/supabase';
import { LogOut, Eye, Shield } from 'lucide-react';

/**
 * Impersonation Banner — shows at the top of the page when a superadmin
 * is impersonating another user. Provides a "Return to Superadmin" button.
 *
 * Session keys used:
 *   impersonation_superadmin_session  — { access_token, refresh_token } of the original SA
 *   impersonation_target              — { id, email, role, fullName } of target user
 *   impersonation_read_only           — '1' or '0'
 */
export default function ImpersonationBanner() {
  const { user } = useAuth();
  const [isImpersonating, setIsImpersonating] = useState(false);
  const [readOnly, setReadOnly] = useState(false);
  const [targetInfo, setTargetInfo] = useState<{ fullName: string; email: string } | null>(null);
  const [restoring, setRestoring] = useState(false);

  useEffect(() => {
    const stored = sessionStorage.getItem('impersonation_superadmin_session');
    const target = sessionStorage.getItem('impersonation_target');
    const ro = sessionStorage.getItem('impersonation_read_only');

    if (stored && target) {
      setIsImpersonating(true);
      setReadOnly(ro === '1');
      try {
        setTargetInfo(JSON.parse(target));
      } catch { /* ignore parse error */ }
    }
  }, [user]); // re-check when user changes (after session swap)

  if (!isImpersonating || !user) return null;

  const handleReturn = async () => {
    setRestoring(true);
    try {
      const stored = sessionStorage.getItem('impersonation_superadmin_session');
      if (!stored) {
        // Fallback: no stored session, redirect to login
        window.location.href = '/login';
        return;
      }

      const { access_token, refresh_token } = JSON.parse(stored);

      // Clear all impersonation state BEFORE swapping back
      sessionStorage.removeItem('impersonation_superadmin_session');
      sessionStorage.removeItem('impersonation_target');
      sessionStorage.removeItem('impersonation_read_only');

      // Restore superadmin session — no redirect, no page reload
      const { error } = await supabase.auth.setSession({ access_token, refresh_token });

      if (error) {
        console.error('Failed to restore superadmin session:', error.message);
        // If token expired, force login
        window.location.href = '/login';
      }
      // AuthContext will detect session change and re-render as superadmin
    } catch (err) {
      console.error('Impersonation restore error:', err);
      window.location.href = '/login';
    }
    setRestoring(false);
  };

  const displayName = targetInfo?.fullName || user.fullName;
  const displayEmail = targetInfo?.email || user.email;

  return (
    <div
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
        background: readOnly
          ? 'linear-gradient(90deg, #6366f1 0%, #8b5cf6 100%)'
          : 'linear-gradient(90deg, var(--yellow) 0%, var(--accent) 100%)',
        color: '#fff', padding: '8px 24px',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
        fontSize: 13, fontWeight: 700,
        boxShadow: '0 2px 12px rgba(0,0,0,0.2)',
      }}
    >
      <Eye size={16} />
      <span>
        Viewing as <strong>{displayName}</strong> ({displayEmail})
      </span>

      {readOnly && (
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 4,
          padding: '2px 10px', borderRadius: 4, fontSize: 10,
          background: 'rgba(255,255,255,0.2)', color: '#fff',
          fontWeight: 800, letterSpacing: '0.06em', textTransform: 'uppercase',
        }}>
          <Shield size={10} /> Read-Only
        </span>
      )}

      <button
        onClick={handleReturn}
        disabled={restoring}
        style={{
          marginLeft: 12, padding: '4px 16px', borderRadius: 6,
          fontSize: 12, fontWeight: 700, border: '2px solid #fff',
          background: 'transparent', color: '#fff', cursor: restoring ? 'wait' : 'pointer',
          display: 'flex', alignItems: 'center', gap: 6,
          transition: 'all 0.15s', opacity: restoring ? 0.6 : 1,
        }}
        onMouseEnter={(e) => {
          if (!restoring) {
            e.currentTarget.style.background = '#fff';
            e.currentTarget.style.color = readOnly ? '#6366f1' : 'var(--yellow)';
          }
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = 'transparent';
          e.currentTarget.style.color = '#fff';
        }}
      >
        <LogOut size={12} />
        {restoring ? 'Restoring...' : 'Return to Superadmin'}
      </button>
    </div>
  );
}
