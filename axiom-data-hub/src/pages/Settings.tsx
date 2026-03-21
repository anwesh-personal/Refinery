import { useState, useRef, useEffect } from 'react';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../lib/supabase';
import { PageHeader } from '../components/UI';
import {
  User, Lock, Camera, Mail, Shield, Save, Check, AlertCircle, Eye, EyeOff, Key,
} from 'lucide-react';

/** Compress an image file to fit within maxDim×maxDim and maxBytes using Canvas API */
async function compressImage(file: File, maxDim: number, maxBytes: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(img.src); // Prevent memory leak
      // Calculate scaled dimensions preserving aspect ratio
      let w = img.width, h = img.height;
      if (w > maxDim || h > maxDim) {
        const ratio = Math.min(maxDim / w, maxDim / h);
        w = Math.round(w * ratio);
        h = Math.round(h * ratio);
      }

      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, 0, 0, w, h);

      // Try progressively lower quality until under maxBytes
      let quality = 0.92;
      const tryExport = () => {
        canvas.toBlob(
          (blob) => {
            if (!blob) return reject(new Error('Canvas export failed'));
            if (blob.size <= maxBytes || quality <= 0.1) {
              resolve(blob);
            } else {
              quality -= 0.1;
              tryExport();
            }
          },
          'image/jpeg',
          quality,
        );
      };
      tryExport();
    };
    img.onerror = () => reject(new Error('Failed to load image'));
    img.src = URL.createObjectURL(file);
  });
}

export default function SettingsPage() {
  const { user, refreshProfile } = useAuth();
  if (!user) return null;

  return (
    <>
      <PageHeader title="Account Settings" sub="Manage your profile, security, and preferences." />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 28, maxWidth: 680 }}>
        <ProfileSection user={user} refreshProfile={refreshProfile} />
        <Verify550Section user={user} />
        <PasswordSection />
      </div>
    </>
  );
}

// ═══════════════════════════════════════
// PROFILE SECTION
// ═══════════════════════════════════════

