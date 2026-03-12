import { type ReactNode } from 'react';
import { useAuth } from '../auth/AuthContext';
import { Navigate } from 'react-router-dom';
import type { PermissionKey } from '../auth/AuthContext';
import { ShieldCheck } from 'lucide-react';

interface ProtectedProps {
  children: ReactNode;
  /** Optional: specific permission key required to view this content */
  requires?: PermissionKey;
}

/** Wraps content that requires authentication */
export function ProtectedRoute({ children, requires }: ProtectedProps) {
  const { user, loading } = useAuth();

  if (loading) {
    return (
      <div
        style={{
          height: '100vh', width: '100%',
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          gap: 16, background: 'var(--bg-app)',
        }}
      >
        <div
          style={{
            width: 48, height: 48, borderRadius: 14,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--accent-muted)',
            animation: 'pulse 2s ease-in-out infinite',
          }}
        >
          <ShieldCheck size={24} style={{ color: 'var(--accent)' }} />
        </div>
        <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-tertiary)' }}>
          Authenticating...
        </p>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  // Check permission if required
  if (requires && !user.permissions[requires]) {
    return (
      <div
        style={{
          display: 'flex', flexDirection: 'column', alignItems: 'center',
          justifyContent: 'center', textAlign: 'center',
          padding: 48, minHeight: 400,
        }}
      >
        <div
          style={{
            width: 64, height: 64, borderRadius: 16,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            background: 'var(--red-muted)', color: 'var(--red)',
            marginBottom: 20,
          }}
        >
          <ShieldCheck size={28} />
        </div>
        <h3 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>
          Access Restricted
        </h3>
        <p style={{ fontSize: 13, color: 'var(--text-tertiary)', maxWidth: 360 }}>
          Your role ({user.role}) does not have permission to access this section.
          Contact the account owner to upgrade your access.
        </p>
      </div>
    );
  }

  return <>{children}</>;
}

/** Inline permission gate — hides children if user lacks permission */
export function Can({ do: perm, children }: { do: PermissionKey; children: ReactNode }) {
  const { user } = useAuth();
  if (!user || !user.permissions[perm]) return null;
  return <>{children}</>;
}
