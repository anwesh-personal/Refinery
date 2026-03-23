import { useState, useEffect } from 'react';
import { useAuth } from '../auth/AuthContext';
import { LogOut, Eye } from 'lucide-react';

/**
 * Impersonation Banner — shows at the top of the page when a superadmin
 * is impersonating another user. Provides a "Return to Superadmin" button.
 *
 * Works by checking sessionStorage for 'return_token', which is set
 * by the Team page before navigating to the impersonation magic link.
 */
export default function ImpersonationBanner() {
  const { user } = useAuth();
  const [returnToken, setReturnToken] = useState<string | null>(null);

  useEffect(() => {
    const token = sessionStorage.getItem('impersonation_return_token');
    if (token) setReturnToken(token);
  }, []);

  // Don't show if not impersonating
  if (!returnToken || !user) return null;

  const handleReturn = async () => {
    // Clear impersonation state
    sessionStorage.removeItem('impersonation_return_token');

    // Redirect to the app root — the return token in the URL will
    // re-authenticate as the superadmin. Since we can't inject a token
    // into Supabase directly from sessionStorage, we sign out and
    // redirect to login. The superadmin can log back in normally.
    //
    // For a smoother UX, we could use supabase.auth.setSession()
    // but that requires the refresh token which we don't store.
    window.location.href = '/login';
  };

  return (
    <div
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, zIndex: 9999,
        background: 'linear-gradient(90deg, var(--yellow) 0%, var(--accent) 100%)',
        color: 'var(--accent-contrast)', padding: '8px 24px',
        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12,
        fontSize: 13, fontWeight: 700,
        boxShadow: '0 2px 12px rgba(0,0,0,0.2)',
      }}
    >
      <Eye size={16} />
      <span>
        You are impersonating <strong>{user.fullName}</strong> ({user.email})
      </span>
      <button
        onClick={handleReturn}
        style={{
          marginLeft: 12, padding: '4px 16px', borderRadius: 6,
          fontSize: 12, fontWeight: 700, border: '2px solid var(--accent-contrast)',
          background: 'transparent', color: 'var(--accent-contrast)', cursor: 'pointer',
          display: 'flex', alignItems: 'center', gap: 6,
          transition: 'all 0.15s',
        }}
        onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--accent-contrast)'; e.currentTarget.style.color = 'var(--yellow)'; }}
        onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent'; e.currentTarget.style.color = 'var(--accent-contrast)'; }}
      >
        <LogOut size={12} />
        End Session
      </button>
    </div>
  );
}
