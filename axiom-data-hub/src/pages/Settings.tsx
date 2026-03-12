import { useState, useRef } from 'react';
import { useAuth } from '../auth/AuthContext';
import { supabase } from '../lib/supabase';
import { PageHeader } from '../components/UI';
import {
  User, Lock, Camera, Mail, Shield, Save, Check, AlertCircle, Eye, EyeOff,
} from 'lucide-react';

/** Compress an image file to fit within maxDim×maxDim and maxBytes using Canvas API */
async function compressImage(file: File, maxDim: number, maxBytes: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
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
        setAvatarUrl(data.publicUrl);
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
              background: 'var(--accent)', color: '#fff',
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
  border: 'none', background: 'var(--accent)', color: '#fff',
  transition: 'all 0.2s', width: '100%',
};

const eyeBtnStyle: React.CSSProperties = {
  position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)',
  background: 'none', border: 'none', cursor: 'pointer',
  color: 'var(--text-tertiary)', display: 'flex', padding: 4,
};
