import { useState, useEffect } from 'react';
import { useAuth, ROLE_LABELS, ROLE_COLORS, ALL_PERMISSIONS, resolvePermissions } from '../auth/AuthContext';
import type { UserRole, PermissionKey, ProfileRow } from '../auth/AuthContext';
import { PageHeader, SectionHeader, Button, Input, Badge } from '../components/UI';
import { Check, X as CloseIcon, Key, LogIn, Mail } from 'lucide-react';
import { supabase } from '../lib/supabase';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:4000';

export default function TeamPage() {
  const { user, refreshProfile, session } = useAuth();
  const [team, setTeam] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Invite state
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>('member');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteMessage, setInviteMessage] = useState({ text: '', type: '' });

  // Right Side Panel state
  const [selectedUser, setSelectedUser] = useState<ProfileRow | null>(null);

  // Permissions state (inside panel)
  const [editingPermissions, setEditingPermissions] = useState<Record<string, boolean> | null>(null);
  const [savingPermissions, setSavingPermissions] = useState(false);

  // Admin Actions state
  const [adminActionLoading, setAdminActionLoading] = useState(false);

  useEffect(() => {
    fetchTeam();
  }, []);

  const fetchTeam = async () => {
    if (!user) return;
    setLoading(true);
    const { data, error } = await supabase
      .from('profiles')
      .select('*')
      .order('created_at', { ascending: true });
    
    if (data) setTeam(data as ProfileRow[]);
    if (error) console.error('Error fetching team:', error);
    setLoading(false);
  };

  const handleInvite = async () => {
    if (!inviteEmail.trim() || !user) return;
    setInviteLoading(true);
    setInviteMessage({ text: '', type: '' });

    const { error } = await supabase.from('team_invites').insert({
      email: inviteEmail.trim(),
      role: inviteRole,
      invited_by: user.id,
      permissions: {},
    });

    if (error) {
      setInviteMessage({ text: `Error: ${error.message}`, type: 'error' });
    } else {
      await supabase.from('audit_log').insert({
        actor_id: user.id,
        action: 'invite_sent',
        target_id: null,
        details: { email: inviteEmail.trim(), role: inviteRole },
      });
      setInviteMessage({ text: 'Invite recorded successfully! They will receive these roles upon signup.', type: 'success' });
      setInviteEmail('');
      setInviteRole('member');
    }
    setInviteLoading(false);
  };

  const openUserPanel = (member: ProfileRow) => {
    setSelectedUser(member);
    setEditingPermissions({ ...member.permissions });
  };

  const closeUserPanel = () => {
    setSelectedUser(null);
    setEditingPermissions(null);
  };

  const savePermissions = async () => {
    if (!selectedUser || !editingPermissions) return;
    setSavingPermissions(true);

    const { error } = await supabase.from('profiles')
      .update({ permissions: editingPermissions } as any)
      .eq('id', selectedUser.id);

    if (error) {
      alert(`Error saving permissions: ${error.message}`);
    } else {
      await supabase.from('audit_log').insert({
        actor_id: user!.id,
        action: 'permission_update',
        target_id: selectedUser.id,
        details: { permissions: editingPermissions },
      });
      setTeam(prev => prev.map(m => m.id === selectedUser.id ? { ...m, permissions: editingPermissions } : m));
      setSelectedUser(prev => prev ? { ...prev, permissions: editingPermissions } : null);
      if (selectedUser.id === user?.id) await refreshProfile();
    }
    setSavingPermissions(false);
  };

  const changeRole = async (newRole: UserRole) => {
    if (!selectedUser) return;
    // Prevent removing your own superadmin role
    if (selectedUser.id === user?.id && newRole !== 'superadmin') {
      alert("You cannot remove your own superadmin role.");
      return;
    }

    const { error } = await supabase.from('profiles')
      .update({ role: newRole } as any)
      .eq('id', selectedUser.id);

    if (error) {
      alert(`Error changing role: ${error.message}`);
    } else {
      await supabase.from('audit_log').insert({
        actor_id: user!.id,
        action: 'role_update',
        target_id: selectedUser.id,
        details: { old_role: selectedUser.role, new_role: newRole },
      });
      setTeam(prev => prev.map(m => m.id === selectedUser.id ? { ...m, role: newRole } : m));
      setSelectedUser(prev => prev ? { ...prev, role: newRole } : null);
      if (selectedUser.id === user?.id) await refreshProfile();
    }
  };

  const changeStatus = async (isActive: boolean) => {
    if (!selectedUser) return;
    if (selectedUser.id === user?.id) {
      alert("You cannot deactivate yourself.");
      return;
    }

    const { error } = await supabase.from('profiles')
      .update({ is_active: isActive } as any)
      .eq('id', selectedUser.id);

    if (error) {
      alert(`Error updating status: ${error.message}`);
    } else {
      setTeam(prev => prev.map(m => m.id === selectedUser.id ? { ...m, is_active: isActive } : m));
      setSelectedUser(prev => prev ? { ...prev, is_active: isActive } : null);
    }
  };

  const handleAdminApiCall = async (endpoint: string, payload: any) => {
    if (!session?.access_token) return null;
    try {
      setAdminActionLoading(true);
      const res = await fetch(`${API_URL}/api/admin/${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Server error');
      return data;
    } catch (err: any) {
      alert(`Admin Action Failed: ${err.message}`);
      return null;
    } finally {
      setAdminActionLoading(false);
    }
  };

  const sendPasswordReset = async () => {
    if (!selectedUser) return;
    const res = await handleAdminApiCall('send-reset-link', { email: selectedUser.email });
    if (res) alert("Password reset link sent successfully");
  };

  const directPasswordReset = async () => {
    if (!selectedUser) return;
    const newPassword = prompt(`Enter new password for ${selectedUser.full_name || selectedUser.email}:`);
    if (!newPassword) return;
    if (newPassword.length < 6) { alert('Password must be at least 6 characters'); return; }

    const res = await handleAdminApiCall('reset-password', { userId: selectedUser.id, newPassword });
    if (res) alert("Password updated successfully");
  };

  const impersonateUser = async () => {
    if (!selectedUser) return;
    if (selectedUser.id === user?.id) return;
    
    const res = await handleAdminApiCall('impersonate', { userId: selectedUser.id });
    if (res?.link) {
      // Store current token in session storage to return later
      sessionStorage.setItem('impersonation_return_token', session?.access_token || '');
      // Navigate via magic link
      window.location.href = res.link;
    }
  };

  if (user?.role !== 'superadmin') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 400 }}>
        <p style={{ fontSize: 14, color: 'var(--text-tertiary)' }}>Only superadmins can manage team members and granular permissions.</p>
      </div>
    );
  }

  // Group permissions for the modal
  const groupedPerms = Object.entries(ALL_PERMISSIONS).reduce((acc, [k, v]) => {
    if (!acc[v.group]) acc[v.group] = [];
    acc[v.group].push({ key: k as PermissionKey, ...v });
    return acc;
  }, {} as Record<string, Array<{ key: PermissionKey; label: string; group: string }>>);

  return (
    <div style={{ display: 'flex', gap: 24, height: 'calc(100vh - 120px)' }}>
      {/* LEFT COLUMN: Main Team List & Invites */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <PageHeader title="Team Management" sub="Invite team members and control their granular access levels." />

        <div style={{ overflowY: 'auto', paddingRight: 8 }} className="main-scroll-desktop">
          {/* Invite form */}
          <SectionHeader title="Invite Team Member" />
          <div
            className="animate-fadeIn"
            style={{
              background: 'var(--bg-card)', border: '1px solid var(--border)',
              borderRadius: 16, padding: 28, marginBottom: 36,
            }}
          >
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 16, marginBottom: 20 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', display: 'block', marginBottom: 8 }}>
                  Email Address
                </label>
                <Input placeholder="team@company.com" value={inviteEmail} onChange={setInviteEmail} />
              </div>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', display: 'block', marginBottom: 8 }}>
                  Base Role
                </label>
                <select
                  value={inviteRole}
                  onChange={(e) => setInviteRole(e.target.value as UserRole)}
                  style={{
                    width: '100%', padding: '10px 16px', borderRadius: 12,
                    fontSize: 13, fontWeight: 500, outline: 'none',
                    background: 'var(--bg-input)', border: '1px solid var(--border)',
                    color: 'var(--text-primary)', cursor: 'pointer',
                  }}
                >
                  <option value="member">Member — Starts Read-only</option>
                  <option value="admin">Admin — Broad Access</option>
                  <option value="superadmin">Superadmin — God Mode</option>
                </select>
              </div>
            </div>
            <Button onClick={handleInvite} disabled={inviteLoading || !inviteEmail.trim()}>
              {inviteLoading ? 'Sending...' : 'Issue Invite'}
            </Button>
            {inviteMessage.text && (
              <p style={{ marginTop: 12, fontSize: 13, color: inviteMessage.type === 'error' ? 'var(--red)' : 'var(--green)' }}>
                {inviteMessage.text}
              </p>
            )}
          </div>

          {/* Team list */}
          <SectionHeader title="Current Team" />
          <div
            className="animate-fadeIn"
            style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, overflow: 'hidden' }}
          >
            {loading ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>Loading team...</div>
            ) : team.length === 0 ? (
              <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>No team members found.</div>
            ) : (
              team.map((member, i) => {
                const colors = ROLE_COLORS[member.role] || ROLE_COLORS.member;
                const isSelf = member.id === user.id;
                const hasOverrides = member.permissions ? Object.keys(member.permissions).length > 0 : false;
                const nameToUse = member.full_name || member.email.split('@')[0] || 'User';
                const initials = nameToUse.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
                const isSelected = selectedUser?.id === member.id;

                return (
                  <div
                    key={member.id}
                    onClick={() => openUserPanel(member)}
                    style={{
                      display: 'flex', alignItems: 'center', gap: 16,
                      padding: '16px 24px', cursor: 'pointer',
                      borderBottom: i < team.length - 1 ? '1px solid var(--border)' : 'none',
                      background: isSelected ? 'var(--bg-card-hover)' : (!member.is_active ? 'rgba(255,0,0,0.05)' : 'transparent'),
                      transition: 'background 0.15s',
                    }}
                    onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.background = 'var(--bg-card-hover)' }}
                    onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.background = !member.is_active ? 'rgba(255,0,0,0.05)' : 'transparent' }}
                  >
                    <div style={{
                      width: 36, height: 36, borderRadius: '50%',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 12, fontWeight: 800,
                      background: colors.bg, color: colors.color,
                      opacity: member.is_active ? 1 : 0.5,
                    }}>
                      {initials}
                    </div>
                    
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', opacity: member.is_active ? 1 : 0.6 }}>
                          {member.full_name || 'Unnamed User'} {isSelf && '(You)'}
                        </span>
                        {!member.is_active && (
                          <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 6px', background: 'var(--red-muted)', color: 'var(--red)', borderRadius: 4 }}>
                            INACTIVE
                          </span>
                        )}
                        {hasOverrides && (
                          <span style={{ fontSize: 10, fontWeight: 600, padding: '2px 6px', background: 'var(--yellow-muted)', color: 'var(--yellow)', borderRadius: 4 }}>
                            CUSTOM PERMS
                          </span>
                        )}
                      </div>
                      <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{member.email}</span>
                    </div>
                    
                    <Badge label={ROLE_LABELS[member.role] || member.role} color={colors.color} colorMuted={colors.bg} />
                    <span style={{ fontSize: 11, color: 'var(--text-tertiary)', minWidth: 60, textAlign: 'right' }}>
                      {new Date(member.created_at).toLocaleDateString()}
                    </span>
                    <div style={{ width: 24, display: 'flex', justifyContent: 'center', color: 'var(--text-tertiary)' }}>
                      <ChevronRight size={16} />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>

      {/* RIGHT COLUMN: User Detail Panel */}
      {selectedUser && editingPermissions && (
        <div 
          className="animate-slideInRight"
          style={{ 
            width: 440, background: 'var(--bg-card)', border: '1px solid var(--border)', 
            borderRadius: 16, display: 'flex', flexDirection: 'column',
            overflow: 'hidden', boxShadow: '0 10px 40px -10px rgba(0,0,0,0.2)' 
          }}
        >
          {/* Panel Header */}
          <div style={{ padding: '20px 24px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{
                width: 40, height: 40, borderRadius: '50%',
                background: selectedUser.avatar_url ? `url(${selectedUser.avatar_url}) center/cover` : 'var(--accent-muted)',
                color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 14, fontWeight: 800,
              }}>
                {!selectedUser.avatar_url && (selectedUser.full_name || selectedUser.email).split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
              </div>
              <div>
                <h3 style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>{selectedUser.full_name || 'Unnamed User'}</h3>
                <p style={{ fontSize: 12, color: 'var(--text-tertiary)' }}>{selectedUser.email}</p>
              </div>
            </div>
            <button onClick={closeUserPanel} style={{ background: 'none', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer', padding: 4 }}>
              <CloseIcon size={20} />
            </button>
          </div>

          {/* Panel Body */}
          <div style={{ flex: 1, overflowY: 'auto', padding: 24 }} className="main-scroll-desktop">
            
            {/* Base Settings */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 32 }}>
              <div>
                <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', display: 'block', marginBottom: 8 }}>
                  Status
                </label>
                <div style={{ display: 'flex', gap: 12 }}>
                  <button
                    onClick={() => changeStatus(true)}
                    disabled={selectedUser.is_active}
                    style={{
                      flex: 1, padding: '10px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                      background: selectedUser.is_active ? 'var(--green-muted)' : 'var(--bg-input)',
                      color: selectedUser.is_active ? 'var(--green)' : 'var(--text-secondary)',
                      border: `1px solid ${selectedUser.is_active ? 'var(--green)' : 'var(--border)'}`,
                      cursor: selectedUser.is_active ? 'default' : 'pointer',
                    }}
                  >
                    Active
                  </button>
                  <button
                    onClick={() => changeStatus(false)}
                    disabled={!selectedUser.is_active || selectedUser.id === user?.id}
                    style={{
                      flex: 1, padding: '10px', borderRadius: 8, fontSize: 13, fontWeight: 600,
                      background: !selectedUser.is_active ? 'var(--red-muted)' : 'var(--bg-input)',
                      color: !selectedUser.is_active ? 'var(--red)' : 'var(--text-secondary)',
                      border: `1px solid ${!selectedUser.is_active ? 'var(--red)' : 'var(--border)'}`,
                      cursor: !selectedUser.is_active || selectedUser.id === user?.id ? 'not-allowed' : 'pointer',
                      opacity: selectedUser.id === user?.id ? 0.5 : 1
                    }}
                  >
                    Deactivated
                  </button>
                </div>
              </div>

              <div>
                <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', display: 'block', marginBottom: 8 }}>
                  Base Role
                </label>
                <select
                  value={selectedUser.role}
                  onChange={(e) => changeRole(e.target.value as UserRole)}
                  style={{
                    width: '100%', padding: '10px 16px', borderRadius: 8,
                    fontSize: 13, fontWeight: 500, outline: 'none',
                    background: 'var(--bg-input)', border: '1px solid var(--border)',
                    color: 'var(--text-primary)', cursor: 'pointer',
                  }}
                >
                  <option value="member">Member</option>
                  <option value="admin">Admin</option>
                  <option value="superadmin">Superadmin</option>
                </select>
              </div>
            </div>

            {/* Admin Actions */}
            <div style={{ marginBottom: 32 }}>
              <h4 style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', marginBottom: 16, borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                Admin Actions
              </h4>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <button
                  onClick={sendPasswordReset}
                  disabled={adminActionLoading}
                  style={{ padding: '10px', borderRadius: 8, fontSize: 12, fontWeight: 600, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                >
                  <Mail size={14} /> Send Link
                </button>
                <button
                  onClick={directPasswordReset}
                  disabled={adminActionLoading}
                  style={{ padding: '10px', borderRadius: 8, fontSize: 12, fontWeight: 600, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                >
                  <Key size={14} /> Set Password
                </button>
                {selectedUser.id !== user?.id && (
                  <button
                    onClick={impersonateUser}
                    disabled={adminActionLoading}
                    style={{ gridColumn: '1 / -1', padding: '10px', borderRadius: 8, fontSize: 12, fontWeight: 600, background: 'var(--yellow-muted)', border: '1px solid var(--yellow)', color: 'var(--yellow)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
                  >
                    <LogIn size={14} /> Impersonate User
                  </button>
                )}
              </div>
            </div>

            {/* Granular Permissions */}
            <div>
              <h4 style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', marginBottom: 16, borderBottom: '1px solid var(--border)', paddingBottom: 8 }}>
                Granular Permissions
              </h4>
              <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginBottom: 16, lineHeight: 1.5 }}>
                Toggles override the base role. Blue is allowed, gray is denied.
              </p>

              {Object.entries(groupedPerms).map(([group, perms]) => (
                <div key={group} style={{ marginBottom: 24 }}>
                  <h5 style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 12 }}>{group}</h5>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {perms.map(p => {
                      const resolved = resolvePermissions(selectedUser.role, editingPermissions);
                      const isAllowed = resolved[p.key];
                      const isOverride = (p.key in editingPermissions);

                      const toggleP = () => {
                        const next = { ...editingPermissions };
                        next[p.key] = !isAllowed;
                        setEditingPermissions(next);
                      };

                      return (
                        <div
                          key={p.key}
                          onClick={toggleP}
                          style={{
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            padding: '8px 12px', borderRadius: 8,
                            background: isAllowed ? 'var(--accent-muted)' : 'var(--bg-app)',
                            border: `1px solid ${isAllowed ? 'var(--accent)' : 'var(--border)'}`,
                            cursor: 'pointer', transition: 'all 0.1s',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <div style={{
                              width: 14, height: 14, borderRadius: 4,
                              background: isAllowed ? 'var(--accent)' : 'transparent',
                              border: `1.5px solid ${isAllowed ? 'var(--accent)' : 'var(--border)'}`,
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                              {isAllowed && <Check size={10} strokeWidth={3} color="#fff" />}
                            </div>
                            <span style={{ fontSize: 12, fontWeight: 500, color: isAllowed ? 'var(--accent)' : 'var(--text-secondary)' }}>
                              {p.label}
                            </span>
                          </div>
                          {isOverride && (
                            <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--yellow)', background: 'var(--yellow-muted)', padding: '2px 6px', borderRadius: 4 }}>
                              OVERRIDE
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>

          </div>

          {/* Panel Footer */}
          <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border)', background: 'var(--bg-app)' }}>
            <Button onClick={savePermissions} disabled={savingPermissions} full>
              {savingPermissions ? 'Saving...' : 'Save Permissions'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

// Ensure ChevronRight is defined for UI layout
const ChevronRight = ({ size }: { size: number }) => (
  <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="9 18 15 12 9 6" />
  </svg>
);