function ProfileSection({ user, refreshProfile }: { user: any; refreshProfile: () => Promise<void> }) {
  const [fullName, setFullName] = useState(user.fullName || '');
  const [avatarUrl, setAvatarUrl] = useState(user.avatarUrl || '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const handleSaveProfile = async () => {
    setSaving(true);
    setMessage(null);

    // Update profile in public.profiles via REST to avoid missing generated types
    const resp = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}`,
      {
        method: 'PATCH',
        headers: {
          'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({ full_name: fullName, avatar_url: avatarUrl || null }),
      },
    );
    const error = resp.ok ? null : { message: `HTTP ${resp.status}` };

    if (error) {
      setMessage({ text: `Error: ${error.message}`, type: 'error' });
    } else {
      // Also update Supabase auth metadata
      await supabase.auth.updateUser({
        data: { full_name: fullName, avatar_url: avatarUrl || null },
      });

      // Invalidate the backend's profile cache so the updated name is
      // reflected immediately in all user-attribution columns.
      try {
        const session = (await supabase.auth.getSession()).data.session;
        if (session?.access_token) {
          await fetch(`${import.meta.env.VITE_API_URL || ''}/api/admin/invalidate-my-cache`, {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${session.access_token}` },
          });
        }
      } catch { /* non-critical */ }

      await refreshProfile();
      setMessage({ text: 'Profile updated successfully', type: 'success' });
    }
    setSaving(false);
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setMessage({ text: 'Please select an image file', type: 'error' });
      return;
    }

    setUploading(true);
    setMessage(null);

    try {
      // Compress to max 512x512 JPEG under 2MB using Canvas API
      const compressed = await compressImage(file, 512, 2 * 1024 * 1024);
      const path = `avatars/${user.id}.jpg`;

      const { error: uploadErr } = await supabase.storage
        .from('avatars')
        .upload(path, compressed, { upsert: true, contentType: 'image/jpeg' });

      if (uploadErr) {
        console.warn('[Settings] Avatar upload failed:', uploadErr.message);
        setMessage({ text: `Upload failed: ${uploadErr.message}. You can paste an image URL instead.`, type: 'error' });
      } else {
        const { data } = supabase.storage.from('avatars').getPublicUrl(path);
        // Cache-bust: same filename is reused on re-upload, so browser serves stale cache without this
        setAvatarUrl(data.publicUrl + '?t=' + Date.now());
        setMessage({ text: 'Avatar uploaded — click Save to apply', type: 'success' });
      }
    } catch (err: any) {
      setMessage({ text: `Compression failed: ${err.message}`, type: 'error' });
    }
    setUploading(false);
  };

  return (
    <div
      className="animate-fadeIn"
      style={{
        background: 'var(--bg-card)', border: '1px solid var(--border)',
        borderRadius: 16, overflow: 'hidden',
      }}
    >
      <div style={{
        padding: '20px 24px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <User size={16} style={{ color: 'var(--accent)' }} />
        <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Profile</h3>
      </div>

      <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 20 }}>
        {/* Avatar */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
          <div
            onClick={() => fileInputRef.current?.click()}
            style={{
              width: 72, height: 72, borderRadius: '50%', flexShrink: 0,
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: avatarUrl ? `url(${avatarUrl}) center/cover` : 'var(--accent-muted)',
              color: 'var(--accent)', fontSize: 24, fontWeight: 800,
              cursor: 'pointer', position: 'relative', border: '2px solid var(--border)',
              transition: 'border-color 0.2s',
            }}
            onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
            onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
          >
            {!avatarUrl && user.initials}
            <div style={{
              position: 'absolute', bottom: -2, right: -2,
              width: 24, height: 24, borderRadius: '50%',
              background: 'var(--accent)', color: 'var(--accent-contrast)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <Camera size={12} />
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleAvatarUpload}
          />
          <div style={{ flex: 1 }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>Profile Photo</p>
            <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 2 }}>
              {uploading ? 'Uploading...' : 'Click the avatar to upload (max 2MB)'}
            </p>
            {/* URL fallback */}
            <input
              type="text"
              value={avatarUrl}
              onChange={(e) => setAvatarUrl(e.target.value)}
              placeholder="Or paste image URL..."
              style={{
                marginTop: 8, width: '100%', padding: '8px 12px', borderRadius: 8,
                fontSize: 12, background: 'var(--bg-input)', border: '1px solid var(--border)',
                color: 'var(--text-primary)', outline: 'none',
              }}
            />
          </div>
        </div>

        {/* Full Name */}
        <div>
          <label style={labelStyle}>Full Name</label>
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            style={inputStyle}
          />
        </div>

        {/* Email (read-only) */}
        <div>
          <label style={labelStyle}>Email</label>
          <div style={{
            ...inputStyle,
            display: 'flex', alignItems: 'center', gap: 8,
            color: 'var(--text-tertiary)', cursor: 'not-allowed',
          }}>
            <Mail size={14} />
            {user.email}
          </div>
        </div>

        {/* Role (read-only) */}
        <div>
          <label style={labelStyle}>Role</label>
          <div style={{
            ...inputStyle,
            display: 'flex', alignItems: 'center', gap: 8,
            color: 'var(--text-tertiary)', cursor: 'not-allowed',
          }}>
            <Shield size={14} />
            {user.role.charAt(0).toUpperCase() + user.role.slice(1)}
          </div>
        </div>

        {/* Message */}
        {message && (
          <div style={{
            padding: '10px 14px', borderRadius: 10, fontSize: 12, fontWeight: 600,
            display: 'flex', alignItems: 'center', gap: 8,
            background: message.type === 'success' ? 'var(--green-muted)' : 'var(--red-muted)',
            color: message.type === 'success' ? 'var(--green)' : 'var(--red)',
          }}>
            {message.type === 'success' ? <Check size={14} /> : <AlertCircle size={14} />}
            {message.text}
          </div>
        )}

        {/* Save */}
        <button
          onClick={handleSaveProfile}
          disabled={saving}
          style={{
            ...btnStyle,
            opacity: saving ? 0.5 : 1,
            cursor: saving ? 'not-allowed' : 'pointer',
          }}
        >
          <Save size={14} />
          {saving ? 'Saving...' : 'Save Profile'}
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════
// PASSWORD SECTION
// ═══════════════════════════════════════

function PasswordSection() {
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);

  const handleChangePassword = async () => {
    setMessage(null);

    if (newPassword.length < 6) {
      setMessage({ text: 'Password must be at least 6 characters', type: 'error' });
      return;
    }
    if (newPassword !== confirmPassword) {
      setMessage({ text: 'Passwords do not match', type: 'error' });
      return;
    }

    setSaving(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });

    if (error) {
      setMessage({ text: `Error: ${error.message}`, type: 'error' });
    } else {
      setMessage({ text: 'Password changed successfully', type: 'success' });
      setNewPassword('');
      setConfirmPassword('');
    }
    setSaving(false);
  };

  return (
    <div
      className="animate-fadeIn"
      style={{
        background: 'var(--bg-card)', border: '1px solid var(--border)',
        borderRadius: 16, overflow: 'hidden', animationDelay: '0.1s',
      }}
    >
      <div style={{
        padding: '20px 24px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', gap: 10,
      }}>
        <Lock size={16} style={{ color: 'var(--yellow)' }} />
        <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Change Password</h3>
      </div>

      <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* New password */}
        <div>
          <label style={labelStyle}>New Password</label>
          <div style={{ position: 'relative' }}>
            <input
              type={showNew ? 'text' : 'password'}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="••••••••"
              style={{ ...inputStyle, paddingRight: 44 }}
            />
            <button
              type="button"
              onClick={() => setShowNew(!showNew)}
              style={eyeBtnStyle}
            >
              {showNew ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </div>

        {/* Confirm password */}
        <div>
          <label style={labelStyle}>Confirm New Password</label>
          <div style={{ position: 'relative' }}>
            <input
              type={showConfirm ? 'text' : 'password'}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              style={{ ...inputStyle, paddingRight: 44 }}
            />
            <button
              type="button"
              onClick={() => setShowConfirm(!showConfirm)}
              style={eyeBtnStyle}
            >
              {showConfirm ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </div>

        {/* Message */}
        {message && (
          <div style={{
            padding: '10px 14px', borderRadius: 10, fontSize: 12, fontWeight: 600,
            display: 'flex', alignItems: 'center', gap: 8,
            background: message.type === 'success' ? 'var(--green-muted)' : 'var(--red-muted)',
            color: message.type === 'success' ? 'var(--green)' : 'var(--red)',
          }}>
            {message.type === 'success' ? <Check size={14} /> : <AlertCircle size={14} />}
            {message.text}
          </div>
        )}

        {/* Save */}
        <button
          onClick={handleChangePassword}
          disabled={saving || !newPassword || !confirmPassword}
          style={{
            ...btnStyle,
            background: 'var(--yellow)',
            opacity: (saving || !newPassword || !confirmPassword) ? 0.5 : 1,
            cursor: (saving || !newPassword || !confirmPassword) ? 'not-allowed' : 'pointer',
          }}
        >
          <Lock size={14} />
          {saving ? 'Changing...' : 'Change Password'}
        </button>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════
// VERIFY550 API KEY SECTION
// ═══════════════════════════════════════

function Verify550Section({ user }: { user: any }) {
  const [apiKey, setApiKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [credits, setCredits] = useState<number | null>(null);
  const [hasOrgKey, setHasOrgKey] = useState(false);
  const [message, setMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null);
  const [loaded, setLoaded] = useState(false);

  // Load existing key from profile on mount
  useEffect(() => {
    (async () => {
      // Check if user has a personal key (use raw REST to avoid generated-type issues)
      try {
        const resp = await fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}&select=verify550_api_key`,
          {
            headers: {
              'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
              'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
            },
          },
        );
        const rows = await resp.json();
        if (rows?.[0]?.verify550_api_key) {
          setApiKey(rows[0].verify550_api_key);
        }
      } catch { /* column might not exist yet */ }

      // Check if org-wide key exists via verification config API
      try {
        const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/rest/v1/system_config?config_key=eq.verify550_api_key&select=config_value`, {
          headers: {
            'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
            'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
          },
        });
        const rows = await resp.json();
        if (rows?.[0]?.config_value) setHasOrgKey(true);
      } catch { /* ignore */ }
      setLoaded(true);
    })();
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setMessage(null);

    const resp = await fetch(
      `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/profiles?id=eq.${user.id}`,
      {
        method: 'PATCH',
        headers: {
          'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          'Authorization': `Bearer ${(await supabase.auth.getSession()).data.session?.access_token}`,
          'Content-Type': 'application/json',
          'Prefer': 'return=minimal',
        },
        body: JSON.stringify({ verify550_api_key: apiKey || null }),
      },
    );

    if (resp.ok) {
      setMessage({ text: apiKey ? 'Personal API key saved' : 'Personal key removed — org-wide key will be used', type: 'success' });
    } else {
      setMessage({ text: `Save failed: HTTP ${resp.status}`, type: 'error' });
    }
    setSaving(false);
  };

  const handleTest = async () => {
    const keyToTest = apiKey.trim();
    if (!keyToTest) {
      setMessage({ text: 'Enter an API key first', type: 'error' });
      return;
    }
    setTesting(true);
    setMessage(null);
    setCredits(null);

    try {
      const resp = await fetch(`https://app.verify550.com/api/getCredit?secret=${encodeURIComponent(keyToTest)}`);
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const text = await resp.text();
      const count = Number(text);
      if (isNaN(count)) throw new Error(`Invalid response: ${text}`);
      setCredits(count);
      setMessage({ text: `Connected! ${count.toLocaleString()} credits remaining`, type: 'success' });
    } catch (err: any) {
      setMessage({ text: `Connection failed: ${err.message}`, type: 'error' });
    }
    setTesting(false);
  };

  if (!loaded) return null;

  return (
    <div
      className="animate-fadeIn"
      style={{
        background: 'var(--bg-card)', border: '1px solid var(--border)',
        borderRadius: 16, overflow: 'hidden', animationDelay: '0.05s',
      }}
    >
      <div style={{
        padding: '20px 24px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Key size={16} style={{ color: 'var(--purple, #a855f7)' }} />
          <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Verify550 API Key</h3>
        </div>
        {credits !== null && (
          <span style={{
            fontSize: 12, fontWeight: 700, padding: '4px 12px', borderRadius: 20,
            background: 'var(--green-muted)', color: 'var(--green)',
          }}>
            {credits.toLocaleString()} credits
          </span>
        )}
      </div>

      <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Info about org key */}
        <div style={{
          padding: '10px 14px', borderRadius: 8, fontSize: 12, lineHeight: 1.6,
          background: hasOrgKey ? 'var(--green-muted)' : 'var(--yellow-muted)',
          color: hasOrgKey ? 'var(--green)' : 'var(--yellow)',
          border: `1px solid ${hasOrgKey ? 'var(--green)' : 'var(--yellow)'}`,
        }}>
          {hasOrgKey
            ? '✓ An organization-wide API key is configured. You can optionally set your own below to override it.'
            : '⚠ No org-wide key configured. Set your personal key below, or ask a superadmin to configure one in Verification settings.'
          }
        </div>

        {/* API Key input */}
        <div>
          <label style={labelStyle}>Your Personal API Key</label>
          <div style={{ position: 'relative' }}>
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Enter your Verify550 API secret..."
              style={{ ...inputStyle, paddingRight: 44, fontFamily: apiKey ? 'monospace' : 'inherit' }}
            />
            <button
              type="button"
              onClick={() => setShowKey(!showKey)}
              style={eyeBtnStyle}
            >
              {showKey ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>
        </div>

        {/* Message */}
        {message && (
          <div style={{
            padding: '10px 14px', borderRadius: 10, fontSize: 12, fontWeight: 600,
            display: 'flex', alignItems: 'center', gap: 8,
            background: message.type === 'success' ? 'var(--green-muted)' : 'var(--red-muted)',
            color: message.type === 'success' ? 'var(--green)' : 'var(--red)',
          }}>
            {message.type === 'success' ? <Check size={14} /> : <AlertCircle size={14} />}
            {message.text}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 12 }}>
          <button
            onClick={handleTest}
            disabled={testing || !apiKey.trim()}
            style={{
              ...btnStyle,
              background: 'var(--purple, #a855f7)',
              flex: 1,
              opacity: (testing || !apiKey.trim()) ? 0.5 : 1,
              cursor: (testing || !apiKey.trim()) ? 'not-allowed' : 'pointer',
            }}
          >
            <Shield size={14} />
            {testing ? 'Testing...' : 'Test Connection'}
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            style={{
              ...btnStyle,
              flex: 1,
              opacity: saving ? 0.5 : 1,
              cursor: saving ? 'not-allowed' : 'pointer',
            }}
          >
            <Save size={14} />
            {saving ? 'Saving...' : 'Save Key'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════
// SHARED STYLES
// ═══════════════════════════════════════

const labelStyle: React.CSSProperties = {
  fontSize: 11, fontWeight: 700, textTransform: 'uppercase',
  letterSpacing: '0.08em', color: 'var(--text-tertiary)',
  display: 'block', marginBottom: 8,
};

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '12px 16px', borderRadius: 12,
  fontSize: 14, fontWeight: 500, outline: 'none',
  background: 'var(--bg-input)', border: '1px solid var(--border)',
  color: 'var(--text-primary)', transition: 'border-color 0.2s',
};

const btnStyle: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
  padding: '12px 20px', borderRadius: 12, fontSize: 13, fontWeight: 700,
  border: 'none', background: 'var(--accent)', color: 'var(--accent-contrast)',
  transition: 'all 0.2s', width: '100%',
};

const eyeBtnStyle: React.CSSProperties = {
  position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
  background: 'none', border: 'none', cursor: 'pointer',
  color: 'var(--text-tertiary)', display: 'flex', padding: 4,
};
