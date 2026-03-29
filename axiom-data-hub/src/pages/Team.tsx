import { useState, useEffect, useRef } from 'react';
import { useAuth, ROLE_LABELS, ROLE_COLORS, ALL_PERMISSIONS, resolvePermissions } from '../auth/AuthContext';
import type { UserRole, PermissionKey, ProfileRow } from '../auth/AuthContext';
import { PageHeader, SectionHeader, Button, Input, Badge } from '../components/UI';
import { Check, X as CloseIcon, Key, LogIn, Mail, Plus, Trash2, Edit2, ShieldAlert, Users } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { apiCall } from '../lib/api';
import { getAvatarUrl } from '../lib/avatar';


interface CustomRole {
  id: string;
  name: string;
  label: string;
  is_system: boolean;
  permissions: Record<string, boolean>;
}

interface TeamGroup {
  id: string;
  name: string;
  description: string | null;
  created_by: string | null;
  member_count: number;
  created_at: string;
}

interface TeamMember {
  profile_id: string;
  role_id: string | null;
  joined_at: string;
  profile: { full_name: string; email: string; avatar_url: string | null; role: string } | null;
  team_role: { name: string; label: string } | null;
}

export default function TeamPage() {
  const { user, refreshProfile, session } = useAuth();
  const [team, setTeam] = useState<ProfileRow[]>([]);
  const [loading, setLoading] = useState(true);

  // Tabs
  const [activeTab, setActiveTab] = useState<'members' | 'roles' | 'teams'>('members');

  // Custom Roles state
  const [customRoles, setCustomRoles] = useState<CustomRole[]>([]);
  const [rolesLoading, setRolesLoading] = useState(false);

  // Custom Role Modal state
  const [isRoleModalOpen, setIsRoleModalOpen] = useState(false);
  const [editingRole, setEditingRole] = useState<CustomRole | null>(null);
  const [roleFormName, setRoleFormName] = useState('');
  const [roleFormDesc, setRoleFormDesc] = useState('');
  const [roleFormPerms, setRoleFormPerms] = useState<Record<string, boolean>>({});
  const [savingRole, setSavingRole] = useState(false);

  // Invite state
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<UserRole>('member');
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteMessage, setInviteMessage] = useState({ text: '', type: '' });

  // Create user directly state
  const [createMode, setCreateMode] = useState<'invite' | 'create'>('invite');
  const [createPassword, setCreatePassword] = useState('');
  const [createFullName, setCreateFullName] = useState('');

  // Right Side Panel state
  const [selectedUser, setSelectedUser] = useState<ProfileRow | null>(null);

  // Permissions state (inside panel)
  const [editingPermissions, setEditingPermissions] = useState<Record<string, boolean> | null>(null);
  const [savingPermissions, setSavingPermissions] = useState(false);

  // Admin Actions state
  const [adminActionLoading, setAdminActionLoading] = useState(false);

  // Teams state
  const [teams, setTeams] = useState<TeamGroup[]>([]);
  const [teamsLoading, setTeamsLoading] = useState(false);
  const [selectedTeam, setSelectedTeam] = useState<TeamGroup | null>(null);
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [teamMembersLoading, setTeamMembersLoading] = useState(false);
  const [isTeamModalOpen, setIsTeamModalOpen] = useState(false);
  const [editingTeam, setEditingTeam] = useState<TeamGroup | null>(null);
  const [teamFormName, setTeamFormName] = useState('');
  const [teamFormDesc, setTeamFormDesc] = useState('');
  const [savingTeam, setSavingTeam] = useState(false);
  const [addMemberDropdownOpen, setAddMemberDropdownOpen] = useState(false);
  const addMemberDropdownRef = useRef<HTMLDivElement>(null);

  // Close add-member dropdown on outside click
  useEffect(() => {
    if (!addMemberDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (addMemberDropdownRef.current && !addMemberDropdownRef.current.contains(e.target as Node)) {
        setAddMemberDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [addMemberDropdownOpen]);

  useEffect(() => {
    fetchTeam();
    fetchCustomRoles();
    fetchTeams();
  }, []);

  const fetchCustomRoles = async () => {
    setRolesLoading(true);
    try {
      const data = await apiCall<{ roles: CustomRole[] }>('/api/custom-roles');
      setCustomRoles(data.roles);
    } catch (err: any) {
      console.error('Failed to fetch roles:', err);
    }
    setRolesLoading(false);
  };

  const fetchTeams = async () => {
    setTeamsLoading(true);
    try {
      const data = await apiCall<{ teams: TeamGroup[] }>('/api/teams');
      setTeams(data.teams);
    } catch (err: any) {
      console.error('Failed to fetch teams:', err);
    }
    setTeamsLoading(false);
  };

  const fetchTeamMembers = async (teamId: string) => {
    setTeamMembersLoading(true);
    try {
      const data = await apiCall<{ members: TeamMember[] }>(`/api/teams/${teamId}/members`);
      setTeamMembers(data.members);
    } catch (err: any) {
      console.error('Failed to fetch team members:', err);
    }
    setTeamMembersLoading(false);
  };

  const selectTeam = (t: TeamGroup) => {
    setSelectedTeam(t);
    fetchTeamMembers(t.id);
    setAddMemberDropdownOpen(false);
  };

  const openNewTeamModal = () => {
    setEditingTeam(null);
    setTeamFormName('');
    setTeamFormDesc('');
    setIsTeamModalOpen(true);
  };

  const openEditTeamModal = (t: TeamGroup) => {
    setEditingTeam(t);
    setTeamFormName(t.name);
    setTeamFormDesc(t.description || '');
    setIsTeamModalOpen(true);
  };

  const saveTeamMutation = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingTeam(true);
    try {
      const payload = { name: teamFormName, description: teamFormDesc || null };
      if (editingTeam) {
        await apiCall(`/api/teams/${editingTeam.id}`, { method: 'PUT', body: payload });
      } else {
        await apiCall('/api/teams', { method: 'POST', body: payload });
      }
      setIsTeamModalOpen(false);
      await fetchTeams();
    } catch (err: any) {
      alert(`Team save failed: ${err.message}`);
    } finally {
      setSavingTeam(false);
    }
  };

  const deleteTeamAction = async (id: string) => {
    if (!window.confirm('Delete this team and remove all memberships?')) return;
    try {
      await apiCall(`/api/teams/${id}`, { method: 'DELETE' });
      if (selectedTeam?.id === id) {
        setSelectedTeam(null);
        setTeamMembers([]);
      }
      await fetchTeams();
    } catch (err: any) {
      alert(`Delete failed: ${err.message}`);
    }
  };

  const addTeamMember = async (profileId: string) => {
    if (!selectedTeam) return;
    try {
      await apiCall(`/api/teams/${selectedTeam.id}/members`, {
        method: 'POST',
        body: { profile_id: profileId },
      });
      await fetchTeamMembers(selectedTeam.id);
      await fetchTeams(); // refresh member counts
      setAddMemberDropdownOpen(false);
    } catch (err: any) {
      alert(`Add member failed: ${err.message}`);
    }
  };

  const removeTeamMember = async (profileId: string) => {
    if (!selectedTeam) return;
    try {
      await apiCall(`/api/teams/${selectedTeam.id}/members/${profileId}`, { method: 'DELETE' });
      await fetchTeamMembers(selectedTeam.id);
      await fetchTeams();
    } catch (err: any) {
      alert(`Remove failed: ${err.message}`);
    }
  };

  const updateTeamMemberRole = async (profileId: string, roleId: string | null) => {
    if (!selectedTeam) return;
    try {
      await apiCall(`/api/teams/${selectedTeam.id}/members/${profileId}`, {
        method: 'PUT',
        body: { role_id: roleId },
      });
      await fetchTeamMembers(selectedTeam.id);
    } catch (err: any) {
      alert(`Role update failed: ${err.message}`);
    }
  };

  const fetchTeam = async () => {
    if (!user) return;
    setLoading(true);

    // Attempt with custom_roles join first (needed for permission resolution display)
    let { data, error } = await supabase
      .from('profiles')
      .select('*, custom_roles(name, label, permissions)')
      .order('created_at', { ascending: true });

    // If the join fails (PostgREST schema cache stale), retry without join
    if (error) {
      console.warn('[Team] Join query failed, retrying without custom_roles join:', error.message);
      const retry = await supabase
        .from('profiles')
        .select('*')
        .order('created_at', { ascending: true });
      data = retry.data as typeof data;
      error = retry.error;
    }

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
      setInviteMessage({ text: 'Invite recorded successfully! They will receive these roles upon signup.', type: 'success' });
      setInviteEmail('');
      setInviteRole('member');
    }
    setInviteLoading(false);
  };

  const handleCreateUser = async () => {
    if (!inviteEmail.trim() || !createPassword.trim() || !user) return;
    if (createPassword.length < 6) {
      setInviteMessage({ text: 'Password must be at least 6 characters', type: 'error' });
      return;
    }
    setInviteLoading(true);
    setInviteMessage({ text: '', type: '' });

    try {
      const res = await apiCall<{ message: string; userId: string }>('/api/admin/create-user', {
        method: 'POST',
        body: {
          email: inviteEmail.trim(),
          password: createPassword,
          fullName: createFullName.trim() || undefined,
          role: inviteRole,
        },
      });
      setInviteMessage({ text: `${res.message} — they can now log in immediately.`, type: 'success' });
      setInviteEmail('');
      setCreatePassword('');
      setCreateFullName('');
      setInviteRole('member');
      fetchTeam();
    } catch (err: any) {
      setInviteMessage({ text: `Error: ${err.message}`, type: 'error' });
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

  const changeCustomRole = async (roleId: string | null) => {
    if (!selectedUser) return;

    const { error } = await supabase.from('profiles')
      .update({ custom_role_id: roleId } as any)
      .eq('id', selectedUser.id);

    if (error) {
      alert(`Error updating custom role: ${error.message}`);
    } else {
      await supabase.from('audit_log').insert({
        actor_id: user!.id,
        action: 'custom_role_assigned',
        target_id: selectedUser.id,
        details: { custom_role_id: roleId },
      });
      // Await the full team refresh so joined custom_roles data is available
      await fetchTeam();
      if (selectedUser.id === user?.id) await refreshProfile();
      // Re-select the user from the refreshed team list to update the panel
      setTeam(prev => {
        const updated = prev.find(m => m.id === selectedUser.id);
        if (updated) {
          setSelectedUser(updated);
          setEditingPermissions({ ...updated.permissions });
        }
        return prev;
      });
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
    try {
      setAdminActionLoading(true);
      return await apiCall(`/api/admin/${endpoint}`, { method: 'POST', body: payload });
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

    const res = await handleAdminApiCall('impersonate', { userId: selectedUser.id }) as {
      access_token?: string;
      refresh_token?: string;
      user?: { id: string; email: string; role: string; fullName: string };
      readOnly?: boolean;
    } | null;

    if (res?.access_token && res?.refresh_token) {
      // Store superadmin's current session for restoration
      sessionStorage.setItem('impersonation_superadmin_session', JSON.stringify({
        access_token: session?.access_token,
        refresh_token: session?.refresh_token,
      }));
      sessionStorage.setItem('impersonation_target', JSON.stringify(res.user));
      sessionStorage.setItem('impersonation_read_only', res.readOnly ? '1' : '0');

      // Swap to the impersonated user's session — no redirect, no page reload
      const { error } = await supabase.auth.setSession({
        access_token: res.access_token,
        refresh_token: res.refresh_token,
      });

      if (error) {
        alert(`Impersonation failed: ${error.message}`);
        sessionStorage.removeItem('impersonation_superadmin_session');
        sessionStorage.removeItem('impersonation_target');
        sessionStorage.removeItem('impersonation_read_only');
      }
      // AuthContext will detect session change and re-render
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

  // ── Role Management Functions ──
  const openNewRoleModal = () => {
    setEditingRole(null);
    setRoleFormName('');
    setRoleFormDesc('');
    setRoleFormPerms({});
    setIsRoleModalOpen(true);
  };

  const openEditRoleModal = (role: CustomRole) => {
    setEditingRole(role);
    setRoleFormName(role.name);
    setRoleFormDesc(role.label || '');
    // Only keep explicit true grants — false entries should not exist in the record
    const truePerms: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(role.permissions)) { if (v === true) truePerms[k] = true; }
    setRoleFormPerms(truePerms);
    setIsRoleModalOpen(true);
  };

  const saveRoleMutation = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingRole(true);
    try {
      const payload = {
        name: roleFormName,
        label: roleFormDesc,
        permissions: roleFormPerms,
      };

      if (editingRole) {
        await apiCall(`/api/custom-roles/${editingRole.id}`, { method: 'PUT', body: payload });
      } else {
        await apiCall('/api/custom-roles', { method: 'POST', body: payload });
      }
      setIsRoleModalOpen(false);
      fetchCustomRoles();
    } catch (err: any) {
      alert(`Role save failed: ${err.message}`);
    } finally {
      setSavingRole(false);
    }
  };

  const deleteCustomRole = async (id: string) => {
    if (!window.confirm('Delete this role forever?')) return;
    try {
      await apiCall(`/api/custom-roles/${id}`, { method: 'DELETE' });
      fetchCustomRoles();
    } catch (err: any) {
      alert(`Delete failed: ${err.message}`);
    }
  };


  return (
    <div style={{ display: 'flex', gap: 24, height: 'calc(100vh - 120px)' }}>
      {/* LEFT COLUMN: Main Team List & Invites */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
          <PageHeader title="Team Management" sub="Invite team members and control their granular access levels." />

          {/* Tab Matcher */}
          <div style={{ display: 'flex', background: 'var(--bg-card)', padding: 4, borderRadius: 8, border: '1px solid var(--border)' }}>
            <button
              onClick={() => setActiveTab('members')}
              style={{
                padding: '6px 16px', borderRadius: 6, fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer',
                background: activeTab === 'members' ? 'var(--bg-app)' : 'transparent',
                color: activeTab === 'members' ? 'var(--text-primary)' : 'var(--text-secondary)',
                boxShadow: activeTab === 'members' ? 'var(--shadow-sm)' : 'none',
              }}
            >
              Members
            </button>
            <button
              onClick={() => setActiveTab('roles')}
              style={{
                padding: '6px 16px', borderRadius: 6, fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer',
                background: activeTab === 'roles' ? 'var(--bg-app)' : 'transparent',
                color: activeTab === 'roles' ? 'var(--text-primary)' : 'var(--text-secondary)',
                boxShadow: activeTab === 'roles' ? 'var(--shadow-sm)' : 'none',
              }}
            >
              Custom Roles
            </button>
            <button
              onClick={() => setActiveTab('teams')}
              style={{
                padding: '6px 16px', borderRadius: 6, fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer',
                background: activeTab === 'teams' ? 'var(--bg-app)' : 'transparent',
                color: activeTab === 'teams' ? 'var(--text-primary)' : 'var(--text-secondary)',
                boxShadow: activeTab === 'teams' ? 'var(--shadow-sm)' : 'none',
              }}
            >
              Teams
            </button>
          </div>
        </div>

        <div style={{ overflowY: 'auto', paddingRight: 8 }} className="main-scroll-desktop">

          {activeTab === 'members' && (
            <>
              {/* Invite / Create form */}
              <SectionHeader title={createMode === 'invite' ? 'Invite Team Member' : 'Create User Account'} />
              <div
                className="animate-fadeIn"
                style={{
                  background: 'var(--bg-card)', border: '1px solid var(--border)',
                  borderRadius: 16, padding: 28, marginBottom: 36,
                }}
              >
                {/* Mode Toggle */}
                <div style={{ display: 'flex', gap: 4, marginBottom: 24, background: 'var(--bg-elevated)', padding: 4, borderRadius: 10, width: 'fit-content', border: '1px solid var(--border)' }}>
                  <button
                    onClick={() => setCreateMode('invite')}
                    style={{
                      padding: '8px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer',
                      background: createMode === 'invite' ? 'var(--accent)' : 'transparent',
                      color: createMode === 'invite' ? 'var(--accent-contrast)' : 'var(--text-secondary)',
                      transition: 'all 0.2s',
                    }}
                  >
                    <Mail size={13} style={{ display: 'inline', marginRight: 6, verticalAlign: '-2px' }} />
                    Send Invite
                  </button>
                  <button
                    onClick={() => setCreateMode('create')}
                    style={{
                      padding: '8px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600, border: 'none', cursor: 'pointer',
                      background: createMode === 'create' ? 'var(--accent)' : 'transparent',
                      color: createMode === 'create' ? 'var(--accent-contrast)' : 'var(--text-secondary)',
                      transition: 'all 0.2s',
                    }}
                  >
                    <Plus size={13} style={{ display: 'inline', marginRight: 6, verticalAlign: '-2px' }} />
                    Create Directly
                  </button>
                </div>

                {createMode === 'create' && (
                  <div style={{
                    padding: '10px 14px', borderRadius: 8, fontSize: 12, lineHeight: 1.5,
                    background: 'var(--accent-muted)', color: 'var(--accent)', border: '1px solid var(--accent)',
                    marginBottom: 20, display: 'flex', alignItems: 'center', gap: 8,
                  }}>
                    <Key size={14} />
                    Creates a fully activated account. The user can log in immediately with the credentials you set.
                  </div>
                )}

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 20 }}>
                  <div>
                    <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', display: 'block', marginBottom: 8 }}>
                      Email Address *
                    </label>
                    <Input placeholder="user@company.com" value={inviteEmail} onChange={setInviteEmail} />
                  </div>

                  {createMode === 'create' && (
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', display: 'block', marginBottom: 8 }}>
                        Full Name
                      </label>
                      <Input placeholder="e.g. John Doe" value={createFullName} onChange={setCreateFullName} />
                    </div>
                  )}

                  {createMode === 'create' && (
                    <div>
                      <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', display: 'block', marginBottom: 8 }}>
                        Password *
                      </label>
                      <Input placeholder="Min 6 characters" value={createPassword} onChange={setCreatePassword} type="password" />
                      {createPassword.length > 0 && (
                        <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ flex: 1, height: 4, borderRadius: 2, background: 'var(--border)', overflow: 'hidden' }}>
                            <div style={{
                              height: '100%', borderRadius: 2, transition: 'width 0.3s, background 0.3s',
                              width: createPassword.length < 6 ? '25%' : createPassword.length < 10 ? '60%' : '100%',
                              background: createPassword.length < 6 ? 'var(--red)' : createPassword.length < 10 ? 'var(--yellow)' : 'var(--green)',
                            }} />
                          </div>
                          <span style={{ fontSize: 10, fontWeight: 600, color: createPassword.length < 6 ? 'var(--red)' : createPassword.length < 10 ? 'var(--yellow)' : 'var(--green)' }}>
                            {createPassword.length < 6 ? 'Too short' : createPassword.length < 10 ? 'Good' : 'Strong'}
                          </span>
                        </div>
                      )}
                    </div>
                  )}

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
                <Button
                  onClick={createMode === 'invite' ? handleInvite : handleCreateUser}
                  disabled={inviteLoading || !inviteEmail.trim() || (createMode === 'create' && createPassword.length < 6)}
                >
                  {inviteLoading ? 'Processing...' : createMode === 'invite' ? 'Issue Invite' : 'Create User Account'}
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
                        <img
                          src={getAvatarUrl(member.avatar_url, member.email, 36)}
                          alt=""
                          style={{
                            width: 36, height: 36, borderRadius: '50%',
                            objectFit: 'cover', flexShrink: 0,
                            border: `2px solid ${colors.bg}`,
                            opacity: member.is_active ? 1 : 0.5,
                          }}
                        />

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
            </>
          )}

          {activeTab === 'roles' && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <SectionHeader title="Custom Roles" />
                <Button onClick={openNewRoleModal} icon={<Plus size={16} />}>Create Role</Button>
              </div>

              {rolesLoading ? (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>Loading...</div>
              ) : customRoles.length === 0 ? (
                <div style={{ padding: 48, textAlign: 'center', background: 'var(--bg-card)', borderRadius: 12, border: '1px dashed var(--border)' }}>
                  <ShieldAlert size={32} style={{ color: 'var(--text-tertiary)', marginBottom: 16, margin: '0 auto' }} />
                  <p style={{ color: 'var(--text-secondary)', marginBottom: 16 }}>No custom roles created yet.</p>
                  <Button onClick={openNewRoleModal}>Create First Role</Button>
                </div>
              ) : (
                <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))' }}>
                  {customRoles.map(role => {
                    const assignedCount = team.filter(m => m.custom_role_id === role.id).length;

                    return (
                      <div key={role.id} style={{
                        background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 20,
                        display: 'flex', flexDirection: 'column'
                      }}>
                        <h3 style={{ margin: '0 0 8px 0', fontSize: 16, color: 'var(--text-primary)' }}>{role.name}</h3>
                        <p style={{ margin: 0, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5, flex: 1 }}>
                          {role.label || 'No description provided.'}
                        </p>

                        <div style={{ display: 'flex', gap: 16, marginTop: 16, marginBottom: 16, fontSize: 12, color: 'var(--text-tertiary)' }}>
                          <span style={{ background: 'var(--bg-input)', padding: '4px 8px', borderRadius: 4 }}>
                            {Object.values(role.permissions).filter(Boolean).length} Explicit Perms
                          </span>
                          <span style={{ background: 'var(--bg-input)', padding: '4px 8px', borderRadius: 4 }}>
                            {assignedCount} Users
                          </span>
                        </div>

                        <div style={{ display: 'flex', gap: 8, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                          <Button onClick={() => openEditRoleModal(role)} variant="secondary" icon={<Edit2 size={14} />} style={{ flex: 1 }}>Edit</Button>
                          <Button onClick={() => deleteCustomRole(role.id)} variant="danger" icon={<Trash2 size={14} />} disabled={assignedCount > 0} style={{ padding: '8px 12px' }} />
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </>
          )}

          {activeTab === 'teams' && (
            <>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                <SectionHeader title="Teams" />
                <Button onClick={openNewTeamModal} icon={<Plus size={16} />}>Create Team</Button>
              </div>

              <div style={{ display: 'flex', gap: 24 }}>
                {/* Team List (left side) */}
                <div style={{ width: 280, flexShrink: 0 }}>
                  {teamsLoading ? (
                    <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>Loading...</div>
                  ) : teams.length === 0 ? (
                    <div style={{ padding: 48, textAlign: 'center', background: 'var(--bg-card)', borderRadius: 12, border: '1px dashed var(--border)' }}>
                      <Users size={32} style={{ color: 'var(--text-tertiary)', marginBottom: 16, margin: '0 auto' }} />
                      <p style={{ color: 'var(--text-secondary)', marginBottom: 16 }}>No teams created yet.</p>
                      <Button onClick={openNewTeamModal}>Create First Team</Button>
                    </div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {teams.map(t => (
                        <div
                          key={t.id}
                          onClick={() => selectTeam(t)}
                          style={{
                            padding: '14px 16px', borderRadius: 10, cursor: 'pointer',
                            background: selectedTeam?.id === t.id ? 'var(--accent-muted)' : 'var(--bg-card)',
                            border: `1px solid ${selectedTeam?.id === t.id ? 'var(--accent)' : 'var(--border)'}`,
                            transition: 'all 0.15s',
                          }}
                        >
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)' }}>{t.name}</span>
                            <span style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{t.member_count} members</span>
                          </div>
                          {t.description && (
                            <p style={{ margin: '6px 0 0', fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.4 }}>{t.description}</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Team Detail (right side) */}
                {selectedTeam && (
                  <div style={{ flex: 1, background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: 24 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                      <div>
                        <h3 style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>{selectedTeam.name}</h3>
                        {selectedTeam.description && <p style={{ fontSize: 13, color: 'var(--text-secondary)', margin: '4px 0 0' }}>{selectedTeam.description}</p>}
                      </div>
                      <div style={{ display: 'flex', gap: 8 }}>
                        <Button onClick={() => openEditTeamModal(selectedTeam)} variant="secondary" icon={<Edit2 size={14} />}>Edit</Button>
                        <Button onClick={() => deleteTeamAction(selectedTeam.id)} variant="danger" icon={<Trash2 size={14} />} />
                      </div>
                    </div>

                    {/* Add Member */}
                    <div style={{ marginBottom: 20 }}>
                      <div ref={addMemberDropdownRef} style={{ position: 'relative' }}>
                        <Button onClick={() => setAddMemberDropdownOpen(!addMemberDropdownOpen)} variant="secondary" icon={<Plus size={14} />}>Add Member</Button>
                        {addMemberDropdownOpen && (
                          <div style={{
                            position: 'absolute', top: '100%', left: 0, marginTop: 8, zIndex: 100,
                            background: 'var(--bg-app)', border: '1px solid var(--border)', borderRadius: 10,
                            boxShadow: '0 8px 32px -4px rgba(0,0,0,0.3)', maxHeight: 240, overflowY: 'auto',
                            width: 280, padding: 8,
                          }}>
                            {team
                              .filter(m => !teamMembers.some(tm => tm.profile_id === m.id))
                              .map(m => (
                                <div
                                  key={m.id}
                                  onClick={() => addTeamMember(m.id)}
                                  style={{
                                    padding: '8px 12px', borderRadius: 6, cursor: 'pointer',
                                    display: 'flex', alignItems: 'center', gap: 10,
                                    transition: 'background 0.1s',
                                  }}
                                  onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-card-hover)'}
                                  onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                                >
                                  <img
                                    src={getAvatarUrl(m.avatar_url, m.email, 28)}
                                    alt=""
                                    style={{ width: 28, height: 28, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
                                  />
                                  <div>
                                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{m.full_name || 'Unnamed'}</div>
                                    <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{m.email}</div>
                                  </div>
                                </div>
                              ))}
                            {team.filter(m => !teamMembers.some(tm => tm.profile_id === m.id)).length === 0 && (
                              <p style={{ padding: 12, textAlign: 'center', fontSize: 12, color: 'var(--text-tertiary)' }}>All users are already members</p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Member List */}
                    {teamMembersLoading ? (
                      <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>Loading members...</div>
                    ) : teamMembers.length === 0 ? (
                      <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-tertiary)', fontSize: 13 }}>No members in this team yet.</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {teamMembers.map(m => (
                          <div
                            key={m.profile_id}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 12,
                              padding: '12px 16px', borderRadius: 10,
                              background: 'var(--bg-app)', border: '1px solid var(--border)',
                            }}
                          >
                            {(() => {
                              const fallbackProfile = team.find(t => t.id === m.profile_id);
                              const avatarUrl = m.profile?.avatar_url ?? fallbackProfile?.avatar_url ?? null;
                              const emailSeed = m.profile?.email ?? fallbackProfile?.email ?? m.profile_id;
                              return (
                                <img
                                  src={getAvatarUrl(avatarUrl, emailSeed, 32)}
                                  alt=""
                                  style={{ width: 32, height: 32, borderRadius: '50%', objectFit: 'cover', flexShrink: 0 }}
                                />
                              );
                            })()}
                            <div style={{ flex: 1 }}>
                              {(() => {
                                const fallback = team.find(t => t.id === m.profile_id);
                                const name = m.profile?.full_name || fallback?.full_name || fallback?.email?.split('@')[0] || 'Unknown';
                                const email = m.profile?.email || fallback?.email || '';
                                return (
                                  <>
                                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{name}</div>
                                    <div style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>{email}</div>
                                  </>
                                );
                              })()}
                            </div>
                            <select
                              value={m.role_id || ''}
                              onChange={e => updateTeamMemberRole(m.profile_id, e.target.value || null)}
                              style={{
                                padding: '6px 10px', borderRadius: 6, fontSize: 11, fontWeight: 500,
                                background: 'var(--bg-input)', border: '1px solid var(--border)',
                                color: 'var(--text-primary)', cursor: 'pointer',
                              }}
                            >
                              <option value="">No team role</option>
                              {customRoles.map(cr => (
                                <option key={cr.id} value={cr.id}>{cr.name}</option>
                              ))}
                            </select>
                            <button
                              onClick={() => removeTeamMember(m.profile_id)}
                              style={{
                                background: 'none', border: 'none', color: 'var(--text-tertiary)',
                                cursor: 'pointer', padding: 4, borderRadius: 4,
                                transition: 'color 0.1s',
                              }}
                              onMouseEnter={e => e.currentTarget.style.color = 'var(--red)'}
                              onMouseLeave={e => e.currentTarget.style.color = 'var(--text-tertiary)'}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}

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
              <img
                src={getAvatarUrl(selectedUser.avatar_url, selectedUser.email, 40)}
                alt=""
                style={{
                  width: 40, height: 40, borderRadius: '50%', objectFit: 'cover', flexShrink: 0,
                }}
              />
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

              <div>
                <label style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', color: 'var(--text-tertiary)', display: 'block', marginBottom: 8 }}>
                  Custom Role Overlay
                </label>
                <select
                  value={selectedUser.custom_role_id || ''}
                  onChange={(e) => changeCustomRole(e.target.value || null)}
                  style={{
                    width: '100%', padding: '10px 16px', borderRadius: 8,
                    fontSize: 13, fontWeight: 500, outline: 'none',
                    background: 'var(--bg-input)', border: '1px solid var(--border)',
                    color: 'var(--text-primary)', cursor: 'pointer',
                  }}
                >
                  <option value="">None (Base Role Only)</option>
                  {customRoles.map(cr => (
                    <option key={cr.id} value={cr.id}>{cr.name}</option>
                  ))}
                </select>
                <p style={{ fontSize: 11, color: 'var(--text-tertiary)', marginTop: 8 }}>
                  Custom roles merge extra permissions on top of the base role defaults.
                </p>
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
                      const crPerms = selectedUser.custom_roles?.permissions || {};
                      const resolved = resolvePermissions(selectedUser.role, crPerms, editingPermissions);
                      const isAllowed = resolved[p.key];

                      const isUserOverride = (p.key in editingPermissions) && typeof editingPermissions[p.key] === 'boolean';
                      const isRoleOverride = (p.key in crPerms) && typeof crPerms[p.key] === 'boolean' && !isUserOverride;

                      const toggleP = () => {
                        const next = { ...editingPermissions };
                        // If it was already a user override, delete the override to fallback to Role/Base
                        if (isUserOverride) {
                          delete next[p.key];
                        } else {
                          // Specify exact opposite of current effective state
                          next[p.key] = !isAllowed;
                        }
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
                          <div style={{ display: 'flex', gap: 6 }}>
                            {isRoleOverride && (
                              <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--purple)', background: 'var(--purple-muted)', padding: '2px 6px', borderRadius: 4 }}>
                                FROM ROLE
                              </span>
                            )}
                            {isUserOverride && (
                              <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--yellow)', background: 'var(--yellow-muted)', padding: '2px 6px', borderRadius: 4 }}>
                                USER OVERRIDE
                              </span>
                            )}
                          </div>
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


      {/* CUSTOM ROLE MODAL */}
      {isRoleModalOpen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24, paddingBottom: 100
        }}>
          <div className="animate-slideInRight" style={{
            background: 'var(--bg-app)', border: '1px solid var(--border)', borderRadius: 16, width: 600, maxWidth: '100%',
            maxHeight: '90vh', display: 'flex', flexDirection: 'column'
          }}>
            <div style={{ padding: 24, borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: 18, margin: 0 }}>{editingRole ? 'Edit Custom Role' : 'Create Custom Role'}</h2>
              <button onClick={() => setIsRoleModalOpen(false)} style={{ background: 'transparent', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer' }}>✕</button>
            </div>

            <form onSubmit={saveRoleMutation} style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

              <div style={{ padding: 24, overflowY: 'auto' }} className="main-scroll-desktop">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 16, marginBottom: 32 }}>
                  <div>
                    <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Role Name</label>
                    <input
                      required
                      value={roleFormName} onChange={(e) => setRoleFormName(e.target.value)}
                      placeholder="e.g. Sales Manager"
                      style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 14 }}
                    />
                  </div>
                  <div>
                    <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Description (Optional)</label>
                    <input
                      value={roleFormDesc} onChange={(e) => setRoleFormDesc(e.target.value)}
                      placeholder="What does this role do?"
                      style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 14 }}
                    />
                  </div>
                </div>

                <div style={{ borderTop: '1px solid var(--border)', paddingTop: 24 }}>
                  <h4 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16 }}>Select Permissions</h4>
                  {Object.entries(groupedPerms).map(([group, perms]) => (
                    <div key={group} style={{ marginBottom: 24 }}>
                      <h5 style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', color: 'var(--text-tertiary)', marginBottom: 12 }}>{group}</h5>
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 8 }}>
                        {perms.map(p => {
                          const isAllowed = !!roleFormPerms[p.key];
                          return (
                            <label
                              key={p.key}
                              style={{
                                display: 'flex', alignItems: 'center', gap: 8,
                                padding: '8px 12px', borderRadius: 8,
                                background: isAllowed ? 'var(--accent-muted)' : 'var(--bg-card)',
                                border: `1px solid ${isAllowed ? 'var(--accent)' : 'var(--border)'}`,
                                cursor: 'pointer', transition: 'all 0.1s',
                              }}
                            >
                              <input
                                type="checkbox"
                                checked={isAllowed}
                                onChange={(e) => setRoleFormPerms(prev => {
                                  const next = { ...prev };
                                  if (e.target.checked) { next[p.key] = true; } else { delete next[p.key]; }
                                  return next;
                                })}
                                style={{ margin: 0 }}
                              />
                              <span style={{ fontSize: 12, fontWeight: 500, color: isAllowed ? 'var(--accent)' : 'var(--text-secondary)' }}>
                                {p.label}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border)', background: 'var(--bg-app)', display: 'flex', gap: 12 }}>
                <Button type="submit" disabled={savingRole} style={{ flex: 1 }}>{savingRole ? 'Saving...' : (editingRole ? 'Save Changes' : 'Create Role')}</Button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* TEAM MODAL */}
      {isTeamModalOpen && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 24,
        }}>
          <div className="animate-slideInRight" style={{
            background: 'var(--bg-app)', border: '1px solid var(--border)', borderRadius: 16, width: 480, maxWidth: '100%',
          }}>
            <div style={{ padding: 24, borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <h2 style={{ fontSize: 18, margin: 0 }}>{editingTeam ? 'Edit Team' : 'Create Team'}</h2>
              <button onClick={() => setIsTeamModalOpen(false)} style={{ background: 'transparent', border: 'none', color: 'var(--text-tertiary)', cursor: 'pointer' }}>✕</button>
            </div>
            <form onSubmit={saveTeamMutation}>
              <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 16 }}>
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Team Name</label>
                  <input
                    required
                    value={teamFormName} onChange={(e) => setTeamFormName(e.target.value)}
                    placeholder="e.g. Sales Team"
                    style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 14 }}
                  />
                </div>
                <div>
                  <label style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Description (Optional)</label>
                  <input
                    value={teamFormDesc} onChange={(e) => setTeamFormDesc(e.target.value)}
                    placeholder="What does this team do?"
                    style={{ width: '100%', padding: '10px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-input)', color: 'var(--text-primary)', fontSize: 14 }}
                  />
                </div>
              </div>
              <div style={{ padding: '16px 24px', borderTop: '1px solid var(--border)', background: 'var(--bg-app)' }}>
                <Button type="submit" disabled={savingTeam} full>{savingTeam ? 'Saving...' : (editingTeam ? 'Save Changes' : 'Create Team')}</Button>
              </div>
            </form>
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
