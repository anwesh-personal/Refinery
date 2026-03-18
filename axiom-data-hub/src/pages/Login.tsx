import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useTheme } from '../ThemeContext';
import { Navigate } from 'react-router-dom';
import { Zap, Sun, Moon, Eye, EyeOff } from 'lucide-react';

export default function LoginPage() {
  const { user, loading: authLoading, signIn } = useAuth();
  const { mode, toggleMode } = useTheme();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  // Already authenticated → go to dashboard
  if (!authLoading && user) {
    return <Navigate to="/" replace />;
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    const result = await signIn(email, password);
    if (result.error) setError(result.error);
    // On success, onAuthStateChange fires → user state updates → Navigate triggers above

    setLoading(false);
  };

  return (
    <div
      style={{
        minHeight: '100vh', width: '100%',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        background: 'var(--bg-app)',
        padding: 24,
        transition: 'background 0.3s',
      }}
    >
      {/* Theme toggle (top-right) */}
      <button
        onClick={toggleMode}
        style={{
          position: 'fixed', top: 24, right: 24, zIndex: 50,
          padding: 10, borderRadius: 12,
          background: 'var(--bg-card)', border: '1px solid var(--border)',
          color: 'var(--text-secondary)', cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          transition: 'all 0.2s',
        }}
      >
        {mode === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
      </button>

      <div
        className="animate-fadeIn"
        style={{
          width: '100%', maxWidth: 420,
          display: 'flex', flexDirection: 'column', alignItems: 'center',
        }}
      >
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 40 }}>
          <div
            style={{
              width: 48, height: 48, borderRadius: 14,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: 'var(--accent-muted)',
            }}
          >
            <Zap size={24} style={{ color: 'var(--accent)' }} />
          </div>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.02em' }}>
              Refinery Nexus
            </h1>
            <p style={{ fontSize: 12, fontWeight: 500, color: 'var(--text-tertiary)', marginTop: 2 }}>
              Data Operations Hub
            </p>
          </div>
        </div>

        {/* Card */}
        <div
          style={{
            width: '100%',
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 20, padding: 32,
            boxShadow: 'var(--shadow-lg)',
          }}
        >
          <h2 style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
            Welcome back
          </h2>
          <p style={{ fontSize: 13, color: 'var(--text-tertiary)', marginBottom: 28 }}>
            Sign in to access your pipeline dashboard
          </p>

          <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div>
              <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', display: 'block', marginBottom: 8 }}>
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@company.com"
                required
                style={{
                  width: '100%', padding: '12px 16px', borderRadius: 12,
                  fontSize: 14, fontWeight: 500, outline: 'none',
                  background: 'var(--bg-input)', border: '1px solid var(--border)',
                  color: 'var(--text-primary)', transition: 'border-color 0.2s',
                }}
                onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
                onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
              />
            </div>

            <div>
              <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', display: 'block', marginBottom: 8 }}>
                Password
              </label>
              <div style={{ position: 'relative' }}>
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  required
                  minLength={6}
                  style={{
                    width: '100%', padding: '12px 48px 12px 16px', borderRadius: 12,
                    fontSize: 14, fontWeight: 500, outline: 'none',
                    background: 'var(--bg-input)', border: '1px solid var(--border)',
                    color: 'var(--text-primary)', transition: 'border-color 0.2s',
                  }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
                  onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  style={{
                    position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: 'var(--text-tertiary)', display: 'flex', padding: 4,
                  }}
                >
                  {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                </button>
              </div>
            </div>

            {error && (
              <div
                style={{
                  padding: '10px 14px', borderRadius: 10,
                  background: 'var(--red-muted)', border: '1px solid var(--red)',
                  fontSize: 12, fontWeight: 600, color: 'var(--red)',
                }}
              >
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%', padding: '13px 20px', borderRadius: 12,
                fontSize: 14, fontWeight: 700, cursor: loading ? 'wait' : 'pointer',
                background: loading ? 'var(--bg-elevated)' : 'var(--accent)',
                color: loading ? 'var(--text-tertiary)' : '#fff',
                border: 'none', transition: 'all 0.2s',
                marginTop: 4,
              }}
            >
              {loading ? 'Please wait...' : 'Sign In'}
            </button>
          </form>

          <p style={{ textAlign: 'center', marginTop: 24, fontSize: 12, color: 'var(--text-tertiary)' }}>
            Need access? Contact your Superadmin for an invite.
          </p>
        </div>

        {/* Footer */}
        <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 24, textAlign: 'center' }}>
          Secured by Supabase · Invite-only access
        </p>
      </div>
    </div>
  );
}
